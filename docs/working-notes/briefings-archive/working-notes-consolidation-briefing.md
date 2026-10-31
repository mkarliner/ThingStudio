# Briefing: consolidate working-notes, gather outstanding items into one place

For the next chat. Read `CLAUDE.md` in full, as always.

**This session runs before, not instead of,
`redeploy-cleanup-and-network-fault-detection-briefing.md`** — Mike's own
sequencing: clean up and consolidate first, specifically to keep context
size down for the session that actually does that implementation work
(and every session after it). This briefing is about the working-notes
directory itself, not about any of the technical problems the other
briefing describes — don't start implementing anything from that doc
here.

## Why this is its own session

`docs/working-notes/` has grown to 33 files (list below) plus a 63KB
`validation/mvp-validation-plan.md`, accumulated one briefing per
session over this project's life. That's working as designed —
`repo-structure-and-conventions.md` calls this directory "active
planning," and the briefing-per-session pattern is deliberate, not
accidental sprawl. But a briefing whose own work has already landed
(config nodes, the interrupt node, the rete migration, RP2 bring-up,
etc.) has no ongoing reason to be read in full by a fresh session
picking up unrelated work — its value at that point is historical/
archival, not "context a new session needs loaded." Nothing here is
about the *content* of those files being wrong; it's about a fresh
session currently having to either read all 33 files or guess which
ones still matter, when the real, current "what's actually
outstanding" answer should fit in one place.

## The actual task

1. **Audit every file below** (and `validation/mvp-validation-plan.md`)
   and sort each into one of three buckets:
   - **Fully resolved** — an implementation briefing whose own "Success
     criteria" (or equivalent) are entirely met, confirmed via `git log`/
     the design doc's own dated addenda, nothing left open. Historical
     reference only.
   - **Partially resolved** — some real, still-open item(s) remain (an
     explicitly flagged follow-up, a "not in scope for this chat" item
     that's still genuinely pending, a stop condition that fired and was
     never revisited). The file's *history* stays where it is; its
     *open items* get pulled into the consolidated doc (next step) so a
     fresh session doesn't have to open the original file to know they
     exist.
   - **Active/not-yet-started** — a briefing written but not yet acted
     on at all (e.g. `redeploy-cleanup-and-network-fault-detection-
     briefing.md`, written this session, zero of it implemented yet).
     Stays fully live, gets a prominent pointer in the consolidated doc,
     don't try to compress it.
2. **Produce one consolidated document** — e.g.
   `docs/working-notes/outstanding-items.md` — listing every real open
   item found across the "partially resolved" and "active" buckets, each
   with a one-or-two-line summary and a pointer back to its source file
   for full detail (don't inline full reasoning for each — that defeats
   the point; this doc is a map, not a copy). Group by rough theme
   (network/config nodes, redeploy/runtime, UI/editor, hardware/rig,
   docs/process) rather than by source-file order, so it reads as a real
   backlog, not a file listing.
3. **Don't delete history.** This project's own convention (the design
   doc's `~~strikethrough~~` + dated addendum pattern, never silently
   rewriting) is the model — apply the same spirit here: a "fully
   resolved" briefing doesn't get deleted, it can move to
   `docs/working-notes/archive/` (new subdirectory) or just get a short
   dated note prepended ("Status: fully landed as of <date>, see
   `outstanding-items.md` — kept for historical reference, not active
   reading") so it's obviously safe to skip without needing to be
   physically removed. Recommend the prepended-note approach over a
   directory move unless the file count genuinely gets in the way — a
   move risks breaking the many cross-references between these files
   (they cite each other constantly), a prepended note doesn't.
4. **Known open items to make sure land in the consolidated doc** —
   don't treat this as the full list, it's a floor, not a ceiling:
   - `redeploy-cleanup-and-network-fault-detection-briefing.md` (this
     session's own immediately-prior sibling) — entirely unstarted.
     Three sub-items: the redeploy socket-leak fix, loud/attributable
     network-error messages, the WiFi config `security` field.
   - `mikes-questions-and-points.md`'s "Bugs -- priority" section
     (2026-08-19 entry): live console output showing raw numeric node
     IDs with no way to map them back to a canvas node. Real, logged,
     unstarted.
   - `config-node-and-palette-implementation-briefing.md`'s own flagged
     follow-up: `http_request`/`mqtt_publish`/`mqtt_subscribe` never got
     the config-node treatment — still registry-only for credentials.
   - Whatever `mvp-feature-priorities.md` and `thingstudio-design-doc.md`
     §10/§11 already track as open (v2 candidates, open questions) —
     don't re-derive these from scratch, pull them into the consolidated
     doc's "known, already-tracked, not forgotten" section so
     `outstanding-items.md` is genuinely complete rather than duplicating
     a subset.
   - Anything else turned up by the audit in step 1 — this list is a
     starting point for what's already known from this session's own
     context, not a substitute for actually reading each file.

## Current inventory (so this session doesn't need to `ls` first)

```
docs/working-notes/
  architecture-review-briefing.md
  backend-editor-auth-and-protocol.md
  backend-platform-decision.md
  config-node-and-palette-implementation-briefing.md
  config-node-system-scoping.md
  deployment-and-distribution-notes.md
  editor-hands-on-briefing.md
  editor-look-and-feel-briefing.md
  fault-isolation-briefing.md
  mikes-questions-and-points.md
  mvp-feature-priorities.md               (48KB -- large, likely already a consolidation of sorts, audit it as such)
  mvp-planning-briefing.md
  node-definition-model.md
  node-red-reference-screen-shot.png      (not a doc, skip)
  redeploy-cleanup-and-network-fault-detection-briefing.md   (written this session, unstarted)
  repo-structure-and-conventions.md
  rete-migration-decision.md
  rete-migration-implementation-briefing.md
  rete-migration-phase3-briefing.md
  rete-migration-phase4-briefing.md
  rete-migration-planning-briefing.md
  rete-spike-briefing.md
  rp2-bringup-interrupt-briefing.md
  rp2040-bringup-findings.md
  rp2350-bringup-briefing.md
  tier1-interrupt-node-implementation-briefing.md
  tier1-node-candidates-prioritization-briefing.md
  tier1-node-set-briefing.md
  tier1-sensors-network-briefing.md
  transport-auth-design.md
  udp-tcp-nodes-implementation-briefing.md
  wire-protocol-briefing.md
  wire-type-system-implementation-briefing.md
  wire-type-system-scoping.md
  validation/
    mvp-validation-plan.md                (63KB -- likely has its own internal "pending" vs "Results" structure already; audit rather than assume unstructured)
```

Sizes weren't gathered for everything above except the two flagged as
large — worth checking actual sizes as part of the audit (a small file
that's still fully open is different from a small file that's fully
resolved; size alone isn't the signal, staleness/resolution status is).

## Recommended approach

Given 33+ files, this doesn't need to be one pass read serially — most
of the actual "is this resolved" judgment can be made from each file's
own final section (most already end in "Success criteria"/"Stop
conditions"/"Not in scope" or, for scoping-not-implementation notes, an
explicit resolution note) plus a quick cross-check against `git log`/the
design doc's addenda for whether that work actually landed, rather than
needing to re-read every file end to end. Where a file's own status is
genuinely ambiguous from a quick read, err toward "partially resolved"
(pull forward whatever's unclear as an open item) rather than guessing
it's fully closed — losing a real open item into an archived file
defeats the whole point of this exercise.

## Success criteria

- `docs/working-notes/outstanding-items.md` exists, is genuinely
  readable end to end in one sitting (that's the actual point — if it's
  nearly as long as reading everything it summarizes, this didn't work),
  and a fresh session could read *only* this file plus the design doc
  and have an accurate picture of what's open across the whole project.
- Every file in the inventory above has been looked at and classified;
  none silently skipped.
- No real open item lost — spot-check by confirming every item in this
  briefing's own "Known open items" list above actually appears in the
  finished `outstanding-items.md`.
- Fully-resolved files are marked as such (prepended note or archive
  move, per the judgment call above) but still exist and are still
  readable — nothing destroyed, only re-labeled.
- `redeploy-cleanup-and-network-fault-detection-briefing.md` itself is
  clearly flagged as the next actual implementation session's target,
  not accidentally filed as historical.

## Stop conditions

- A file's "resolved" status can't actually be confirmed (e.g. `git log`
  doesn't clearly show the work landing, or the file references a
  decision that was later reversed elsewhere without an addendum noting
  it) — flag it as an open item rather than guessing, and note the
  ambiguity itself in `outstanding-items.md` so a human can resolve it,
  rather than silently picking a bucket.
- The design doc (`thingstudio-design-doc.md`) itself turns out to be
  meaningfully out of sync with what's actually landed (beyond the
  already-tracked addenda) — that's a bigger problem than this session's
  scope; stop and flag it rather than trying to fix the design doc here
  too.

## Not in scope for this chat

- Any actual implementation work from `redeploy-cleanup-and-network-
  fault-detection-briefing.md` or any other open item found — this
  session catalogs and consolidates, it doesn't build.
- Rewriting or "improving" any individual working-note's own content
  beyond the resolved/open labeling described above — e.g. don't rewrite
  `mvp-feature-priorities.md`'s prose, just determine whether it belongs
  in the "already-tracked, pull forward" category and do so.
- Restructuring `thingstudio-design-doc.md` itself.

## Git

Same standing rule as every other session: git writes (`add`/`commit`)
go to Mike as exact commands to run himself in a real Terminal, not run
from the sandbox (`CLAUDE.md`, confirmed `.git/*.lock` corruption bug).
Read-only git commands are fine. This session in particular will
probably touch a lot of files (prepended status notes across many
working-notes files, or an `archive/` move) — worth prompting Mike to
commit once, at the end, rather than file-by-file, given the volume.
