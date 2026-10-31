# Briefing: rewrite the user docs to the style guide, then test the guide

Status: brief, 2026-10-11. Follows the docs style review (2026-10-10/11). Two parts, in order: rewrite pages to
the guide without Mike steering each sentence, then a review session with Mike to see how well the guide steered.

## Read first

- `docs/working-notes/docs-style-guide.md`: the rules, all confirmed by Mike; "draft" until Part 2 tests them.
- `docs/working-notes/docs-style-review.md`: Mike's remarks, verbatim, and the patterns they grouped into. Read the
  remarks, not just the rules: they show what he reacts to.
- `docs/working-notes/outstanding-items/user-docs-rewrite.md`: the prioritised page list and open decisions.
- `CLAUDE.md`: commits, build and test limits, console and docs rules.

## Part 1: rewrite

Scope: the P1 list in `user-docs-rewrite.md`, in order. Stop there; P2/P3 wait for the review.

1. Getting started, steps 1-6: `getting-started.md`, `editor-tour.md`, `installing-micropython.md`,
   `connecting.md`, `installing-runtime.md`, `first-flow.md`. Read them as one sequence: no repeats, no jumps.
2. `working-in-the-editor.md`: cut the design reasons (presets, config nodes) to what and how.
3. `sensor-display.md`, then `debugging.md`.

How:

- Work from the guide only. Don't ask Mike rule questions mid-rewrite; where the guide doesn't decide something,
  make a call and log it (see "Log" below). The point is to find out what the guide fails to say.
- Don't change meaning. Every behaviour claim you touch, check against the source (editor `src/node-library`,
  `device-runtime/src`, backend). Wrong claims found on the way: fix, and note them separately from style edits.
- Keep each page's anchors where other pages link to them (`grep -rn "page.md#"` before renaming a heading).
- New troubleshooting or FAQ material found on the way goes in `faq.md`/`debugging.md`, per `CLAUDE.md`.
- After each page: `mkdocs build --strict` and `python3 tools/build_llms_txt.py --check` (see Environment).

Log, in a new section at the end of `docs-style-review.md`, "Rewrite log (date)": per page, one line per call the
guide didn't settle, and one line per factual fix. This is the input to Part 2.

Then stop and hand Mike the commit commands.

## Part 2: review how well the guide steered

A session with Mike, same shape as the first review: he reads, Claude records verbatim, then interprets.

1. Mike reads the rewritten pages, in Getting started order, and reacts. Record verbatim under a dated heading in
   `docs-style-review.md`.
2. Sort each remark into one of four kinds:
   - **Rule missing:** the guide says nothing about it. Add a rule.
   - **Rule unclear:** the guide covers it, but the rewrite read it differently. Reword the rule, add an example.
   - **Rule ignored:** the guide is clear and the rewrite didn't follow it. Note it; if it recurs, the rule needs to
     be more prominent, or the brief needs a checklist step.
   - **Rule wrong:** following it made the page worse. Change or drop it.
3. Go through Part 1's log with Mike: each call the guide didn't settle becomes a rule, a preference, or a one-off.
4. Measure: remarks per page against the first session's sample pages. Fewer, and of a different kind (taste rather
   than structure), means the guide is steering. Note the counts in the review note.
5. Optional, if time: give a fresh agent only the guide and one untouched P2 page (`flow-lifecycle.md` is a good
   one), with no other context. Compare its rewrite with what Mike wants. This tests the guide without this
   session's history leaking in.
6. Update `docs-style-guide.md`: changed rules, new examples, and drop "draft" from the status once Mike says so.
   Then update the P2/P3 list in `user-docs-rewrite.md` for the next session.

## Decisions to put to Mike early in Part 2

- SSD1306 and BMP280 "Not yet confirmed" on Supported hardware: tested since?

Settled 2026-10-11: all guide rules confirmed, including the node page layout, limitations and word list. A
"Future" page stays on the backlog. `wifi-provisioning.md` is in the nav, after Connecting over WiFi.
`clock.md` is replaced by `ntp.md` in a dev session first; don't rewrite it.

## Environment (learned in the review session)

- Docs build: a mkdocs 1.6.1 + mkdocs-material venv outside the shared mount. In a device-bridge session:
  `python3 -m venv ~/mkv && ~/mkv/bin/pip install "mkdocs==1.6.1" mkdocs-material`, then from the repo
  `~/mkv/bin/mkdocs build --strict -d ~/site-check`. Never the repo's own `.venv` (Mac binaries).
- Never `npm`, `vitest` or `tsc` against the shared mount. Mike runs the docs tests:
  `cd editor && ./node_modules/.bin/vitest run test/docs-llms.test.ts test/cli-check-flow.test.ts test/cli-describe.test.ts`.
  A node label change needs the catalog regenerated first (command in `test/cli-describe.test.ts`'s header).
- Screenshots (`tools/screenshots.py`): the device VM can't download Chromium. Stage `editor/dist`, `backend/src`,
  `tools/screenshots.py` and `docs/screenshots/` into the cloud container, `pip install aiohttp pyserial`, run with
  `PYTHONPATH=backend/src` and `--chromium` pointing at the preinstalled Playwright Chromium, then commit the PNGs
  back.
- Even read-only git from the sandbox can leave `.git/index.lock`. Don't run git there; every commit block starts
  with `rm -f .git/index.lock`.
- Deleting files in the mount isn't allowed by default. Rename with `mv` instead of create-and-delete.

## Constraints

- Mike does all git writes. Prompt him to commit after Part 1 and at the end of Part 2.
- Don't use the phrase "load bearing".
- Wrap working-notes prose under 120 characters.
- `ai-authoring.md` and `nodes-catalog.md` are out of scope.
