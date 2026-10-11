# WARNING!: This has been heavily vibe-coded. If you don't like that, please move on.


# Thingstudio

Thingstudio is a visual, low-code way to program microcontrollers. You build a flow of nodes and wires in a
node-based editor in your browser, in the style of [Node-RED](https://nodered.org/). Thingstudio compiles the flow
to [MicroPython](https://micropython.org/) and sends it to your board, where it runs on its own: no server, no
cloud, and no editor connected.

**User guide:** https://docs.thingstudio.net/

## Install

Download the package for your computer from the
[releases page](https://github.com/mkarliner/ThingStudio/releases/latest), or run the installer script. To read the
script before running it, download [install.sh](https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh)
or [install.ps1](https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1) and open it in a
text editor.

macOS and Linux:

```sh
curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh
```

Windows, in PowerShell:

```powershell
irm https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1 | iex
```

Then follow [Getting started](https://docs.thingstudio.net/getting-started/), from a new board to a blinking LED.
[Supported hardware](https://docs.thingstudio.net/supported-hardware/) lists the boards Thingstudio is tested on;
other MicroPython boards may work.

## How it works

Thingstudio has three parts:

1. **Backend:** a local Python program. It serves the editor and the user guide, talks to boards over USB serial
   or WiFi, and keeps custom nodes, board definitions and saved credentials in `~/.thingstudio`.
2. **Editor:** runs in the browser. It compiles the flow there too: to MicroPython, then to `.mpy` bytecode with a
   WebAssembly build of `mpy-cross`.
3. **Device runtime:** a MicroPython program on the board. It receives the compiled flow, saves it, and runs it.
   The editor installs it on a board that has MicroPython (**Tools → Install runtime…**).

How this compares to Node-RED MCU Edition, MicroBlocks, XOD and ESPHome/Tasmota: design doc §1–§2.

## Build from source

You need Python 3.10 or later, Node.js 22.12 or later, and `make`. In the repository folder:

```sh
make                  # build the editor and docs, install into .venv, put thingstudio-backend on PATH
thingstudio-backend   # start it (or: make run)
```

`make` rebuilds only what changed. `make test` runs the editor and backend tests. The Makefile's header lists the
other targets.

To work on the editor with hot reload, run `npm run dev` in `editor/`, with the backend started separately on its
default port, 8765. Run `make` before relying on the copy the backend serves: the backend warns at startup if
`editor/dist` is older than `editor/src`.

## Project layout

The repository's folders:

```
backend/         local Python backend: serial and WiFi relay, runtime install, serves editor and docs
editor/          browser app: canvas, compiler, protocol client, node library
device-runtime/  MicroPython code for the board: listener, protocol, runtime
docs/            user guide, design doc, working notes
test-flows/      example flows and scripts for testing on real hardware
test/hil/        hardware-in-the-loop rig (run by hand, not in CI)
pocs/            the original proof-of-concept spikes, kept for reference
tools/           build, screenshot and license-scan scripts
```

## Documentation for contributors

These files describe how Thingstudio is built and what's in progress:

- `docs/thingstudio-design-doc.md`: the design. Read it in full before proposing architecture changes.
- `docs/working-notes/`: planning, decisions and open items. Start with `outstanding-items.md`.
- `docs/third-party-licenses.md`: every third-party dependency, with its license.
- `CLAUDE.md`: project conventions for anyone, human or AI, working in this repository.

## License

Apache-2.0. See `LICENSE`.
