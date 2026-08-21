# Working note: custom node authoring — scoping + implementation, one session

Status: decision-complete and implemented, 2026-08-20. Written per Mike's
own sequencing override (`outstanding-items.md`, "Next up"): custom node
authoring had "no design or scope exists yet, needs its own dedicated
scoping session" on record, but Mike's override was explicit that whoever
picked this up should resolve that gap as this session's own first task
rather than raise it back to him as a blocker. This note is that
resolution, worked out and implemented in one pass rather than handed off —
closer to how `wire-type-system-scoping.md` ended up ("started as scoping,
ended as a real decision, worked out live") than to the more common
scope-note-then-separate-implementation-session pattern this project
otherwise favors. Read this note before touching
`editor/src/node-library/custom-node.ts` or the loader/canvas wiring it
motivates — it explains *why* the shape is what it is, not just what was
built.

Second half of Mike's own sequencing note applies too: he'll run a
deliberately narrow follow-up session equipped with *only* the end-user
documentation this work produces (`docs/custom-nodes.md`), not this note,
not `CLAUDE.md`, not the rest of `working-notes/`, and ask it to build a
new node type from a brief — a real test of whether that doc alone is
sufficient. That's the actual bar this design has to clear, not just "is
this architecturally sound."

## Grounding: what the design doc already committed to

§7 (Extensibility) frames a node as two halves — "a small JSON descriptor
for the editor (palette entry, ports, property UI) and a Python module
implementing the node's behavior" — and names the distribution model in
prose: "adding a new node type is a matter of pushing a new `.mpy` module
to the device's filesystem alongside the flow, not rebuilding and
reflashing the runtime." §11 already resolved, back at MVP planning, that
v1's *first-party* node set ships fixed inside the runtime image, with an
explicit sketch for what "push a new module without reflashing" would need
once it's actually built: "a module-push wire message, a version/hash
field in `HELLO`, extending the free-space accounting." That mechanism was
never built — nothing about it exists in `editor/src/protocol/messages.ts`
or `device-runtime/src/messages.py` today, and §13's `DEPLOY` message still
carries exactly one `bytecode` blob plus one `staticData` blob, no per-node
or per-module structure at all.

That matters directly here: §11's own reasoning for deferring that
mechanism — "v1's node set is fixed at flash time... there's no separate
distribution/version-skew problem to protocol against yet" — doesn't
automatically stop applying just because the node is now user-authored
instead of first-party. The real question this session had to answer is
whether *custom* nodes specifically need that unbuilt mechanism on day one,
or whether they can also ride on what already exists.

## Decision 1: no new wire protocol, no separate module-push mechanism

**A custom node's device-side Python is inlined into the same one
`_flow.mpy` every other node type already compiles into, deployed over the
existing `DEPLOY` message unchanged.** No new message type, no `HELLO`
version/hash field, no on-device multi-file bookkeeping beyond what
`_handle_deploy` (`listener.py`) already does.

This is the single biggest scope reduction available, and it's not a
shortcut that forecloses anything — it's exactly what §11 already reasoned
through for the first-party case, now confirmed to extend cleanly to the
custom case too: "moving to 'compiler emits an `import` of a
separately-pushed module' later is additive to the compiler and to §13...
The one real exception is timing-critical nodes needing C-native modules."
Ordinary custom nodes (sensor drivers, protocol glue, anything a real
MicroPython driver library already covers) are exactly the non-exception
case. When a real need shows up for a node shared unchanged across many
flows without recompiling each one, or one large enough that inlining it
into every flow that uses it wastes flash — that's the trigger to build
the module-push mechanism §11 already sketched, and this session's node
contract (a plain `run(msg, properties)` / `emit(properties)` function,
see Decision 3) works identically whether it's textually inlined or
`import`ed from a pushed module. Nothing here is a one-way door against
that later.

**Cross-check against CLAUDE.md's "don't paint into a dead end" test:**
the cheap path (inline, no protocol change) forecloses nothing that
would otherwise be nearly free to keep open, because the node body's own
contract doesn't encode "I am inlined text" anywhere — it's just a Python
function taking `properties`. Worth the explicit check regardless, per
CLAUDE.md's standing instruction to make that comparison rather than skip
it in the name of avoiding premature optimization.

## Decision 2: package format — two files, not one, not a directory

A custom node type is exactly two files sharing a base name:

- `<name>.node.json` — the editor descriptor (type id, palette metadata,
  `kind`, ports, property schema).
- `<name>.node.py` — the device-side behavior, ordinary MicroPython.

Not one JSON file with the Python embedded as a string field: a real `.py`
file is editable with real syntax highlighting/linting and is what a node
author (human or agent) actually wants to write and iterate on, and it
keeps the git diff for "I changed the sensor read logic" separate from "I
changed the palette color" — the same diff-hygiene reasoning §6 already
applies to flow files (`nodes`/`edges` vs. `layout`), extended here rather
than reinvented. Not a directory-per-node-type with a manifest: that's
real, avoidable complexity for v1 (a directory picker, a manifest schema)
when a fixed two-file naming convention gets the same result for less
mechanism — see Decision 4 for why the loader doesn't need directory
access at all.

## Decision 3: the node contract — one function, not a JS codegen hook

Every first-party node type registers a `NodeDefinition`
(`compiler/node-definition.ts`) whose codegen hooks are TypeScript
functions compiled into the editor bundle. A custom node author has no way
to ship a TypeScript function without an editor rebuild — that's the
actual gap this whole feature exists to close — so custom nodes need a
data-driven codegen path, not a code-driven one. Concretely:

- `kind: "sink"` or `"transform"` custom nodes' `.node.py` defines
  `async def run(msg, properties):` — returns the (possibly modified) msg
  for transform, return value ignored for sink. Exactly §6's envelope
  contract, same as every first-party node.
- **Output port cardinality, resolved in conversation with Mike
  2026-08-20:** a custom node may declare at most one output port
  (`sink`: zero, `source`/`transform`: zero-or-one). Not a format
  restriction — `NodeDefinition.ports.outputs` is already `PortDefinition[]`,
  and nothing in `.node.json`'s schema caps its length — it's a codegen
  restriction: the generic wrapper only knows how to route one `return msg`
  value to one output, which is exactly what every first-party node does
  today too (`graph-adapter.ts` already flags a real two-output router as
  future work, unbuilt for any node type yet). The validator rejects a
  second declared output port with a clear error rather than silently
  wiring only the first. Explicitly checked against multi-output routing's
  own priority (high, just not this session, per Mike): when that
  compiler-level contract lands, custom nodes pick it up by extending
  `custom-node.ts`'s codegen to accept an array-of-msgs return, one per
  declared output — the package format doesn't need to change, so this
  cap isn't a one-way door against it.
- `kind: "source"` custom nodes' `.node.py` defines
  `async def emit(properties):` — returns the initial msg for one
  iteration. The descriptor's `properties` schema must declare a numeric
  `intervalMs` field (same name `timer.ts` already uses) — the generic
  codegen reads it to drive the existing `SourceCodegenResult.repeatMs`
  poll-loop shape. **Event-driven custom sources (interrupt-style,
  `EventSourceCodegenResult`'s wait-on-event pattern) are explicitly not
  supported in v1** — bridging a hard-IRQ handler into `uasyncio` safely
  (`interrupt.ts`'s `ThreadSafeEvent` machinery) isn't something a generic
  contract can make safe for arbitrary author-supplied code without a much
  larger effort; a custom node needing that shape is out of scope until a
  real motivating case argues for building it deliberately, not
  discovered as a missing corner case later.

The compiler wraps each *instance's* `.node.py` source in its own
uniquely-named closure, called once at flow-import time with that
instance's `properties` dict:

```python
def _custom_setup_<uniq>(properties):
    <node.py source, indented>
    return run   # or emit, per kind
_custom_run_<uniq> = _custom_setup_<uniq>({...instance's properties...})
```

This is what makes two instances of the same custom node type safe to drop
on one canvas with zero risk of their top-level state (driver objects,
imports, module-level variables) colliding — Python's own closure scoping
does the isolation, not a naming convention a node author has to remember.
It also means a custom node's own module-level setup code (pin/bus init,
same shape `gpio_out.ts`'s codegen has at the top level) is ordinary,
unremarkable Python — nothing about writing one requires understanding
this project's compiler internals, which is exactly the bar the
documentation deliverable needs to clear.

**Cleanup / lifecycle, checked against Node-RED's `on('close', (removed,
done) => ...)` pattern:** no new API is needed here — `runtime.py`'s
`register_cleanup(key, fn)` (built for the redeploy socket-leak fix)
already does the job, and it's already an ordinary module-level call a
node author can make from their own setup code, no different from
`udp-send.ts`'s own use of it. The gap isn't capability, it's
discoverability — nothing prompts a custom node author to know this
primitive exists unless they've read `runtime.py` itself. The end-user
guide (`docs/custom-nodes.md`) makes this a prominent worked example (a
node that opens a socket in setup and registers its own cleanup), not a
footnote, specifically because of this comparison.

**Real, named limitation this creates, distinct from a first-party node's
own dedup:** first-party nodes with shared claimed resources (two
`gpio_out` nodes on the same pin) dedup their setup statement by a resource
key (`pin-N-out`) so they share one `machine.Pin` object.
Custom node instances get **no** such dedup — each instance's closure is
fully independent, so two custom node instances configured against the
same physical pin/bus get two separate driver objects contending for one
resource. This is a real behavior difference, not a bug, and it compounds
an already-open project-wide gap (`outstanding-items.md`'s "Pin/resource-
conflict detection — never built" applies to first-party nodes too) rather
than introducing a new *kind* of gap. Documented plainly in the end-user
guide rather than left to be discovered the hard way.

## Decision 4: editor-side discovery — session-scoped load, no file-watching

The editor is a pure browser app today (`flow-file/file-io.ts`) — no
backend, no directory-scan mechanism exists anywhere in `main.ts`. Rather
than build one (a real, non-trivial addition: the File System Access API's
directory permissions and its persistence-across-reload story are their
own scoped feature), custom node loading reuses exactly the picker pattern
`file-io.ts` already established for flow files: a "Load custom node…"
action opens a multi-select file picker
(`showOpenFilePicker({multiple:true})`, `<input type=file multiple>`
fallback for Safari/Firefox, matching `file-io.ts`'s own two-tier pattern)
where the user selects both files of one node package at once (native
OS-level multi-select, no new browser API). The loader matches them by
shared base name, validates the descriptor, and registers the result into
an in-memory store for the rest of the session.

**Explicit, named limitation:** loaded custom nodes do not persist across
a page reload and there is no auto-reload/file-watch. Reopening the editor
means reloading every custom node package the current flow uses, same as
re-picking a flow file itself would be if this project had auto-restore
(it doesn't). This is the cheap-by-default call, not an oversight — nothing
about the package format or the in-memory store forecloses adding
persistence (e.g. remembering File System Access handles, or a real
project-directory scan once the backend in `backend-platform-decision.md`
exists) later; it's additive UI/storage work on top of an unchanged
package format, not a redesign.

## Decision 5: sandboxing — restate §9/§11's existing resolution, don't relitigate it

§11's open question ("whether the unsandboxed function node... ever
warrants hardening") was resolved 2026-08-11 as "no hardening for v1"
specifically because v1 has no marketplace or shared-flow mechanism, and
explicitly flagged for revisit "if/when Thingstudio ever supports something
like shared/marketplace flows written by someone other than the deployer."
`outstanding-items.md`'s own framing of this task called that resolution
back onto the table, arguing custom node authoring is "close kin" to that
trigger condition, "arguably closer... since a node runs with the same
trust level as the runtime itself."

Resolved this session, confirmed in conversation with Mike 2026-08-20
("go with it until it bites us" — the same "ship narrow, tighten later if
real use shows real pain" posture `wire-type-system-scoping.md`'s own
coercion matrix shipped under, not a permanently closed question):
**still no hardening, and the reasoning holds without modification.** §9's actual perimeter is deploy access, not
authorship — "anyone who can deploy a flow could already ship a malicious
native node... an unrestricted Python function node doesn't widen the
trust boundary, it just makes using it less effort." A custom node's
`.node.py` runs at exactly that same trust level, reached through exactly
the same perimeter (it only ever executes after a `DEPLOY`, gated by
whatever board-runtime auth `transport-auth-design.md` eventually enforces,
same as every other node's generated code). What *would* actually reopen
the sandboxing question is a marketplace/sharing mechanism — someone
installing a *different* person's custom node package without personally
reviewing it before it rides along on their own deploy. **That mechanism
does not exist. This session builds only local, same-machine loading of a
file the deploying user picked themselves** — no fetch-from-URL, no
registry, no "install someone else's package" flow of any kind. The
trigger condition §11 named is still unmet; restating that explicitly here
rather than silently assuming it, since this task specifically exists to
check.

Worth being honest about the one thing that *is* new: the editor process
itself now parses and displays untrusted-shaped JSON/Python text (the
package files) before any deploy happens. This is not a code-execution
risk in the browser — the loader parses the descriptor as inert JSON (no
`eval`/`Function()`/dynamic import of it) and only ever splices the Python
*text* into the generated flow source at compile time, the same
string-templating `function` node's own verbatim-user-code inlining
already does. Confirmed as a real design constraint on the implementation,
not just an aspiration: `custom-node.ts` and the loader must never execute
either file's content inside the editor's own JS runtime.

**Worth naming the actual alternative this rejects, since it's the
Node-RED-standard approach and diverges here deliberately:** Node-RED's own
node package HTML half (`nodered.org/docs/creating-nodes/node-html`)
registers a real edit-dialog via `oneditprepare`/`oneditsave`/
`oneditcancel` — literal JavaScript, executed in the browser admin UI the
moment a node's properties panel opens, not just on deploy. That buys
dynamic edit-dialog behavior (fields that populate from a callout, show/
hide based on another field) this project's static JSON property schema
can't do. Confirmed with Mike as the right trade for now — a loaded
custom node package can never execute anything in the editor process,
only (later, on an explicit deploy) on the device — revisit if a real
node design actually needs dynamic dialog behavior the static schema
can't express, not before.

## Decision 6: what's deliberately NOT built this session

Named explicitly so it reads as a scope choice, not an oversight:

- **Resource-conflict / pin-claim declarations for custom nodes.** No
  first-party node type has this either (`outstanding-items.md`); adding
  a `claimedPins`-style field to only the custom-node descriptor schema
  while no checker exists anywhere, for any node type, would be inventing
  unused surface. Add it project-wide, for every node kind, when the
  actual checker gets built.
- **Event-driven custom sources.** See Decision 3.
- **Separate module-push distribution.** See Decision 1 — this is the
  deferred-not-abandoned half; §11's own sketch is still the plan for when
  it's needed.
- **Directory-based / bulk loading of many custom node packages at once.**
  One "Load custom node…" action loads one package (two files); loading
  several means repeating the action. Cheap to extend to a directory
  picker later without changing the package format.
- **Any registry, sharing, or install-from-URL mechanism.** Directly what
  keeps Decision 5's sandboxing call valid — not a gap to fill casually.

## Blast radius (implementation)

- New: `editor/src/node-library/custom-node.ts` (descriptor validation +
  generic `NodeDefinition` builder), its test file, a small properties-
  dict Python-literal helper.
- New (editor UI): a custom-node package loader beside `file-io.ts`, a
  session-scoped custom-node store beside `store.ts`, one generic Rete node
  class replacing "one hand-written subclass per type" for custom kinds
  only (first-party classes in `nodes.ts` are untouched beyond the
  mechanical fix below), palette + property-panel integration, `main.ts`
  wiring (add/load/save/compile paths).
- Small, mechanical, zero-behavior-change fix needed regardless: `nodes.ts`
  (each class), `graph-adapter.ts`, and `main.ts` currently compute a
  node's compiler type by string-concatenating `` `thingstudio/${n.kind}` ``
  — which is wrong for a custom node's own (unprefixed) type id. Each node
  class gains an explicit `nodeType` field instead; the two call sites read
  it directly. Verified against the existing test suite to produce
  identical output for all 9 existing node types.
- New: `docs/custom-nodes.md` — the end-user guide, written to stand
  completely alone per the validation-session bar described at the top of
  this note.

## What this session does NOT claim

Same caveat every prior canvas-touching session in this project's history
carries, restated rather than dropped: the editor-side wiring (palette,
property panel, drag/drop, canvas round-trip) is unverified in a real
browser until Mike's own hands-on pass. What's off-device testable (the
compiler-side codegen in `custom-node.ts`, executed against real Python via
the existing `python3` + `pymock` fixture convention `node-timer.test.ts`
etc. already establish) is tested the same way every other node type in
this codebase is.
