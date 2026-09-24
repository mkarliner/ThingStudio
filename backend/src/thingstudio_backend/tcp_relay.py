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
# discover() broadcasts the UDP probe and collects replies for the editor's board list.
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
    "timeout", or "network" for everything else."""

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
            raise TcpRelayError(self.port, "connect", exc) from exc
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


def discover(timeout_s: float = 1.5, targets: list[str] | None = None, probe_port: int = PROBE_PORT) -> list[DiscoveredBoard]:
    """Broadcasts the probe and returns every distinct board that answers within `timeout_s`.
    Blocking -- ws_relay runs it in a thread. `targets` overrides the broadcast address (tests).
    Never raises: a network with no broadcast route just finds nothing, logged."""
    found: dict[tuple[str, str], DiscoveredBoard] = {}
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    except OSError as exc:
        logger.warning("board discovery: could not open a UDP socket: %s", exc)
        return []
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for target in targets or ["255.255.255.255"]:
            try:
                sock.sendto(PROBE_REQUEST, (target, probe_port))
            except OSError as exc:
                logger.warning("board discovery: probe to %s failed: %s", target, exc)
        deadline = time.monotonic() + timeout_s
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            sock.settimeout(remaining)
            try:
                data, (address, _port) = sock.recvfrom(2048)
            except (socket.timeout, TimeoutError):
                break
            except OSError as exc:
                logger.warning("board discovery: receive failed: %s", exc)
                break
            board = _parse_probe_reply(data, address)
            if board is not None:
                found[(board.hostname, board.address)] = board
    finally:
        sock.close()
    return sorted(found.values(), key=lambda b: b.hostname)
