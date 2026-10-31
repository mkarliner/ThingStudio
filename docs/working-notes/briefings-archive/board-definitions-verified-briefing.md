# Briefing: board definitions verified on hardware, plus a Makefile and three fixes

2026-09-24. Handoff from the session that ran the hardware check in `board-definitions-landed-briefing.md`.
Everything below is committed except whatever `git status` shows; if anything is modified, ask Mike to
commit it (`rm -f .git/index.lock` first, per CLAUDE.md).

## Result: MVP item 4's board/processor definitions pass on real hardware

All checks from the previous briefing pass (log: `outstanding-items/gpio-pin-range-by-chip.md`):

- **LOLIN S2 Mini:** Auto finds it, Arch xtensawin, GPIO 40 now allowed, GPIO 23 refused with the valid pins.
- **CYD (picked by hand):** gs4 and mono test flows draw at 27 MHz on bus 2; 40 MHz on bus 2 refused at
  compile time; 40 MHz on bus 1 compiles and renders (new, recorded in
  `learnings/hardware-bringup-hil-rig.md`).
- **Pico / Pico W / Pico 2:** Auto finds each; GPIO 25 refused as reserved on the Pico W.
- **`~/.thingstudio`:** filled with all 11 built-ins on first start. Editing `boards/pico.json` (name and a pin
  label) shows up on the next Connect without a restart; deleting it and restarting restores the built-in.

## Built or fixed this session

- **Top-level `Makefile`** (`make`, `make run`, `make test`, `clean`, `distclean`). Incremental: rebuilds the
  editor, docs or venv only when their inputs change (including the device-runtime SHA the editor bakes in).
  Checks Node/npm/Python/git first with plain messages. Installs the backend and mkdocs into a repo-local
  `.venv` and symlinks `thingstudio-backend` into the first writable `~/.local/bin`, `/opt/homebrew/bin` or
  `/usr/local/bin` on PATH (never over a real file). GNU make 3.81-compatible (macOS). mkdocs pins moved to
  `docs/requirements.txt`, shared with `docs.yml`. README and Getting started now say `make`. The bridge
  refuses to write a file named `Makefile`, so changes to it have to be handed to Mike as a file.
  `decisions/repo-tooling.md`.
- **MkDocs future** logged, not acted on: stay on 1.x; 2.0 is an incompatible rewrite; Zensical is the likely
  later move. `outstanding-items/mkdocs-future.md`.
- **Display test flows ran out of memory under runtime 2.0.0.** `bytes(buf)` needed a second contiguous 38 KB
  block. The CYD and TiDAL test flows now send the `bytearray` itself; `display-spi.md` says to.
- **Board menu kept a manual pick across a board change** (CYD pick stuck when a Pico connected, so pins and
  arch were the ESP32's). It now drops back to Auto when the connected board's processor differs; a
  same-processor pick (CYD on a generic ESP32) stays. `decisions/chip-board-definitions.md`.
- **Install runtime needed a power cycle on a Pico.** The listener ignores Ctrl-C, and native-USB boards don't
  reset on port open. Install now sends STOP_TO_PROMPT first, then waits for a prompt like Remove flow
  (`board_recovery.catch_prompt`, "press reset or unplug and replug"). Confirmed on a Pico.

## Unexplained, watch for it

The first CYD deploy of the session timed out (no DEPLOY_ACK) and the board rebooted about 3 s after Deploy.
A power cycle cleared it and it didn't recur. If it comes back, get the board's boot output.

## Open follow-ups

`outstanding-items/processor-board-definitions-followups.md`: the flow file doesn't record its board; the Board
menu choice isn't kept across reloads; CYD touch/SD/LED pins unverified; no board-level defaults (e.g. seed
`display_spi` with 40 MHz on bus 1 for the CYD); no ESP32-C6 processor file; the Arch menu keeps a manual pick
across board changes; the backend banner still says `npm run build` / `mkdocs build` instead of `make`.

The two `editor/test/node-startup.test.ts` failures and its tsc error are still there, unrelated to any of this.
Ask Mike whether startup-node work is in progress before touching them.

## Working method that worked

Code was tested in a cloud copy of the repo (tarball via `.verify-tmp/`, `npm ci --ignore-scripts` there), never
with npm/make against the shared mount. Before copying files back, compare each file's md5 on the mount with
the snapshot, so nothing Mike changed in between gets overwritten. `git archive` of an older commit plus a small
vitest dump script is a quick way to diff generated Python between versions.
