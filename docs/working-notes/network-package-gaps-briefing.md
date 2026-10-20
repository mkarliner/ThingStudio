# Briefing: network packages and the two remaining format gaps

Written 2026-10-19. Continues `node-parity-remaining-nodes-briefing.md` (2026-10-17) and
`package-compile-hooks-spike.md`. The compile-hook architecture is settled and working; this session converted every
network node that the package format can express today. The next session starts with the three that cannot be
expressed yet.

## What landed this session

**The package compile hook, end to end** (`interfaces/node-compile-context/`, draft v1):

- Spec + `api.json`: `<name>.compile.py` with `compile(ctx, properties)`, a JSON context (node/wiring, flow
  nodes/configs, referenced configs with secrets, target), and a validated result (`properties`, `claims`,
  `warnings`, `errors`). Limits: 64 KB properties, 64 claims, 1 s/hook.
- `node-library/compile-context.ts`, `compile-hook.ts`, `compile-hooks.ts`: builder, validator, async pre-pass.
  **`compile()` stays synchronous**; it refuses a hooked node when the pre-pass was skipped.
- `compile-hook/{wasi,run-hook,runner,hook-worker}.ts`: vendored MicroPython WASI interpreter
  (`micropython-wasi/`), pure-JS WASI shim, worker with a 1 s budget and terminate-on-timeout, sentinel-marked
  JSON results.
- Backend/loader serve the optional `compile` field; `main.ts` runs the pre-pass before every preview/deploy.
- The CLI (`thingstudio-compile`) runs hooks synchronously in-process (no timeout; documented) so checks still work.

**Node conversions** (all core packages, same recipe):

- `timer` (last blocker-free old-style package).
- `wifi_status`, `wifi_gate`, `udp_send`, `udp_receive`, `http_request` — including a shared
  `WIFI_DERIVATION` Python snippet so their hooks cannot drift.
- **`ts_wifi`** (`device-runtime/src/vendor/thingstudio_wifi/`), a flow dependency: idempotent
  `ensure_station(ssid, password, security, defer_to_mqtt)`. Built-in network nodes now emit it too, replacing the
  compile-time `wifi-sta` dedup that could not cross the package boundary. `mqtt` nodes now pass the config's real
  security so both paths agree.

## Git state

HEAD before the handoff commit: `42369cc`. All session commits are local and are pushed with this note (14 commits
from `b114dc8` timer through `42369cc`). Editor: 99 files, 1107 passed / 2 skipped; backend: 301 passed; editor and
CLI builds green; catalog regenerated and in sync.

## The three remaining network nodes, by blocker

**1. `ntp` — two-faced packages.**
`ntp` is a sink that also defines `codegenEventSource` (`pump the clock on messages` + `emit after each sync`).
A package declares one kind/hook pair; there is no data form for both faces.
Options: (a) allow a package to declare both a sink/transform hook and an event-source hook (the generic codegen
already supports two-faced `NodeDefinition`s); (b) split `ntp` into two nodes. (a) is the parity-preserving option;
needs a descriptor/schema addition and Mike's OK.

**2. `mqtt-publish` / `mqtt-subscribe` — shared client across instances. DONE 2026-10-19:** converted on the new
`ts_mqtt` library (`device-runtime/src/vendor/thingstudio_mqtt/`), which is option (a) below plus the per-node
subscription registry dynamic subscription required.
Both nodes share one `mqtt_as.MQTTClient` per broker, built once by compile-time setup dedup with module-level
variables, plus `runtime.register_cleanup`. A package's per-instance setup cannot express that.
Options: (a) a shared device library (`ts_mqtt`, the `ts_wifi` pattern) with `ensure_client(broker, port, ...)`
keyed by broker and its own cleanup; (b) a designed `runtime.shared` client with lifecycle rules. (a) is the closer
match and reuses the proven pattern; it moves the ~100 lines of connection/status code out of `mqtt-shared.ts` into
a vendored library that built-ins and packages both call.
**Requirement added 2026-10-19 (Mike), binding whichever option is chosen:** design the shared client for run-time
subscribe/unsubscribe even though dynamic subscription isn't built yet -- subscriptions tracked per node (a broker
UNSUBSCRIBE only when the last node lets go), resubscribe on reconnect from the *current* set, incoming messages
routed per node by wildcard match, and room for a "subscribed" signal a publish can wait on (the suspected boot race,
`outstanding-items/mqtt-pubsub-boot-race.md`). Full list: `outstanding-items/mqtt-dynamic-subscription.md`.

**3. `http-in` — sibling scan and a shared server. DONE 2026-10-20:** `ctx.nodesOfType` (added to the compile
context) gives the hook the full route table and keeps duplicate `(method, path)` a compile error; one
`ts_http_server.Server` per port is shared through `runtime.shared`, with a queue per node.
Builds the route table from every `http_in` node (`findNodesOfType` plus each node's properties), rejects duplicate
`(method, path)` per port, and shares one server setup per port.
Options: (a) a `nodesOfType` field kind (inline `[{id, properties}]`) + `runtime.shared('http_server', port, ...)`
and per-node queues keyed by node id — the design sketched in `network-family-flow-context-scoping.md` §4; (b) a
shared `ts_http_server` library that takes the whole route table as data, with each node registering its route.
(b) avoids inlining sibling properties but needs a runtime registration order; (a) keeps the built-in's compile-time
route validation. Decide before building.

## Open items carried forward

- **Real browser pass** for the worker + wasm (Node and the shim are tested; the bundle emits a 4 KB worker chunk).
- **Hardware pass** for the converted nodes, especially ESP32 + MQTT (the WiFi-flapping bug's home) and an RP2040
  run. Nothing this session has touched a board.
- **Conformance vectors** against the real interpreter (the worked example, malformed result, error, timeout,
  version mismatch) under `interfaces/node-compile-context/vectors/`.
- **CLI custom-node loading** does not exist, so the CLI has no hook path for user packages; its synchronous hook
  runner also has no containment (Ctrl-C is the escape).
- **Held by decision**: the flow-query vocabulary (`hasNode`/`nodesOfType`) and promoting core-only vocabulary into
  `custom-node.schema.json`. Not held: the property-dependent port-type data form, and `ts_wifi`.
- **Interpreter provenance**: the vendored wasm is an experimental MicroPython PR #13676 build, hash-recorded in
  `micropython-wasi/README.md`. Rebuild from a pinned commit when the target MicroPython version moves.

## Suggested next-session order

1. Decide the shared-client design (`ts_mqtt`) and flip `mqtt-publish` / `mqtt-subscribe`; they are the highest-use
   network nodes and the `ts_wifi` pattern is proven.
2. Decide two-faced packages and flip `ntp`.
3. ~~Decide the `http-in` design; it is the only node needing sibling data.~~ Done 2026-10-20.
4. Then the real-browser and hardware passes, and the conformance vectors.

## Constraints and gotchas

- Interface changes (`NodeDescriptor`, the custom schema, `interfaces/*`, the runtime API) need **Mike's explicit
  OK**. The compile-context spec is still a **draft pending review**.
- `find editor/src editor/test -name "*.js" -delete` before trusting `tsc`/`vitest`; use `./node_modules/.bin/tsc`.
- Backend tests: `../.venv/bin/python -m pytest` (system Python has no pytest).
- Regenerate the catalog after any user-visible field change:
  `npm run build:cli && node dist-cli/thingstudio-compile.mjs --describe-all --markdown >
  ../docs/user-guide/nodes-catalog.md`.
- Tests that compile a flow containing a hooked package must use `test/compile-with-hooks.ts` (or the hook pre-pass
  directly); a plain `compile()` deliberately throws.
- Working-notes line width <120; update `decisions/node-authoring.md` and `outstanding-items.md` in the same change.
