# Briefing: Rete migration, Phase 3 (app shell)

> **Status: fully resolved as of 2026-08-19 — see
> `docs/working-notes/outstanding-items.md`.** Phase 3's app-shell cutover
> landed and was hardware-confirmed the same day
> (`rete-migration-phase4-briefing.md`'s own "Status as of this session
> starts" section). Kept for historical reference, not active reading.

For the next chat. Read `CLAUDE.md` in full, as always. Then read
`docs/working-notes/rete-migration-decision.md` **in full — it is still
the spec for this session**, same status it had for Phase 0-1: Phase 3's
task list (items 11-13 below), the sub-decisions (especially 3, wire types
stay out of scope), and "Explicitly out of scope" all still bind.

Then read, in full, everything Phase 3 actually touches or replaces:
`editor/src/app/main.ts` (584 lines — the file this session rewrites most
of), `editor/src/app/nodes.ts` (the Litegraph node classes main.ts's
canvas section currently drives — **not** the same file as
`editor/src/app/rete/nodes.ts`, which is this migration's Rete
equivalent; the two live side by side under similar names, easy to
conflate), `editor/index.html` (the DOM main.ts wires against), and
everything already built under `editor/src/app/rete/` (five files from
Phase 1 — `sockets.ts`, `schemes.ts`, `nodes.ts`, `palette.ts`,
`validation.ts`, `editor-setup.ts`, `ThingstudioNode.vue`,
`ThingstudioSocket.vue`, `PaletteSidebar.vue` — plus Phase 2's
`graph-adapter.ts`). Also read `pocs/poc-rete/src/PropertyPanel.vue` and
`pocs/poc-rete/src/store.ts` in full — this session ports both, and
`editor-setup.ts` currently has no `nodepicked` selection wiring at all
(deliberately deferred to this phase, see its own header comment).

**You do not need to read the full design doc.** §5 (fault isolation) and
§13 (protocol) are worth having to hand for the error-attribution section;
reading all fifteen sections is not a good use of the session, same call
the Phase 0-1 briefing made.

## Model note

This phase is **not** the same mechanical-porting shape Phase 0-1 was.
Phase 0-1 ported working poc-rete code onto real property contracts —
low-judgment. Phase 2's adapter was "the one genuinely new logic," but
still a pure function with an obvious correct shape (mirror
`graph.serialize()`'s contract). Phase 3 is real synthesis: `main.ts`'s
Litegraph-shaped functions have no 1:1 Rete equivalent to port (the
decision doc says this outright — "`applyFlowFile()` is a rewrite, not a
port," "Rete has no widget layer to sync") and the thing being preserved
across that rewrite is a fault-handling contract, not a feature. Sonnet is
probably still fine given how detailed this brief is, but the signal to
stop and ask for Opus is different this time: if preserving the
skip-and-report contract, or the error-attribution boundary below, starts
requiring judgment calls the decision doc doesn't already answer, that's
the reassessment trigger — not a coupling-boundary surprise (Phase 0-2
already confirmed that claim holds).

## What kind of session this is

Implementation, continuing Phases 2 (the one deferred item) and 3 of the
decision doc's scoped task list. Phase 2 left item 10 undone deliberately
(Mike's call, previous session): wiring the graph adapter into
`currentSource()` and deleting the 1s poll. That's really part of the same
`main.ts` surgery Phase 3 does, so do it together with items 11-13 rather
than as a separate pass.

## The thing to resolve before writing any code

**Decision 1 in the decision doc says there is no half-migrated canvas**:
"Litegraph and Rete both want to own the same canvas element, the same
pointer events, and the same graph state... The one file that has to
change (`app/nodes.ts`) changes all at once or not at all." Phase 0-1's
"Litegraph editor must stay runnable throughout" instruction was
satisfiable for free during those phases because `main.ts` was never
touched — Litegraph kept running because nothing about its wiring changed.

That stops being true the moment `main.ts`'s canvas-construction section
(the `LGraph`/`LGraphCanvas` build, `resize()`, `graph.start()`) gets
replaced with `createThingstudioEditor()`. Once that lands, Litegraph is
no longer what `index.html` actually loads and runs — it stays in the
repo, untouched, deletable-but-not-deleted (Phase 4 step 17 does that,
after the hardware round-trip), and **revertible via git**, but it is not
simultaneously live alongside Rete in the same browser tab. Nothing in the
decision doc describes a toggle or dual-canvas mode, and Decision 1's own
reasoning above is that one isn't really buildable without owning the
canvas element twice.

Read this as: "stays runnable" phase-by-phase meant "unmodified and
functional" through Phase 0-2, and from Phase 3 on it means "reversible" —
matching the decision doc's own framing of Phase 4 step 16 (the hardware
round-trip) as "the only step in this plan whose failure would mean the
decision was wrong. Everything before it is reversible." **Confirm this
reading with Mike before starting** rather than assuming it — it's a
real, one-way (until reverted) change to what the live editor is, and
that's exactly the kind of call this project's own convention says
shouldn't be made silently from a sandbox.

## What to actually do

The decision doc's Phase 2 item 10 and Phase 3 items 11-13 are the task
list. In practice that decomposes into, roughly in this order:

1. **Swap the canvas-construction section of `main.ts`.** Replace the
   `LGraph`/`LGraphCanvas` build, `resize()`, `graph.start()` (~20 lines)
   and the toolbar `addNode()`/button wiring (~15 lines) with
   `createThingstudioEditor()` (`editor-setup.ts`) mounted into a
   container, plus `PaletteSidebar.vue` for node creation (click-to-add and
   the drag-and-drop it already implements — `PaletteSidebar.vue`'s `add`
   event and `DRAG_MIME`-based drop target aren't wired to anything yet;
   this is where they get wired). `registerCanvasNodeTypes()`'s import
   from `nodes.ts` (Litegraph) is what actually gets dropped here — the
   file itself is untouched, per the section above.
2. **`index.html` needs real decisions, not just file swaps.** It
   currently loads `litegraph.min.js`/`litegraph.css` via `<script>`/
   `<link>` tags and has a vanilla-JS toolbar (add-node buttons per type,
   `#canvas-wrap`/`#graph-canvas`, the `#code-modal` for function nodes).
   poc-rete's `App.vue` is the template for the canvas+palette+panel
   layout, but the real editor also has `#source-preview` and `#console`
   (device console) panels poc-rete never had, plus the Connect/
   Disconnect/Deploy buttons and the `#pill` connection-status indicator —
   none of that is canvas-related and none of it should move. Work out
   whether the whole app becomes one mounted Vue tree (poc-rete's model,
   with the existing sidebar panels folded in as more Vue components) or
   whether only the canvas+palette+property-panel region mounts Vue while
   the rest of `main.ts`'s vanilla DOM code stays as-is. The decision doc
   doesn't pick one — this is real judgment for this session, not
   something to infer from poc-rete alone.
3. **Item 10: wire `graph-adapter.ts` into `currentSource()`.** Replace
   `graph.serialize()` with `toGraphData(editor)` (Phase 2's function,
   already unit-tested against the real compiler). Delete the 1s
   `refreshPreview` poll — its own comment says it exists only because
   "Litegraph 0.7.18 has no reliable 'graph changed' callback," which Rete
   doesn't have that problem with; drive `refreshPreview` off `editor.
   addPipe` instead (the exact mechanism `validation.ts`'s checkpoint-1
   pipe in `editor-setup.ts` already proves works for every graph
   mutation).
4. **Item 11: rewrite `extractCanvasSnapshot()`/`applyFlowFile()`.**
   These read/write flow files via `flow-file.ts` (canvas-independent,
   untouched) — the part that changes is the canvas-coupled glue. **The
   skip-and-report contract for unknown node types and orphaned edges is
   not negotiable**: a referenced type that isn't registered gets reported
   and skipped, along with any edge touching it, rather than aborting the
   whole load (CLAUDE.md's fault-handling priority applied to file I/O,
   already implemented once against Litegraph — read the current
   `applyFlowFile()`'s own docstring for the exact behavior to preserve).
   Verify against `editor/test/flow-file.test.ts` directly — it's
   canvas-independent and must stay green, untouched, same bar Phase 0-1
   held for the ~20 compiler/protocol suites.
5. **Item 12: rewrite node highlighting.** `highlightNodeFromMpyError()`'s
   line-number-to-node lookup (via `lastNodeLineRanges`, itself from
   `compile.ts`, untouched) and `highlightNodeFromNodeError()`'s
   untrusted-ID guard (`Number(nodeIdRaw)`/`Number.isFinite` check on a
   `§13 NODE_ERROR` — the device is untrusted input) are canvas-agnostic
   logic and **must not change**. What changes is only the mechanism that
   turns a node red: today it's `node.color`/`node.bgcolor` mutation plus
   `canvas.setDirty(true, true)`; the Rete equivalent is reactive
   component state `ThingstudioNode.vue` reads (a `highlighted` field or
   similar), matching how the decision doc's own removed-scope note put
   it: "the mechanism ... becomes reactive component state." Remember
   Phase 1 deliberately left `ThingstudioNode.vue` without a status-line
   mechanism (see that file's own header) — highlighting is a different,
   simpler need (a node-level boolean, not a text status line) and can be
   added without resurrecting the `lastValue`/`lastLabel`/`seed` machinery
   poc-rete had for live propagation, which is still out of scope (below).
6. **Item 13: property panel.** Port `pocs/poc-rete/src/PropertyPanel.vue`
   and `pocs/poc-rete/src/store.ts`'s `selectedNode`/`propertyVersion`
   pattern, and wire the `nodepicked` → `selectedNode` hook into
   `editor-setup.ts` (deliberately left out in Phase 1 — see that file's
   header for why). Retire `window.thingstudioOpenCodeEditor`/
   `#code-modal` (the one-off function-node code editor) into the property
   panel — this closes `mvp-feature-priorities.md`'s deferred "compact node
   appearance" item as a side effect, per the decision doc's own framing:
   "the one deferred item this migration legitimately absorbs."

## Stop conditions

Same shape as Phase 0-1's, still binding:

- **Anything under `editor/src/compiler/`, `editor/src/protocol/`,
  `editor/src/node-library/`, or `editor/src/flow-file/flow-file.ts` needs
  to change.** Still rests on these being canvas-independent — Phase 2's
  adapter already proved this for the compiler specifically (real
  round-trip test, unmodified `compile.ts`). If flow-file.ts turns out to
  need a shape change to fit Rete, that's the Opus-level reassessment.
- **Any of the ~20 existing test suites needs modifying to stay green** —
  `flow-file.test.ts` above all, but the whole set. Untouched and passing
  is the bar, not "passing after edits."
- **A new npm package looks necessary.** Six approved runtime packages
  plus `@vitejs/plugin-vue` is still the full set; nothing in Phase 3's
  scope should need more (no new Rete plugin, definitely not
  `rete-engine` — see "Not in scope").
- **The canvas-agnostic two-thirds of `main.ts` starts looking like it
  needs changing.** Per Decision 1's own evidence table: the mpy-cross WASM
  loader/`waitForMpyCrossFactory`, the device console (`logLine`), the
  HELLO/version gate and its soft-on-absence/hard-on-mismatch reasoning,
  `waitForMessage`, the Deploy button handler, and both error-attribution
  functions' *logic* (not their highlighting mechanism, see item 5 above)
  are supposed to survive verbatim. If any of them turn out to be
  entangled with the canvas section in a way that forces a change, stop
  and flag rather than working around it — that's new information against
  a claim the decision doc treated as settled.

## Real costs and traps to respect

- **`npm install`/`npm run dev`/`npm test`/`vite build` all go to Mike, in
  a real Terminal — not just installs.** Confirmed hard this session, not
  just the documented `node_modules` corruption risk: `editor/node_modules`
  was installed on Mike's Mac and ships Mac-only native bindings
  (`@rolldown/binding-darwin-x64`); the Linux sandbox has neither that nor
  a matching `linux-x64-gnu` build, so `npm test`/`vite build`/`npm run
  dev` **cannot run from the sandbox at all, structurally**, regardless of
  care taken. `./node_modules/.bin/tsc --noEmit` *does* work from the
  sandbox (pure JS, no native deps) and is the one live check available —
  use it, but it's necessary, not sufficient; Mike still has to confirm
  `vite build`/`npm test`/`npm run dev` clean before anything gets
  committed.
- **Even read-only git commands can leave `.git/index.lock` behind on this
  mount.** Learned the hard way at the end of the Phase 0-2 session: a
  `git status`/`git diff` from the sandbox left a lock file the sandbox
  couldn't delete, blocking Mike's own `git add`/`git commit` until he ran
  `rm -f .git/index.lock` himself. Keep sandbox git reads minimal, and if
  Mike reports a blocked `git add`/`git commit`, that's almost certainly
  the same bug — the fix is always `rm -f .git/index.lock` (or
  `.git/HEAD.lock`) in a real Terminal, never attempted from the sandbox.
- **Git writes go to Mike as exact commands, always.** Same as every prior
  phase — `git add`/`git commit` never run from the sandbox. Prefer
  `git -C /Users/mike/Src/Thingstudio ...` forms (no `cd` chaining) —
  a `cd editor && ... && cd .. && ...` block failed silently for Mike this
  session because the shell he pasted it into didn't preserve `cd` state
  the way a single script would.
- **`vite build` still doesn't type-check** (esbuild strips types). Not
  that it matters this session since Mike has to run it anyway, but don't
  treat a clean build as proof of anything `tsc --noEmit` didn't already
  confirm.
- **Prompt Mike to commit at natural boundaries**, not just at the end —
  after the `main.ts`/`index.html` swap lands and the app still loads
  (before wiring flow-file/highlighting/property-panel), and again after
  each of items 11-13, same granularity Phase 0-1 used (after Phase 0,
  after Phase 1).

## Not in scope for this chat

Unchanged from Phase 0-1, still load-bearing:

- **The wire type system.** Sockets stay `any`-equivalent
  (`sockets.ts`'s single `AnySocket`, sub-decision 3). Nothing in Phase 3
  should touch this even though a property panel makes per-type payload
  editing more visible — §6's real socket types are still their own task,
  after this migration.
- **Drag-to-splice.** Still Mike's real-browser
  `nodedragged`-vs-`nodetranslated` call (sub-decision 4), still
  unresolved, still not this session's problem.
- **`rete-engine` / canvas-side live value propagation.** Still out of
  scope — live values are device-driven §13 `VALUE_STREAM` work, not a
  canvas execution engine. Don't resurrect poc-rete's `propagate()`/
  `lastValue`/`lastLabel` status-line machinery for this; node highlighting
  (item 12 above) is a different, much smaller need and doesn't require it.
- **The backend, and anything auth-related.** Still Decision 2's disjoint
  half of `main.ts`.
- **Any new node type**, and Tier 1 reprioritization.
- **Deleting the Litegraph path.** Still Phase 4 step 17, after the
  hardware pass — `app/nodes.ts` (Litegraph), `public/vendor/litegraph/`,
  and their `third-party-licenses.md` entries all stay untouched this
  session even once `main.ts` stops loading them.

## Success criteria

Phase 2 item 10 and Phase 3 (items 11-13) complete: `currentSource()`
uses the adapter, the poll is gone and replaced by a pipe-driven refresh;
`extractCanvasSnapshot()`/`applyFlowFile()` work against Rete with the
skip-and-report contract intact; highlighting works via reactive state;
the property panel replaces the code modal.

Verification bar: `./node_modules/.bin/tsc --noEmit` clean (sandbox can
confirm this one). Mike confirms, on his machine: a real `vite build`
clean, `npm test` green with **all** existing suites untouched
(`flow-file.test.ts` especially), `npm run dev` actually loads the new
canvas and it's usable (add a node, wire it, see the compiled-source
preview update), and save→reload round-trips a flow file correctly.

**What this session cannot establish, and shouldn't claim**: whether the
new canvas feels right, and whether it survives a real deploy. Both are
still Mike's, on his own machine — Phase 4 step 16 (hardware round-trip)
is still the only step in the whole plan whose failure would mean the
decision was wrong.

## Conventions to keep following (unchanged, see `CLAUDE.md`)

Flag any new npm package before installing, individually — none should be
needed this session. Git writes get handed to Mike as exact commands for a
real Terminal, never run from the sandbox (see the `.git/index.lock` note
above). Update `docs/third-party-licenses.md` in the same change as any
dependency decision — not expected to change this session, but check.
Prompt Mike to commit at the boundaries listed above. Fault handling over
happy path: the skip-and-report contract (item 4 above) and the untrusted-
device-ID guard in `highlightNodeFromNodeError()` (item 5 above) are both
load-bearing and must survive this rewrite intact — that's the actual bar
this session is judged against, more than canvas polish.
