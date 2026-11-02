# User guide editing, phase 0: open facts + the docs lint

Status: brief, 2026-11-02. For one session running **GLM-5.3-Flash** (`opencode-go/glm-5.3-flash`; Mike's call,
2026-11-02 — the editing plan's strong-model recommendation for phase 0 is deliberately overridden). Executes phase
0 of `docs/working-notes/user-guide-editing-plan.md` and nothing else. When done, hand back to Mike with the commit
commands.

Read first, in this order:

1. `docs/working-notes/user-guide-editing-plan.md` — the phases and the decisions (2026-11-01) that bind this work.
2. `docs/working-notes/reviews/2026-11-01-user-guide.md` — the findings; this session quotes from it, never
   re-derives.
3. `docs/working-notes/decisions/documentation-process.md` — the three decisions: lint line in AGENTS.md lands with
   the lint; `gui modal` commented out not deleted (phase 4, not this session); one attributing clause per refusal
   (phase 2, not this session).
4. `docs/working-notes/docs-style-guide.md` — what the lint rules encode.

## Task A — resolve the five open fact-checks

Read-only against editor/runtime/installer source. Append each answer, dated 2026-11-02, to the review file
(`docs/working-notes/reviews/2026-11-01-user-guide.md`) as a short "Phase 0 facts" section — one bullet per check:
the question, the answer, the source file and line that proves it. Do not edit any other part of the review.

1. **C5.3, GUI layout model.** The review found `gui.md` describing both a cell grid (row, col, row span, col span
   via ⚙) and "a tree of `row` and `column` containers", and both **panel** and **card** as the label for the same
   tick. Which does the editor implement, and which label does the UI show? Start: `editor/src/node-library/gui.ts`,
   then the layout code it calls.
2. **[Fact?] `topic` required.** `coming-from/node-red.md` says "Every message needs a `topic`, even an empty one";
   `background/flows-and-nodes.md` says only that `topic` is standard. AGENTS.md's message-shape rule says required,
   set to `''`. Check the compiler/runtime: does codegen or the runtime enforce a `topic` key on every message?
3. **C5.6, examples folder per install route.** Confirm where an installer-script install puts the shipped
   examples: `~/.local/share/thingstudio/examples/` on macOS/Linux, `%LOCALAPPDATA%\Thingstudio\examples\` on
   Windows — read `install.sh` and `install.ps1` (and `tools/make_bundle.py`, which copies `examples/` to the bundle
   root) and say what the paths actually are.
4. **`report_status` node list.** `working-in-the-editor.md` lists the nodes with a status dot and omits `ntp`.
   Produce the full list of nodes that call `runtime.report_status`. The files are: `adc.ts`, `ntp.ts`,
   `wifi-status.ts`, `touch-i2c.ts`, `bme280.ts`, `i2c.ts`, `neopixel.ts`, `gui.ts`, `custom-node.ts` (all under
   `editor/src/node-library/core-packages/` except `gui.ts` and `custom-node.ts`, which are one level up). Map each
   to its node name and note which GUI widgets count.
5. **`http in` methods.** `http-in.md` says "a `POST`/`PUT` body"; the review believes the node's method property
   offers GET or POST only. Check `editor/src/node-library/core-packages/http-in.ts`.

## Task B — the docs style lint

Spec is `user-guide-editing-plan.md` §"Regression mitigation". Decisions already made; do not re-ask.

- **`tools/docs_lint.py`** — Python stdlib only (no pip installs, no new third-party dependency; the pinning ledger
  stays untouched). Runs in seconds. Invocation: `python3 tools/docs_lint.py`, exit 0/1.
- **Start rules** (each maps to a cross-cutting finding; all near-zero false positives):
  1. Page-describing opening: "this page" / "this section" in the first body sentence (C1).
  2. UK spellings outside code spans and fenced blocks: colour, catalogue, recognis*, grey*, centre, behaviour (C2).
     Code stripping makes `neopixel`'s `'colour'` payload key a non-issue.
  3. Plans and internal references in `docs/user-guide/`: `working-notes` paths, "coming soon", "next to be
     written", "more are coming", "work in progress" (C4).
  4. The same `**term**` twice in one Properties section (C5.5).
  5. A sentence of eight-plus words repeated verbatim in one file, code stripped (C2's repeated WiFi sentence).
  6. Trailing whitespace; more than one consecutive blank line.
- **Baseline ratchet:** checked-in `docs/style-lint-baseline.json` lists every current violation as
  `file / rule / snippet`. The lint fails on (a) any violation not in the baseline and (b) any baseline entry that
  no longer violates. Generate the baseline with the lint itself; then hand-verify a sample (open two or three
  flagged files and confirm each flagged line is a real violation, not a false positive — fix the rule if not).
- **Prove the ratchet:** add a scratch violation to a temp copy, see it fail; remove a real violation in a temp
  copy without removing the baseline entry, see it fail. Do this on copies or revert afterwards — the working tree
  ends this session with no `docs/user-guide/` changes.
- **CI:** one `docs-lint` job in `.github/workflows/ci.yml` (setup-python, stdlib only, no pip installs), running on
  every push/PR like the editor job. Not `docs.yml` (main-only, deploys).
- **AGENTS.md:** add the approved line, in the project rules: run `python3 tools/docs_lint.py` before committing
  docs changes; new lint rules land only with the fixes that make them pass.
- **Deliberately not checked:** voice, chattiness, repetition of ideas, word counts. Don't add rules beyond the six.

## Environment facts (verified 2026-11-02)

- Linux box, repo at `/home/mike/ThingStudio`, branch `docs/context-diet`. Stay on it; merging to main is Mike's
  call. Tree was clean at handoff.
- Docs build: `.venv/bin/mkdocs build --strict -d /tmp/opencode/mkdocs-out` — the venv exists on this box and works.
- Lint and fact-checks need no npm, no editor build, no board. If anything unexpectedly pulls in the editor:
  `npm ci --ignore-scripts` in `editor/`, never plain `npm install`, never `npx` without `--no` for packages not
  already dependencies.
- `python3` is available; the lint must run on stdlib alone.
- Git: do not commit, stage, or otherwise mutate git. End the session by printing the exact `git add`/`git commit`
  commands for Mike.

## Gate before handback

- `python3 tools/docs_lint.py` exits 0 with the baseline covering every current violation.
- `.venv/bin/mkdocs build --strict` still clean.
- The five fact answers are appended to the review.
- `git status` shows only: `tools/docs_lint.py`, `docs/style-lint-baseline.json`, `.github/workflows/ci.yml`,
  `AGENTS.md`, the review file, and this brief's new home under `docs/working-notes/`.
- Commit commands handed to Mike; suggest one commit: "docs: phase 0 — style lint with baseline and CI gate, review
  fact-checks".

## Done when

Phase 0's gate is green and Mike has the commit commands. Phases 1+ are other sessions; do not start them.
