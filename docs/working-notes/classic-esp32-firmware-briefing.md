# Custom firmware for classic ESP32 — briefing

Written 2026-10-22 (revised the same day, from "CYD only" to classic ESP32 generally), after the
**CYD gate failure**: on a fresh runtime install, deploying the hero GUI flow hit `MemoryError
allocating 13317 bytes` and never ACKed (`decisions/gui-layout.md`, 2026-10-09 gate / 2026-10-22
result). Per the gate, the MVP ships a small set of custom images — this one is the classic-ESP32
image, and it is the whole set for that chip. Read
`frozen-firmware-spike-briefing.md` first for the technical basis; the decision record for what was
settled here is `decisions/classic-esp32-firmware.md`.

## Goal

A **supported-boards-only optional tier**: a prebuilt MicroPython image for **classic ESP32** with
Thingstudio's runtime, libraries and fonts frozen in, so those boards can run the GUI hero flow
without the heap/fragmentation failure. Stock firmware stays the default; the image is an opt-in
download.

One image covers every classic ESP32 board, not just one: pins and panel come from the board
descriptor in the editor, so the image carries no board-specific setup. The CYD is the board it is
proven on, not the only board it is for.

## Decisions settled 2026-10-22 (Mike)

1. **Target is classic ESP32** (Xtensa LX6, 4 MB, no PSRAM) — the `esp32` processor descriptor, not
   a board. CYD first verified; the WeMos D1-R32 is the same chip and needs nothing extra. S2/S3/C3
   stay out (different silicon, partitions or PSRAM), and so do the RP2040/RP2350 boards.
2. **Genuinely generic image** — no CYD pins, no panel init baked into firmware.
3. **Freeze the display/touch drivers too** (`st7789py`, `st7796py`, `ft6336u`) even though a
   headless board never imports them: they cost flash in a 3 MB slot, not heap.
4. **Optional, stock default** — but the failure must stay legible: when a Deploy ends without an
   ACK on a classic-ESP32 board, the console should point at the image rather than just time out.
5. **Docs + `esptool` for installing** — no editor flashing in v1. The backend owns the serial port;
   speaking the ROM bootloader protocol is a new subsystem with brick risk, and a half-right flasher
   is worse than a documented command. The same merged image can serve an editor flow later.
6. **No `HELLO` change** for the frozen set. `runtimeVersion` already gates Deploy, and the override
   property plus a shipped `/lib/_deps.json` do the rest (see below). Reporting frozen modules and
   hashes in `HELLO` would be an interface change with no diagnostic the version gate doesn't give.
7. **Checksums plus rebuildability** — publish SHA-256, and the build script, workflow and exact
   MicroPython/ESP-IDF versions, so anyone can rebuild the image. Signed firmware is deferred; the
   trigger to revisit is the first OTA-capable release, where delivery over the air raises the stakes.
8. **Single-app flash layout, merged image** — 3 MB app slot, 960 KB filesystem, no OTA slot. Dual
   OTA gives 1.5 MB per slot on 4 MB (MicroPython's own OTA table), which the frozen set is expected
   to exceed. Re-partitioning later costs one USB reflash, which is already the install path.

## What is already known (from the frozen-firmware spike)

- **Freezing saves about 75% of the heap those modules would use** (unix-port measurement; the CYD's
  problem is exactly the contiguous-block failure at import). Modules measured: `mqtt_as`,
  `thingstudio_gui`, GUI widget modules, fonts.
- **A pushed library can override a frozen one** if `/lib` comes before `.frozen` on `sys.path`
  (unix and ESP32 defaults put `.frozen` first). `deps.ensure_on_path()` appended and is changed to
  insert at position 0 under this brief, with a test — that is the property that keeps runtime and
  library updates cheap: the image still accepts pushed updates, so a bump is a push, not a reflash.
- **ROMFS** would keep the update story even cheaper, but stock builds for our boards have
  `MICROPY_VFS_ROM` off and no romfs partition. It still needs one image per board, then files are
  pushed into ROMFS. Worth measuring, not v1.
- **The board stages and firmware builds were never run** in the spike (the sandbox could not reach
  Espressif's toolchains). Everything here is unproven on hardware except the stock CYD baseline.

## Why the frozen set is not shadowed by Deploy

Deploy pushes the libraries a flow imports into `/lib`. With `/lib` first on `sys.path`, a pushed
copy wins over a frozen one — which would throw away the whole saving for exactly the big libraries
(GUI, fonts, drivers) that matter. The board solves this itself, with no protocol change:

- The image's build writes `/lib/_deps.json` — the same inventory `DEP_PUT`/`DEP_COMMIT` maintain —
  listing every frozen library with the hash the **editor** computes for it (compiled with the
  vendored `mpy-cross` WASM, `dependencyHash()`'s exact scheme; `firmware/classic-esp32/
  gen_deps_index.mjs`). `HELLO.dependencies` reports it, so the editor's existing
  `librariesToSend()` skips those libraries.
- Entries carry an empty file list on purpose: the bytes are frozen code, not files, so
  `deps.missing()` must not look for them on disk.
- If a hash doesn't match (an editor whose `mpy-cross` version differs), nothing breaks: the editor
  pushes a real copy, which updates the index and wins on `sys.path`. The saving is lost for that
  flow, correctness is not. That failure mode is why this needs no version negotiation.

A frozen image also has no runtime build marker, so `HELLO.runtimeBuild` reports `null` — "can't
confirm", which is what the editor's own check already treats it as.

## Scope of the image

**Frozen set** — everything `runtime_manifest.py` lists, derived from that file rather than a second
copy of it (`stage.py`), so the image can never disagree with what a stock install would push:

1. `mqtt_as`, `threadsafe_event`, the event/delay primitives, `aadc`, `encoder`, `ts_wifi`, `ts_mqtt`,
   `ts_http_server` (runtime dependencies and library code flows import).
2. `thingstudio_gui` and the `tsgui_*` widget modules, plus every font in the set.
3. `st7789py`, `st7796py`, `ft6336u`, `ssd1306`, `bme280_float`.
4. The runtime core (`CORE_FILES`) and the listener, so the board boots straight into the listener
   and a Deploy only pushes the flow.

Do **not** freeze the flow or board settings; they stay on the filesystem and are wiped by a flash,
which the docs must say.

**Boot**: a frozen module cannot be the boot script, so the image's filesystem gets a three-line
`/main.py` that imports the frozen listener and calls `main()` (`firmware/classic-esp32/main.py`).

## Build and distribution

1. **Pin MicroPython** (`v1.28.0`, what the CYD reports) and the ESP-IDF container
   (`espressif/idf:v5.5.1`, the newest tag MicroPython v1.28.0 tests against);
   build from a tag, not master.
2. A custom board directory (`firmware/classic-esp32/board/`) on `BOARD=thingstudio_classic_esp32`:
   stock `sdkconfig.base` + BLE, 4 MB flash, size-optimised, our single-app partition table.
3. Build on a developer machine or `.github/workflows/firmware.yml`; the sandbox cannot build ESP32
   firmware. The artifact is a release asset, never a committed binary.
4. **`deps.ensure_on_path()` inserts `/lib` at position 0** before shipping, with a unix-port test
   for the order and a real-hardware check that a pushed library overrides the frozen copy.
5. **Package**: one merged `thingstudio-classic-esp32-<runtime>-<sha>.bin` (flash at 0x0, so the
   offsets can't be got wrong), SHA-256 beside it, plus `_deps.json`. No `curl | sh` route: the
   release page is the download, and `install.sh` is short enough to read first.
6. **Repo placement**: build inputs live in this repo. A separate firmware repo would need a
   submodule or a pinned copy of the runtime, and "the image is stale relative to the runtime" would
   become a silent failure mode — the frozen set *is* `runtime_manifest.py`. A separate repo earns
   its keep only at multiple image variants on their own release cadence, or key custody for signing.
7. **Docs**: a page naming the chip family, what is included, what a flash erases, how to flash from
   macOS/Linux/Windows, and how to go back to stock. Link it from the gate result. Written when the
   first image exists, not before.

## Verification

- ~~**Rerun the CYD gate on the custom image** (the acceptance): fresh flash, hero GUI flow ↔ a different flow, five
  cycles, no manual resets; it must pass where stock failed.~~ **Retired 2026-10-22 evening (Mike): "the 5 cycle gate
  can go, at least on small memory boards."** See `decisions/gui-layout.md`; what replaces it is a deploy over a
  *stopped* flow, plus the documented power-cycle path when even that cannot fit.
- **Memory**: the spike's S0-S5 table (free, largest block, IDF free/largest) on the custom image;
  compare with the stock failure. Record the numbers.
- **Deploy-skips-frozen**: after flashing, a GUI flow's console line should name the libraries as
  already on the board, not push them; `/lib` should stay empty for those.
- **Override**: a pushed library at a different hash must win over the frozen copy; a runtime update
  must deploy without reflashing.
- **Version discipline**: the image's runtime version must equal the editor's
  `EDITOR_TARGET_VERSION`; a mismatch must be the normal Deploy refusal, not a silent broken flow.
- **Panel variants**: only Mike's CYD is confirmed ST7789; an ILI9341 batch needs a different driver,
  which this image does not carry. Say so in the docs.

## First hardware state (2026-10-22)

Built with ESP-IDF v5.5.1 and MicroPython v1.28.0; 1.69 MB merged image, app inside the 3 MB slot.
Flashed to the CYD and booting: `LISTENER_READY`, `chipType "Thingstudio classic ESP32 (generic) with
ESP32"`, runtime 11.1.0, `HELLO` reporting all 34 frozen libraries in `dependencies` (so Deploy will
skip them) and `runtimeBuild` null as expected.

Idle, no flow:

| | custom image |
|---|---|
| free RAM (`gc.mem_free`) | 149,408 |
| free IDF heap | 140,088 |
| largest IDF heap block | 110,592 |
| free flash | 946,176 |

That is the S0 row. S1-S5 and the five-cycle gate still need the editor: deploy the hero GUI flow,
watch the console line for "already on the board" (that is the Deploy-skips-frozen path working) and
`/lib` staying empty, then flip between two flows five times without touching the board.

## Frozen runtime vs a pushed one (why "Install runtime" matters here)

The image's runtime is only what runs **as long as nobody installs the runtime over it**. An install
pushes `CORE_FILES` into the board's root, and root comes before `.frozen` on `sys.path`, so the pushed
copy wins — that is the intended update path (a runtime bump is a push, not a reflash), and it is also
why a board that has had an install no longer runs its frozen runtime. The frozen copy stays in flash
and is simply shadowed.

For a shipped image the two versions match, so nothing asks for an install and the frozen runtime is
what runs. During development they drift every time the runtime version is bumped — which is exactly
what happened on 2026-10-22: the image froze 11.1.0, the editor moved to 11.1.1 and then 11.2.x, and
each install put the new runtime in root. The board then reports a matching `runtimeBuild` (the pushed
copy carries the marker) and `HELLO` looks identical either way.

What this means for testing: "frozen image boots and runs a flow" and "the runtime can be updated
without reflashing" are two different checks, and a board that has had an install can only show the
second. Reflash before measuring the first.

## Deploying over a running flow: where this stands (2026-10-22, evening)

This is the open problem, written down rather than worked around further.

**The fact.** A classic ESP32 running a GUI flow cannot reliably accept another flow. The board has to receive the
new flow and then start it, and after a GUI flow has run the MicroPython heap (a split heap: `gc.mem_free()` sums
several regions) has no block big enough for either step. Measured: 116 KB free, a 9,538-byte allocation failed; then
chunked pieces transferred fine, and starting the flow failed allocating **376 bytes**.

**What was tried, in order** (each one a local answer to the previous error, which is the pattern to avoid):

1. free the running flow before the retry — freed RAM, not contiguity;
2. drop the flow module and the flow's library modules — 50 → 116 KB free, still no 10 KB block;
3. clear the flow and soft-restart the board, then deploy — worked sometimes, hid a board limit behind a restart;
4. send the flow in 1 KB pieces (`FLOW_PUT`/`FLOW_COMMIT`, runtime 11.3.0) — the *transfer* works, the *start* still
   fails on a fragmented heap.

Steps 1-3 were removed again. Step 4 stays: it is the right shape for the transfer and fixes a real class of failure.

**What "fail well" looks like here** — the sequence to design next session, not to patch in:

- **One deterministic deploy sequence.** Deploy = "stop the flow, free, receive, start", decided before anything is
  sent, on every board. Not "send, fail, recover". The board is in a named state at each step, and the editor knows
  which one before it starts.
- **A stop action that keeps the listener.** Today the choices are Remove flow… (deletes it) or Stop flow & open
  prompt (ends Thingstudio, needs a reset), so there is no way to say "stop the flow, stay connected, keep the saved
  flow". Deploy needs that state.
- **One warning about memory**, not a refusal: the editor says the flow may not fit (with the board's figure) and
  deploys anyway — the user may know the board better than the estimate does (Mike, 2026-10-22).
- ~~**Then re-test the five-cycle gate.**~~ **Retired 2026-10-22 evening** (Mike: "the 5 cycle gate can go, at least
  on small memory boards"). It asked for five deploys in one powered session with a display flow resident, which
  this hardware cannot do; chasing it is what produced the recovery chain. `decisions/gui-layout.md` records it.

Until the sequence exists, the user-facing answer is `Tools → Remove flow…`, **power cycle the board** (unplug and
replug the USB cable, or `Tools → Reset board (hard)`), then deploy (`docs/user-guide/debugging.md`). A soft restart
is not part of that answer: it keeps the same heap regions and returns no chip memory.

## Remaining risks


1. **Only the idle baseline is measured.** The image boots and reports a healthy heap, but the GUI
   flow has not run on it yet. If it still fails, the next lever is Deploy skipping fewer libraries
   than expected (a hash mismatch) rather than the frozen set being wrong.
2. **Image size vs the 3 MB slot** — 1.69 MB total today, so there is room; if it overflows later,
   drop fonts or `ssd1306`.
3. **`mpy-cross` drift** — the image's index hashes must match the editor's; a drift costs the
   saving, not correctness (see above), but it is worth a check in the docs' troubleshooting page.
4. **`runtimeBuild` is `null`** on these boards by construction; a user comparing build SHAs sees
   "can't confirm" rather than a mismatch.
5. **The install path is one machine deep.** `install.sh` works here, but a VM's USB bridge can drop
   the port between commands (`learnings/hardware-bringup-hil-rig.md`); a second machine should
   confirm it before the docs page is written.

## Suggested order

1. Measure the stop-first sequence on the CYD: stop a GUI flow, probe for the largest block, try the start. The
   numbers decide whether the sequence needs a power cycle in it. (The five-cycle gate that came before this step
   is retired, 2026-10-22.)
2. Build the first image (now scripted), flash it, measure S0-S5.
3. Then the packaging/flashing docs page and the release asset.
