// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/http-server-shared.ts
//
// Shared plumbing for the http_in / http_response node pair (docs/working-
// notes/outstanding-items.md's "HTTP in / HTTP response nodes" P3 MVP
// item). Node-RED is this project's explicit behavioral reference for
// what these two nodes are called and how they're paired (Mike's own
// "node-red calls it http in" + a follow-up Node-RED docs quote), but --
// Mike's own explicit call this session ("we don't have to implement all
// of the node-red semantics") -- v1 does NOT implement Node-RED's full
// http-in surface: no named `:param` path segments, no `msg.req.params`,
// no request-body-to-`msg.payload` parsing (v1's emitted msg always has
// `payload: None`). Those omissions are real, deliberately deferred scope
// -- see outstanding-items.md's own entry for the P4 follow-up note
// tracking them, not oversights.
//
// Architecture, in one paragraph: any number of http_in nodes can share
// one physical TCP port (routing on exact method+path), so -- same shape
// as wifi-status.ts's "one wifi_status node owns WiFi for the whole flow"
// precedent -- codegen for ANY http_in node sharing a port builds the
// FULL route table for that port (via ctx.findNodesOfType, scanning every
// http_in node in the flow, not just itself) and the shared server-
// bootstrap/request-handler code, under an `http-server-<port>` setup key
// so mergeSetup's dedup keeps exactly one copy regardless of which
// sibling's codegen call actually ran first (every sibling computes the
// identical code from the same flow-wide data, so which one "wins" the
// dedup doesn't matter -- same reasoning wifi-status.ts's shared
// "wifi-sta" key already relies on).
//
// compile.ts's own constraint drives one real design choice here: setup
// statements (SetupCode.statements) are emitted at plain MODULE scope,
// run synchronously, never awaited (mergeSetup's own doc comment) -- so
// the shared code below can DEFINE `async def`s at setup time (that's
// just a synchronous `def` statement, nothing awaited yet) but can't
// itself call `await asyncio.start_server(...)` there. Instead, starting
// the server is deferred to the first time any sibling http_in node's own
// per-instance coroutine actually runs (compile.ts spawns one coroutine
// per source node, http_in included) -- its `waitStatement` calls a
// small idempotent `_http_ensure_<port>()` bootstrap (an awaitable
// `async def`, safe to call every loop iteration; a global bool flag
// makes every call after the first a no-op) before waiting on its own
// queue. No change to compile.ts/node-definition.ts needed -- this stays
// entirely within the existing EventSourceCodegenResult contract.
//
// Per-request flow, once the server IS up:
//   1. uasyncio's own start_server spawns one handler coroutine per
//      accepted TCP connection (concurrently -- no explicit cap on
//      simultaneous in-flight connections in v1; see "known limitation"
//      below).
//   2. The shared handler reads the request line + headers (NOT the
//      body -- v1 doesn't parse one, see this file's header), matches
//      (method, path) against the port's route table.
//   3. No match, or a malformed request line -> writes a plain 404/400
//      and closes.
//   4. A match -> builds a small per-request "connection record" (the
//      raw `writer` stream, an `asyncio.Event` used as a completion
//      signal, and a status/body slot defaulting to 500/"no response"),
//      puts a ready-to-consume msg dict (carrying that record under the
//      internal `_http_conn` key) onto the MATCHED node's own queue, then
//      awaits the record's completion event, bounded by that specific
//      node's own `responseTimeoutMs` property -- a slow/stuck flow can
//      never hang a client connection forever, matching CLAUDE.md's
//      fault-handling priority (same "bound every I/O call" convention
//      http-request.ts/serial_relay.py already apply). A timeout leaves
//      the still-default 500 body in place rather than hanging.
//   5. Whichever wakes it (a real http_response node completing, or the
//      timeout) -- the handler writes the final status line + body and
//      closes the connection. v1 always sends `Connection: close`; no
//      keep-alive.
//
// Each http_in node instance gets its own hand-rolled minimal async
// queue (`_HttpInQueue` below) rather than relying on uasyncio shipping
// `asyncio.Queue` (not reliably present across the MicroPython ports/
// versions this project targets, unlike the CPython stdlib) -- single-
// consumer (the owning node's own coroutine), multi-producer (every TCP
// handler coroutine matching this node's route) safe under uasyncio's
// cooperative scheduling: `put()` never awaits, so it can't be
// interleaved with another task mid-mutation; `get()` only ever awaits at
// its own `_evt.wait()`. One instance per http_in node (own setup key,
// not shared/deduped the way the route table/handler are).
//
// A request to the SAME http_in node's route while a previous one is
// still being processed queues behind it -- this node's own coroutine
// (like every event-source node's, compile.ts) processes its queue one
// item at a time, so two concurrent requests to one route are served in
// series, not in parallel. Requests to two DIFFERENT routes (even on the
// same port) run fully concurrently, since each is its own TCP handler
// task feeding its own node's own queue/coroutine. Worth being explicit
// about, not silently assumed -- a real v1 characteristic, not a bug.
//
// Known limitation, not silently glossed over (matching http-request.ts's
// own "Real, honest v1 limitations" section): no explicit cap on
// simultaneous in-flight TCP connections/handler tasks for a given port
// -- relies entirely on the device's own socket accept/memory limits.
// Fine for a small number of well-behaved clients, a real resource-
// exhaustion risk for anything exposed to untrusted traffic. Flagged as a
// P4 follow-up (outstanding-items.md) alongside the path-parameter/
// body-parsing scope cuts above, not built now.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext } from "../compiler/node-definition.js";

export const HTTP_IN_TYPE = "thingstudio/http_in";

export type HttpMethod = "GET" | "POST";

export interface HttpInProperties {
  port: number;
  path: string;
  method: HttpMethod;
  responseTimeoutMs: number;
}

/** Validates one http_in node's own properties -- shared by codegen (this
 * file's route-table builder, called once per sibling) so every caller
 * gets identical CompileError wording regardless of which node instance's
 * own codegen call happened to trip it. */
export function resolveHttpInProperties(node: GraphNode): HttpInProperties {
  const port = Math.round(Number(node.properties.port));
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new CompileError(`http_in port "${String(node.properties.port)}" must be a number between 1 and 65535`);
  }
  const path = String(node.properties.path ?? "");
  if (!path.startsWith("/")) {
    throw new CompileError(
      `http_in path "${path}" must start with "/" -- v1 matches one exact path only, no named parameters (see outstanding-items.md)`,
    );
  }
  const method = String(node.properties.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    throw new CompileError(`http_in method "${String(node.properties.method)}" must be "GET" or "POST" -- v1 supports no other methods`);
  }
  const responseTimeoutMs = Math.round(Number(node.properties.responseTimeoutMs ?? 10000));
  if (!Number.isFinite(responseTimeoutMs) || responseTimeoutMs <= 0) {
    throw new CompileError(`http_in responseTimeoutMs "${String(node.properties.responseTimeoutMs)}" must be a positive number`);
  }
  return { port, path, method: method as HttpMethod, responseTimeoutMs };
}

/** Deterministic, node-id-derived Python identifier -- NOT ctx.uniqueName
 * (see this file's header: any sibling http_in node's codegen call needs
 * to be able to compute every OTHER sibling's own queue variable name
 * independently, to build the shared route table, without waiting for
 * that sibling's own codegen to have run first -- the same ordering
 * problem interrupt.ts's own header describes for its pin-derived names,
 * a different root cause, same fix shape). Node ids in this codebase are
 * already identifier-safe-ish in practice, but this strips anything that
 * isn't a Python identifier character defensively rather than assuming. */
function sanitizeIdent(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `n${cleaned}` : cleaned;
}

export function httpInQueueVar(nodeId: string): string {
  return `_http_in_q_${sanitizeIdent(nodeId)}`;
}

const QUEUE_CLASS_KEY = "http-in-queue-class";
const QUEUE_CLASS_CODE = [
  "class _HttpInQueue:",
  "    def __init__(self):",
  "        self._items = []",
  "        self._evt = asyncio.Event()",
  "    def put(self, item):",
  "        self._items.append(item)",
  "        self._evt.set()",
  "    async def get(self):",
  "        while not self._items:",
  "            await self._evt.wait()",
  "            self._evt.clear()",
  "        return self._items.pop(0)",
].join("\n");

export const queueClassSetupStatement = { key: QUEUE_CLASS_KEY, code: QUEUE_CLASS_CODE };

/**
 * Builds (and validates) the full route table for one port, by scanning
 * EVERY http_in node in the flow (ctx.findNodesOfType) and keeping only
 * the ones that share `port` -- called from any sibling's own codegen
 * (http-in.ts), so every sibling computes the identical result;
 * mergeSetup's dedup (compile.ts) keeps whichever one actually lands
 * first, harmlessly. Throws a CompileError on two http_in nodes sharing
 * one (method, path) on the same port -- an unambiguous flow-authoring
 * mistake, not something to silently let "last one wins."
 */
function buildRouteTable(port: number, ctx: CodegenContext): { node: GraphNode; props: HttpInProperties }[] {
  const finder = ctx.findNodesOfType;
  if (!finder) {
    throw new CompileError(
      "http_in: this compiler context can't look up sibling http_in nodes (findNodesOfType missing) -- internal error, not a flow-authoring mistake",
    );
  }
  const siblings = finder(HTTP_IN_TYPE)
    .map((n) => ({ node: n, props: resolveHttpInProperties(n) }))
    .filter((entry) => entry.props.port === port);

  const seen = new Map<string, GraphNode>();
  for (const entry of siblings) {
    const key = `${entry.props.method} ${entry.props.path}`;
    const prior = seen.get(key);
    if (prior) {
      throw new CompileError(
        `http_in: nodes ${prior.id} and ${entry.node.id} both claim ${entry.props.method} ${entry.props.path} on port ${port} -- exact (method, path) must be unique per port`,
      );
    }
    seen.set(key, entry.node);
  }
  return siblings;
}

/** The shared per-port setup: route table, request handler, and the
 * idempotent server-bootstrap coroutine. Identical text from every
 * sibling http_in node sharing `port` (see buildRouteTable above) --
 * mergeSetup's `http-server-<port>` key keeps exactly one copy. */
export function httpServerSetupStatement(port: number, ctx: CodegenContext): { key: string; code: string } {
  const routes = buildRouteTable(port, ctx);
  const routeLines = routes.map(
    (entry) =>
      `        _http_routes_${port}[(${JSON.stringify(entry.props.method)}, ${JSON.stringify(entry.props.path)})] = (${httpInQueueVar(entry.node.id)}, ${entry.props.responseTimeoutMs / 1000})`,
  );

  // Real ordering hazard this dodges (found by node-http-in.test.ts's own
  // multi-route functional test, not hypothetical): mergeSetup (compile.ts)
  // collects every sibling http_in node's own SetupCode.statements into
  // ONE Map, in per-node codegen-call order -- and THIS function's own
  // output (deduped under the single "http-server-<port>" key) is only
  // ONE of several statements a given sibling contributes. If sibling A's
  // codegen call happens to run first, A's statements land in the Map as
  // [..., A's own queue var, THIS route table, ...] -- fine for A's own
  // queue reference, but sibling B's own queue-var statement (its own,
  // separately-keyed entry) only gets inserted into the Map when B's OWN
  // codegen call runs, which -- since this route table already claimed
  // the shared key on A's turn -- lands AFTER this route table in Map
  // insertion order, even though this table's route lines reference B's
  // queue variable by name. A plain top-level `_http_routes_<port>[...] =
  // ...` line at that position would be a NameError at import time.
  // Fixed by NOT populating the route table at raw module scope at all --
  // it's built here, inside `_http_ensure_<port>`, which only ever runs
  // from within an already-running coroutine (a node's own waitStatement),
  // i.e. strictly after Python has finished executing every module-level
  // statement (including every sibling's own queue-var assignment) --
  // so by the time this code actually runs, textual/Map-insertion order
  // among the setup statements no longer matters at all.
  const code = `
_http_started_${port} = False

async def _http_handler_${port}(reader, writer):
    try:
        try:
            _reqline = await asyncio.wait_for(reader.readline(), 5)
            _parts = _reqline.split(b' ')
            if len(_parts) < 2:
                raise ValueError("bad request line")
            _method = _parts[0].decode()
            _path = _parts[1].decode().split('?')[0]
            while True:
                _hline = await asyncio.wait_for(reader.readline(), 5)
                if _hline in (b'\\r\\n', b'\\n', b''):
                    break
        except Exception:
            writer.write(b'HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n')
            await asyncio.wait_for(writer.drain(), 5)
            return
        _route = _http_routes_${port}.get((_method, _path))
        if _route is None:
            writer.write(b'HTTP/1.1 404 Not Found\\r\\nConnection: close\\r\\n\\r\\n')
            await asyncio.wait_for(writer.drain(), 5)
            return
        _q, _timeout_s = _route
        _conn = {'writer': writer, 'done': asyncio.Event(), 'status': 500, 'body': b'Internal Server Error: no response'}
        _q.put({'payload': None, 'topic': '', 'req': {'method': _method, 'path': _path}, '_http_conn': _conn})
        try:
            await asyncio.wait_for(_conn['done'].wait(), _timeout_s)
        except asyncio.TimeoutError:
            pass
        _resp_body = _conn['body']
        if isinstance(_resp_body, str):
            _resp_body = _resp_body.encode()
        _resp = ('HTTP/1.1 ' + str(_conn['status']) + ' -\\r\\nContent-Length: ' + str(len(_resp_body)) + '\\r\\nConnection: close\\r\\n\\r\\n').encode()
        writer.write(_resp)
        if _resp_body:
            writer.write(_resp_body)
        await asyncio.wait_for(writer.drain(), 5)
    except Exception:
        pass
    finally:
        writer.close()

async def _http_ensure_${port}():
    global _http_started_${port}
    if not _http_started_${port}:
        _http_started_${port} = True
        # Built here, not at module scope -- see this function's own
        # header comment above for the real ordering hazard that fixes.
        global _http_routes_${port}
        _http_routes_${port} = {}
${routeLines.join("\n")}
        # Kept in a module-level global rather than discarded -- not
        # strictly required under every asyncio implementation (the
        # listening socket is already registered with the event loop
        # once start_server returns), but cheap insurance against a
        # Server wrapper object being garbage-collected out from under
        # an active listener on any implementation that ties socket
        # lifetime to this object's own.
        global _http_server_${port}
        _http_server_${port} = await asyncio.start_server(_http_handler_${port}, '0.0.0.0', ${port})
`.trim();

  return { key: `http-server-${port}`, code };
}
