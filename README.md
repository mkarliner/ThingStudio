# Thingstudio

A browser-based, drag-and-drop node/wire programming environment whose
output runs directly on a microcontroller — Node-RED's visual model, but
the flow runs standalone on the device itself once deployed, not on a
server.

## Status

Pre-v1, but real and running. The editor (Rete.js canvas, compiler,
WebSerial device link) and the device runtime (a MicroPython listener)
both exist and have been tested against real ESP32-C3 and RP2040
hardware. Still missing: the optional remote-access backend
(design-complete, zero code — direct USB works today without it), several
node types' canvas presence, and other items tracked in
`docs/working-notes/outstanding-items.md`.

See `docs/thingstudio-design-doc.md` for the full design.

## How it works

Three pieces:

1. **Editor** (browser, no install) — drag nodes onto a canvas, wire them
   together, hit Deploy. Runs entirely client-side.
2. **Compiler** (also client-side) — turns the node graph into MicroPython
   source, then cross-compiles it to `.mpy` bytecode with a WASM build of
   `mpy-cross`.
3. **Device runtime** (on the microcontroller) — a MicroPython listener
   receives the compiled bytecode over USB serial, swaps the running flow,
   and keeps executing it standalone once the cable's disconnected.

Editor and device talk directly over WebSerial — no backend needed for
local use. A thin remote-access backend is designed but not built yet
(see "Not built yet" below).

Full reasoning, and how this compares to Node-RED MCU Edition,
MicroBlocks, XOD, MicroFlo, and ESPHome/Tasmota: design doc §1–§2.

## Try it

Requires Chrome or Edge — WebSerial isn't supported in Safari, and only
in recent Firefox.

```sh
cd editor
npm install
npm run dev
```

Opens the editor. Build a flow, or open one of the examples in
`test-flows/`.

Before deploying to a board for the first time, push the runtime onto it:

```sh
pip install mpremote
python3 test-flows/deploy_runtime.py --port /dev/tty.usbmodemXXXX
```

Then connect from the editor and hit Deploy. `test-flows/README.md` has
the full walkthrough, including how to watch a board's first boot without
triggering a false "it never started."

## Node library

15 built-in node types (`editor/src/node-library/`): `inject`,
`function`, `debug`, `timer`, `interrupt`, `gpio_out`, `pwm_out`,
`wifi_status`, `udp_send`, `udp_receive`, `http_request`, `mqtt_publish`,
`mqtt_subscribe`, `variable_get`, `variable_set`. 9 are wired onto the
canvas today; the rest compile correctly but have no palette entry yet
(`docs/working-notes/outstanding-items.md`). No dedicated boolean/
arithmetic/comparator nodes — a `function` node covers that ground in
one line, and dedicated ones were never wired onto the canvas anyway.

You can also write your own node type without touching the compiler —
see [`docs/user-guide/custom-nodes.md`](docs/user-guide/custom-nodes.md).

## Target hardware

ESP32-C3 confirmed on real hardware (v1 baseline). RP2040 (Pico)
confirmed too — stable, comfortable RAM headroom. Classic ESP32/ESP32-S3
are in scope; RP2350 (Pico 2) hasn't been touched yet. Full comparison:
design doc §3.

## Project layout

```
editor/          browser app: canvas, compiler, protocol client, node library
device-runtime/  MicroPython device code: listener, protocol, runtime
docs/            design doc, user guide, working notes
test-flows/      hand-authored flows and scripts for exercising real hardware
test/hil/        hardware-in-the-loop rig (manual, not CI)
pocs/            the four original proof-of-concept spikes — frozen, historical
tools/           license-scan and build scripts
```

## Not built yet

- **Remote access backend** — a thin local Python service so the editor
  doesn't have to run on the same machine as the USB cable.
  Design-complete, zero code. Direct local USB works without it.
- **Board-transport auth** — the `HELLO` handshake fields are designed,
  not yet wired in.
- **Several node types' canvas presence** — see "Node library" above.
- **TCP nodes, I2C/SPI sensor nodes, live value streaming, flow
  persistence** — all scoped, none built.

Full, current list: `docs/working-notes/outstanding-items.md`.

## Documentation

- [`docs/user-guide/`](docs/user-guide/) — guides for using Thingstudio
  (currently: writing a custom node type).
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
