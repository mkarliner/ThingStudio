# À la carte images: a local image builder for power users — scoping

Status: musing, 2026-11-24, from a chat with Mike. Nothing decided or built. Related:
`user-libraries-and-frozen-builds-scoping.md` (piece B there is the frozen-Python subset of this),
`firmware-pipeline-scoping.md` (the CI build container and `build.sh`), `custom-firmware-family-briefing.md`.

## The idea

A user picks components from a curated menu and gets a MicroPython + Thingstudio image built with exactly those in.
Not a full dev toolchain experience: choose, build, flash. The use case is RAM and flash: someone who wants, say,
FFT and filtering but can't afford the RAM to load the code at run time.

Mike's direction (2026-11-24):

- **Really local.** Built on the user's machine. No remote CI, no hosted service, no cloud.
- **A separate app**, for power users only. The main Thingstudio App and ThingStudio Web stay as they are.
- **No signing.** Images are never published or catalogued by us, so nothing goes through `catalogue_sign.py`.
- Mike: "I think I want it at least."

## Why curated matters

A menu of vetted components (not arbitrary user code) keeps the combinations sane, makes flash/RAM costs knowable up
front, and would still allow a hosted build later without running strangers' code (not planned; noted so the shape
doesn't foreclose it).

## Candidate menu items

- **C modules**: ulab (numpy-like, FFT and filters; the obvious headline; check it builds for each target at the
  pinned MicroPython/IDF), display drivers, possibly LVGL bindings (large).
- **Frozen Python**: Thingstudio node libraries (GUI, BLE, MQTT), vendored drivers, the user's own libraries
  (from the user-libraries note, piece A's folder).
- **Removals**: drop BLE or other subsystems to recover RAM.

Lesson from the chat: Peter Hinch's FFT/filters were a bad example. They're inline ARM Thumb assembler (the FFT
needs an FPU), so they can't run on ESP32/C3/C5 at all; possibly the RP2350. Also, freezing saves code RAM, not
data RAM: FFT buffers cost the same either way.

## Shape

1. **A menu file per target**: each component, its source, flash and RAM cost, what it requires and what it clashes
   with. The builder reads it to build; the editor reads the same data to know what an image has frozen, so Deploy
   sends nothing already there (as `gen_deps_index.mjs` does for our images). A new user-facing format, so probably
   a short spec in `interfaces/` with a conformance test.
2. **The builder**: a CLI first, e.g. `thingstudio-build --target esp32-c3 --select ulab,gui`. Wraps `build.sh`,
   stages the selection, indexes it, names the image `user-<target>-<runtime>-<hash>.bin` (never `thingstudio-…`,
   so it can't be recorded, published or catalogued; same rule as the user-libraries note). A GUI picker with a
   flash budget can come later if it earns it.
3. **Toolchain fetched on first use**, pinned, into `~/.thingstudio/toolchains/`, as PlatformIO and the Arduino IDE
   do. ESP-IDF + Xtensa/RISC-V compilers is roughly a couple of GB (estimate); RP2 is far lighter. Docker as an
   optional alternative, not a requirement. Windows native ESP-IDF is the hard platform.
4. **Version lock-step**: builder version X builds runtime X, so an image never disagrees with the editor deploying
   to it.
5. **Flashing unchanged**: "Or use your own image file" in the App, or a local file in "Set up a board" on Web.

## Testing policy (the hard part)

Every combination can't be hardware-tested. Likely: components tested individually; a user's combination is
"built, not tested". Our own `thingstudio-…` images keep the release gate.

## Later, maybe

- A custom node package declares "needs ulab"; the editor says which image it needs.
- A hosted build for Web users, only if people ask. Same container and menu, so local and hosted give identical
  images for the same selection. CI minutes (Mike's cap ~3000/month) would need caching or a self-hosted runner.

## Open questions

1. First menu: which components, and which targets first?
2. Toolchain: fetch on demand (smoother, more work) or Docker (cheap, heavier for users)?
3. Does the user-libraries note's piece B fold into this, or ship first as the simple case?
4. Menu file spec in `interfaces/`: yes?
5. Name for the separate app/CLI.
