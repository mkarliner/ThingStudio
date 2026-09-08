# HTTP in / HTTP response nodes

## Status

Implemented and off-device verified, 2026-09-08. Not yet real-hardware verified by Mike.

## Background

Node-RED-style pair Mike raised in `mikes-questions-and-points.md` ("http server / http in node"),
originally listed under design doc §10's v2/v3 candidates ("a self-hosted mini dashboard needs an on-device
HTTP server"). Moved up into MVP scope, priority 3, during the 2026-09-08 triage session.

Mike's own steer on scope (same session, after seeing the full Node-RED semantics quoted back to him): **v1
does not implement Node-RED's full `http in` surface.** No named `:name` path parameters, no `msg.req.params`,
no request-body-to-`msg.payload` parsing. Exact `(method, path)` match only. Both omissions are real,
deliberately deferred — see "What's deferred" below, not oversights.

## What was built

- `editor/src/node-library/http-server-shared.ts` — the shared plumbing: property validation, a per-port
  route table built from every `http_in` node sharing that port (`ctx.findNodesOfType`), the actual TCP
  request handler (reads the request line + headers, matches the route table, dispatches to the matched
  node's own queue, waits — bounded by that node's own `responseTimeoutMs` — for a reply, writes the real
  HTTP response), and a hand-rolled minimal async queue (`_HttpInQueue`, since `asyncio.Queue` isn't reliably
  present across MicroPython/uasyncio versions).
- `editor/src/node-library/http-in.ts` — the source half (`codegenEventSource`, same pattern `interrupt.ts`
  established): one dedicated coroutine per node instance, waiting on its own private queue, fired only when
  a real inbound request matches its own `(method, path)`. Shares the flow's `wifi_status` node for WiFi
  credentials, same as `http_request`.
- `editor/src/node-library/http-response.ts` — the sink half: reads `msg.statusCode` (default 200) and
  `msg.payload` off the msg (Node-RED's own field names) and completes the matched request. Raises a clear,
  attributable error if fired on a msg that never came from an `http_in` node.
- Full canvas presence from the start (no registry-only interim period, unlike `http_request`'s own history):
  Rete node classes (`app/rete/nodes.ts`), palette entries (`app/rete/palette.ts`), `PropertyPanel.vue`
  sections.
- `docs/user-guide/nodes/http-in.md` / `http-response.md`, wired into `mkdocs.yml`; `canvas-basics.md`'s
  wifi_status-derivation sentence updated to include `http_in`.

### A real bug the functional test caught, not hypothetical

Building the route table at plain module scope (the same place every other shared-setup-statement node in
this codebase — `wifi_status`, `http_request` — puts its setup code) turned out to be broken for the
multi-`http_in`-node-sharing-one-port case: `compile.ts`'s `mergeSetup` collects every sibling's own
`SetupCode.statements` into one `Map`, in per-node codegen-call order, and the shared route table (deduped
under one `http-server-<port>` key) is only one of several statements a given sibling contributes. Whichever
sibling's codegen call happened to emit the route table first could land it in the generated source
*before* a later sibling's own queue-variable definition, even though the table's own route lines reference
that variable by name — a `NameError` at import time. Fixed by building the route table lazily, inside the
already-idempotent `_http_ensure_<port>()` bootstrap (which only ever runs from within an already-running
coroutine, i.e. strictly after every module-level statement — including every sibling's own queue variable —
has already executed), instead of at raw module scope. `node-http-in.test.ts`'s "GET and POST on the same
path" test is what surfaced this; worth remembering as a real hazard for any future shared-setup-statement
node whose setup code needs to reference another sibling's own per-instance name.

## Verified

Off-device: `tsc --noEmit` clean, `vitest run` clean (384/384, including 19 new tests in
`editor/test/node-http-in.test.ts`), `vite build` clean — all in the sanctioned isolated scratch copy
(`npm ci` fresh, never the live-mounted `node_modules`).

The new test file's harness is the mirror image of `node-http-request.test.ts`'s: rather than firing one
request and reading the result, generated Python here IS a real, long-lived server (`asyncio.start_server`),
so the harness spawns it as a genuine background process (`child_process.spawn`, not `execFile`) and makes
real HTTP requests into it from Node's own `fetch`. Covers: end-to-end request/response round trip including
status code + body, two routes sharing one port (the bug above), routing on method+path together, `msg.req`
contents, an unmatched path getting a real 404 (not a hang), a request whose flow never reaches
`http_response` timing out with a 500 (not a hang — the fault-handling case), two independent servers on two
ports, and the full set of property-validation/route-conflict CompileErrors.

**Not yet real-hardware verified** — same bar as every other network node type here (Tier 1 validation plan).

## What's deferred (Mike's own explicit scope cut, 2026-09-08)

- **Named path parameters** (`/user/:name`, populating `msg.req.params`) — Node-RED's own real behavior,
  quoted back to Mike mid-session; he chose the simpler exact-path-match v1 instead ("we don't have to
  implement all of the node-red semantics").
- **Request body parsing into `msg.payload`** — v1's `http_in` always emits `payload: None`; the body is
  read off the wire (so it doesn't corrupt the next request on the same connection) but discarded.
- **A per-node Content-Type property on `http_response`** — v1 always sends plain bytes/text, no header set.
- **No explicit cap on simultaneous in-flight connections/handler tasks per port** — relies entirely on the
  device's own socket/memory limits. Fine for a small number of well-behaved clients, a real
  resource-exhaustion risk for anything exposed to untrusted traffic.

None of these are hard to add later on top of the current shape (the exact-path route table already keys on
plain strings; templated matching, a params dict, and body capture are additive, not a redesign) — just not
built now, per Mike's own steer.

## Not yet decided / not asked

Nothing outstanding on the design side — Mike's Node-RED-parity steer plus the exact-path-only /
status-and-body-only scope answers resolved every open question this item's design phase raised. Remaining
work is the git commit and Mike's own real-hardware verification pass, same as every other freshly-built
node type here.
