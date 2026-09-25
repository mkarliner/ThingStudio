# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/ws_relay.py
#
# One WebSocket endpoint, multiplexed by frame type (docs/working-notes/
# backend-editor-auth-and-protocol.md §2):
#   - Binary frames: §13's CBOR-framed device-protocol bytes, exactly one
#     complete frame per WS message, both directions -- this module never
#     decodes CBOR. Browser -> serial: each binary WS message already IS
#     one complete, already-framed protocol frame (codec.ts/framing.ts's
#     job on the browser side); this relay wraps it as one base64/"F64:"
#     text line (line_framing.py's encode_f64_line) and writes that line to
#     the serial port -- see line_framing.py's header for why the raw
#     bytes can't go straight to the wire. Serial -> browser: the serial
#     port is a boundary-less byte stream of such lines (plus the device's
#     own plain print()/debug lines interleaved), so line_framing.py's
#     LineDecoder reconstructs line boundaries and classifies each one;
#     an F64 line's decoded frame bytes become one WS binary message,
#     forwarded verbatim (not re-encoded).
#   - Text frames: JSON backend control-plane messages -- some with no
#     device counterpart (list serial ports, connect/disconnect, connection
#     status), and one, "debug", that relays the device's own plain
#     print()/debug lines (a LineDecoder debug_text event) so they still
#     reach the browser's console the way they already do in the direct
#     WebSerial connection mode (transport.ts's onDebugLine).
#
# Corrected 2026-09-07 (editor-backend-wiring session): this module
# originally ran framing.py's FrameDecoder directly against the raw serial
# byte stream, which assumes §13's binary frame layout rides the wire
# unmodified. It doesn't -- the real device listener
# (device-runtime/src/listener.py) only ever speaks the base64/F64-line
# encoding line_framing.py now implements; see that module's header and
# docs/working-notes/learnings/backend-serial-wire-format.md for the full
# incident. This was a real, previously-untested-against-the-real-contract
# bug, not a design change: the WS<->browser binary contract described
# above (one complete frame per WS message) is exactly what
# backend-editor-auth-and-protocol.md §2 always specified and is unchanged;
# only the internal serial<->relay boundary was wrong.
#
# Fault handling: a serial disconnect or open failure becomes a structured
# {"type": "status", ...} text message to the browser, never an uncaught
# exception that drops the WebSocket or crashes the backend process --
# same fault-isolation posture as the relay's serial layer and the
# device-side listener it's modeled after.
#
# "install_runtime" control message (2026-09-22, MVP item 1's first backend slice --
# outstanding-items/deploy-runtime-from-editor.md): pushes the runtime onto a board with raw
# REPL (raw_repl.py/runtime_installer.py) instead of the normal listener-relay path -- a bare
# board has no listener running at all, so there's nothing for the usual connect/binary-relay
# flow above to talk to. Deliberately NOT layered on SerialConnection: raw REPL needs
# synchronous, marker-driven reads (raw_repl.py's own _ByteReader), a different discipline
# from SerialConnection's async read_loop generator built for continuous line-by-line
# relaying. Opens its own dedicated port instead, closing any existing relay connection
# first (raw REPL needs exclusive access) -- the whole install runs as one blocking
# asyncio.to_thread() call, so v1 has no live progress messages, only a final
# {"type": "install_runtime_result", "ok": ..., "error"?: ...}. Deliberately does not try to
# auto-reconnect afterward: hard_reset() can make a board re-enumerate its USB port
# (RP2040's native USB, unlike an ESP32's separate UART bridge chip) on a timeline this
# backend has no way to predict -- per CLAUDE.md's "make the failure legible, don't chase
# every board's idiosyncrasy" -- so the browser is told to prompt the user to reconnect
# manually instead.

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import re
import time
from typing import Callable

import serial
from aiohttp import WSMsgType, web

from . import board_recovery
from .line_framing import LineDecoder, encode_f64_line
from .raw_repl import ENTER_STEP, RawReplError, classify_reply
from .board_recovery import CATCH_STEP
from .runtime_installer import RuntimeInstaller
from .serial_relay import SerialConnection, SerialRelayError, list_ports
from .tcp_relay import DEFAULT_PORT as DEFAULT_TCP_PORT
from .tcp_relay import PasswordLookup, TcpConnection, TcpRelayError, discover

# Either kind of board connection: serial_relay.SerialConnection or tcp_relay.TcpConnection share one
# interface (open/write/read_loop/request_stop/close, `port`), and both raise their own *RelayError.
_RELAY_ERRORS = (SerialRelayError, TcpRelayError)

logger = logging.getLogger(__name__)

# Poll timeout for the raw port opened specifically for install_runtime -- same
# responsiveness-bound reasoning serial_relay.py's own _READ_POLL_TIMEOUT_SECONDS gives (bounds
# how long one blocking read() can hold the executor thread), not a protocol-level timeout on
# its own; raw_repl.py's own RawReplTimeouts own the actual per-step deadlines.
_INSTALL_READ_POLL_TIMEOUT_SECONDS = 0.5

# Write bound for that same port. pyserial's default is to block forever on a board that stops
# reading -- the real 2026-09-23 ESP32-S2 install hang. raw_repl._write() turns the timeout into a
# RawReplError naming the step. Same value and reasoning as serial_relay.py's _WRITE_TIMEOUT_SECONDS.
_INSTALL_WRITE_TIMEOUT_SECONDS = 5.0

# How long "Remove flow" keeps trying to catch a boot window before giving up -- long enough for a
# user to read "press reset" and do it, and for a boot-looping board to cycle a few times.
_REMOVE_FLOW_TIMEOUT_SECONDS = 60.0
# How long Install runtime waits for a running board to stop at a prompt (board_recovery.catch_prompt).
_INSTALL_CATCH_TIMEOUT_SECONDS = 60.0


# Serial ports with an install or Remove flow in progress, across every WebSocket session in this
# process. Each such job opens the port itself in a thread, so two of them on one port interleave
# raw-REPL traffic and both fail (seen 2026-09-24: four clicks on "Install runtime…" while a Pico
# waited for a reset gave "multiple access on port" and one install reading another's raw-REPL
# banner). A second job on a busy port is refused straight away instead.
_BUSY_PORTS: set[str] = set()


_MPY_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]{0,40}\.mpy$")
_MAX_COMPILED_FILES = 64
_MAX_COMPILED_BYTES = 512 * 1024


def _decode_compiled(value: object) -> tuple[dict[str, bytes] | None, str | None]:
    """install_runtime's optional "compiled" field (2026-09-25): {"<module>.mpy": base64} from the
    editor's mpy-cross. Absent means install from source, as before. Names are plain module names only
    (they become board file names); sizes are capped. Returns (files, None) or (None, problem)."""
    if value is None:
        return None, None
    if not isinstance(value, dict) or len(value) > _MAX_COMPILED_FILES:
        return None, '"compiled" must be an object of at most %d files' % _MAX_COMPILED_FILES
    out: dict[str, bytes] = {}
    total = 0
    for name, b64 in value.items():
        if not isinstance(name, str) or not _MPY_NAME_RE.match(name) or not isinstance(b64, str):
            return None, f"bad compiled file entry {str(name)[:50]!r}"
        try:
            data = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            return None, f"compiled file {name} isn't valid base64"
        if not data.startswith(b"M"):
            return None, f"compiled file {name} isn't a .mpy (bad header)"
        total += len(data)
        if total > _MAX_COMPILED_BYTES:
            return None, "compiled files are too large in total"
        out[name] = data
    return out, None


class ConnectionSession:
    """Per-WebSocket-connection state: at most one open serial port at a time,
    matching this backend's one-backend-one-device v1 scope."""

    def __init__(
        self,
        ws: web.WebSocketResponse,
        serial_connection_factory: type[SerialConnection] | object = SerialConnection,
        raw_port_factory: Callable[..., object] = serial.Serial,
        runtime_installer: RuntimeInstaller | None = None,
        tcp_connection_factory: Callable[..., TcpConnection] = TcpConnection,
        password_lookup: PasswordLookup | None = None,
        discover_fn: Callable[[], list] = discover,
    ) -> None:
        self._ws = ws
        self._tcp_connection_factory = tcp_connection_factory
        self._password_lookup = password_lookup
        self._discover_fn = discover_fn
        # Injectable for tests -- production code always uses the real
        # SerialConnection; tests substitute a fake with no hardware dependency.
        self._serial_connection_factory = serial_connection_factory
        # Same injection shape, for install_runtime's own dedicated port (see this module's
        # header) -- production code always uses real serial.Serial/RuntimeInstaller.
        self._raw_port_factory = raw_port_factory
        self._runtime_installer = runtime_installer or RuntimeInstaller()
        self._serial: SerialConnection | TcpConnection | None = None
        self._decoder = LineDecoder()
        self._read_task: asyncio.Task[None] | None = None

    async def handle_text(self, raw: str) -> None:
        try:
            message = json.loads(raw)
        except json.JSONDecodeError as exc:
            await self._send_status(error=f"NODE_ERROR: control message was not valid JSON: {exc}")
            return

        msg_type = message.get("type")
        if msg_type == "list_ports":
            ports = [p.__dict__ for p in list_ports()]
            await self._ws.send_str(json.dumps({"type": "ports", "ports": ports}))
        elif msg_type == "connect" and message.get("host"):
            # WiFi transport (2026-09-24, tcp_relay.py). `password` is only sent when the editor has
            # just asked the user for one; otherwise it's looked up by the board's hostname.
            await self._connect_tcp(str(message["host"]), message.get("tcpPort", DEFAULT_TCP_PORT), message.get("password"))
        elif msg_type == "connect":
            await self._connect(message.get("port"), message.get("baudrate", 115200))
        elif msg_type == "discover":
            await self._discover()
        elif msg_type == "disconnect":
            await self._disconnect()
        elif msg_type == "install_runtime":
            await self._install_runtime(message.get("port"), message.get("baudrate", 115200), message.get("compiled"))
        elif msg_type == "remove_flow":
            await self._remove_flow(message.get("port"), message.get("baudrate", 115200))
        elif msg_type == "raw_write":
            await self._raw_write(message.get("text"))
        else:
            await self._send_status(error=f"NODE_ERROR: unknown control message type: {msg_type!r}")

    async def handle_binary(self, data: bytes) -> None:
        """Browser -> serial. `data` is already one complete §13 frame
        (codec.ts/framing.ts's job on the browser side) -- wrapped as one
        base64/"F64:" line (line_framing.py) before it goes to the wire,
        since that's the encoding the real device listener actually
        expects there (see this module's header)."""
        if self._serial is None:
            await self._send_status(error="NODE_ERROR: received a binary frame with no serial port connected")
            return
        try:
            await self._serial.write(encode_f64_line(data))
        except _RELAY_ERRORS as exc:
            await self._send_status(error=str(exc))
            await self._disconnect()

    async def _connect(self, port: str | None, baudrate: int) -> None:
        if not port:
            await self._send_status(error="NODE_ERROR: connect requested with no port given")
            return
        if port in _BUSY_PORTS:
            await self._send_status(error=f"NODE_ERROR: {port} is busy with an install or Remove flow -- connect when it finishes")
            return
        if self._serial is not None:
            await self._disconnect()

        conn = self._serial_connection_factory(port, baudrate=baudrate)
        try:
            await conn.open()
        except SerialRelayError as exc:
            await self._send_status(error=str(exc))
            return

        self._serial = conn
        self._decoder.reset()
        await self._send_status(connected=True, port=port)
        self._read_task = asyncio.create_task(self._pump_serial_to_ws(conn))

    async def _connect_tcp(self, host: str, tcp_port: object, password: object) -> None:
        if not isinstance(tcp_port, int) or not 1 <= tcp_port <= 65535:
            await self._send_status(error=f"NODE_ERROR: connect requested with an invalid network port {tcp_port!r}")
            return
        if self._serial is not None:
            await self._disconnect()
        conn = self._tcp_connection_factory(
            host,
            tcp_port,
            password=password if isinstance(password, str) else None,
            password_lookup=self._password_lookup,
        )
        try:
            await conn.open()
        except TcpRelayError as exc:
            await self._send_status(error=str(exc), error_code=exc.code, hostname=exc.hostname)
            return
        self._serial = conn
        self._decoder.reset()
        await self._send_status(connected=True, port=conn.port, network=True, hostname=conn.hostname)
        self._read_task = asyncio.create_task(self._pump_serial_to_ws(conn))

    async def _discover(self) -> None:
        """Lists boards answering the WiFi transport's UDP probe (tcp_relay.discover)."""
        try:
            boards = await asyncio.to_thread(self._discover_fn)
        except Exception:  # noqa: BLE001 -- discovery must never take the session down
            logger.exception("board discovery failed")
            boards = []
        payload = {
            "type": "boards",
            "boards": [
                {
                    "hostname": b.hostname,
                    "address": b.address,
                    "port": b.port,
                    "chip": b.chip,
                    "flow": b.flow,
                    "wifiTransport": b.wifi_transport,
                    "busy": b.busy,
                }
                for b in boards
            ],
        }
        await self._send_quietly(json.dumps(payload))

    async def _install_runtime(self, port: str | None, baudrate: int, compiled_b64: object = None) -> None:
        compiled, problem = _decode_compiled(compiled_b64)
        if problem:
            await self._send_install_result(ok=False, error=f"NODE_ERROR: install_runtime: {problem}")
            return
        if port and port in _BUSY_PORTS:
            await self._send_install_result(
                ok=False, error=f"NODE_ERROR: an install or Remove flow is already running on {port} -- wait for it to finish"
            )
            return
        if port:
            _BUSY_PORTS.add(port)
        try:
            await self._install_runtime_exclusive(port, baudrate, compiled)
        finally:
            if port:
                _BUSY_PORTS.discard(port)

    async def _install_runtime_exclusive(self, port: str | None, baudrate: int, compiled: dict[str, bytes] | None = None) -> None:
        """Pushes the runtime onto `port`'s board via raw REPL -- see this module's header for
        why this doesn't reuse the normal connect/relay path. Closes any existing relay
        connection first (raw REPL needs exclusive access to the port); does not reopen one
        afterward even on success -- see this module's header on why an automatic reconnect
        isn't attempted."""
        if not port:
            await self._send_install_result(ok=False, error="NODE_ERROR: install_runtime requested with no port given")
            return
        if self._serial is not None:
            await self._disconnect()

        loop = asyncio.get_running_loop()

        def _on_progress(index: int, total: int, name: str) -> None:
            # Called from the install's worker thread -- hand the send to the event loop, and
            # don't wait on it: a slow or closing WebSocket mustn't stall the install itself.
            asyncio.run_coroutine_threadsafe(self._send_install_progress(index, total, name), loop)

        def _on_status(text: str) -> None:
            payload = json.dumps({"type": "install_runtime_status", "text": text})
            asyncio.run_coroutine_threadsafe(self._send_quietly(payload), loop)

        def _open_raw():
            return self._raw_port_factory(
                port,
                baudrate=baudrate,
                timeout=_INSTALL_READ_POLL_TIMEOUT_SECONDS,
                write_timeout=_INSTALL_WRITE_TIMEOUT_SECONDS,
            )

        def _run_install() -> None:
            # Runs entirely inside asyncio.to_thread() below -- raw_repl.py is deliberately
            # synchronous (see its own header), so the whole install is one blocking call from
            # this event loop's point of view, not interleaved with anything else on this
            # session. A real serial.Serial opened here is unrelated to (and, since
            # self._disconnect() already ran above, never concurrent with) self._serial.
            # Opened once up front so a port that can't be opened at all (busy, no permission) fails
            # straight away as "serial open failed", not after the whole catch timeout.
            first = [_open_raw()]

            def _open_for_catch():
                return first.pop() if first else _open_raw()

            # A running listener ignores Ctrl-C, and a native-USB board (Pico) doesn't reset when the
            # port opens, so wait for a prompt the same way Remove flow does (2026-09-24, Mike: Pico
            # installs failed with "last seen: b''" until power-cycled).
            raw_port = board_recovery.catch_prompt(
                _open_for_catch, time.monotonic() + _INSTALL_CATCH_TIMEOUT_SECONDS, _on_status
            )
            try:
                self._runtime_installer.install(raw_port, on_progress=_on_progress, compiled=compiled)
            finally:
                try:
                    raw_port.close()
                except Exception as exc:  # noqa: BLE001 -- a board that reset or was unplugged
                    # can make close() fail; that mustn't replace the install's real outcome.
                    logger.info("closing %s after install: %s", port, exc)

        try:
            await asyncio.to_thread(_run_install)
        except serial.SerialException as exc:
            # Only the open can land here -- every read/write during the install is wrapped into a
            # RawReplError naming its step (raw_repl._write()/_ByteReader). Before 2026-09-23 a
            # mid-install read failure also landed here and was mislabelled "open failed".
            # Same NODE_ERROR text shape serial_relay.py's SerialRelayError already produces
            # for a connect failure (deliberate -- see connect-error-help.ts on the editor
            # side, which pattern-matches this exact shape into a workaround suggestion; that
            # logic applies here for free rather than needing its own copy).
            await self._send_install_result(ok=False, error=f"NODE_ERROR: serial open failed on {port}: {exc}")
            return
        except RawReplError as exc:
            # Only a failure to reach raw REPL at all says anything about what the board is
            # running; a failure mid-push means MicroPython was there and something else broke.
            diagnosis = classify_reply(exc.seen) if exc.step in (ENTER_STEP, CATCH_STEP) else None
            await self._send_install_result(ok=False, error=str(exc), diagnosis=diagnosis)
            return
        await self._send_install_result(ok=True)

    async def _raw_write(self, text: object) -> None:
        """Writes `text` to the connected board as-is, no F64 framing -- the editor's command box
        when the board is at MicroPython's own ">>>" prompt (after STOP_TO_PROMPT), and Ctrl-D to
        restart the listener from there. Output comes back through the normal relay as "debug"
        lines. Added 2026-09-23."""
        if not isinstance(text, str):
            await self._send_status(error="NODE_ERROR: raw_write needs a text field")
            return
        if self._serial is None:
            await self._send_status(error="NODE_ERROR: raw_write with no serial port connected")
            return
        try:
            await self._serial.write(text.encode("utf-8"))
        except _RELAY_ERRORS as exc:
            await self._send_status(error=str(exc))
            await self._disconnect()

    async def _remove_flow(self, port: str | None, baudrate: int) -> None:
        if port and port in _BUSY_PORTS:
            await self._send_result(
                "remove_flow_result",
                ok=False,
                error=f"NODE_ERROR: an install or Remove flow is already running on {port} -- wait for it to finish",
            )
            return
        if port:
            _BUSY_PORTS.add(port)
        try:
            await self._remove_flow_exclusive(port, baudrate)
        finally:
            if port:
                _BUSY_PORTS.discard(port)

    async def _remove_flow_exclusive(self, port: str | None, baudrate: int) -> None:
        """board_recovery.remove_flow() on a dedicated port, same shape as _install_runtime: close any
        relay connection first, run in a thread, one final result message. Status lines ("press
        reset") go out as they happen."""
        if not port:
            await self._send_result("remove_flow_result", ok=False, error="NODE_ERROR: remove_flow requested with no port given")
            return
        if self._serial is not None:
            await self._disconnect()
        loop = asyncio.get_running_loop()

        def _on_status(text: str) -> None:
            payload = json.dumps({"type": "remove_flow_status", "text": text})
            asyncio.run_coroutine_threadsafe(self._send_quietly(payload), loop)

        def _open():
            return self._raw_port_factory(
                port,
                baudrate=baudrate,
                timeout=_INSTALL_READ_POLL_TIMEOUT_SECONDS,
                write_timeout=_INSTALL_WRITE_TIMEOUT_SECONDS,
            )

        try:
            await asyncio.to_thread(board_recovery.remove_flow, _open, _REMOVE_FLOW_TIMEOUT_SECONDS, _on_status)
        except RawReplError as exc:
            await self._send_result("remove_flow_result", ok=False, error=str(exc))
            return
        await self._send_result("remove_flow_result", ok=True)

    async def _send_result(self, msg_type: str, *, ok: bool, error: str | None = None) -> None:
        payload: dict[str, object] = {"type": msg_type, "ok": ok}
        if error is not None:
            payload["error"] = error
            logger.warning(error)
        await self._send_quietly(json.dumps(payload))

    async def _send_quietly(self, text: str) -> None:
        try:
            await self._ws.send_str(text)
        except (ConnectionResetError, RuntimeError) as exc:
            logger.warning("could not send to a closing WebSocket: %s", exc)

    async def _send_install_progress(self, index: int, total: int, name: str) -> None:
        """One message per file as it starts, so the editor can show progress and notice a stall
        (BackendTransport.installRuntime()'s idle timeout)."""
        payload = {"type": "install_runtime_progress", "index": index, "total": total, "file": name}
        try:
            await self._ws.send_str(json.dumps(payload))
        except (ConnectionResetError, RuntimeError) as exc:
            logger.warning("could not send install_runtime_progress to a closing WebSocket: %s", exc)

    async def _send_install_result(self, *, ok: bool, error: str | None = None, diagnosis: str | None = None) -> None:
        payload: dict[str, object] = {"type": "install_runtime_result", "ok": ok}
        if error is not None:
            payload["error"] = error
            logger.warning(error)
        if diagnosis is not None:
            # raw_repl.classify_reply()'s value -- the editor turns it into a next step.
            payload["diagnosis"] = diagnosis
        # Same already-closing-socket tolerance _send_status gives below -- best-effort, never
        # lets a write to a dead WebSocket take the install's own error path down with it.
        try:
            await self._ws.send_str(json.dumps(payload))
        except (ConnectionResetError, RuntimeError) as exc:
            logger.warning("could not send install_runtime_result to a WebSocket that's already closing: %s", exc)

    async def _pump_serial_to_ws(self, conn: SerialConnection | TcpConnection) -> None:
        try:
            async for chunk in conn.read_loop():
                for event in self._decoder.push(chunk):
                    if event.error is not None:
                        await self._send_status(error=f"NODE_ERROR: {conn.port}: {event.error}")
                    elif event.frame is not None:
                        await self._ws.send_bytes(event.frame)
                    elif event.debug_text is not None:
                        await self._ws.send_str(json.dumps({"type": "debug", "line": event.debug_text}))
        except _RELAY_ERRORS as exc:
            await self._send_status(error=str(exc))
            if self._serial is conn:
                await self._send_status(connected=False, port=conn.port)
            self._serial = None
        except Exception:  # noqa: BLE001 -- last-resort backstop, never let this task die silently
            logger.exception("unexpected error relaying serial->WS for %s", conn.port)
            await self._send_status(error=f"NODE_ERROR: unexpected error relaying {conn.port}, connection stopped")
            self._serial = None

    async def _disconnect(self) -> None:
        if self._serial is not None:
            port = self._serial.port
            try:
                await self._serial.close()
            except _RELAY_ERRORS as exc:
                await self._send_status(error=str(exc))
            else:
                await self._send_status(connected=False, port=port)
            self._serial = None
        if self._read_task is not None:
            self._read_task.cancel()
            self._read_task = None

    async def _send_status(
        self,
        *,
        connected: bool | None = None,
        port: str | None = None,
        error: str | None = None,
        network: bool | None = None,
        error_code: str | None = None,
        hostname: str | None = None,
    ) -> None:
        payload: dict[str, object] = {"type": "status"}
        if network is not None:
            payload["network"] = network
        if error_code is not None:
            payload["errorCode"] = error_code
        if hostname is not None:
            payload["hostname"] = hostname
        if connected is not None:
            payload["connected"] = connected
        if port is not None:
            payload["port"] = port
        if error is not None:
            payload["error"] = error
            logger.warning(error)
        # Real bug, found 2026-09-07 while exercising this against an actual
        # backend process for the first time: this send is reached from
        # cleanup()/_disconnect() on the way OUT of a connection that's
        # already gone (the browser tab closed, a second connection to the
        # same board raced this one's serial read into a "Bad file
        # descriptor" and this cleanup ran right as the WS itself was also
        # closing) -- there's nobody left to receive the status this call is
        # trying to send. Before this fix, that write raised
        # ClientConnectionResetError straight out of _disconnect()/cleanup(),
        # surfacing as an unhandled server-side traceback -- exactly the
        # "uncaught exception that crashes the request handler" this file's
        # own header comment says never happens. Best-effort now, same
        # last-resort-backstop posture _pump_serial_to_ws already has for
        # its own unexpected errors: log and move on, don't let a write to
        # an already-dead socket take the teardown path down with it.
        try:
            await self._ws.send_str(json.dumps(payload))
        except (ConnectionResetError, RuntimeError) as exc:
            logger.warning("could not send status to a WebSocket that's already closing: %s", exc)

    async def cleanup(self) -> None:
        await self._disconnect()


def make_websocket_handler(
    serial_connection_factory: type[SerialConnection] | object = SerialConnection,
    raw_port_factory: Callable[..., object] = serial.Serial,
    runtime_installer: RuntimeInstaller | None = None,
    password_lookup: PasswordLookup | None = None,
    tcp_connection_factory: Callable[..., TcpConnection] = TcpConnection,
    discover_fn: Callable[[], list] = discover,
):
    """Build the aiohttp WS route handler. Production code uses the defaults (real
    SerialConnection/serial.Serial/RuntimeInstaller); tests pass fakes with no hardware
    dependency."""

    async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        session = ConnectionSession(
            ws,
            serial_connection_factory,
            raw_port_factory,
            runtime_installer,
            tcp_connection_factory=tcp_connection_factory,
            password_lookup=password_lookup,
            discover_fn=discover_fn,
        )

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    await session.handle_text(msg.data)
                elif msg.type == WSMsgType.BINARY:
                    await session.handle_binary(msg.data)
                elif msg.type == WSMsgType.ERROR:
                    logger.warning("WebSocket connection closed with exception %s", ws.exception())
        finally:
            await session.cleanup()

        return ws

    return websocket_handler


websocket_handler = make_websocket_handler()
