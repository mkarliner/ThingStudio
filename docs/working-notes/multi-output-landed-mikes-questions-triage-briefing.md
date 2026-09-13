# Briefing: multi-output-port support + favicon landed and committed — starts with a triage of Mike's questions

For the next chat. Read `CLAUDE.md` in full, as always, plus `docs/working-notes/mikes-questions-and-points.md`
(shorter now — five items pruned or annotated below).

**Everything from this session is committed** — tip is `3dad1af` ("NEW: Test of multiple outputs"), working tree
clean (`git status --short` empty as of this writing). Three commits: `52fab78` (multi-output-port support),
`c4c5a53` (favicon), `3dad1af` (the function-output-switch test flow, committed by Mike under his own message).

**Unconfirmed: whether Mike actually ran `tsc --noEmit`/`vitest run` before committing.** This session's own
sandbox couldn't run either — `npm ci` in the sandbox's own isolated workspace hit a genuine egress-policy `403`
on `registry.npmjs.org` (not a Mac-native-binding issue this time; see `learnings/editor-build-tooling.md`'s
newest entry) — so the multi-output-port implementation was verified by manual diff review against the exact
`compile.ts`/`nodes.ts`/etc. logic plus hand-simulated Python for the routing/loose-tolerance behavior, not by
the actual test runner. Commands were handed to Mike to run himself in his own Terminal (`node_modules` already
exists on his Mac). **First thing next session: ask whether they came back clean**, before trusting any of it
beyond what a careful read already confirms.

## Triage of Mike's questions and points

Went through `mikes-questions-and-points.md` top to bottom. Two items are resolved and removed below (pruning
them from that file, per its own stated convention); most of the rest already carry an accurate annotation from
prior sessions and are just double-checked, not re-litigated. A few turned out to be genuinely unresolved or
never actually triaged into `outstanding-items.md` despite looking like they were — those are flagged as this
session's real finding.

**Resolved this session, pruned from the file:**
- *"Favicon for editor"* (Bugs) and *"favicon"* (UI, listed a second time) — both the same ask, built and
  committed 2026-09-12 (`c4c5a53`): `editor/public/favicon.svg`/`.ico`/`apple-touch-icon.png`, wired into
  `index.html`. Removed both lines.

**Genuinely still open — this session's real finding, not just a re-confirmation:**

1. **"Clicking on the inject node action opens the property sheet. It should only open on a real select."**
   (Bugs) — **confirmed still broken**, checked against the actual code: `editor-setup.ts`'s `nodepicked` pipe
   fires on *any* pointer-down over a node and unconditionally sets `selectedNode.value = node`; `main.ts`'s
   `onInjectNodeClicked` (the click-to-fire handler) runs alongside it with no suppression. So a click-to-fire on
   a live inject node always also opens/refreshes the property panel — exactly Mike's complaint, never fixed
   despite the unrelated 2026-09-02/09-06 inject click-fire work landing and being marked resolved elsewhere.
   Small, well-scoped fix (distinguish "this pointer-down was a fire-click on an already-connected inject" from
   "this is a real selection") — no `outstanding-items/` file exists for it yet; worth creating one, or just
   picking it off directly, next session.

2. **Two UI wishlist bullets that were never actually triaged, despite looking like they were.**
   `mikes-questions-and-points.md`'s "# UI" section lists five bullets; its own annotation only accounts for
   three of them (*resizable panes*, *delete node/wire*, *notes/README sheet* — all correctly pointed at
   `outstanding-items/ui-wishlist-untriaged.md` and `delete-node-wire.md`). **"Arrange to menu to better reflect
   workflow (connect/open/save...)" and "Allow multiple panes (still one flow)" appear in neither
   `ui-wishlist-untriaged.md` nor anywhere else in `outstanding-items/`** — confirmed by grep, not just
   inference. They've been sitting un-annotated and untracked since whenever that section was last written.
   Needs a decision, not a build: are these still wanted, and at what priority? If yes, they need their own
   `outstanding-items.md` line (or folding into `ui-wishlist-untriaged.md`) before either is scoped.

3. **"Node input and output - define a consistent policy for msg/payload ext and include in claude.md"** —
   **partially covered, one easy piece missing.** The actual convention already exists and is documented, just
   not where Mike asked for it: `docs/user-guide/custom-nodes.md` (lines ~97, ~166-170) spells out
   `msg = {'payload': ..., 'topic': ..., <anything else>}`, `payload` is the one key that's wired/type-checked,
   everything else rides along unchecked. `CLAUDE.md` itself has zero mentions of `payload`/`msg` — the specific
   ask ("include in claude.md") is still outstanding. Trivial: restate the existing convention as a short
   standing rule in `CLAUDE.md`, point at `custom-nodes.md` for the full explanation. Good five-minute pick to
   open the next session with, or fold into whatever else gets picked.

4. **"write explaination of node flow operation to include in user docs"** — **partially covered.**
   `docs/user-guide/canvas-basics.md`'s "Wiring" section covers connection mechanics (port types, fan-in/fan-out,
   refused connections) but not the underlying execution model itself: each source node (`inject`, `timer`,
   `wifi_status`, etc.) drives its own independent async loop, there's no shared "tick," and — freshly relevant
   after this session — multi-output fan-out iterates outputs in order with each output's own messages processed
   before the next output's. Worth a short new subsection now that multi-output makes execution order an actual
   user-facing question, not just an implementation detail.

5. **"deploy runtome from editor"** [sic] — **untracked anywhere**, confirmed by grep across
   `outstanding-items.md` and every `outstanding-items/*.md`. Today, `test-flows/deploy_runtime.py` is a
   standalone one-time bootstrap script Mike runs by hand (`mpremote cp`-based, per `test-flows/README.md`) —
   there's no path to push the runtime itself from the browser UI at all, only compiled flows via the Deploy
   button. If this is still wanted, it needs its own `outstanding-items/` file; currently it's a bullet with
   nowhere else it's written down.

**Everything else in the file** (platforms, board/processor reference docs, security/board-transport-auth,
node prioritization, store-flows-on-micro, machine-specific node collections, port mapping, documentation
tooling, custom-node persistence) still carries an accurate annotation from a prior session — spot-checked
several, nothing else found stale.

## What landed this session

1. **Multi-output-port support** (`52fab78`) — general compiler mechanism (`NodeDefinition.outputCount()`,
   `compile.ts`'s per-output-slot routing with loose tolerance) plus a real multi-output UI on the `function`
   node (dynamic ports, grows taller per output rather than packing tighter). Three of Mike's own design calls
   from the prior session: loose tolerance on a malformed return shape, live-value streaming deferred, "grow the
   pill." Found and fixed two latent bugs the resizable ports exposed (`ThingstudioNode.vue`'s port-list
   reactivity, `main.ts`'s flow-load port reconstruction). 8 new compiler tests
   (`node-function.test.ts`), docs updated throughout (`function.md`, `decisions/editor-canvas.md`,
   `outstanding-items.md` + its `connection-state-gate-router-nodes.md` detail file,
   `learnings/editor-build-tooling.md`). Full story: this file's own git history, or ask me to recap —
   the detail lives in `decisions/editor-canvas.md`'s 2026-09-12 entry.
2. **`test-flows/function-output-switch.flow.json`** (`3dad1af`) — inject (integer payload) → 3-output function
   node doing an index-based switch → three debug nodes, one per output. Logic hand-verified against 0/1/2/3/-1/
   non-int/float inputs; JSON shape checked field-by-field against `parseFlowFile`'s real validation. **Not yet
   run through the actual browser "Open Flow" loader or on real hardware** — pure software flow, no board
   needed, should be a quick real-verification pick early next session if multi-output-port itself needs a
   confidence check beyond the unit tests.
3. **Favicon** (`c4c5a53`) — see triage above.
4. **New standing fact, not a feature**: the cloud sandbox's own isolated `npm ci` can be blocked by session
   egress policy even for `registry.npmjs.org` (distinct from the older Mac-native-binding corruption issue) —
   logged in `learnings/editor-build-tooling.md`. If a future session hits the same wall, don't retry it; go
   straight to handing Mike the verification commands, same as this session did.

## Open threads carried forward, not fully closed this session

- **Confirm `tsc`/`vitest` actually came back clean on Mike's machine** — see the warning at the top. Highest
  priority open item.
- **The function-output-switch test flow hasn't been opened in the real browser or run on hardware** — see #2
  above. Cheap to do, would be the first real (not hand-simulated) confidence check on the whole feature.
- **A dedicated router/switch node still isn't built** — the multi-output-port item's original narrower ask.
  The general mechanism now makes it a small addition (a `NodeDefinition` with a fixed `outputCount()`, ordinary
  `codegenTransform` routing, no compiler changes) but it's still unscoped as its own node type + UI (condition
  editor, output labels). See `outstanding-items/connection-state-gate-router-nodes.md`'s "Not scoped (still
  open)" section.
- **Everything under "Genuinely still open" in the triage above** — none of those five items were touched this
  session beyond identifying their real status.
- Everything else in `outstanding-items.md` untouched this session, all still open.

## Suggested next-session candidates

Rough priority order, mixing this session's own findings in with `outstanding-items.md`'s existing P-tags:

1. **Confirm `tsc`/`vitest` results, then real-verify the multi-output feature** (open flow in browser, click
   inject with a couple different payload values, confirm the right debug node lights up). Not a "build"
   candidate, but should happen before anything else gets layered on top of `compile.ts`'s new routing path.
2. **The inject-click-opens-property-sheet bug** (triage #1 above) — small, well-scoped, real annoyance Mike
   flagged explicitly; good session-opener once verification above is done.
3. **`CLAUDE.md` msg/payload convention** (triage #3) — five minutes, closes out an explicit Mike ask cleanly.
4. **Dedicated router/switch node** (P2, `outstanding-items/connection-state-gate-router-nodes.md`) — natural
   continuation of this session's work, mechanism already exists.
5. **TCP send / TCP listen-receive** (P3, `outstanding-items/tcp-send-listen-receive.md`) — real Tier-1 gap,
   bigger scope (lazy-expiry connection cache, callback-to-coroutine bridge). Worth splitting scoping from build.
6. **Context model, Node-RED-style** (P2 but unscoped, `outstanding-items/context-model-node-red-style.md`) —
   needs a scoping conversation with Mike first, not straight implementation.

Needs a decision from Mike before it's buildable at all: the two orphaned UI wishlist items (triage #2) — ask
whether they're still wanted and at what priority.

Other open P2/P3 items not picked for this shortlist but still live (unchanged from the prior briefing):
credential-free git-committable flows (P2, unscoped), filter/event-compression node (P3, deferred until
eswitch/ebutton land), I2C/SPI sensor nodes (P3, gated on hardware in hand), pin/resource-conflict detection
(P5).

## Not in scope for this chat

- RP2350 wiring/bring-up continuation — parked on Mike's own timeline.
- I2C/SPI sensor nodes — gated on hardware in hand.
- MQTTS/TLS — deferred, Mike's explicit call.
- Backend/auth, most remaining UI/editor items, docs/process items — separately tracked, not flagged as next.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself, never executed from the sandbox. Read-only git commands (`status`/`log`/`diff`) are fine to run
directly — but even those can leave a stale `.git/index.lock` behind (confirmed twice now, `CLAUDE.md`'s "Git
writes from the agent sandbox" section) — always tell Mike to `rm -f .git/index.lock` before any commit attempt,
regardless of what ran before it. Working tree is clean as of this writing; nothing to commit at session start.
