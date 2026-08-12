# Thingstudio

A browser-based, drag-and-drop node/wire programming environment whose output runs directly on a microcontroller — Node-RED's visual model, but the flow runs standalone on the device itself once deployed, not on a server.

## Status: pre-v1, greenfield

There is no installable editor or flashable runtime yet. Four proof-of-concept spikes (`poc-a` through `poc-d`) have de-risked the core technical bets and are done; real v1 hasn't started being built. See `docs/thingstudio-design-doc.md` for the full design and `docs/working-notes/` for what's actively being planned. If you're looking for something you can actually run today, see "Try it today" below.

## How it works

Three pieces, talking over a swappable transport (USB serial to start; BLE/WiFi later):

1. **Editor** (browser, no install) — drag nodes onto a canvas, wire them together, hit Deploy. Runs entirely client-side.
2. **Compiler** (also client-side, in the browser) — walks the node graph, generates MicroPython source, cross-compiles it to `.mpy` bytecode using a WASM build of `mpy-cross`. No server round-trip.
3. **Device runtime** (on the microcontroller) — a small MicroPython-based scheduler (`uasyncio`) accepts the compiled bytecode over the wire, replaces the running flow, and executes it standalone — the device keeps running the flow with no host machine attached, until the next deploy.

The point of doing it this way rather than compiling to firmware (the more common approach in this space) is the live loop: edit a flow, redeploy, see it running on real hardware in well under a second, with live values streaming back to the editor — without a flash-and-reboot cycle. See `docs/thingstudio-design-doc.md` §1 for the full reasoning and §2 for how this compares to existing tools (Node-RED MCU Edition, MicroBlocks, XOD, MicroFlo, ESPHome/Tasmota).

## Target hardware

ESP32-C3 or better (RISC-V, 400KB SRAM, WiFi+BLE) is the v1 baseline; classic ESP32 and ESP32-S3 are in scope as higher-spec options. RP2040/RP2350 (Pico family) support is a v2 candidate. Full rationale and the RAM/flash comparison table: `docs/thingstudio-design-doc.md` §3.

## Installing the editor

Not built yet. The v1 editor will be a static, no-install browser app (see the design doc §4). Track progress in `docs/working-notes/mvp-feature-priorities.md`.

## Flashing the runtime onto a device

Not built yet. The v1 runtime is a MicroPython-based image flashed once via USB; after that, flows deploy as data, not firmware (design doc §5). Track progress in `docs/working-notes/mvp-feature-priorities.md`.

## Try it today

Nothing production-shaped exists, but the POC folders are real, runnable code, each with its own README (scope, setup, and dated results):

- **`poc-a/`** — the core live-redeploy loop: a hand-written MicroPython program deployed to real ESP32-C3 hardware over WebSerial, no compiler involved. The central latency/reliability claim, measured.
- **`poc-b/`** — `mpy-cross` running as WASM, entirely client-side in a browser tab, compiling real Python to real bytecode.
- **`poc-c/`** — the node/wire canvas, comparing Litegraph.js against Drawflow with mocked node behavior (no device involved).
- **`poc-d/`** — the full pipeline merged: canvas → real compiler → real bytecode → real WebSerial deploy → running on real ESP32-C3 hardware.

Each POC is fully self-contained (its own vendored dependencies) — deliberate for throwaway independence, not a pattern real v1 will follow (design doc §14).

## Project layout (current)

```
docs/
  thingstudio-design-doc.md    the design doc — read this in full before proposing architecture changes
  working-notes/                active planning: MVP scope, node-authoring model, validation plan
poc-a/ poc-b/ poc-c/ poc-d/     proof-of-concept spikes, each self-contained with its own README
```

Real v1's repo layout (single monorepo: editor, device runtime glue, node library) is still an open decision — see the "code structure and conventions" task in `docs/working-notes/mvp-planning-briefing.md`.

## Documentation index

- `docs/thingstudio-design-doc.md` — the design doc. Read in full before proposing anything architectural.
- `docs/working-notes/mvp-planning-briefing.md` — the planning task list this repo's current working notes are answering.
- `docs/working-notes/mvp-feature-priorities.md` — the prioritized v1 feature list, tiered by dependency.
- `docs/working-notes/node-definition-model.md` — how a node is actually defined (editor descriptor + device-side codegen), grounded in `poc-d`'s real compiler.
- `docs/working-notes/validation/mvp-validation-plan.md` — how each tier of the feature list gets confirmed done, including the two-board hardware-in-the-loop test rig design.

## License

Apache-2.0 is the recommended project license (design doc §14), chosen mainly for its explicit patent grant. Not yet formalized as a `LICENSE` file, and worth an actual dependency license scan before any public release (design doc §12) — treat this as a strong recommendation, not yet a locked decision.
