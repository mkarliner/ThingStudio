# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_http/ts_http_server.py
#
# Thingstudio's shared HTTP server, a general facility (Mike, 2026-11-06): http_in routes plus, mounted
# by whoever else needs it, static assets (e.g. the remote display's page) and WebSocket upgrades -- each
# under the path prefix that thing owns, so `/` stays with the flow. One Server per port through
# `runtime.shared`; every additional thing on that port calls mount() for its own routes. Per-route auth is
# the mounter's business; the Server never sees a credential.
#
# Original shape (2026-10-20): ported from the old http-server-shared.ts codegen, with the server built once
# per port through `runtime.shared` instead of a deduped module-scope statement, so http_in could be a core
# package. One Server per port: each http_in node owns a Queue (its own coroutine consumes it); the hook's
# route table, identical for every node on that port, tells the Server which queue and response timeout
# belongs to each (method, path). Server.ensure() is lazy because runtime.shared runs at module scope, where
# start_server cannot be awaited.
#
# Exact (method, path) matching; no routing beyond that. The v1 scope read no request bodies; POST bodies
# are now read only where the mounted route opted in (`body_limit`), capped, because a route such as the
# remote display's login needs the posted bytes.
#
# WebSocket (2026-11-06, remote-display spike): a route mounted with `ws=` upgrades the connection
# (RFC 6455 subset) -- handshake, masked client frames, text/binary, ping/pong, close; fragmentation is
# refused cleanly with a close frame, never parsed into a half message. The per-frame cap protects the heap.
# The protocol over the socket is the route owner's; the Server sees opaque text.
#
# The hook rejects duplicate routes before deploy; a route whose queue never registered is a loud error at
# ensure(). A mounted ws route's handler is awaited across the connection's life: the handler returning
# ends it.

import asyncio
import hashlib
import binascii
import runtime

_HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


async def _close_writer(writer):
    """Releases the connection *and* its socket. On MicroPython asyncio `writer.close()` alone only marks the
    stream for closing -- the socket is not released until `wait_closed()` returns, so a server that skips it
    leaks one socket per request until the port stops accepting (10 of them on an ESP32, CONFIG_LWIP_MAX_SOCKETS;
    found on a C3, 2026-11-07). CPython closes it on close(), which is why the unix-port tests never showed this
    before the close was asserted rather than assumed."""
    try:
        writer.close()
        wait_closed = getattr(writer, "wait_closed", None)
        if wait_closed is not None:
            await asyncio.wait_for(wait_closed(), 2)
    except Exception:
        pass  # already gone, or the peer vanished first: nothing left to release



class Queue:
    def __init__(self):
        self._items = []
        self._evt = asyncio.Event()

    def put(self, item):
        self._items.append(item)
        self._evt.set()

    async def get(self):
        while not self._items:
            await self._evt.wait()
            self._evt.clear()
        return self._items.pop(0)


class WebSocket:
    """One upgraded connection, RFC 6455 subset. Client frames are masked, server frames are not.
    recv() returns one of:
      ("text", payload) / ("binary", payload) -- a full frame, not a fragment (fragments are refused)
      ("pong", payload)  -- after the client ponged one of ours
      ("close", code)    -- peer closed (or we refused an illegal frame: 1003 fragment, 1002
                            control-frame too big or reserved bits, 1009 over the frame cap)
    and raises OSError once the link is dead, which is the caller's close. Our pings the client answers
    move recv() to ("pong", ...). Peer pings are answered with a pong and then also returned, so the
    caller sees everything that arrived."""

    MAX_PAYLOAD = 2048  # client -> board frames only; protects the heap (also the Pico W's)

    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.closed = False

    async def recv(self):
        while True:
            head = await self._read_exact(2)
            fin = bool(head[0] & 0x80)
            opcode = head[0] & 0x0F
            masked = bool(head[1] & 0x80)
            n = head[1] & 0x7F
            if n == 126:
                ext = await self._read_exact(2)
                n = (ext[0] << 8) | ext[1]
            elif n == 127:
                n = 0
                for b in await self._read_exact(8):
                    n = (n << 8) | b
            if not fin or opcode == 0 or head[0] & 0x70:
                await self.close(1003)
                return ("close", 1003)
            if opcode in (1, 2) and n > WebSocket.MAX_PAYLOAD:
                await self.close(1009)
                return ("close", 1009)
            if opcode in (9, 10) and n > 125:
                await self.close(1002)
                return ("close", 1002)
            if not masked and opcode not in (9, 10):
                await self.close(1002)
                return ("close", 1002)
            payload = await self._read_payload(n, masked)
            if opcode == 8:  # a peer close is answered with the same code, then the socket ends
                code = int.from_bytes(payload, "big") if len(payload) >= 2 else 1000
                await self.send_close(code)
                self.closed = True
                return ("close", code)
            if opcode == 9:  # peer ping: answered with an unmasked pong, same body; still returned
                await self._write_frame(10, payload)
                return ("ping", payload)
            if opcode == 10:
                return ("pong", payload)
            return ("text" if opcode == 1 else "binary", payload)

    async def _read_exact(self, n):
        buf = bytearray()
        while len(buf) < n:
            got = await asyncio.wait_for(self.reader.read(n - len(buf)), 7200)
            if not got:
                raise OSError("websocket link dead")  # EOFError too: callers expect OSErrors only
            buf.extend(got)
        return bytes(buf)

    async def _read_payload(self, n, masked):
        if n == 0:
            return b""
        if masked:
            key = await self._read_exact(4)
        raw = bytearray()
        while len(raw) < n:
            chunk = await asyncio.wait_for(self.reader.read(n - len(raw)), 7200)
            if not chunk:
                raise OSError("websocket link dead")
            raw.extend(chunk)
        if not masked:
            return bytes(raw)
        return bytes(raw[i] ^ key[i % 4] for i in range(n))

    async def _write_frame(self, opcode, payload):
        n = len(payload)
        head = bytearray([0x80 | opcode])  # fin set, no fragments sent by us
        if n < 126:
            head.append(n)
        elif n < 65536:
            head.append(126)
            head.append((n >> 8) & 0xFF)
            head.append(n & 0xFF)
        else:
            head.append(127)
            for sh in (56, 48, 40, 32, 24, 16, 8, 0):
                head.append((n >> sh) & 0xFF)
        self.writer.write(bytes(head) + payload)
        await asyncio.wait_for(self.writer.drain(), 10)

    async def send_text(self, text):
        if self.closed:
            raise OSError("websocket closed")
        await self._write_frame(1, text.encode() if isinstance(text, str) else text)

    async def send_close(self, code=1000):
        """Sends a close frame (2-byte code) and marks this socket closed; does not wait for the peer's."""
        if self.closed:
            return
        self.closed = True
        try:
            await self._write_frame(8, bytes([(code >> 8) & 0xFF, code & 0xFF]))
        except Exception:
            pass

    async def ping(self, payload=b""):
        await self._write_frame(9, payload)

    async def close(self, code=1000):
        await self.send_close(code)
        await _close_writer(self.writer)


def _ws_accept(key):
    """RFC 6455 §1.3: base64(SHA-1(key + the fixed GUID))."""
    digest = hashlib.sha1(key.encode() + _HANDSHAKE_GUID.encode()).digest()
    b64 = binascii.b2a_base64(digest)
    return b64.decode().strip() if isinstance(b64, bytes) else b64.strip()


_REASONS = {200: "OK", 204: "No Content", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found",
            408: "Request Timeout", 429: "Too Many Requests", 500: "Internal Server Error",
            503: "Service Unavailable"}


class Server:
    def __init__(self, port, routes, queues):
        self.port = port
        self.routes = list(routes)
        self.queues = queues
        self.started = False
        self.table = {}
        self._server = None

    def mount(self, route, queue=None, static=None, ws=None, pre=None):
        """Adds one route the construction-time route table doesn't know: an extra thing on this port,
        owned by something other than the http_in nodes. `route` is {'id', 'method', 'path'} with
        optional 'timeoutS'/'body_limit' for a queued route. Exactly one owner:
          queue  -- a Queue: the owner's coroutine consumes {'req': {...}, '_http_conn': {...}} messages
                    exactly like an http_in node, and answers by setting conn['status']/['body'].
          static -- (status, content-type, body, [(header, value), ...]): served bytes as they sit.
          ws     -- async def (ws, query): receives the WebSocket after the upgrade; returning ends the
                    connection.
        `pre` (ws routes only) runs before the handshake and must return True to allow it: the simple
        way to gate a socket (per-route auth lives here, not in the Server)."""
        method, path = route["method"], route["path"]
        if (method, path) in self.table:
            raise ValueError("ts_http_server: route %s %s mounted twice" % (method, path))
        if len([o for o in (queue, static, ws) if o is not None]) != 1:
            raise ValueError("ts_http_server: route %s %s needs exactly one of queue/static/ws" % (method, path))
        if static is not None and (method != "GET" or not isinstance(static, tuple) or len(static) != 4):
            raise ValueError("ts_http_server: route %s %s: a static route is (status, type, body, headers)" % (method, path))
        if static is not None and pre is not None:
            raise ValueError("ts_http_server: route %s %s: static routes need no pre-check" % (method, path))
        if queue is not None and pre is not None:
            raise ValueError("ts_http_server: route %s %s: pre-checks belong to ws routes" % (method, path))
        if queue is not None:
            self.table[(method, path)] = (queue, float(route.get("timeoutS") or 10), None, None,
                                          int(route.get("body_limit") or 0))
        else:
            entry = ws if ws is not None else static
            self.table[(method, path)] = (None, 0, entry, pre, 0)
        self.routes.append(route)

    async def ensure(self):
        if self.started:
            return
        self.started = True
        for route in self.routes:
            if (route['method'], route['path']) in self.table:
                continue  # mounted with mount(): owner is not a queue
            queue = self.queues.get(route['id'])
            if queue is None:
                raise OSError('ts_http_server: no request queue for http_in node %s on port %s' % (
                    route['id'], self.port))
            self.table[(route['method'], route['path'])] = (queue, float(route.get('timeoutS') or 10), None, None,
                                                            int(route.get('body_limit') or 0))
        self._server = await asyncio.start_server(self._handle, '0.0.0.0', self.port)
        runtime.register_cleanup('http-server-%s' % self.port, self._stop)

    async def stop(self):
        """Releases the listening socket for real: on MicroPython asyncio `close()` alone leaves the port bound,
        so a redeploy that rebinds the same port fails with EADDRINUSE (see _close_writer for the same trap on
        connections)."""
        srv, self._server = self._server, None
        self.started = False
        if srv is None:
            return
        try:
            srv.close()
            wait_closed = getattr(srv, "wait_closed", None)
            if wait_closed is not None:
                await asyncio.wait_for(wait_closed(), 2)
        except Exception:
            pass

    async def _stop(self):
        """runtime.register_cleanup's hook. Async on purpose: releasing the listening socket needs
        `wait_closed()`, and `runtime.cancel_running()` awaits a cleanup that returns a coroutine, so the next
        flow on the same port can bind. Scheduling it as a task instead lost the race and left port 80 held."""
        await self.stop()

    async def _handle(self, reader, writer):
        try:
            try:
                request_line = await asyncio.wait_for(reader.readline(), 5)
                parts = request_line.split(b' ')
                if len(parts) < 2:
                    raise ValueError('bad request line')
                method = parts[0].decode()
                full_path = parts[1].decode()
                path, _, query = full_path.partition('?')
                headers = {}
                while True:
                    header = await asyncio.wait_for(reader.readline(), 5)
                    if header in (b'\r\n', b'\n', b''):
                        break
                    name, _, value = header.partition(b':')
                    headers[name.strip().lower().decode()] = value.strip().decode()
            except Exception:
                await self._plain(writer, 400, b"bad request")
                return
            entry = self.table.get((method, path))
            if entry is None:
                await self._plain(writer, 404, b"no such route")
                return

            queue, timeout_s, static_or_ws, pre, body_limit = entry

            # -- a static or ws route: static bytes as they sit, or the WebSocket upgrade --------------
            if queue is None:
                if isinstance(static_or_ws, tuple):
                    status, ctype, body, extra = static_or_ws
                    head = 'HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nConnection: close\r\n' % (
                        status, _REASONS.get(status, "OK"), ctype, len(body))
                    for h, v in extra:
                        head += '%s: %s\r\n' % (h, v)
                    writer.write(head.encode() + b'\r\n' + body)
                    await asyncio.wait_for(writer.drain(), 10)
                    return
                if headers.get('upgrade', '').lower() != 'websocket' or (
                        pre is not None and pre(query, headers) is not True):
                    await self._plain(writer, 401, b"not authorised")
                    return
                ws = WebSocket(reader, writer)
                response = ('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                            'Sec-WebSocket-Accept: ' + _ws_accept(headers.get('sec-websocket-key', '')) +
                            '\r\n\r\n').encode()
                writer.write(response)
                await asyncio.wait_for(writer.drain(), 5)
                await static_or_ws(ws, query)
                if not ws.closed:  # a handler that returns without closing still gets one close frame
                    await ws.close()
                return

            # -- a queued route: read an opted-in request body, hand the request over, send the answer --
            body = b''
            if body_limit and headers.get('content-length'):
                try:
                    want = min(int(headers['content-length']), body_limit)
                except ValueError:
                    want = 0
                got = bytearray()
                while len(got) < want:
                    chunk = await asyncio.wait_for(reader.read(want - len(got)), 5)
                    if not chunk:
                        break
                    got.extend(chunk)
                body = bytes(got)
            conn = {'writer': writer, 'done': asyncio.Event(), 'status': 500,
                    'body': b'Internal Server Error: no response'}
            queue.put({'payload': None, 'topic': '', 'req': {'method': method, 'path': path, 'query': query,
                                                             'body': body},
                       '_http_conn': conn})
            try:
                await asyncio.wait_for(conn['done'].wait(), timeout_s)
            except asyncio.TimeoutError:
                pass
            body = conn['body']
            if isinstance(body, str):
                body = body.encode()
            response = ('HTTP/1.1 ' + str(conn['status']) + ' ' + _REASONS.get(conn['status'], "OK") +
                        '\r\nContent-Length: ' + str(len(body)) + '\r\nConnection: close\r\n\r\n').encode()
            writer.write(response)
            if body:
                writer.write(body)
            await asyncio.wait_for(writer.drain(), 5)
        except Exception:
            pass
        finally:
            await _close_writer(writer)

    async def _plain(self, writer, status, body):
        writer.write(('HTTP/1.1 %d %s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n' % (
            status, _REASONS.get(status, "OK"), len(body))).encode() + body)
        try:
            await asyncio.wait_for(writer.drain(), 5)
        except Exception:
            pass
