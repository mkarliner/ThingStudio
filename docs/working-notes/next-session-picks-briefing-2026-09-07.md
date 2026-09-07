# Briefing: canvas-hide committed, full backlog priority triage done — start on a P1 next

For the next chat. Read `CLAUDE.md` in full, as always, plus `docs/working-notes/mikes-questions-and-points.md`
(a new, untriaged entry was added this session — see "New, untriaged" below, read it before assuming the backlog
below is the whole picture).

**Check `git log` and `git status` before assuming anything below is committed.** As of this writing the tip is
`28c2347` ("Hide variable_get/variable_set from canvas; adopt Node-RED context model as target design"), on top of
`2b2cece`/`6ebaa6f`/`b046af1`. That commit is real and confirmed in — Mike ran it himself between sessions. **But
`git status` is NOT clean**: this session's full backlog priority-triage pass touched five files
(`docs/working-notes/outstanding-items.md` plus three of its own `outstanding-items/*.md` detail files, plus
`mikes-questions-and-points.md` picked up the new WiFi entry independently) and **none of it is committed yet** —
confirm with `git status --short` before trusting the priority tags below are safely on disk. Also: a stale
`.git/index.lock` turned up mid-session (the known shared-mount issue, `CLAUDE.md`'s own warning) — if a git
command hangs or errors oddly, that's the first thing to check; ask Mike to `rm -f .git/index.lock` in a real
Terminal, don't retry from the sandbox.

## Where this came from

Two distinct pieces of work, same running session, not the usual "next item" loop:

1. **`variable_get`/`variable_set` hidden from the canvas** — given real canvas presence earlier the same day
   (`b046af1`), then walked through with Mike: the only clean no-code use case (decoupling a producer/consumer on
   independent triggers, sharing a value by name) was judged too narrow to justify keeping the pair visible without
   a real design behind it. Reverted the canvas wiring (`nodes.ts`'s `VariableGetNode`/`VariableSetNode` classes,
   `palette.ts`/`PaletteSidebar.vue`/`PropertyPanel.vue`/`verify-flow-file.ts`); left codegen/registry
   (`variable-get.ts`/`variable-set.ts`) and the function node's `flow.get`/`flow.set` (same underlying
   `_flow_vars` store) fully working and untouched. New target design: Node-RED's own context system
   (https://nodered.org/docs/user-guide/context) — `outstanding-items/context-model-node-red-style.md` carries the
   reference material forward. **Committed, `28c2347`.**
2. **Full backlog priority triage** — at Mike's request, every active item in `outstanding-items.md` walked one at
   a time, tagged inline with his own call: **[P1]**-**[P5]** (1 = highest), **[POST-MVP]**, **[TRACKING]** (a
   rollup pointer, not independently prioritized), moved to "Resolved" (three items got confirmed-working
   verdicts on the spot), rejected-and-logged (one item), or deleted/folded into a related item (several). 47 real
   items triaged; only the four "Next up" meta-pointers (a handoff-doc link, two already-fully-closed items) were
   deliberately skipped. **Not committed yet** — see the top of this file.

## What this session actually did, in more detail (context, not this session's job to redo)

**Priority tally** (see `outstanding-items.md` itself for the authoritative, per-item detail — this is just the
count): 4× **[P1]**, 5× **[P2]**, 8× **[P3]**, 4× **[P4]**, 8× **[P5]**, 13× **[POST-MVP]**, 1× **[TRACKING]**.

**Notable reframings, not just tags** — worth knowing before picking anything up, since the item text itself
changed, not just its priority:

- **Multi-output-port support** (was "connection-state gate/router nodes") — Mike generalized this past a
  narrow two-output status router into real Node-RED-style multi-output support (function-node UI for output
  count, `return`/`node.send()` array-of-arrays codegen, `null` = no message, nested array = multiple messages per
  output — https://nodered.org/docs/user-guide/writing-functions#multiple-outputs). Turns out this was already
  anticipated: `decisions/node-authoring.md`'s 2026-08-20 entry deliberately caps custom-node output ports at 1 via
  *codegen validation*, not the schema, specifically so this "higher-priority multi-output-routing roadmap item"
  wouldn't be compromised. **[P2]**, detail file (`connection-state-gate-router-nodes.md`) fully rewritten.
- **Context model, Node-RED-style, split in two**: the volatile (in-RAM) scope/API redesign is **[P2]**, buildable
  pre-MVP; a flash-backed persistent storage backend for the same context model is a separate, later
  **[POST-MVP]** item (the old "Tier 2 live value streaming + flow/state persistence" item, split three ways —
  see next bullet). Do the scope/API first, let persistence plug in as a storage backend choice later, same as
  Node-RED's own `memory`/`localfilesystem` split.
- **Old "Tier 2" item split three ways**: flow-bytecode-survives-power-loss is **already built** (boot-time flow
  auto-resume, 2026-09-05 — that part of the old item's "not started at all" framing was stale); full live-value
  streaming on wires isn't being pursued (Mike: never actually asked for it); the real near-term bar is
  **[P2]** per-node connection-status indicators (`node-status-indicators.md`); the flash-backed state-persistence
  half is **[POST-MVP]**, cross-linked to the context-model item above.
- **Documentation** — split into three separate activities rather than one lump task: (1) scoping — what needs
  documenting, for whom; (2) design — structure/format; (3) tech selection — what tool/generator, which subsumed
  and deleted the separate "documentation site" item. **[P1]**.
- **Backend/auth** — **[P1]**, and now also absorbs the cross-platform-requirement and package-distribution-story
  items (both folded in, not separate). Worth flagging: `backend-auth-overview.md`'s own text asks "whether this
  reprioritizes the backend ahead of the sequencing override" as an open question needing Mike's resequencing
  call — **this session's [P1] tag on backend, from Mike directly, is that call.** Also worth knowing before
  starting: this is design-complete, zero-code work (`backend-platform-decision.md`: Python/`aiohttp`/`pyserial`;
  `backend-editor-auth-and-protocol.md`: Host-header allowlisting posture 1, `bcrypt`+signed-cookie posture 2, one
  multiplexed WebSocket endpoint) — the design decisions exist, only the code doesn't. Treat as one coherent body
  of work, not three independent small tasks, per that file's own closing note.

**Three items confirmed done and moved to Resolved during the pass** (Mike verified on real hardware while
triaging): `wifi_status` emit-on-change, the single-wifi-owner fix (including re-confirming
`basic-mqtt.flow.json`), and `inject`'s click-only live-fire feature (the real click → TRIGGER → device round
trip). One design suspicion resolved outright: `inject` doing the job of two nodes — the 2026-09-02 click-fire
rewrite already split this structurally (inject fires only on click now; the old "fire once at boot" behavior was
pushed out to a separate, not-yet-built `startup` node — see `init-node-on-flow-start.md`, **[P3]**). One item
rejected with reasoning kept on record: the recovery-button/jumper idea — redundant with `HELLO_REQUEST`, a reset
node, and simply wiring a physical button to the processor's own hardware reset pin.

**A real technical question got answered along the way**: Mike's condition for deferring stateful-nodes/`join`
work was "as long as context set/get is interrupt-safe." Checked against `interrupt.ts`'s own architecture: the
hard-IRQ handler only ever signals a `ThreadSafeEvent` — every real decision, including any context get/set, runs
in the coroutine afterward on the normal cooperative scheduler. Interrupt-safe by construction today, not by luck
— worth a confirming real-hardware test whenever `join` is picked up, but not an open unknown.

## New, untriaged — pull this into the process next session

`mikes-questions-and-points.md` picked up a new entry this session, added independently (not by this session's own
work), never pulled into `outstanding-items.md` or given a priority tag:

> **Wifi management** — Investigate using Functor/Singletons for the WiFi config and any other global config
> objects: https://github.com/peterhinch/micropython-samples/blob/master/functor_singleton/README.md

Not investigated this session (out of scope for a triage pass — this needs its own read-the-linked-doc-and-assess
step first). Worth doing early next session: read the linked pattern, assess whether/how it applies to
Thingstudio's current WiFi-config handling (`wifi_status.ts`, the single-wifi-owner-fix work), write up a real
`outstanding-items/*.md` entry, then get Mike's own priority call on it same as everything else got this session.

## Suggested next-session candidates

Priority order, per Mike's own tags — both are **[P1]**, pick whichever fits the session's time budget:

1. **Documentation — scoping pass.** Lowest-risk starting point: no hardware, no architecture risk, fits in one
   sitting. Read `mikes-questions-and-points.md`'s original ask plus `custom-nodes.md` (the node-authoring half
   that's already covered) and produce a real scope: what needs documenting, for which audience(s) — before
   touching structure/format (the "design" sub-activity) or picking a generator (the "tech selection"
   sub-activity, which subsumed the old documentation-site question).
2. **Backend/auth — start the build.** Bigger, more consequential, design-complete already (see above) — probably
   deserves its own dedicated session rather than being squeezed in, but nothing is blocking a start: platform and
   auth-protocol decisions are both settled, only code is missing. `backend-auth-overview.md` + its three linked
   design docs (`backend-platform-decision.md`, `backend-editor-auth-and-protocol.md`, `local-persistence-
   scoping.md`) are the starting reading, in that order.
3. **The new WiFi functor/singleton question** (see above) — not a build task yet, a read-and-assess task. Cheap
   to fold into whichever of the above session happens, or do standalone first if time is short.

If a smaller, buildable-right-now item is wanted instead: **[P2]** multi-output-port support and **[P2]** delete
node/wire are both real code, no hardware, no design-doc dependency, similar shape to how `delay` and the
canvas-presence-gaps work got picked in past sessions.

## Success criteria (whichever item gets picked)

- Real code, real tests, real canvas wiring where applicable — not just a scoping doc, matching every prior
  session's bar (documentation's own "scoping" sub-activity is the one legitimate exception this time — a real
  scope document IS the deliverable for that specific pick).
- Off-device verified in an isolated extracted copy (`tsc --noEmit` clean, `vitest run` passing) before calling
  anything done — never against the live-mounted repo directly.
- `outstanding-items.md`, the item's own detail file, and (if it's a hardware-relevant node) `mvp-validation-
  plan.md`'s Tier 1 section all updated in the same session, dated, honest about what's still open. Preserve the
  priority tag the item already carries unless Mike explicitly changes it.
- Any real limitation documented in the code's own header comment, not just in the docs — this project's own
  established convention.

## Not in scope for this chat

- Every **[POST-MVP]**-tagged item (13 of them) — deliberately deferred, not this session's to start unprompted.
- RP2350 wiring/interrupt-flow pass, I2C/SPI sensor nodes — still gated on Mike's own hardware time, unaffected by
  this session's triage (RP2350 bring-up itself is **[P5]**, not zero-priority, but the wiring step is his own
  timeline, not a next-session pick).
- Anything already committed (canvas-hide, `28c2347`) — done, don't redo.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself in a real Terminal, never executed from the sandbox. Read-only git commands (`status`/`log`/`diff`) are
fine to run directly from the sandbox, but even those have occasionally left a stale `.git/index.lock` behind on
this shared mount (recurred again this session) — if a git command hangs or errors oddly, that's the first thing
to suspect; the fix is telling Mike to `rm -f .git/index.lock` in a real Terminal, not retrying from the sandbox.
The sandbox also cannot delete files it creates on the shared mount by default (`rm` -> "Operation not permitted")
— ask Mike to grant delete permission rather than leaving scratch files to accumulate silently, or just tell him
what's left over.
