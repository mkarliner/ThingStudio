# User guide editing plan

Status: plan, 2026-11-01. Executes `reviews/2026-11-01-user-guide.md` (including its second-pass section).
Mike accepted the second-pass points and asked for this plan, a regression-mitigation strategy, and a model
recommendation. Nothing here is decided until Mike says so; decisions land in `decisions/` as usual.

## Regression mitigation: a docs style lint with a shrinking baseline

The problem: style rules enforced only by review passes regress between passes (the `debugging.md` opening came
back after being removed on 2026-10-11). The project already enforces its other boundaries mechanically;
the checkable subset of the style guide gets the same treatment.

- **`tools/docs_lint.py`** -- Python stdlib only, so no new third-party dependency and the pinning ledger is
  untouched. Runs in seconds. Local: `python3 tools/docs_lint.py`.
- **Rules (start set; each maps to a cross-cutting finding, all near-zero false positives):**
  1. Page-describing opening: "this page" / "this section" in the opening paragraph (C1). Widened from the first
     sentence: the review's own examples (`boards.md`, `nodes/index.md`) say it in the second.
  2. UK spellings outside code spans and fenced blocks: colour, catalogue, recognis\*, grey\*, centre, behaviour
     (C2). Code stripping makes `neopixel`'s `'colour'` payload key a non-issue.
  3. Plans and internal references in `docs/user-guide/`: `working-notes` paths, "coming soon", "next to be
     written", "more are coming", "work in progress" (C4). `sensor-display.md`'s work-in-progress note (Mike's
     remark 5) is a deliberate baseline entry.
  4. The same `**term**` twice in one Properties section (C5.5).
  5. A sentence of eight-plus words repeated verbatim in one file, code stripped (C2's repeated WiFi sentence).
  6. Trailing whitespace; more than one consecutive blank line (several "source only" findings).
- **Baseline ratchet, not Mike.** A checked-in `docs/style-lint-baseline.json` lists every current violation as
  `file / rule / snippet`. The lint fails on (a) any violation not in the baseline -- a regression or a new
  instance -- and (b) any baseline entry that no longer violates -- forcing the baseline to shrink as fixes land
  and never grow silently. Adding an entry is a hand-edit visible in review; CI failing is the enforcement.
- **CI:** one `docs-lint` job in `.github/workflows/ci.yml` (setup-python, stdlib only, no pip installs), running
  on every push/PR like the editor job. Not `docs.yml`: that one only fires on main and deploys.
- **New rules land only with the fixes that make them pass** -- the project's "update in the same change"
  convention applied to the lint, so it is always green on main.
- **Deliberately not checked:** voice, chattiness, repetition of ideas, word counts. Judgment stays with editing
  sessions and future reviews.
- Approved by Mike, 2026-11-01: the AGENTS.md line and the ci.yml job land with the lint in phase 0.

## Phases

Each phase ends green: `python3 tools/docs_lint.py`, `mkdocs build --strict`, the internal-link check, and a
commit prompt. Findings are quoted from the review, not re-derived -- sessions act without re-reading it.

### Phase 0 -- open facts + the lint (one session, strong model)

- Resolve the open fact-checks against editor/runtime source and append the answers to the review: C5.3 (panel
  vs card label; cell grid vs row/column tree -- which the editor actually implements), the [Fact?] on `topic`
  being required, C5.6's install paths against the installer scripts, the full `report_status` node list for
  `working-in-the-editor.md` finding 4, the `http in` methods claim.
- Write `tools/docs_lint.py`, generate the baseline, add the ci.yml job, propose the AGENTS.md line.
- Gate: CI green with the baseline covering every current violation.

Phase 0 done, 2026-11-01. Fact-check answers are the last section of the review. `tools/docs_lint.py` and
`tools/test_docs_lint.py` are written; `docs/style-lint-baseline.json` holds 38 violations; the `docs-lint` job is in
`ci.yml`; the AGENTS.md line is in. Notes for the editing phases:

- Rule 6 reports as two ids, `trailing-whitespace` and `blank-lines`.
- Rules 4 and 5 start with one and zero baseline entries (`display-spi.md`'s `palette`; no verbatim repeated sentence
  exists today, the WiFi sentence on the network pages differs between Properties and Behavior).
- Phase 3's work-in-progress note on `sensor-display.md` trips rule 3: add its baseline entry by hand in that change.
- The lint skips HTML comments, so phase 4's commented-out modal section in `gui.md` stays clean.
- Phase 1's examples-folder wording and phase 2's `topic` fix use the review's phase 0 answers, not the earlier guesses.

### Phase 1 -- quick fixes (review order item 1)

Installation details (remark 1, Remove heading, `~/.thingstudio` reset note); getting-started pointer; Installing
MicroPython (dialog labels, the three "further down" lines, step 4 split); editor-tour and working-in-the-editor
openings; first-flow ("Next, pick:", the state paragraph, the example's location); custom-firmware contradiction
(C5.4) and repeated MemoryError sentence; debugging.md's "a Thingstudio image" and "Image file" labels. Delete
baseline entries as they are fixed.

### Phase 2 -- what the tester hits (review order item 2)

Gap 1 (MQTT-unreachable troubleshooting entry, linked from both MQTT node pages); C6 memory home in debugging.md
(points a-d from the review) with the FAQ trimmed to one-line answers linking it; Gap 3 (runtime-by-accident);
known finding 4 on `coming-from/node-red.md`; the Unmanaged-MQTT line on `wifi-provisioning.md`. This phase holds
the most judgment: apply second-pass point 2 (one attributing clause per refusal) while stripping the rest of C2.

### Phase 3 -- tutorials (review order item 3)

Rewrite `blink-from-your-network.md` with a Build the flow section (facts from the review's item 1, template from
`first-flow.md`); voice pass on `two-more-blinks.md`; tutorials index without plans; the work-in-progress note on
`sensor-display.md` (remark 5). Then Gap 2, the MQTT tutorial, as its own session.

**Tester-ready bar: phases 1-3.** Phases 4-7 are tractable with testers running.

### Phase 4 -- contradictions (review order item 4)

`node-conventions.md` vs `custom-nodes.md` (C5.1); `gui.md` -- merge `gui-layout.md` (remark 7), remove
`gui navigator` (remark 6), comment out the modal flow-file section for future inclusion (Mike, 2026-11-01), one
layout model from phase 0's facts; `display-spi.md`'s double palette entry.

### Phase 5 -- node pages to layout and voice (review order item 5)

C2/C3 passes in the review's batches: network pages, then general, then hardware. Each page's findings are its
checklist; the lint plus `mkdocs build --strict` are the mechanical gate.

### Phase 6 -- structure (review order item 6)

Developer section in the nav (remark 4: check-a-flow, command-line's source-checkout half, From source,
custom-firmware's freeze paragraph); FAQ grouping; `flow-lifecycle.md`'s second half; `boards.md` duplication
with Supported hardware and the folder page.

### Phase 7 -- pictures (review order item 7)

Extend `tools/screenshots.py` for the broker edit form and Install firmware dialog; regenerate the editor tour
shot after v0.11.

## Model recommendation

Available providers checked 2026-11-01 (`opencode-go`, `opencode`).

- **Phases 0-4, 6, 7 (facts, rewrites, judgment, code): `opencode/claude-sonnet-5-5`** ($2/$10 per Mtok). The
  work is prose judgment against a style guide plus source-level fact-checking; Sonnet is the quality/cost sweet
  spot. `opencode-go/kimi-k3.1-pro` ($2/$10) is the equivalent alternative.
- **Phase 5 (bulk per-page passes): `opencode/claude-haiku-5-5`** ($0.1/$0.5 per Mtok), one batch of pages per
  subagent with the review's per-page findings as the checklist. The lint and the strict build are the gate;
  a strong-model pass reviews each batch's diff before commit. ~30 pages of mechanical edits is where the cheap
  model pays; it is not trusted with phases 1-4.
- **Phase 0's lint:** written and tested by the strong model in-session; no subagent (it gates everything after).

## Decisions (Mike, 2026-11-01)

Recorded in `decisions/documentation-process.md`.

1. **Lint in AGENTS.md:** yes -- the project rule lands in the same change as the lint (phase 0): run
   `python3 tools/docs_lint.py` before committing docs changes; new lint rules land only with the fixes that make
   them pass.
2. **`gui modal`:** commented out for future inclusion (HTML comment in `gui.md`), not deleted -- the text
   survives for when modal layout lands in the editor. `gui navigator` stays simply removed (remark 6).
3. **C2 refusal clause:** stands. `debugging.md`/`faq.md` keep one short clause per refusal saying the behavior is
   deliberate; the style guide gets the refinement in the same change as the phase 2 edits.
