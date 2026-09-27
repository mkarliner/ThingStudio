# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/tcp_relay.py
#
# WiFi transport, backend side (MVP item 6 -- docs/working-notes/wifi-transport-scoping.md).
#
# TcpConnection is a drop-in for serial_relay.SerialConnection (same open/write/read_loop/
# request_stop/close and `port` attribute), so ws_relay.ConnectionSession relays a network board
# exactly the way it relays a serial one: the board speaks the same `F64:` lines plus plain print()
# output over TCP (device-runtime/src/net_transport.py), and line_framing.py splits them as before.
#
# What's different from serial is the start: the board sends a challenge and nothing else happens
# until this side answers it (net_transport.py's header has the exchange). The password comes from
# the caller -- ws_relay looks it up in the credential store by the hostname the board names in its
# challenge, or uses one the editor just asked the user for. It never goes over the network: only
# HMAC-SHA256(sha256^N(salt + password), nonce) does.
#
# scan()/discover() send the UDP probe to each interface's broadcast address and collect replies for the
# editor's board list.
#
# Fault handling: every failure is a TcpRelayError naming the host and the step, the same
# NODE_ERROR shape SerialRelayError uses; the handshake distinguishes the cases a user can act on
# (no saved password, wrong password, board busy, no password set on the board, timeout). Every
# network wait is bounded.

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import socket
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

from .net_interfaces import broadcast_addresses

logger = logging.getLogger(__name__)

DEFAULT_PORT = 7462
PROBE_PORT = 7463
PROBE_REQUEST = b"TSPROBE1"
_CONNECT_TIMEOUT_S = 8.0
_HANDSHAKE_TIMEOUT_S = 10.0
_READ_CHUNK_SIZE = 4096
_WRITE_TIMEOUT_S = 5.0
KEEPALIVE_INTERVAL_S = 30.0


class TcpRelayError(Exception):
    """A network operation failed. `code` lets the editor react to the cases a user can fix:
    "no_password" (none saved for this board), "auth_failed", "busy", "board_no_password",
    "timeout", "refused" (the board's address answered but nothing listens on the port -- almost always
    no password set on the board, since it only opens the port once one is), or "network" for everything
    else."""

    def __init__(self, host: str, operation: str, cause: object, code: str = "network", hostname: str | None = None) -> None:
        super().__init__(f"NODE_ERROR: network {operation} failed for {host}: {cause}")
        self.host = host
        self.operation = operation
        self.cause = cause
        self.code = code
        self.hostname = hostname


def derive_key(salt: bytes, password: str, iterations: int) -> bytes:
    key = salt + password.encode("utf-8")
    for _ in range(iterations):
        key = hashlib.sha256(key).digest()
    return key


def answer_challenge(challenge: str, password: str) -> str:
    """The reply line for a `TSAUTH1 <hostname> <nonce> <salt> <iterations>` challenge."""
    parts = challenge.split(" ")
    if len(parts) != 5 or parts[0] != "TSAUTH1":
        raise ValueError(f"not a TSAUTH1 challenge: {challenge[:80]!r}")
    nonce, salt, iterations = bytes.fromhex(parts[2]), bytes.fromhex(parts[3]), int(parts[4])
    if not 1 <= iterations <= 1_000_000:
        raise ValueError(f"implausible iteration count {iterations}")
    mac = hmac.new(derive_key(salt, password, iterations), nonce, hashlib.sha256).hexdigest()
    return f"TSAUTH1 {mac}"


def _explain_connect_oserror(exc: OSError) -> str:
    """Adds the likely fix to the network errors a user can act on. EHOSTUNREACH on macOS is usually
    the Local Network privacy setting, not the network: since macOS 15, a program started from
    Terminal can't reach LAN devices until the app that launched it is allowed, and the refusal
    surfaces as "No route to host" (2026-09-25, first real ESP32-C3 WiFi test). Apple's Terminal is
    exempt (TN3179); iTerm, even when allowed, didn't cover Homebrew's framework Python.
    Also sent for the discovery broadcast (discover()), which needs the same permission."""
    import errno
    import sys

    text = str(exc)
    if exc.errno == errno.EHOSTUNREACH and sys.platform == "darwin":
        return (
            f"{text} -- on a Mac this usually means macOS is blocking Thingstudio's local network access. Allow "
            "Thingstudio in System Settings > Privacy & Security > Local Network, then restart it. Running from "
            "source, start it from Apple's Terminal app instead, which macOS always allows"
        )
    if exc.errno in (errno.EHOSTUNREACH, errno.ENETUNREACH):
        return f"{text} -- check this computer and the board are on the same network (not a guest network)"
    if exc.errno == errno.ECONNREFUSED:
        return f"{text} -- the board is on the network but isn't accepting connections: is a WiFi password set in Board settings?"
    return text


DEAD_PEER_TIMEOUT_S = 20


def enable_dead_peer_detection(sock: socket.socket, timeout_s: int = DEAD_PEER_TIMEOUT_S) -> list[str]:
    """Makes this computer's TCP stack notice a board that vanished without closing the connection -- pulled
    power, a reset mid-session (2026-09-25, ESP32-C3: the editor never showed "disconnected"). Nothing arrives
    to say the board has gone, so without this the socket looks open until a write times out, many minutes
    later on macOS. Two parts, because either alone misses a case:
      - TCP keepalive probes when the line is idle (the board's network stack answers them by itself);
      - a cap on how long sent data may stay unacknowledged, since keepalive pauses while there is some --
        and the 30 s keepalive line (_keepalive, below) always leaves some.
    Options this platform lacks are skipped; returns the names that were set, for the log. Best-effort: a
    failure here must never stop a connection that would otherwise work."""
    import sys

    done: list[str] = []

    def opt(level: int, name: str, value: int, fallback: int | None = None) -> None:
        number = getattr(socket, name, fallback)
        if number is None:
            return
        try:
            sock.setsockopt(level, number, value)
            done.append(name)
        except OSError:
            pass

    opt(socket.SOL_SOCKET, "SO_KEEPALIVE", 1)
    if sys.platform == "darwin":
        opt(socket.IPPROTO_TCP, "TCP_KEEPALIVE", 5, 0x10)  # idle seconds before the first probe
        opt(socket.IPPROTO_TCP, "TCP_KEEPINTVL", 3, 0x101)
        opt(socket.IPPROTO_TCP, "TCP_KEEPCNT", 3, 0x102)
        opt(socket.IPPROTO_TCP, "TCP_RXT_CONNDROPTIME", timeout_s, 0x80)  # seconds of unacked retransmits
    else:
        opt(socket.IPPROTO_TCP, "TCP_KEEPIDLE", 5)
        opt(socket.IPPROTO_TCP, "TCP_KEEPINTVL", 3)
        opt(socket.IPPROTO_TCP, "TCP_KEEPCNT", 3)
        opt(socket.IPPROTO_TCP, "TCP_USER_TIMEOUT", timeout_s * 1000)  # milliseconds (Linux)
    return done


PasswordLookup = Callable[[str], "str | None"]


class TcpConnection:
    """One authenticated network session with a board. Same interface as SerialConnection."""

    def __init__(
        self,
        host: str,
        tcp_port: int = DEFAULT_PORT,
        password: str | None = None,
        password_lookup: PasswordLookup | None = None,
    ) -> None:
        self.host = host
        self.tcp_port = tcp_port
        self.port = f"{host}:{tcp_port}"  # what status messages show, like a serial device path
        self.hostname: str | None = None  # the board's own name, from its challenge
        self._password = password
        self._password_lookup = password_lookup
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._stop_requested = False
        self._keepalive_task: asyncio.Task[None] | None = None
        self._pending = b""  # bytes read past the handshake, handed to read_loop first

    async def open(self) -> None:
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.tcp_port), _CONNECT_TIMEOUT_S
            )
        except asyncio.TimeoutError as exc:
            raise TcpRelayError(self.port, "connect", f"no answer within {_CONNECT_TIMEOUT_S:.0f}s -- is the board on and on this network?", "timeout") from exc
        except OSError as exc:
            import errno

            code = "refused" if exc.errno == errno.ECONNREFUSED else "network"
            raise TcpRelayError(self.port, "connect", _explain_connect_oserror(exc), code) from exc
        raw_sock = self._writer.get_extra_info("socket") if self._writer is not None else None
        if raw_sock is not None:
            logger.info("%s: dead-peer detection %s", self.port, ", ".join(enable_dead_peer_detection(raw_sock)) or "unavailable")
        try:
            await self._handshake()
        except BaseException:
            await self._close_socket()
            raise
        self._keepalive_task = asyncio.create_task(self._keepalive())

    async def _readline(self, what: str) -> str:
        assert self._reader is not None
        try:
            raw = await asyncio.wait_for(self._reader.readline(), _HANDSHAKE_TIMEOUT_S)
        except asyncio.TimeoutError as exc:
            raise TcpRelayError(self.port, "handshake", f"no {what} within {_HANDSHAKE_TIMEOUT_S:.0f}s", "timeout") from exc
        except OSError as exc:
            raise TcpRelayError(self.port, "handshake", exc) from exc
        if not raw:
            raise TcpRelayError(self.port, "handshake", f"connection closed before the {what}")
        return raw.decode("utf-8", "replace").strip()

    async def _handshake(self) -> None:
        assert self._writer is not None
        challenge = await self._readline("challenge")
        if challenge == "TSAUTH BUSY":
            raise TcpRelayError(self.port, "handshake", "the board already has a network session open -- disconnect the other editor first", "busy")
        if challenge == "TSAUTH NOPASSWORD":
            raise TcpRelayError(self.port, "handshake", "the board has no password set -- set one in Board settings over USB", "board_no_password")
        parts = challenge.split(" ")
        if len(parts) != 5 or parts[0] != "TSAUTH1":
            raise TcpRelayError(self.port, "handshake", f"not a Thingstudio board (got {challenge[:60]!r})")
        self.hostname = parts[1]
        password = self._password
        if password is None and self._password_lookup is not None:
            password = self._password_lookup(self.hostname)
        if password is None:
            raise TcpRelayError(self.port, "handshake", f"no saved password for board {self.hostname}", "no_password", self.hostname)
        try:
            answer = answer_challenge(challenge, password)
        except ValueError as exc:
            raise TcpRelayError(self.port, "handshake", exc) from exc
        self._writer.write((answer + "\n").encode())
        await self._drain()
        verdict = await self._readline("answer to the password")
        if verdict == "TSAUTH FAIL":
            raise TcpRelayError(self.port, "handshake", f"wrong password for board {self.hostname}", "auth_failed", self.hostname)
        if verdict != "TSAUTH OK":
            raise TcpRelayError(self.port, "handshake", f"unexpected reply {verdict[:60]!r}")
        # Show the board's own name from here on: "kitchen.local", or "kitchen (192.168.1.42)".
        if self.host in (self.hostname, f"{self.hostname}.local"):
            self.port = f"{self.hostname}.local"
        else:
            self.port = f"{self.hostname} ({self.host})"

    async def _drain(self) -> None:
        assert self._writer is not None
        try:
            await asyncio.wait_for(self._writer.drain(), _WRITE_TIMEOUT_S)
        except asyncio.TimeoutError as exc:
            raise TcpRelayError(self.port, "write", f"blocked for {_WRITE_TIMEOUT_S:.0f}s", "timeout") from exc
        except OSError as exc:
            raise TcpRelayError(self.port, "write", exc) from exc

    async def write(self, data: bytes) -> None:
        if self._writer is None:
            raise TcpRelayError(self.port, "write", "not connected")
        try:
            self._writer.write(data)
        except (OSError, RuntimeError) as exc:
            raise TcpRelayError(self.port, "write", exc) from exc
        await self._drain()

    async def _keepalive(self) -> None:
        """A blank line every KEEPALIVE_INTERVAL_S: the board drops a session that sends nothing for
        90 s (net_transport.py), so an idle editor stays connected and a vanished one doesn't."""
        while not self._stop_requested:
            await asyncio.sleep(KEEPALIVE_INTERVAL_S)
            try:
                await self.write(b"\n")
            except TcpRelayError as exc:
                logger.info("keepalive to %s failed: %s", self.port, exc)
                return

    async def read_loop(self) -> AsyncIterator[bytes]:
        if self._reader is None:
            raise TcpRelayError(self.port, "read", "not connected")
        while not self._stop_requested:
            try:
                chunk = await self._reader.read(_READ_CHUNK_SIZE)
            except OSError as exc:
                if self._stop_requested:
                    return
                if getattr(exc, "errno", None) in (60, 110):  # ETIMEDOUT (macOS, Linux): enable_dead_peer_detection() fired
                    raise TcpRelayError(self.port, "read", "the board stopped answering (power lost, reset, or out of WiFi range)") from exc
                raise TcpRelayError(self.port, "read", exc) from exc
            if not chunk:
                if self._stop_requested:
                    return
                raise TcpRelayError(self.port, "read", "the board closed the connection (reset, WiFi dropped, or its password was changed)")
            yield chunk

    def request_stop(self) -> None:
        self._stop_requested = True

    async def _close_socket(self) -> None:
        if self._writer is not None:
            try:
                self._writer.close()
                await asyncio.wait_for(self._writer.wait_closed(), 2.0)
            except (OSError, asyncio.TimeoutError, RuntimeError):
                pass
        self._writer = None
        self._reader = None

    async def close(self) -> None:
        self.request_stop()
        if self._keepalive_task is not None:
            self._keepalive_task.cancel()
            self._keepalive_task = None
        await self._close_socket()


@dataclass(frozen=True)
class DiscoveredBoard:
    hostname: str
    address: str
    port: int
    chip: str
    flow: str | None
    wifi_transport: bool
    busy: bool


def _parse_probe_reply(data: bytes, address: str) -> DiscoveredBoard | None:
    try:
        obj = json.loads(data)
        if not isinstance(obj, dict) or obj.get("ts") != 1:
            return None
        return DiscoveredBoard(
            hostname=str(obj["hostname"]),
            address=address,
            port=int(obj.get("port", DEFAULT_PORT)),
            chip=str(obj.get("chip", "")),
            flow=obj.get("flow") if isinstance(obj.get("flow"), str) else None,
            wifi_transport=bool(obj.get("wifiTransport")),
            busy=bool(obj.get("busy")),
        )
    except (ValueError, KeyError, TypeError):
        return None


_PROBE_RESEND_S = 0.4


@dataclass(frozen=True)
class DiscoveryResult:
    """What a scan found. `problem` is set only when the probe couldn't be sent anywhere, so an empty
    list means "nothing answered" rather than "couldn't look" -- the editor shows it to the user."""
    boards: list[DiscoveredBoard]
    problem: str | None = None


def scan(timeout_s: float = 1.5, targets: list[str] | None = None, probe_port: int = PROBE_PORT) -> DiscoveryResult:
    """Sends the probe and returns every distinct board that answers within `timeout_s`.
    Blocking -- ws_relay runs it in a thread. Never raises.

    Targets: the broadcast address of every WiFi/Ethernet interface (net_interfaces.py), falling back to
    255.255.255.255 where interfaces can't be listed; `targets` overrides both (tests). Not the limited
    broadcast alone: on macOS it can fail with "No route to host" while the interface's own broadcast
    address works (2026-09-27), and it only ever leaves by one interface.

    The probe goes out every _PROBE_RESEND_S until the deadline, not once: WiFi broadcasts aren't
    acknowledged or retried, and a board in modem sleep can miss one. (On the 2026-09-25 bench, both
    boards answered within 0.3 s; a "missing" second board was the port menu's stale placeholder, not
    discovery.) Replies are de-duplicated by (hostname, address)."""
    if targets is None:
        targets = broadcast_addresses() or ["255.255.255.255"]
    found: dict[tuple[str, str], DiscoveredBoard] = {}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    except OSError as exc:
        logger.warning("board discovery: could not open a UDP socket: %s", exc)
        return DiscoveryResult([], f"couldn't open a network socket for the WiFi scan: {exc}")
    failures: dict[str, OSError] = {}
    sent_any = False
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)

        def send_probes() -> None:
            nonlocal sent_any
            for target in targets:
                try:
                    sock.sendto(PROBE_REQUEST, (target, probe_port))
                    sent_any = True
                except OSError as exc:
                    if target not in failures:  # once per scan, not once per resend
                        failures[target] = exc
                        logger.debug("board discovery: probe to %s failed: %s", target, exc)

        start = time.monotonic()
        deadline = start + timeout_s
        next_send = start
        while True:
            now = time.monotonic()
            remaining = deadline - now
            if remaining <= 0:
                break
            if now >= next_send:
                send_probes()
                next_send = now + _PROBE_RESEND_S
            sock.settimeout(max(0.01, min(remaining, next_send - now)))
            try:
                data, (address, _port) = sock.recvfrom(2048)
            except (socket.timeout, TimeoutError):
                continue  # time to resend, or the loop's deadline check ends the scan
            except OSError as exc:
                logger.warning("board discovery: receive failed: %s", exc)
                break
            board = _parse_probe_reply(data, address)
            if board is not None:
                if (board.hostname, board.address) not in found:
                    logger.debug("board discovery: %s (%s) answered after %.1fs", board.hostname, address, time.monotonic() - start)
                found[(board.hostname, board.address)] = board
    finally:
        sock.close()
    boards = sorted(found.values(), key=lambda b: b.hostname)
    problem = None
    if not sent_any and failures:
        exc = next(iter(failures.values()))
        problem = f"couldn't send the WiFi scan to {', '.join(failures)}: {_explain_connect_oserror(exc)}"
        logger.warning("board discovery: %s", problem)
    elif failures:
        logger.info("board discovery: probe failed for %s, sent to the others", ", ".join(failures))
    return DiscoveryResult(boards, problem)


def discover(timeout_s: float = 1.5, targets: list[str] | None = None, probe_port: int = PROBE_PORT) -> list[DiscoveredBoard]:
    """scan(), boards only."""
    return scan(timeout_s, targets, probe_port).boards
