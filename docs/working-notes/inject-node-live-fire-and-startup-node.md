# Working note: inject live-fire + startup node + node-ID UUID refactor, one session

Session origin: `docs/working-notes/inject-node-briefing.md` ("Currently the inject
node fires only at compile deploy time, which it shouldn't and doesn't fire when
clicked, which it should"). Closes both halves of `outstanding-items.md`'s
"`inject` might be doing the job of two separate nodes" review
(`outstanding-items/inject-node-review.md`) and the raw "init node triggered by
start of flow?" open question (`outstanding-items/init-node-on-flow-start.md`) —
both resolved together, as `outstanding-items.md` itself already anticipated.

## Grounding: what was actually broken

Before this session, `inject` had a `repeat` property (`manual`/`1s`/`5s`/`30s`)
and used `codegenSource`. `manual` compiled to `repeatMs: 0`, which `compile.ts`
runs exactly once, at flow start, with no loop — so "manual" inject already meant
"fires once at deploy time," not "fires when clicked." There was no live re-fire
mechanism anywhere: `PropertyPanel.vue`'s own header already flagged "no inject
now button... doesn't exist on the real InjectNode class." Clicking inject on a
running, deployed flow did nothing at all.

## Decision 1: click-fire is a live device command, not a canvas-only simulation

Discussed and resolved with Mike directly (not a design-doc-driven call):

- Clicking inject on a **live/deployed** device re-fires it **on the device**,
  via a new wire-protocol round trip — not a redeploy, not a canvas-only
  preview/mock the way `poc-rete`'s old `InjectNode.fire()` simulated firing
  with no real device behind it (`PropertyPanel.vue`'s pre-existing header
  already documented that gap as explicitly out of scope for the Rete
  migration).
- Clicking inject when **nothing is deployed** is a no-op — the Fire button is
  disabled, not hidden, so it's still discoverable.
- Inject's `1s`/`5s`/`30s` repeat presets are **dropped entirely**, not kept
  alongside the new click behavior. `timer` (`node-library/timer.ts`) already
  covers repeating sources with a real, configurable interval; inject
  carrying its own redundant fixed-preset repeat mechanism forward would just
  be two ways to do the same thing on the canvas.

## Decision 2: automatic fire-at-start is a separate node, not a checkbox on inject

Mike's own explicit redirect, verbatim: "I don't want fire on deploy at all. I
want an init (boot) node that fires at boot time. Deploy is not useful if the
device is disconnected from the editor, while a boot/init node will fire on
deploy and on a device reset which is the more useful use case. I think inject
and init/boot should be separate nodes for clarity."

This rejected an earlier `fireOnDeploy`-checkbox-on-inject proposal. The
reasoning that won: "fires when the editor deploys" and "fires whenever the
flow starts, including a bare device reset with no editor attached at all" are
genuinely different capabilities, not one capability with an extra trigger —
a standalone field device that loses power and comes back should still run its
startup logic with nobody watching, which a deploy-triggered fire can never
do. Naming: **`startup`** (`thingstudio/startup`), chosen over `init`/`boot`
alternatives via a direct question to Mike.

`startup` is structurally what inject's own `repeat: "manual"` case used to be:
`codegenSource` with a hardcoded `repeatMs: 0` ("run once, then stop" —
`SourceCodegenResult`'s own contract). No new compiler machinery needed for
this half.

## Decision 3: node IDs became UUIDs, project-wide, not just for this feature

Discussed and resolved with Mike directly. While scoping the live-fire
mechanism, the plan was a narrow workaround: capture a
`deployedNodeIdByReteId` mapping only at successful-deploy time, so a live
FIRE_NODE command could survive the canvas being edited between deploy and
firing. Mike's question instead: "why not use uuid's for nodeid's, I think
that's what nodered does" — followed by his explicit instruction, **"do it
properly,"** once the underlying issue was confirmed real rather than
theoretical.

**The pre-existing bug this exposed, unrelated to inject/startup:**
`GraphNode.id` was a `number`, freshly re-derived by `graph-adapter.ts`'s
`toGraphData()` on every single compile — never a stable identity tied to a
canvas node's actual lifetime. `main.ts`'s device-`NODE_ERROR`/mpy-cross-error
attribution (mapping a wire-protocol error back to the canvas node to
highlight) depended on exactly this fragile renumbering: if the canvas was
edited between a deploy and a later error arriving from that still-running
flow, the highlighted node could be **wrong** — a real correctness bug already
in production code, not something the fire feature introduced.

**Why the UUID fix is cheaper than the workaround, not just "more correct" per
CLAUDE.md's one-way-door framing:** Rete already assigns every node a stable
`crypto.randomUUID()` string ID at creation (`ClassicPreset.Node`'s own
constructor) — the exact same generator `store.ts`'s `createConfig()` already
reuses for config nodes. Passing that straight through removes code
(`graph-adapter.ts`'s renumbering maps, `main.ts`'s `lastReteIdByNodeId`) rather
than adding it, and closes the NODE_ERROR misattribution bug as a side effect.
The narrow workaround would have added a second, fire-specific ID-mapping
layer on top of an already-known-fragile one instead.

**Blast radius:** `GraphNode.id: number → string`; `GraphLink`'s origin/target
positions (not `link_id`, not the slot indices) same change; `graph-adapter.ts`'s
`GraphAdapterResult` simplified from `{ graphData, reteIdByNodeId, nodeIdByReteId }`
to just `{ graphData }` — no renumbering maps left to carry; `compile.ts`'s
internal node-id-keyed structures (`nodesById`, `childrenOf`, `functionDefs`,
`transformCodegen`/`sinkCodegen` maps, `emit()`/`nodeCallWithFaultBoundary()`
signatures) all follow the type through; `main.ts`'s `highlightNode`/
`highlightNodeFromNodeError` drop their `Number(...)`/`Number.isFinite` parsing
entirely, since a node ID is just used as-is now; every hand-built `GraphData`
test fixture project-wide moved from numeric `id: 1` literals to string
`id: "1"` (mechanical, `tsc --noEmit` gave the authoritative list); `device-runtime/src/runtime.py`'s `NodeError` docstring's stale "graph node IDs
are numeric in the compiler" note corrected.

**Side effect worth naming, not fully closed here:** `outstanding-items/console-node-id-mapping.md` ("live console output shows raw node IDs
only, no way to map back to a canvas node") described the fix as
straightforward specifically *because* the editor "already tracks a node-id
↔ canvas-node mapping internally (`graph-adapter.ts`'s `reteIdByNodeId`/
`nodeIdByReteId`)." That mapping no longer exists — and doesn't need to,
since a node's own ID now *is* its canvas identity directly, zero indirection.
The underlying fix is if anything now easier than before (no map to thread
through, just render `node.id`). But the raw ID a device error reports is now
a full UUID instead of a small integer — meaningfully harder to eyeball on a
console than `NODE_ERROR node=4` was, so the "how am I supposed to know which
node 2 is?" complaint this item already tracks (`mikes-questions-and-points.md`,
2026-08-19) got slightly worse in the meantime, not better, even though the
underlying plumbing is simpler. Reflected in that item's own updated
description; still unstarted, not fixed by this session.

## What got built

### Wire protocol: FIRE_NODE / FIRE_ACK / FIRE_ERROR (§13 addition)

Three new message types (byte values 9/10/11 — appended after §13's original
1–8, not renumbering anything already assigned):

- **`FIRE_NODE`** (editor → device): `{ nodeId }`. Fire one fireable-source
  node's msg-build + downstream chain right now, independent of anything else
  running.
- **`FIRE_ACK`** (device → editor): `{ nodeId }`. The named node was found in
  the fire-dispatch table and spawned — does **not** itself mean the node's own
  code ran without error; a failure inside it is reported the ordinary way, via
  `NODE_ERROR`, same as any other spawned task.
- **`FIRE_ERROR`** (device → editor): `{ nodeId, code, message }`. Rejected
  before anything ran — `nodeId` isn't in the currently-deployed flow's
  fire-dispatch table at all (unknown, or from a flow since replaced by a
  later `DEPLOY`). `code: "UNKNOWN_NODE"` is the only code emitted so far.

Implemented identically on both sides: `editor/src/protocol/messages.ts` +
`codec.ts` (TypeScript/cborg), `device-runtime/src/messages.py` (MicroPython/
`cbor.py`) — same field names, same validation shape, same numbering, per this
project's existing "device-runtime/src/messages.py's own table must match
editor/src/protocol/messages.ts's exactly" convention.

### Compiler: the fifth codegen pattern — `codegenFireableSource`

`node-definition.ts`'s `NodeKind: "source"` now has three possible codegen
hooks instead of two: `codegenSource` (poll/sleep loop), `codegenEventSource`
(wait-on-event, added for `interrupt` in an earlier session), and the new
`codegenFireableSource` (fire-on-command only, never auto-spawned).

`compile.ts`'s source-walk dispatch: a fireable source's generated function
(`async def _fire_N(): ...`) is emitted alongside every other coroutine, but
gets **no `spawnCalls` entry** — instead one
`runtime.register_fireable("<node-id>", _fire_N)` call
(`fireRegistrations`, emitted at the end of the module, after `spawnCalls`).
Registered under the node's own UUID, so a live `FIRE_NODE`'s `nodeId` matches
straight across to the device's dispatch table with no translation on either
side.

### Device runtime: the fire-dispatch table

`runtime.py`: `_fireables = {}` (node_id → zero-arg callable returning a
coroutine), `register_fireable(node_id, fn)` (plain overwrite, no dedup —
unlike `register_cleanup`'s "first wins": a same-flow collision is
structurally near-impossible with UUID node IDs, and `cancel_running()`
already clears the table before a new `DEPLOY`'s registrations land, so even a
same-flow re-registration case can't really arise), `fire(node_id) -> bool`
(looks up and `spawn()`s under the same per-task fault boundary every other
coroutine gets — a fired node's own failure is a normal `NODE_ERROR`, not a
fire-specific error channel). `cancel_running()` now also clears `_fireables`,
alongside the existing `_tasks`/`_cleanups` clearing.

`listener.py`: new `_handle_fire_node()` dispatches `FIRE_NODE` to
`runtime.fire()`, turning its boolean result into `FIRE_ACK`/`FIRE_ERROR`.

### Boot-time auto-resume of the persisted flow (the actual point of `startup`)

Before this session, `listener.py` only ever did `import _flow` inside
`_handle_deploy()` — nothing re-imported a previously-deployed, still-persisted
flow on a bare device boot/reset with no `DEPLOY` sent. Confirmed via
`test/hil/README.md` that `listener.py` already effectively becomes `main.py`
on real hardware (so the transport listener itself does restart on every
device boot) — this narrowed the actual gap to specifically "auto re-import
`/_flow.mpy` at boot," not the whole listener bootstrap.

New `_resume_persisted_flow()`, called from `main()` right after the existing
`sys.path` setup and before `_listener()`'s own task starts: if `_FLOW_PATH`
exists on disk, re-`import _flow` — same code path `_handle_deploy()` already
uses, just without rewriting the bytecode first. Silent on absence (no
persisted flow is the ordinary "never deployed" case, not an error); a
corrupted/incompatible persisted flow logs `RESUME_ERR` and is skipped rather
than blocking the listener from starting at all — same "adversarial input
never kills the process" principle `_handle_deploy`'s own try/except already
applies to a live `DEPLOY`. This is the piece that actually makes `startup`'s
"fires at boot/reset" promise real, not just "fires at deploy."

### Editor UI

- `inject.ts`: `repeat` property dropped entirely; `codegenSource` →
  `codegenFireableSource`.
- `startup.ts` (new): inject's old shape, minus `repeat`.
- `nodes.ts`: `InjectNode.properties` loses `repeat`; new `StartupNode` class
  (same `retypeOutput()` dynamic-socket pattern `InjectNode` already had).
- `palette.ts`: new `startup` kind — olive-green (deliberately close to but
  distinct from inject's own green, since the two are conceptually related),
  "⏻" icon (boot/reset) distinct from inject's "▶" (manual trigger).
- `PropertyPanel.vue`: inject's `repeat` `<select>` replaced with a Fire
  `<button>`, gated on `deviceConnected.value && flowDeployed.value`
  (disabled, not hidden), showing `FIRE_ACK`/`FIRE_ERROR`/timeout inline; new
  `startup` block (payload fields only, no fire button — it isn't a
  `codegenFireableSource` node).
- `store.ts`: `deviceConnected`, `flowDeployed` (true only from a real
  `DEPLOY_ACK` for the currently-open flow, reset on every new deploy attempt
  and on disconnect — deliberately does **not** try to track "has the canvas
  changed since deploy," since a stale/unknown node ID is caught safely by the
  device's own `FIRE_ERROR` either way), `fireNodeImpl` (the indirection
  `main.ts`'s real transport/`waitForMessage` machinery is reached through,
  same pattern `configs`/`bumpPropertyVersion` already establish).
- `main.ts`: `fireNode()` — sends `FIRE_NODE`, races `FIRE_ACK`/`FIRE_ERROR`
  against a 5s timeout, wired into `fireNodeImpl`.

## What this session does NOT claim

Same caveat every prior canvas-touching session in this project's history
carries: the editor-side wiring (palette entry, property panel, Fire button)
is unverified in a real browser until Mike's own hands-on pass. The
device-runtime half got real verification this session (not just review):
`device-runtime/test/test_runtime.py` (fire-dispatch table under real
`uasyncio`) and `device-runtime/test/test_listener_integration.py` (real
`micropython listener.py` subprocess, real `mpy-cross`-compiled bytecode) both
run against an actual MicroPython unix-port build, not a mock — including two
new integration tests that specifically prove the boot-resume claim: deploy a
flow, kill the listener process, start a fresh one against the same
`_FLOW_PATH`, confirm the flow's own coroutine runs again with **no `DEPLOY`
sent the second time**. That's real proof of the boot/reset behavior on the
unix port; it is not the real hardware pass (real silicon timing, a real
power-cycle rather than a killed process, the witness rig's independent
`HEARTBEAT_WATCH`) — same gap every prior device-runtime session in this
project has been explicit about.

## Blast radius (implementation)

- Wire protocol: `editor/src/protocol/messages.ts`, `codec.ts`;
  `device-runtime/src/messages.py`.
- Compiler: `editor/src/compiler/node-definition.ts` (new
  `FireableSourceCodegenResult` + hook), `compile.ts` (dispatch branch +
  `fireRegistrations` emission), `graph.ts` (UUID type change + header
  rewrite).
- Device runtime: `device-runtime/src/runtime.py` (`_fireables`/
  `register_fireable`/`fire`), `listener.py` (`_handle_fire_node`,
  `_resume_persisted_flow`).
- Editor UI: `node-library/inject.ts` (rewritten), `node-library/startup.ts`
  (new), `node-library/registry.ts`, `app/rete/nodes.ts`, `app/rete/palette.ts`,
  `app/rete/PropertyPanel.vue`, `app/rete/store.ts`, `app/rete/graph-adapter.ts`
  (simplified), `app/main.ts`, `dev-tools/verify-flow-file.ts`.
- Tests: new `editor/test/node-inject.test.ts`, `node-startup.test.ts`;
  `protocol.roundtrip.test.ts` extended with FIRE_* cases;
  `editor/test/fixtures/pymock/runtime.py` extended with a `register_fireable`/
  `fire` mock; every hand-built `GraphData` fixture project-wide (~19 test
  files) converted from numeric to string node IDs, and every fixture using
  `thingstudio/inject` purely as an auto-firing trigger (not testing inject's
  own semantics) switched to `thingstudio/startup` (one exception:
  `compiler.general.test.ts`'s sleep/yield-skipping test needs a genuinely
  *repeating* source, so it uses `thingstudio/timer` instead — `startup`'s
  `repeatMs: 0` never emits a sleep/loop at all); device-runtime:
  `test_runtime.py` (fire-dispatch unit tests), `test_protocol.py` (FIRE_*
  round-trip/rejection), `test_listener_integration.py` (real end-to-end
  fire + boot-resume tests, including two brand new tests specific to the
  boot-resume claim).

## Addendum, 2026-09-24

Only `startup.ts` and `node-startup.test.ts` from this session ever reached git (inside `67d87c7`); the
`registry.ts`/`nodes.ts`/`palette.ts`/`PropertyPanel.vue` wiring described above did not. Wired in 2026-09-24 —
see `outstanding-items/init-node-on-flow-start.md`.
