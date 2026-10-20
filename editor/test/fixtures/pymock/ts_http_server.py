# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/thingstudio_http/ts_http_server.py
#
# Thingstudio's shared HTTP server for http_in, a flow dependency (a flow without an http_in node never carries it).
# Ported from the old http-server-shared.ts codegen, with the server built once per port through `runtime.shared`
# instead of a deduped module-scope statement, so http_in can be a core package.
#
# One Server per port. Each http_in node owns a Queue (its own coroutine consumes it); the hook's route table,
# identical for every node on that port, tells the Server which queue and response timeout belongs to each
# (method, path). The first node's Server factory starts; every later node shares it. Server.ensure() is lazy
# because runtime.shared runs at module scope, where start_server cannot be awaited.
#
# Exact (method, path) matching, no body parsing -- the v1 scope the built-in had. The hook rejects duplicate
# routes before deploy; a route whose queue never registered is a loud error at ensure().

import asyncio
import runtime


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


class Server:
    def __init__(self, port, routes, queues):
        self.port = port
        self.routes = routes
        self.queues = queues
        self.started = False
        self.table = {}
        self._server = None

    async def ensure(self):
        if self.started:
            return
        self.started = True
        for route in self.routes:
            queue = self.queues.get(route['id'])
            if queue is None:
                raise OSError('ts_http_server: no request queue for http_in node %s on port %s' % (
                    route['id'], self.port))
            self.table[(route['method'], route['path'])] = (queue, route['timeoutS'])
        self._server = await asyncio.start_server(self._handle, '0.0.0.0', self.port)
        runtime.register_cleanup('http-server-%s' % self.port, self._stop)

    def _stop(self):
        if self._server is not None:
            self._server.close()
            self._server = None
        self.started = False

    async def _handle(self, reader, writer):
        try:
            try:
                request_line = await asyncio.wait_for(reader.readline(), 5)
                parts = request_line.split(b' ')
                if len(parts) < 2:
                    raise ValueError('bad request line')
                method = parts[0].decode()
                path = parts[1].decode().split('?')[0]
                while True:
                    header = await asyncio.wait_for(reader.readline(), 5)
                    if header in (b'\r\n', b'\n', b''):
                        break
            except Exception:
                writer.write(b'HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
                await asyncio.wait_for(writer.drain(), 5)
                return
            route = self.table.get((method, path))
            if route is None:
                writer.write(b'HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
                await asyncio.wait_for(writer.drain(), 5)
                return
            queue, timeout_s = route
            conn = {'writer': writer, 'done': asyncio.Event(), 'status': 500,
                    'body': b'Internal Server Error: no response'}
            queue.put({'payload': None, 'topic': '', 'req': {'method': method, 'path': path},
                       '_http_conn': conn})
            try:
                await asyncio.wait_for(conn['done'].wait(), timeout_s)
            except asyncio.TimeoutError:
                pass
            body = conn['body']
            if isinstance(body, str):
                body = body.encode()
            response = ('HTTP/1.1 ' + str(conn['status']) + ' -\r\nContent-Length: ' + str(len(body)) +
                        '\r\nConnection: close\r\n\r\n').encode()
            writer.write(response)
            if body:
                writer.write(body)
            await asyncio.wait_for(writer.drain(), 5)
        except Exception:
            pass
        finally:
            writer.close()
