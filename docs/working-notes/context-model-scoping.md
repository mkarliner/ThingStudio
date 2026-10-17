# The context model (Node-RED-style) — scoping

Status: scoping, 2026-10-17. Proposes; does not commit. Every interface addition here — the runtime API, the
node descriptor, the wire protocol — needs Mike's explicit OK in the session that lands it (root `AGENTS.md`,
"Interface specs", "Everything is a plugin"). This note exists because the model was deliberately deferred twice
(`outstanding-items/context-model-node-red-style.md`, `decisions/editor-canvas.md` 2026-09-06) and is now blocking
node-format-parity work.

**Not to be confused with `node-context-parity-scoping.md`** (a different "context"): that note is about
**compile-time** context a node's codegen reads (`CodegenContext` — `findNodesOfType`, `resolveConfig`, the target
board). This note is about the **runtime** context model — state a running flow keeps between messages, Node-RED's
`context`/`flow`/`global`. The two share a word and nothing else.

## 1. Why this is being scoped now

`variable_get`/`variable_set` sit on the node-format-parity briefing's "portable now" list
(`node-parity-remaining-nodes-briefing.md`), and `flow`/`context` are exactly what those two nodes and the function
node already *are*. Porting them 1:1 into core packages would cement the narrow store/fetch pair Mike hid on
2026-09-06, pending a real design — the same design this note is about. It is also the named blocker under design
doc §11: the flash-backed state store's design "connects to the un-scoped Node-RED-style context model." So the model
is scoped first; the parity work and the persistence item both hang off it.

## 2. What exists today

Three pieces, none of them called "context" in the device runtime — all of it compiler-emitted:

- **`flow` scope** — `_flow_vars`, a module-level dict, emitted as a setup statement (key `flow-vars-dict`).
  Name-keyed. Read/written by `variable_get`/`variable_set` codegen (`editor/src/node-library/variable-{get,set}.ts`)
  and by function-node `flow.get`/`flow.set`.
- **`context` scope** — a fresh dict per function-node *instance* (`ctx.uniqueName("ctx")`), wrapped in a generated
  `_Store` class. Only function code sees it.
- **`_Store`** — six lines emitted by function codegen (`function-node.ts:52`): `get(key, default=None)` /
  `set(key, value)`.

Both dicts live in the deployed flow module. A redeploy re-imports the module and re-runs the setup statements, so
both are wiped — the same behavior Node-RED's default in-memory store has across a restart. There is **no `global`
scope** (single flow per device, design doc §6) and **no persistence** (`STATE_READ`/`STATE_WRITE` are reserved on
the wire and logged as ignored; design doc §5). The runtime (`device-runtime/src/runtime.py`) knows nothing about any
of it.

The consequence that matters here: **only the `function` node can reach context directly.** A built-in or a package
that isn't the function node cannot, and a custom package has no path at all (the editor never runs package code, and
the runtime exposes no store). That is a node-format-parity gap — a built-in using context is not reproducible as a
package.

User-facing today: `function.md` documents `context`/`flow`; the dedicated `variable_get`/`variable_set` canvas nodes
are hidden (`editor/src/app/rete/palette.ts`, `nodes.ts`); their codegen/registry still work, so a saved flow
referencing either type still compiles.

## 3. What Node-RED does (the reference)

From https://nodered.org/docs/user-guide/context:

- **Three scopes.** Node (one node instance only), Flow (every node on the tab), Global (every node everywhere).
- **No dedicated get/set node types.** Context is read/written from inside Function-node code (`context.get/set`,
  `flow.get/set`, `global.get/set`). The no-code path is the generic **Change** node — set (or delete) a msg
  property, a flow/global value, or the node's own value, picking the scope (and store) from a dropdown.
- **Other nodes read context directly** too (Inject can inject a context value; Switch can route on one) — context is
  a first-class input source, not only a side channel.
- **Pluggable stores** via `settings.js` `contextStorage`: `memory` (default, cleared on restart) and
  `localfilesystem` (~30s write-behind), plus custom plugins; multiple named stores can coexist and the UI picks one
  per value.
- **Custom nodes use context** the same way through the runtime's node API.

## 4. The two axes — keep them apart

Two independent questions get conflated in Node-RED's single word "store":

1. **Scope** — *who can see it*: node-instance / flow / global.
2. **Durability** — *does it survive*: in-RAM (cleared on redeploy/reboot) / flash-persisted.

Thingstudio already split these deliberately (`context-model-node-red-style.md`): the scope/API shape is this item
(volatile, pre-MVP); a flash backend behind the same API is the separate POST-MVP item
(`tier2-live-streaming-persistence.md`). The API designed here must let durability be an interchangeable backend under
one `get`/`set`, per Node-RED's `contextStorage` model — not two parallel mechanisms.

## 5. Scope set and keying for v1 — proposal

- **node + flow; defer `global`.** Global is "across flows," and v1 is single-flow-per-device (design doc §6), so it
  would today be indistinguishable from flow scope. Reserve the name/slot so a v2 multi-flow doesn't move the API.
- **Node scope keyed by the node's stable UUID** (design doc §6: IDs are stable, never renumbered). Two instances
  with the same author-chosen key must not collide, and the future flash store is node-ID-keyed
  (`tier2-live-streaming-persistence.md`) — keying node scope by ID now is what lets persistence plug in without a
  migration.
- **Flow scope stays name-keyed** (the author owns collisions, same trust model as the unsandboxed function node).
  This matches Node-RED and preserves the existing `_flow_vars` contract, including `function`'s `flow` interop with a
  `variable_get`/`variable_set` node of the same name.
- **Durability: memory only in this item.** Flash persistence stays POST-MVP.

## 6. Mechanism — where the store lives

**Option A (recommended): runtime-owned.** The `runtime` module gains a small accessor — node scope and flow scope —
returning a `get`/`set`/`keys`/`delete` store. Function codegen binds its `context`/`flow` locals to those stores;
built-in and custom packages call the same accessor from their `.node.py`. One implementation, reachable by every node
kind, and the future persistence backend has a real owner (the runtime, which outlives the flow module and a
redeploy) to sit behind.

**Option B: keep it compiler-emitted.** Continue emitting `_Store`/`_flow_vars` from the compiler. This cannot serve
packages at all (no way for `.node.py` to reference generated local names), and gives the persistence item nothing to
own. Rejected on the parity gap alone.

Option A is a **runtime API addition** to `interfaces/runtime-api/` (`SPEC.md` + `api.json` + conformance tests), and
the generated function code changes shape (from `_Store`/`_flow_vars` to runtime calls), so an editor with this change
could produce a flow an older `runtime.py` fails to run → a **major** runtime version bump when landed (root
`AGENTS.md`, "Device-runtime version bump discipline").

## 7. API shape (illustrative, not final)

Store surface, kept deliberately tiny:

```
get(key, default=None)   # missing key -> default, never an error
set(key, value)
keys()
delete(key)
```

Node-RED's optional store argument (`context.get(key, store)`) is where a per-value durability choice would ride
later; **reserve** the slot rather than build it now (design doc §5's "explicit property on each entry, not an
inferred default" refinement). Don't expose named stores in v1 — that is the persistence item's call.

**Concurrency.** uasyncio is cooperative; a function-node body is synchronous (no `await`), so a get-then-set inside
one call is atomic against other tasks. A read-modify-write spanning an `await` in a coroutine node can interleave.
No locks in v1 — a deadlockable lock is a worse failure than a documented race (fault-handling priority). A
check-and-set helper is a possible later addition, not now.

## 8. The no-code path — the product question

What replaces the hidden `variable_get`/`variable_set`? Three live options:

- **(a) Revive the narrow pair.** Already judged too narrow on 2026-09-06 — rejected once; don't reopen without a
  reason.
- **(b) A generic Change-style context node.** One descriptor (scope target + operation + value), data-expressible,
  so it can be a core package and a custom package alike — the Node-RED model, and the "everything is a plugin"
  answer. Larger scope: a real Change node also sets/deletes msg properties, which nothing does today.
- **(c) Function-code-only.** Document that context access requires a function node; ship no no-code node. Cheapest
  and covers the honest use case (a counter/toggle needs computation anyway), but abandons the low-code path Node-RED
  users expect.

This decides the fate of the two hidden nodes **and** the parity briefing's "portable `variable_set`" item. It is a
product call — **Mike's** — not something this note should pre-decide.

## 9. Fault handling and one-way doors

- **Resolution shape:** `get` with a default; a missing key is not an error (matches `_Store` and Node-RED).
- **Persistence failures** (flash full, write wear) must be legible — an attributed error, not a silent lost write.
  That is the persistence item's bar, but the API must not make it impossible (a backend that can fail needs an error
  path the volatile dict doesn't have).
- **The one-way door** is the runtime-owned store and its keying: node scope keyed by stable node ID and flow scope by
  name, fixed now, is what keeps a future flash backend from a breaking migration of already-deployed flows. Get it
  right before anything ships that reads context.
- **`STATE_READ`/`STATE_WRITE`** stay reserved and unbuilt. Whether context persistence is device-internal
  (write-behind, Node-RED-style) or driven through those wire messages is an open question (§12) with a wire-protocol
  blast radius.

## 10. Blast radius

- **`device-runtime/src/runtime.py`** — the store accessor + the in-RAM stores (**major** version bump).
- **`device-runtime/src/listener.py`** — only when persistence lands (store ownership across redeploy).
- **`interfaces/runtime-api/{SPEC.md,api.json}`** + `editor/test/runtime-api-conformance.test.ts` +
  `device-runtime/test/test_runtime_api.py`.
- **`editor/src/node-library/function-node.ts`** — bind `context`/`flow` to the runtime store; drop the emitted
  `_Store`/`_flow_vars` setup (and the `FLOW_VARS_DICT` coupling).
- **`editor/src/node-library/variable-{get,set}.ts`**, `registry.ts`, `palette.ts`, `nodes.ts`,
  `verify-flow-file.ts` — keep/delete/replace per §8.
- **`interfaces/node-descriptor/`** — only if a generic context node (§8b) is built.
- **`docs/user-guide/nodes/function.md`**, a new node page if any, `first-flow.md`.
- **Wire protocol** — only if `STATE_*` is chosen (§9); otherwise untouched.

## 11. Reference "no loss" targets

1. **A counter/toggle inside one function node** (`context.get`/`set`) — works today; must keep working.
2. **A value shared between two nodes by name** (`flow`, `variable_get`/`variable_set` interop) — works today; must
   keep working, now on one backend.
3. **A custom package reading/writing flow context** — the new capability that closes the parity gap; nothing can do
   this today.
4. **(future)** A calibration constant surviving reboot — the persistence item, sitting on this API unchanged.

## 12. Open questions for Mike

1. **Scope set:** node + flow only for v1, `global` deferred/reserved (§5) — agree?
2. **Mechanism:** runtime-owned accessor (Option A) vs compiler-emitted (Option B) — §6 recommends A; A is a major
   runtime bump.
3. **No-code path:** (a) revive the pair, (b) a generic Change-style node, or (c) function-code-only (§8)? This also
   settles whether the parity work ports `variable_get`/`variable_set` at all.
4. **Timing:** does this land pre-MVP (the outstanding item is tagged [P2] pre-MVP for the volatile half), or after
   the current parity push?
5. **Persistence boundary:** confirm the API is designed to leave room for the per-entry persist flag and a storage
   backend, without building either here.
6. **`STATE_*`:** leave the wire messages reserved and make persistence device-internal, or use them? (Wire change =
   your OK.)

## 13. First step (if approved)

Land the volatile model against the runtime-owned shape: the `runtime` store accessor (node + flow scope, memory
only), migrate `function` codegen and the `variable_*` nodes onto it, update `interfaces/runtime-api/` + conformance,
bump the runtime major, and verify targets 1 and 2 above still pass. §8's node decision can follow once answered;
nothing in the store API forecloses any of its three options.
