# Protocol state machine: finish and merge — briefing

Written 2026-10-24 at the end of the session that audited the board ↔ editor wire protocol and rebuilt its
conversation layer as a table-driven state machine. The work is on branch **`protocol-state-machine`**, pushed to
GitHub and rebased onto `main` (`09fdbf1`). It is **not merged, and no PR is open yet.** Mike's next step was
"fix the obvious code smells, then merge". This brief covers what that means, what was decided, and the
environment facts needed to pick it up.

## Where things stand

- Branch head `c598c33` on GitHub, 14 commits on top of `main` `09fdbf1`; it fast-forwards onto `main`. Two of
  the 14 are Mike's own: "NEW: Kitchen sink" (`a0bce7d`) and "FIX: catch up" (`4f4a2c6`). They were only on his
  Mac until the push, carry his authorship, and were rebased along with the rest.
- **Mike's Mac checkout (`~/Src/ThingStudio`) is stale.** It is still on the pre-rebase branch (`765a688`), and its
  local `main` lacks GitHub's 12 newer commits. Hand him the commands below. Don't run them from the sandbox
  unless he asks; the shared-mount git rules are under "Environment facts".

  ```sh
  cd ~/Src/ThingStudio
  rm -f .git/index.lock
  git fetch origin
  git switch protocol-state-machine && git reset --hard origin/protocol-state-machine
  git branch -u origin/protocol-state-machine
  git switch main && git reset --hard origin/main
  ```

- All green on the rebased tree, all runs in the cloud workspace:

  | Check | Result |
  |---|---|
  | Editor `vitest` | 1,238 passed; `tsc` clean |
  | Board MicroPython suites | all pass |
  | `test_listener_integration.py` | 26/26 |
  | `test_exchanges.py` | 13/13 |
  | `audit_protocol_exchanges.py` | every finding "fixed" |
  | Backend `pytest` | 301 passed |
  | `tools/protocol_states.py --check`, `tools/protocol_coverage.py --check` | clean |

- Runtime and editor target are **13.1.0** (minor: no codegen change, no message-shape change). `main` is at
  13.0.0.
- **Nothing has run on hardware.** `outstanding-items.md` ("Redeploy / runtime") has the CYD pass.

## What the branch does, in one screen

Read these first; they are the record:

- `docs/working-notes/reviews/2026-10-24-protocol-audit.md`: the audit (findings 1–10).
- `docs/working-notes/reviews/2026-10-24-protocol-state-machine.md`: what changed, every finding's status
  (including two new ones, 11 and 12), board RAM figures, test evidence.

In short:

- **`interfaces/protocol/states.json` is the ground truth** for the conversation (SPEC §7). It holds three
  machines: `board.listener`, `board.stream` and `editor.transfer`. Each has states, events, named guards and
  actions, an ordered transition table, and an `illegal` rule. Anything without a row is illegal.
- **`tools/protocol_states.py`** validates the table and generates three files:
  - `interfaces/protocol/STATES.md`, the diagrams and tables for people;
  - `device-runtime/src/protocol_states.py`, a flat tuple of strings that stays in flash when frozen;
  - `editor/src/protocol/states.generated.ts`.

  `make test` runs `check-protocol`, which covers both tools.
- **Interpreters:**
  - Board: `device-runtime/src/statemachine.py`. Four functions (`table`, `check`, `find`, `illegal`), plus
    `Stream`, which implements `board.stream`. `listener.py` dispatches every line through `board.listener`; its
    `_LISTENER_ACTIONS` maps table action names to handlers `(msg, err, source)`.
  - Editor: `editor/src/protocol/machine.ts` (`Machine`) and `transfer.ts` (`TransferSession`). There is one
    session per page; `main.ts` feeds it every message (`onMessage`) and tells it about disconnects.
- **Alerts:** `PROTOCOL_ILLEGAL <machine> <state> <event>: <detail>` on the board, and
  `[protocol] illegal: <event> while <state> (<detail>)` in the editor (SPEC §7.6). User docs:
  `debugging.md`.
- **Conversation vectors:** `interfaces/protocol/vectors/exchanges.json`, 14 exchanges.
  - Run by `device-runtime/test/test_exchanges.py` (a real listener) and `editor/test/protocol-exchanges.test.ts`.
  - `"illegal": true` marks where an alert must happen. `"sides": ["editor"]` marks a scripted misbehaving board.
- **Hand-drawn exchange diagrams:** `interfaces/protocol/SEQUENCES.md`. `tools/protocol_coverage.py` →
  `COVERAGE.md` checks that every message is specified, vectored, sent, handled and drawn.

## Decisions Mike made this session (all recorded)

- **The state machine is data, and the data is the ground truth.** A first pass wrote the rules as code; Mike
  rejected it ("It's what I expected in the first place"). Diagrams and docs come from the table.
  `decisions/subsystem-interfaces.md`, 2026-10-24.
- **Board RAM matters; editor code size doesn't.** Constrained boards will run a custom image with the runtime
  frozen into flash, so judge board cost frozen first, then as precompiled `.mpy`.
- **Spec changes on this branch were approved in session** (SPEC §4, §5, §6, §7, `states.json`). Anything further
  that changes the interface still needs his explicit OK: request ids (finding 5), specifying the backend leg
  (finding 8).
- **Push only when asked.** He did ask, so the branch is on GitHub. The repo is public.

## Next: fix these before merging (Mike asked; ~30 min)

From a quick smell pass at the end of the session. Do all four on this branch, re-run everything, push, then open
the PR.

1. **Guards and actions fall through silently (board).**
   - `statemachine.py` `_guard`: the last line returns the `complete` result for *any* unrecognised name.
   - `statemachine.py` `_act`: `elif name != "release"` treats any other name as a write.
   - `listener.py` `_listener_guard`: ignores `name` entirely.

   `check()` only confirms a name is in the hand-written tuple, so a guard that is listed but not implemented would
   run as the wrong guard. Fix: match each name explicitly and raise on an unknown one. Then add a test that a
   name in the tuple with no implementation fails.
2. **The two interpreters order a transition differently.**
   - Board (`Stream._run`): runs the action, then moves. It needs this for `onError`.
   - Editor (`machine.ts` `fire`): moves, then runs the action.

   Pick one rule ("the action runs in the from-state; the state changes after it succeeds, or to `onError` when
   it fails"), state it in SPEC §7 and `states.json`'s `about`, and make both sides follow it. The editor's
   `TransferSession` actions arm timers by line type rather than by state, so check nothing there relied on
   moving first.
3. **SPEC §7.1 "who answers what" restates `states.json`** (`board.listener` rows carry `replies`). Generate a
   "who answers what" table into `STATES.md` from the rows, and make §7.1 point at it, as §7.2 does. Keep
   §7.1's prose on the `Garbled` answer and the unsolicited messages.
4. **A stale comment** in `editor/src/protocol/transport.ts` (around line 96) says the frame-decoder state "lives
   here". It was removed: each line is now decoded on its own with `protocol.decodeLineFrame`.

Then open the PR: `https://github.com/mkarliner/ThingStudio/pull/new/protocol-state-machine`.

## Later (not for this merge)

5. **A changelog in a code comment.** `_RUNTIME_VERSION` in `listener.py` is a 4,888-character line of version
   history, and `EDITOR_TARGET_VERSION` in `main.ts` is 2,537 characters. They are hand-mirrored; the 2026-10-23
   architecture review already asks for one source or a drift test. Move the history to a `CHANGELOG`.
6. **God files:** `main.ts` (3,333 lines) and `listener.py` (1,292). Board settings, restart, exec and connect
   still use ad-hoc `waitForMessage` waits in `main.ts`. They are the next candidates for `editor.*` machines in
   `states.json`.
7. **`deps._RESERVED` is hand-kept** next to `runtime_manifest.CORE_FILES`. Add a test comparing them.
8. **Library streams in `deps._streams` are dropped only by a `DEP_COMMIT`.** A transfer abandoned without one
   leaves a small `Stream` until restart. It is bounded, but it is a leak.
9. **`listener._serve_lines` builds a `ProtocolStreamDecoder` and resets it every line.** A single-frame decode,
   like the editor's `decodeLineFrame`, would be simpler.
10. **`test_exchanges.py` waits on fixed sleeps** (0.25 s settle per step). It's slow, and could be flaky in CI.
11. **`audit_protocol_exchanges.py` largely duplicates the vectors now.** Keep it as the audit's record, or fold
    the rest into `exchanges.json` and retire it.

Still open from the audit (`outstanding-items.md`, "Redeploy / runtime"):

- the CYD hardware pass;
- request ids (interface change, Mike's call);
- the backend leg (WebSocket JSON control messages, `TSAUTH1`) unspecified;
- the device conformance and exchange suites not in CI.

## Environment facts (what worked, what didn't)

**The working copy.**

- All work was done in a cloud clone at `/home/claude/repo`, not on the shared mount. Its `origin` is
  `https://github.com/mkarliner/thingstudio`, reached through the session's GitHub access (`add_repo`, push).
- The clone was first made from a `git bundle` of Mike's local repo. That is how to get unpushed local commits off
  his Mac without pushing them.
- A new session will need to clone again: `git clone https://github.com/mkarliner/thingstudio`, then
  `git switch protocol-state-machine`.

**Editor.**

- `cd editor && npm ci --no-audit --no-fund` in the cloud clone (~2 s; it worked, with no lockfile changes).
  AGENTS.md's canonical form is `npm ci --ignore-scripts`; use that.
- **Never run npm or vitest on the shared mount** (CLAUDE.md).
- Typecheck with `./node_modules/.bin/tsc --noEmit`, then `npx vitest run` (~70 s). Check first for stray `.js`
  under `editor/src` and `editor/test`.

**MicroPython.**

- Upstream `micropython/micropython` at commit `682e3f1` (2026-10-23), not the project's pinned firmware commit.
  It was cloned with `--depth 1` to `/home/claude/mp/mpy-src`.
- Build: `make -C mpy-cross -j8`, then `make -C ports/unix submodules`, then `make -C ports/unix -j8`. About 2
  minutes; it worked first time.
- Run with `MICROPYTHON_BIN=.../ports/unix/build-standard/micropython` and
  `MPY_CROSS_BIN=.../mpy-cross/build/mpy-cross`.
- **Frozen builds for RAM measurement:**

  ```sh
  make -C ports/unix FROZEN_MANIFEST=/path/manifest.py BUILD=build-frz-x
  ```

  The manifest **must** begin with `include("$(PORT_DIR)/variants/standard/manifest.py")`. Without it,
  `uasyncio` is missing and `import listener` fails.

**RAM measurement.**

- Measure `gc.mem_free()` before and after `import listener` (held), and binary-search `-X heapsize=` for
  the minimum heap that boots. Point every `THINGSTUDIO_*_PATH` environment variable at `/tmp`, as
  `test_listener_integration.py` does.
- The minimum heap is **fragmentation-sensitive**: import order alone swung it from 155 KB to 215 KB for the same
  code.
- The unix port is 64-bit; roughly halve the figures for an ESP32.

**Backend.**

- `python3 -m venv bvenv && bvenv/bin/pip install -e backend` (plus `pytest`), then
  `bvenv/bin/python -m pytest -q backend/test`. That passed (301).
- `main` now hash-pins `backend/requirements.txt`. The canonical install is `--require-hashes` (AGENTS.md
  "Third-party code"); this session's venv predates that.

**Diagrams.** `mmdc` (Mermaid CLI, preinstalled in the cloud) renders `.mmd` to PNG for checking a diagram by eye.

**The shared mount, via the device bridge.**

- Git from the sandbox leaves lock files unless Mike grants delete permission
  (`device_request_delete_permission`). He granted it for this session; with it, `git switch`, `commit`,
  `fetch` and `merge --ff-only` from `device_bash` left no locks.
- **`device_commit_files` silently failed to overwrite an existing file**: it reported "written", but the old
  content stayed. Committing to a *new* path, then `mv` in `device_bash`, worked. New files commit fine.

## Mistakes made this session, so the next one doesn't repeat them

- **Hashes quoted before reading them back.** Twice I gave Mike a commit hash I hadn't read from git output, and
  both were wrong. Only quote hashes from tool output.
- **A commit went in with a failing check.** A shell chain ran `git add/commit` after a failing `--check`,
  because the `&&` didn't cover the commit. Gate the commit on the check.
- **The state machine was first built as code.** It should have been a table from the start. When "state
  machine" is ambiguous, ask whether it means table-driven before building.
