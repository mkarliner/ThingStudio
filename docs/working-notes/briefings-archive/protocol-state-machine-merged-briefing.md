# Protocol state machine: merged — briefing

Status: **merged and shipped; nothing here is outstanding.** Written 2026-10-24 at the end of the session that
audited the board ↔ editor wire protocol and rebuilt its conversation layer as a table-driven state machine,
then rewritten 2026-10-25 (and renamed from `...-merge-briefing.md`) because it still told a reader to "fix the
obvious code smells, then merge" work that had already landed. It is kept as the record of what that session
decided and what it learned; the work it left behind is in `outstanding-items.md` ("Redeploy / runtime").

## Where things stand

- **Merged as PR #3** (`d21fc5c`), released as **v0.6.0** with runtime **13.1.0** (minor: no codegen change, no
  message-shape change).
- `origin/protocol-state-machine` is an **ancestor of `main`** — 27 commits behind and holding none of its own as
  of 2026-10-25. Do not reopen or rebase it; its content is in `main`.
- The four pre-merge fixes this brief originally asked for are in two commits on that branch: `bf381af`
  (explicit guard/action dispatch, one transition order) and `747dbe3` (that order rule in each machine's
  `about`, where `STATES.md` renders it).
- `main` has moved well past it: **v0.7.2 / runtime 14.0.1** as of 2026-10-25, after the GUI grid, cards and
  display work. The runtime bump on the merged branch was 13.1.0; `main`'s current target is 14.0.1.
- **Nothing ran on hardware from that session.** The CYD pass is still open in `outstanding-items.md`.

## What the branch does, in one screen

Read these first; they are the record of the audit and the rebuild:

- `docs/working-notes/reviews/2026-10-24-protocol-audit.md`: the audit (findings 1–10).
- `docs/working-notes/reviews/2026-10-24-protocol-state-machine.md`: what changed, every finding's status
  (including two new ones, 11 and 12), board RAM figures, test evidence.

In short:

- **`interfaces/protocol/states.json` is the ground truth** for the conversation (SPEC §7). It holds three
  machines: `board.listener`, `board.stream` and `editor.transfer`. Each has states, events, named guards and
  actions, an ordered transition table, and an `illegal` rule. Anything without a row is illegal.
- **`tools/protocol_states.py`** validates the table and generates three files:
  - `interfaces/protocol/STATES.md`, the diagrams, tables and the "Who answers what" table for people;
  - `device-runtime/src/protocol_states.py`, a flat tuple of strings that stays in flash when frozen;
  - `editor/src/protocol/states.generated.ts`.

  `make test` runs `check-protocol`, which covers both tools.
- **Interpreters:**
  - Board: `device-runtime/src/statemachine.py`. Four functions (`table`, `check`, `find`, `illegal`), plus
    `Stream`, which implements `board.stream`. `listener.py` dispatches every line through `board.listener`; its
    `_LISTENER_ACTIONS` maps table action names to handlers `(msg, err, source)`. Guards and actions match
    names explicitly and raise on an unknown one — `check()` can only see that a name is in the tuple.
  - Editor: `editor/src/protocol/machine.ts` (`Machine`) and `transfer.ts` (`TransferSession`). There is one
    session per page; `main.ts` feeds it every message (`onMessage`) and tells it about disconnects.
- **Transition order (one rule, both sides):** the action runs in the from-state; the state changes after it
  succeeds, or to `onError` when it fails. Each machine's `about` in `states.json` states it, and `STATES.md`
  renders it.
- **Alerts:** `PROTOCOL_ILLEGAL <machine> <state> <event>: <detail>` on the board, and
  `[protocol] illegal: <event> while <state> (<detail>)` in the editor (SPEC §7.6). User docs:
  `debugging.md`.
- **Conversation vectors:** `interfaces/protocol/vectors/exchanges.json`, 14 exchanges.
  - Run by `device-runtime/test/test_exchanges.py` (a real listener) and `editor/test/protocol-exchanges.test.ts`.
  - `"illegal": true` marks where an alert must happen. `"sides": ["editor"]` marks a scripted misbehaving board.
- **Hand-drawn exchange diagrams:** `interfaces/protocol/SEQUENCES.md`. `tools/protocol_coverage.py` →
  `COVERAGE.md` checks that every message is specified, vectored, sent, handled and drawn. The one-off
  `audit_protocol_exchanges.py` was the audit's own record and did not survive the merge.

## Decisions Mike made in that session (all recorded)

- **The state machine is data, and the data is the ground truth.** A first pass wrote the rules as code; Mike
  rejected it ("It's what I expected in the first place"). Diagrams and docs come from the table.
  `decisions/subsystem-interfaces.md`, 2026-10-24.
- **Board RAM matters; editor code size doesn't.** Constrained boards will run a custom image with the runtime
  frozen into flash, so judge board cost frozen first, then as precompiled `.mpy`.
- **Spec changes on that branch were approved in session** (SPEC §4, §5, §6, §7, `states.json`). Anything
  further that changes the interface still needs Mike's explicit OK: request ids (audit finding 5), specifying
  the backend leg (finding 8).
- **Push only when asked.** He did ask, so the branch went to GitHub. The repo is public.

## What it left behind (not this brief's work)

All in `outstanding-items.md` ("Redeploy / runtime"), with the detail in
`outstanding-items/protocol-state-machine-followups.md`:

- version history in two long comments (`_RUNTIME_VERSION`, `EDITOR_TARGET_VERSION`) — wants a `CHANGELOG`;
- `deps._RESERVED` vs `runtime_manifest.CORE_FILES`, hand-kept, no test;
- `main.ts` and `listener.py` as the next `editor.*` machines (ad-hoc `waitForMessage` waits);
- a library `Stream` left by an abandoned transfer;
- `test_exchanges.py`'s fixed sleeps (slow, possibly flaky in CI);
- plus the older open items: the CYD hardware pass, request ids, the unspecified backend leg, and device
  conformance/exchange suites not in CI.

## Environment facts

These were verified during that session and are still the working recipe.

**Editor.**

- `cd editor && npm ci --ignore-scripts` (AGENTS.md's canonical form). Never run npm or vitest on the shared
  mount (`CLAUDE.md`).
- Typecheck with `./node_modules/.bin/tsc --noEmit`, then `npx vitest run` (~70 s). Check first for stray `.js`
  under `editor/src` and `editor/test`.

**MicroPython.**

- The suites need a unix-port build and `mpy-cross`; `device-runtime/test/README.md` has the recipe. That
  session used upstream `micropython/micropython` at commit `682e3f1` (2026-10-23), not the project's pinned
  firmware commit — fine for the unix port, but say so when quoting results.
- Build: `make -C mpy-cross -j8`, then `make -C ports/unix submodules`, then `make -C ports/unix -j8`. About 2
  minutes.
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

- `python3.12 -m venv bvenv && bvenv/bin/pip install --require-hashes -r backend/requirements.txt`, then
  `bvenv/bin/pip install --no-build-isolation --no-deps -e ./backend`, then
  `bvenv/bin/python -m pytest -q backend/test`. The hash-pinned lock is now the canonical install (AGENTS.md,
  "Third-party code"); that session's venv predated it. The lock must be generated under 3.12 or aiohttp's
  `typing_extensions` is dropped and CI refuses the file.

**Diagrams.** `mmdc` (Mermaid CLI) renders `.mmd` to PNG for checking a diagram by eye.

**The shared mount, via the device bridge.**

- Git from the sandbox leaves lock files unless Mike grants delete permission
  (`device_request_delete_permission`). With it, `git switch`, `commit`, `fetch` and `merge --ff-only` from
  `device_bash` left no locks.
- **`device_commit_files` silently failed to overwrite an existing file**: it reported "written", but the old
  content stayed. Committing to a *new* path, then `mv` in `device_bash`, worked. New files commit fine.

## Mistakes made in that session, so the next one doesn't repeat them

- **Hashes quoted before reading them back.** Twice a commit hash was given without reading it from git output,
  and both were wrong. Only quote hashes from tool output.
- **A commit went in with a failing check.** A shell chain ran `git add/commit` after a failing `--check`,
  because the `&&` didn't cover the commit. Gate the commit on the check.
- **The state machine was first built as code.** It should have been a table from the start. When "state
  machine" is ambiguous, ask whether it means table-driven before building.
- **This brief itself went stale.** It kept a "next: merge" section after the merge shipped, and its own hash
  and version framing rotted within a day. A handoff note that names a state ("not merged, no PR") needs the
  same rewrite discipline as code: when the state changes, the note changes in the same session.
