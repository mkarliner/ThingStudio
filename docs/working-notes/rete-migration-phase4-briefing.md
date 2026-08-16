# Briefing: Rete migration, Phase 4 step 17 + Phase 5 (cleanup and docs)

For the next chat. Read `CLAUDE.md` in full, as always. Then read
`docs/working-notes/rete-migration-decision.md` **in full — still the spec
for this session**, same status it's had every session so far: step 17
and Phase 5's task list (items 18-20 below), and "Explicitly out of scope"
still bind.

You do not need to read `rete-migration-phase3-briefing.md` in full to do
this session's work, but it's useful background: it's the session that
did the actual canvas cutover (Phase 2 item 10, Phase 3 items 11-13).
Everything in that briefing about `main.ts`/`index.html`/`editor/src/app/
rete/` is now done and confirmed — see "Status as of this session starts"
below.

## What kind of session this is

Cleanup and documentation, not implementation. Phase 4 step 16 (the
hardware round-trip) is done and confirmed by Mike, hands-on, this
session's own prerequisite per the decision doc's framing ("the only step
in this plan whose failure would mean the decision was wrong"). What's
left is step 17 (delete the now-dead Litegraph path) and Phase 5 (update
the docs that still describe Litegraph as the live canvas library). This
is genuinely more mechanical than Phase 3 was — the decision doc already
specifies exactly what to delete and exactly which doc sections to update,
and this session's own research (below) has already located the precise
text in each. Sonnet is fine for this. The one thing that would be a real
reassessment trigger: a grep for `litegraph`/`LiteGraph`/`LGraph` turning
up a reference this briefing's own research didn't find and doesn't have
an answer for — stop and flag rather than guessing what to do with it.

## Status as of this session starts

Confirmed by Mike, hands-on, on real hardware, this same day (2026-08-16):

- `vite build`, `npm test` (all suites, `flow-file.test.ts` included,
  untouched), and `npm run dev` all clean.
- Canvas parity: add a node, wire it, palette drag-and-drop, property
  panel editing all work.
- Save → reload → deploy round-trip confirmed.
- Hardware round-trip: `inject → gpio_out` and the fan-out case
  (`inject` to both `gpio_out` and `debug`), matching the 2026-08-14
  Litegraph-era result.
- Node highlighting confirmed twice on real `NODE_ERROR` traffic (a
  `function` node referencing an undefined name — syntactically valid
  Python, so this is the runtime/`NODE_ERROR` path, not the mpy-cross
  compile-error path specifically, though the mechanism is shared) —
  both from a fresh Deploy and from Connect alone against an
  already-running flow. Reactive-state highlighting (item 12) is
  confirmed working independent of Deploy's own success/failure.
- One red herring chased and resolved during this testing, worth knowing
  about but not carrying forward as an open question: an earlier test run
  against a stale browser tab (page loaded before `npm run dev` had been
  restarted) produced a `[deploy timeout]` with no `DEPLOY_ACK` ever
  received. Reading `device-runtime/src/listener.py`/`runtime.py` during
  that investigation confirmed `_handle_deploy` sends `DEPLOY_ACK`
  essentially immediately after `import _flow` succeeds (`runtime.spawn()`
  just schedules an `asyncio.create_task`, non-blocking) — so structurally
  a real device-runtime bug would be surprising. A clean retest against a
  live dev server produced a normal `DEPLOY_ACK` immediately, confirming
  it was a stale-connection artifact of the earlier test, not a protocol
  bug. Nothing to fix; recorded here so it isn't re-investigated from
  scratch.

`tsc --noEmit` was already confirmed clean from the sandbox at the end of
the Phase 3 session, and nothing in this session's own scope touches
`.ts` source under `editor/src/app/`, so that bar should still hold —
worth re-running as this session's own verification step (item 3 below)
rather than assumed stale.

**One operational note carried forward, not new:** the Phase 3 session's
own sandbox `git status` call left a `.git/index.lock` behind (same known
bug as the Phase 0-2 session hit — see `CLAUDE.md`'s "Git writes from the
agent sandbox" section). Mike clears this with `rm -f .git/index.lock` in
a real Terminal before anything else touches git. If the Phase 3 commit
hasn't landed yet when this session starts, confirm it has (or hand Mike
the commit command again) before starting step 17's deletions — deleting
files on top of an uncommitted Phase 3 diff makes that diff harder to
review cleanly.

## What to actually do

The decision doc's step 17 and Phase 5 (items 18-20) are the task list.
This session's own research already found the exact text each item
touches — quoted below so this session doesn't need to re-derive it.

### Step 17: delete the Litegraph path

- **Delete** `editor/src/app/nodes.ts` (the Litegraph node classes —
  confirmed untouched and unreferenced since Phase 3: `main.ts` stopped
  importing `registerCanvasNodeTypes` that session, and nothing else in
  `editor/src/` references it).
- **Delete** `editor/public/vendor/litegraph/` (`litegraph.min.js`,
  `litegraph.css`, `LITEGRAPH-LICENSE` — confirmed this session, 500K
  total, three files).
- **Before deleting, grep to confirm nothing new snuck in** since this
  briefing was written: `litegraph|LiteGraph|LGraph` across `editor/src`
  and `editor/index.html`. This session's own research found matches only
  in the two files being deleted, plus stale build artifacts (next bullet)
  and files this session isn't touching (`flow-file.ts`, `graph.ts`,
  `main.ts` — all mention Litegraph only in prose comments explaining
  *why* something is shaped the way it is post-migration, e.g. `graph.ts`'s
  header note that its `{nodes, links}` shape "was modeled on
  `LGraph.serialize()`" — historical explanation, not a live reference,
  leave these alone).
- **Not this session's problem, but noticed doing the grep above and worth
  flagging to Mike once, not silently working around it every session:**
  `editor/src/app/main.js`, `nodes.js`, `flow-file/flow-file.js`,
  `compiler/graph.js`, and `.js` siblings of several files under
  `editor/test/` are stray compiled-output artifacts from some past `tsc`
  invocation that didn't respect `--noEmit` (the sandbox's own
  `./node_modules/.bin/tsc --noEmit` direct-binary-call convention exists
  partly because of this). `editor/.gitignore` already covers
  `editor/src/**/*.js`/`editor/test/**/*.js` with a comment explaining
  exactly this ("Never intentional, never committed") — so they're
  harmless and untracked, not this session's job to clean up, but they do
  contain a stale pre-migration `nodes.js` referencing `LiteGraph` that a
  naive grep without the `.ts`-only filter above would flag as a false
  positive. Don't delete them (out of scope, `.gitignore` already handles
  it) — just don't be confused by them.
- **Do not touch** `pocs/poc-c/`, `pocs/poc-d/` (frozen, historical,
  vendor their own Litegraph copies per `repo-structure-and-conventions.md`
  — "kept as-is, frozen, historical reference").

### Item 18: design doc §11 — supersede the POC-C resolution

`docs/thingstudio-design-doc.md` §11 ("Open questions") resolves the
canvas-library question inline, mid-paragraph, in this repo's established
strikethrough-plus-replacement style (not a separate changelog). The exact
clause (already struck through once, from the original "should the canvas
be bespoke or a library" open question, then resolved 2026-08-11 per
POC-C):

> ~~whether the node-editor canvas should be built on an existing library
> (Litegraph.js and Drawflow are the leading lightweight options...) or
> built bespoke~~ **resolved 2026-08-11 per POC-C (§15.3): Litegraph.js.**
> It needed no custom infrastructure for type-checked wiring, live value
> propagation, or multi-select — all three are native, and its object
> model (`LGraphNode` subclasses with `onExecute`/`onDrawForeground`/
> widgets) maps directly onto this doc's node/wire/live-value/typed-payload
> design. Drawflow needed all three hand-rolled and can't reach
> multi-select at all without building real editor infrastructure from
> scratch; its smaller bundle and plain-DOM node bodies didn't offset that
> gap. Full comparison in `pocs/poc-c/README.md`;

This whole clause now needs the same strikethrough treatment applied to
*itself*, with a new resolution appended citing the Rete migration
(`rete-migration-decision.md`'s Decision 1, and `pocs/poc-rete/README.md`
for the spike evidence) rather than silently rewriting the POC-C text
away — same reasoning the decision doc itself gave for why this matters
("the reasoning for the reversal should survive"). Say plainly that this
reverses a decision that was itself evidence-based and correct given what
it knew (POC-C's comparison method and Drawflow findings still stand,
per `rete-migration-decision.md`'s own opening line) — the reversal is
about a maintenance/ecosystem finding (Litegraph vendored/unmaintained vs.
Rete's real npm package with plugin activity) that POC-C wasn't scoped to
weigh, not a correction of POC-C's own work.

### Item 19: design doc §12 and §14 — dependency table and vendoring line

§12's dependency table (licensing/open-source suitability) currently has:

> `| Litegraph.js | browser canvas/node-editor library | MIT | chosen over Drawflow per §11/§15.3; Drawflow evaluated and dropped |`

Replace with a row (or rows) for the real Rete package set now living in
`editor/`'s `package.json` — `rete`, `rete-area-plugin`,
`rete-connection-plugin`, `rete-render-utils`, `rete-vue-plugin`, `vue`
(all MIT) — `docs/third-party-licenses.md`'s own "Vendored in `editor/`"
and promoted-dependencies tables already carry the per-package notes if
this session wants to pull descriptions from an already-written source
rather than redrafting them.

§14's vendoring line currently reads:

> "Vendored third-party code (Litegraph.js — see §11/§15.3 — MicroPython
> itself if forked rather than tracked as a submodule) keeps its own
> upstream license file per §12's audit..."

The Litegraph.js parenthetical no longer describes reality once step 17
lands — these are real npm dependencies with a committed lockfile, not
vendored static files. Drop the Litegraph.js mention (the MicroPython
forked-submodule case is hypothetical/unrelated and can stay).

### Item 20: `mvp-feature-priorities.md` — close compact-node-appearance

Tier 3's "Real editor shell" entry has a dated bullet (2026-08-14, "cosmetic
question raised, not built") describing the compact Node-RED-style node
appearance gap — inline `addWidget` config vs. a real properties panel —
and concluding "Deferred — cosmetic, not blocking the hardware-proof work
above." `rete-migration-decision.md`'s own Phase 3 item 13 description
already states this explicitly: "This closes `mvp-feature-priorities.md`'s
deferred 'compact node appearance' item as a side effect... the one
deferred item this migration legitimately absorbs." Add a new dated bullet
(this session's date) closing it, same append-only historical-log style
the rest of that file uses — don't edit the 2026-08-14 bullet's text away,
add a new one citing the Rete migration's `ThingstudioNode.vue`'s compact
pill layout and `PropertyPanel.vue` as what actually closed it.

**Leave drag-to-splice alone.** It has its own dated entries in the same
file (an "Addendum, 2026-08-15" reclassifying it axis-2 → axis-1, partly
reasoned from Rete's own "Insert node" example) and is explicitly still
open — `rete-migration-decision.md`'s "Explicitly out of scope" list and
sub-decision 4 both confirm it's unresolved, pending Mike's own
hands-on `nodedragged`-vs-`nodetranslated` call. Don't touch it, don't
imply Phase 3 addressed it — `editor/src/app/rete/insert-node.ts` was
never even ported from `poc-rete`.

## Stop conditions

Same shape as every prior session's:

- **Anything outside the files/sections named above needs to change to
  make this work.** The blast radius here should be exactly: two
  deletions (`nodes.ts`, `public/vendor/litegraph/`), three doc files
  (`thingstudio-design-doc.md` §11/§12/§14, `third-party-licenses.md`,
  `mvp-feature-priorities.md`). If deleting Litegraph turns out to break
  something still depending on it beyond what this briefing's grep found,
  that's new information against a claim this note treated as settled —
  stop and flag.
- **Any of the ~20 existing test suites needs modifying.** None of them
  should reference Litegraph at all (confirmed: `flow-file.test.ts` and
  `graph-adapter.test.ts` are both canvas-independent/headless, per their
  own file headers) — if one does, that's worth understanding before
  deleting anything, not after.
- **A new npm package looks necessary.** Nothing about this session should
  need one — it's pure deletion plus doc edits.

## Real costs and traps to respect

- **Git writes go to Mike as exact commands, always** — same as every
  prior phase. `git -C /Users/mike/Src/Thingstudio ...` forms, no `cd`
  chaining (a `cd editor && ...` block previously failed silently for
  Mike because the shell he pasted it into didn't preserve `cd` state the
  way a single script would).
- **Even read-only git commands can leave `.git/index.lock` behind on this
  mount** — confirmed again this same day (see "Status as of this session
  starts" above). Keep sandbox git reads minimal; if one is needed, expect
  to possibly hand Mike a `rm -f .git/index.lock` afterward rather than
  being surprised by it.
- **`npm test`/`vite build`/`npm run dev` still can't run from the
  sandbox** — Mac-only native bindings (`@rolldown/binding-darwin-x64`),
  confirmed structural in the Phase 3 session. `./node_modules/.bin/tsc
  --noEmit` does work and is worth running as this session's own
  verification step, but a deletion-only session has very little for it
  to catch — the real verification is Mike confirming `vite build`/
  `npm test`/`npm run dev` are still clean after the deletions, same bar
  as always.
- **Prompt Mike to commit at the natural boundary** — after step 17's
  deletions land (and `tsc --noEmit`/his own build-and-run pass confirm
  nothing broke), and again after the three doc files are updated. Two
  commits reads more natural here than one, since a deletion and a
  documentation pass are different units of work and either could be worth
  reverting independently.

## Not in scope for this chat

Unchanged from every prior session, still load-bearing:

- **The wire type system** (§6, sub-decision 3) — still its own task,
  scoped to start "immediately after" this migration per the decision
  doc's own task list, but not bundled into cleanup.
- **Drag-to-splice** — see item 20 above.
- **The backend, and anything auth-related** — Decision 2, disjoint from
  this migration entirely.
- **Any new node type**, Tier 1 reprioritization.

## Success criteria

`editor/src/app/nodes.ts` and `editor/public/vendor/litegraph/` deleted.
Design doc §11 carries a new strikethrough-plus-resolution citing the Rete
migration; §12's dependency table lists the real Rete package set instead
of Litegraph.js; §14 no longer mentions Litegraph.js as vendored code.
`mvp-feature-priorities.md`'s compact-node-appearance bullet has a new
dated entry marking it closed via Phase 3; drag-to-splice's entries are
untouched.

Verification bar: `./node_modules/.bin/tsc --noEmit` clean (sandbox can
confirm this one, though a deletion-only change gives it little to catch).
Mike confirms, on his machine: `vite build`/`npm test`/`npm run dev` still
clean after the deletions — the real risk here isn't a subtle bug, it's
"did the grep in step 17 actually find every live reference."

This closes out the Rete migration's own scoped task list (Phases 0-5).
What's next after this session is Mike's call, not pre-scoped here — the
decision doc names §6's wire-type system as the thing that "immediately
after, as its own task" follows, but that's a separate working note when
it starts, not assumed to be the very next session.
