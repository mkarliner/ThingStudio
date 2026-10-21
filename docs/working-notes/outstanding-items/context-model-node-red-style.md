# Context model — do it Node-RED-style, volatile (in-RAM) scope only

**Status: resolved 2026-10-21** -- Q3 chose the generic `change` node (option b); v1 is one rule per node over msg
properties and flow variables. Node context remains function-code only. See `decisions/context-model.md`.

Status: **[P2]**, scope narrowed 2026-09-06 during Mike's priority pass -- deliberately volatile-only for now. Follow-up to `canvas-presence-gaps.md`'s same-day reversal of
`variable_get`/`variable_set` canvas presence.

## Where this came from

`variable_get`/`variable_set` were given real canvas presence 2026-09-06 (`b046af1`), then walked through with
Mike the same session. Asked for a real use case beyond "it's like a variable": the honest answer is decoupling a
producer and a consumer that fire on independent triggers with no code needed on either side (e.g. a `timer`-fed
`variable_set` and an `mqtt_subscribe`-fed `variable_get` sharing a name, so a value asked for on demand doesn't
wait for the next timer tick). Anything involving actual computation on the stored value (a counter, a toggle) needs
a `function` node in the mix regardless, since `variable_get`/`variable_set` only copy `msg.payload` verbatim -- so
the two nodes only really earn their keep in the pure store/fetch case, which is real but narrow. Mike's call: keep
the underlying mechanism (the function node's `flow.get`/`flow.set`, already built and unaffected by any of this),
hide the two dedicated canvas nodes, and come back to this once it can be done properly, pointing at Node-RED's own
context system (https://nodered.org/docs/user-guide/context) as the reference.

## What Node-RED actually does (for when this gets scoped for real)

- **Three scope levels**, not one flat store: **Node** context (visible only to the one node instance that set it),
  **Flow** context (visible to every node on the same flow/tab -- the level our current `_flow_vars` dict already
  matches), and **Global** context (visible everywhere, across flows). We only have the Flow level today.
- **No dedicated "get variable"/"set variable" node types at all.** Context is read/written from inside a Function
  node's own code (`context.get()`/`context.set()`, plus `flow.`/`global.` equivalents for the other two scopes) --
  same shape our `flow.get()`/`flow.set()` inside a function node already has, just for one scope only so far. The
  no-code path is the generic **Change** node: it can set a message property, a flow/global context value, or a
  node's own context value, picking the store from a dropdown when more than one is configured -- one flexible node
  doing the job our two single-purpose nodes tried to do, not a dedicated pair per operation.
- **Pluggable storage backends**, configured in `settings.js`'s `contextStorage`, not hardcoded: `memory` (default,
  cleared on restart -- what we have) and `localfilesystem` (persists to disk, ~30s write-behind cache) are built
  in; multiple named stores can coexist (e.g. a default in-memory store plus a named persistent one), and a node's
  UI lets the user pick which store a given context value goes into.
- Some other nodes (Inject, Switch) can also read a context value directly as one of their own option types, rather
  than needing a Change node in front of them every time.

## What this would mean for Thingstudio, roughly (not a real scoping pass)

- A real design question, not answered here: does "Node" scope make sense on a microcontroller target at all, or is
  Flow + Global the right two-level version for v1? (Design doc §5's planned flash-backed store, mentioned in
  `variable-set.ts`'s own header, is a separate but related question -- persistence *within* a scope, not how many
  scopes exist.)
- Likely shape: extend the function node's `flow`/`global` (two objects instead of one), and either (a) bring back
  a single generic node (Node-RED's Change-node equivalent) that can target msg/flow/global rather than reviving
  `variable_get`/`variable_set` as-is, or (b) decide the no-code case genuinely isn't worth a dedicated node given
  how narrow the real use case turned out to be, and leave context access to function-node code only. Both are
  live options -- this file exists to carry the reference material forward, not to pre-decide between them.
- `node-library/variable-get.ts`/`variable-set.ts` and their `registry.ts` registration are untouched by the
  2026-09-06 hide -- whatever gets built here can reuse, replace, or sit alongside them; nothing about the hide
  forecloses either direction.

## Scoped 2026-10-17

`context-model-scoping.md` (working-notes root) is the scoping pass this file called for: it inventories what exists
today, proposes the scope set (node + flow, `global` reserved), a runtime-owned store mechanism, the keying and
one-way-door calls, and the no-code-path options -- and ends with the open questions for Mike. The reference material
above stays as the source for it. Nothing is built and the open questions are still open (proposes, does not commit).

## Sequenced after the device settings store, 2026-10-17 (Mike's call)

Mike split out a third use case in the same session -- **application settings** (a GUI colour scheme, units kg/lbs),
device-scoped and persistent -- and called **settings-first**: it lands as the pre-MVP piece and this volatile model
follows. `device-settings-store-scoping.md` is that sibling. Two consequences for this file:

- **`STATE_*` is settled:** the settings store needs no editor read/set at runtime, so persistence is device-internal
  and the wire stays untouched. Q6 in `context-model-scoping.md` §12 is answered.
- **§5's "reserve `global`" reasoning is superseded:** the distinction is **durability** -- the settings store is
  flash-backed, where `_flow_vars` is RAM only. It is namespaced by `flowName`, so the same flow's values survive a
  reboot/redeploy and a different flow is isolated. Its file-backed primitive is what this model's future
  device/persistent scope reuses.


## Scope split, 2026-09-06 (Mike's call)

This item is **[P2]**, buildable pre-MVP, but deliberately limited to volatile (in-RAM) storage -- same durability
as today's `_flow_vars` dict, just with the real node/flow/global scope model and a generic setting mechanism
instead of the narrow `variable_get`/`variable_set` pair. A flash-backed/persistent storage backend for this same
context model is a separate, later item -- see `tier2-live-streaming-persistence.md` (tagged **[POST-MVP]**),
which should build on top of whatever scope/API shape this item lands on rather than duplicate it. Do not conflate
the two when scoping this: get the scope/API right first (this item), let persistence plug in as a storage backend
choice later (Node-RED's own `contextStorage` pattern already models this split -- `memory` vs `localfilesystem` as
interchangeable backends behind the same `context.get`/`.set` API).
