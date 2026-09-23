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
import json
import logging
from typing import Callable

import serial
from aiohttp import WSMsgType, web

from . import board_recovery
from .line_framing import LineDecoder, encode_f64_line
from .raw_repl import ENTER_STEP, RawReplError, classify_reply
from .runtime_installer import RuntimeInstaller
from .serial_relay import SerialConnection, SerialRelayError, list_ports

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


class ConnectionSession:
    """Per-WebSocket-connection state: at most one open serial port at a time,
    matching this backend's one-backend-one-device v1 scope."""

    def __init__(
        self,
        ws: web.WebSocketResponse,
        serial_connection_factory: type[SerialConnection] | object = SerialConnection,
        raw_port_factory: Callable[..., object] = serial.Serial,
        runtime_installer: RuntimeInstaller | None = None,
    ) -> None:
        self._ws = ws
        # Injectable for tests -- production code always uses the real
        # SerialConnection; tests substitute a fake with no hardware dependency.
        self._serial_connection_factory = serial_connection_factory
        # Same injection shape, for install_runtime's own dedicated port (see this module's
        # header) -- production code always uses real serial.Serial/RuntimeInstaller.
        self._raw_port_factory = raw_port_factory
        self._runtime_installer = runtime_installer or RuntimeInstaller()
        self._serial: SerialConnection | None = None
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
        elif msg_type == "connect":
            await self._connect(message.get("port"), message.get("baudrate", 115200))
        elif msg_type == "disconnect":
            await self._disconnect()
        elif msg_type == "install_runtime":
            await self._install_runtime(message.get("port"), message.get("baudrate", 115200))
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
        except SerialRelayError as exc:
            await self._send_status(error=str(exc))
            await self._disconnect()

    async def _connect(self, port: str | None, baudrate: int) -> None:
        if not port:
            await self._send_status(error="NODE_ERROR: connect requested with no port given")
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

    async def _install_runtime(self, port: str | None, baudrate: int) -> None:
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

        def _run_install() -> None:
            # Runs entirely inside asyncio.to_thread() below -- raw_repl.py is deliberately
            # synchronous (see its own header), so the whole install is one blocking call from
            # this event loop's point of view, not interleaved with anything else on this
            # session. A real serial.Serial opened here is unrelated to (and, since
            # self._disconnect() already ran above, never concurrent with) self._serial.
            raw_port = self._raw_port_factory(
                port,
                baudrate=baudrate,
                timeout=_INSTALL_READ_POLL_TIMEOUT_SECONDS,
                write_timeout=_INSTALL_WRITE_TIMEOUT_SECONDS,
            )
            try:
                self._runtime_installer.install(raw_port, on_progress=_on_progress)
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
            diagnosis = classify_reply(exc.seen) if exc.step == ENTER_STEP else None
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
        except SerialRelayError as exc:
            await self._send_status(error=str(exc))
            await self._disconnect()

    async def _remove_flow(self, port: str | None, baudrate: int) -> None:
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

    async def _pump_serial_to_ws(self, conn: SerialConnection) -> None:
        try:
            async for chunk in conn.read_loop():
                for event in self._decoder.push(chunk):
                    if event.error is not None:
                        await self._send_status(error=f"NODE_ERROR: {conn.port}: {event.error}")
                    elif event.frame is not None:
                        await self._ws.send_bytes(event.frame)
                    elif event.debug_text is not None:
                        await self._ws.send_str(json.dumps({"type": "debug", "line": event.debug_text}))
        except SerialRelayError as exc:
            await self._send_status(error=str(exc))
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
            except SerialRelayError as exc:
                await self._send_status(error=str(exc))
            else:
                await self._send_status(connected=False, port=port)
            self._serial = None
        if self._read_task is not None:
            self._read_task.cancel()
            self._read_task = None

    async def _send_status(
        self, *, connected: bool | None = None, port: str | None = None, error: str | None = None
    ) -> None:
        payload: dict[str, object] = {"type": "status"}
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
):
    """Build the aiohttp WS route handler. Production code uses the defaults (real
    SerialConnection/serial.Serial/RuntimeInstaller); tests pass fakes with no hardware
    dependency."""

    async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        session = ConnectionSession(ws, serial_connection_factory, raw_port_factory, runtime_installer)

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
