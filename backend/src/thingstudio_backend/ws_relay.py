# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/ws_relay.py
#
# One WebSocket endpoint, multiplexed by frame type (docs/working-notes/
# backend-editor-auth-and-protocol.md §2):
#   - Binary frames: §13's CBOR-framed device-protocol bytes. Passed through
#     verbatim in both directions -- this module never decodes CBOR. Browser
#     -> serial: each binary WS message already IS one complete, already-
#     framed protocol frame (codec.ts/framing.ts's job on the browser side),
#     so it's written straight to the serial port as raw bytes. Serial ->
#     browser: the serial port is a boundary-less byte stream, so framing.py's
#     FrameDecoder reconstructs frame boundaries from it, and each complete
#     frame's *raw* bytes (not re-encoded) become one WS binary message.
#   - Text frames: JSON backend control-plane messages with no device
#     counterpart -- list serial ports, connect/disconnect, connection status.
#
# Fault handling: a serial disconnect or open failure becomes a structured
# {"type": "status", ...} text message to the browser, never an uncaught
# exception that drops the WebSocket or crashes the backend process --
# same fault-isolation posture as the relay's serial layer and the
# device-side listener it's modeled after.

from __future__ import annotations

import asyncio
import json
import logging

from aiohttp import WSMsgType, web

from .framing import FrameDecoder
from .serial_relay import SerialConnection, SerialRelayError, list_ports

logger = logging.getLogger(__name__)


class ConnectionSession:
    """Per-WebSocket-connection state: at most one open serial port at a time,
    matching this backend's one-backend-one-device v1 scope."""

    def __init__(
        self,
        ws: web.WebSocketResponse,
        serial_connection_factory: type[SerialConnection] | object = SerialConnection,
    ) -> None:
        self._ws = ws
        # Injectable for tests -- production code always uses the real
        # SerialConnection; tests substitute a fake with no hardware dependency.
        self._serial_connection_factory = serial_connection_factory
        self._serial: SerialConnection | None = None
        self._decoder = FrameDecoder()
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
        else:
            await self._send_status(error=f"NODE_ERROR: unknown control message type: {msg_type!r}")

    async def handle_binary(self, data: bytes) -> None:
        """Browser -> serial. The bytes are already one complete §13 frame --
        forwarded to the wire verbatim, no re-framing."""
        if self._serial is None:
            await self._send_status(error="NODE_ERROR: received a binary frame with no serial port connected")
            return
        try:
            await self._serial.write(data)
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

    async def _pump_serial_to_ws(self, conn: SerialConnection) -> None:
        try:
            async for chunk in conn.read_loop():
                for result in self._decoder.push(chunk):
                    if result.error is not None:
                        await self._send_status(error=f"NODE_ERROR: framing error on {conn.port}: {result.error}")
                    elif result.frame is not None:
                        await self._ws.send_bytes(result.frame.raw)
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
        await self._ws.send_str(json.dumps(payload))

    async def cleanup(self) -> None:
        await self._disconnect()


def make_websocket_handler(
    serial_connection_factory: type[SerialConnection] | object = SerialConnection,
):
    """Build the aiohttp WS route handler. Production code uses the default
    (real SerialConnection); tests pass a fake with no hardware dependency."""

    async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        session = ConnectionSession(ws, serial_connection_factory)

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
