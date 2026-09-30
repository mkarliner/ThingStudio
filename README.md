# Thingstudio

A browser-based, drag-and-drop node/wire programming environment whose
output runs directly on a microcontroller — Node-RED's visual model, but
the flow runs standalone on the device itself once deployed, not on a
server.

**Docs:** https://docs.thingstudio.net/

**Install** (other options in [Getting started](https://docs.thingstudio.net/getting-started/)).
macOS and Linux:

```sh
curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh
```

Windows, in PowerShell:

```powershell
irm https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1 | iex
```

## Status

Pre-v1, working towards an MVP (`docs/road-to-mvp.md`). The editor, the
compiler, the local backend and the device runtime all exist and run on
real hardware.

See `docs/thingstudio-design-doc.md` for the full design.

## How it works

1. **Backend** — a small local Python program. It serves the editor and
   the user docs, talks to boards over USB serial, and stores custom nodes
   and saved credentials in `~/.thingstudio`. Start it and the editor opens
   in your browser, as with Node-RED.
2. **Editor** (in the browser) — drag nodes onto a canvas, wire them
   together, hit Deploy. The compiler runs in the browser too: it turns the
   graph into MicroPython, then into `.mpy` bytecode with a WASM build of
   `mpy-cross`.
3. **Device runtime** (on the microcontroller) — a MicroPython listener
   that receives the compiled flow, swaps it in, and keeps running it on
   its own once the cable's unplugged. The editor installs it onto a board
   that already has MicroPython (**Tools → Install runtime…**).

Full reasoning, and how this compares to Node-RED MCU Edition,
MicroBlocks, XOD, MicroFlo, and ESPHome/Tasmota: design doc §1–§2.

## Build from source

From a copy of this repository (Python 3.10+, Node.js 22.12+, make):

```sh
make                  # build the editor and docs, install into .venv, link the command onto PATH
thingstudio-backend   # start it (or: make run)
```

`make` only rebuilds what changed; `make test` runs the editor and backend tests. The
Makefile's header lists the other targets.

The editor opens at `http://127.0.0.1:8765/`; **Help → User guide** opens the
user guide, served locally. Start with its Getting started page
(`docs/user-guide/getting-started.md`), and Installing MicroPython if your
board doesn't have it yet.

**Working on the editor itself:** `cd editor && npm run dev` serves it with
hot reload on Vite's own port, talking to a separately started backend on
its default port (8765). Rebuild (`make`) before relying on the
backend-served copy — the backend warns at startup if `editor/dist` is
older than `editor/src`.

## Node library

24 built-in node types (`editor/src/node-library/`, listed in
`registry.ts`). All are on the canvas except `variable_get` and
`variable_set`, which compile but have no palette entry
(`docs/working-notes/outstanding-items.md`). No dedicated boolean/
arithmetic/comparator nodes — a `function` node covers that ground in
one line, and dedicated ones were never wired onto the canvas anyway.

You can also write your own node type without touching the compiler —
see [`docs/user-guide/custom-nodes.md`](docs/user-guide/custom-nodes.md).

## Target hardware

MVP chips: ESP32, ESP32-C3, ESP32-S3, RP2040, RP2350 — users bring a board
with MicroPython already on it. Confirmed on real hardware so far:
ESP32-C3, RP2040, classic ESP32 (CYD), and an ESP32-S2 (LOLIN S2 Mini,
outside the MVP list) for the full blank-board-to-runtime path. Full
comparison: design doc §3.

## Project layout

```
backend/         local Python backend: serial relay, runtime install, serves editor + docs
editor/          browser app: canvas, compiler, protocol client, node library
device-runtime/  MicroPython device code: listener, protocol, runtime
docs/            design doc, user guide, working notes
test-flows/      hand-authored flows and scripts for exercising real hardware
test/hil/        hardware-in-the-loop rig (manual, not CI)
pocs/            the four original proof-of-concept spikes — frozen, historical
tools/           license-scan and build scripts
```

## Not built yet

- **More install routes** — Homebrew (MVP item 7); winget/scoop after MVP.
  Releases today: one-line installers for macOS, Linux and Windows, and a
  zip or tarball per platform.
- **Board-transport auth** — the `HELLO` handshake fields are designed,
  not yet wired in.

Full, current list: `docs/working-notes/outstanding-items.md`.

## Documentation

- [`docs/user-guide/`](docs/user-guide/) — the user guide, built with
  MkDocs and served by the backend at `/docs/` (and online at
  https://docs.thingstudio.net/).
- `docs/thingstudio-design-doc.md` — the design doc. Read in full before
  proposing anything architectural.
- `docs/working-notes/` — active planning, decisions, and open items.
  Start with `outstanding-items.md`.
- `docs/third-party-licenses.md` — every third-party dependency in use,
  with its license.
- `CLAUDE.md` — project conventions for anyone, human or Claude, working
  in this repo.

## License

Apache-2.0 — see `LICENSE`.
