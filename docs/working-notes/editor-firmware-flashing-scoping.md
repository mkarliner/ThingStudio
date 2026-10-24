# Editor firmware flashing: scoping

Status: scoped 2026-10-24. Mike's call: **flashing a blank board from the editor comes first**, ahead of the
grid editor and the launch list. This note is the plan; nothing is built.

## The two "blank" states

1. **No MicroPython**: an ESP32 in its ROM bootloader, an RP2040 in BOOTSEL, an STM32 in DFU. Nothing on the
   serial line answers.
2. **MicroPython, no Thingstudio runtime**: the board runs a REPL but never sends `HELLO`, so the editor can
   connect but not deploy.

One flow covers both: detect the chip, flash a firmware image, then (when the image has no runtime) install the
runtime.

## Decisions

- **First slice: classic ESP32 (CYD) and Espressif ESP32-S3 (Freenove).** The CYD flashes Thingstudio's own
  image, which already contains the runtime; the S3 flashes stock MicroPython, then the runtime.
- **Runs in the backend, not the browser.** The backend already owns the serial port in "via backend" mode,
  has pyserial, and already installs the runtime (`runtime_installer.py`). It invokes `esptool` as a
  subprocess. No browser-side flasher, no new npm dependency; direct-WebSerial mode does not offer the action.
- **Images are pinned data, with a local-file escape hatch.** A board definition carries a `firmware` block:
  tool, chip, baud, the image's URL + sha256, its flash offset, and whether the image includes the runtime. The
  backend downloads a missing image into `~/.thingstudio/firmware/`, verifies the sha256, and refuses on a
  mismatch. The user can point at a local image instead (same hash check when the block names one).
- **Runtime install is the same flow's second step**, reported separately.
- **Out of scope for this slice**: RP2040/RP2350 UF2 (BOOTSEL volume), STM32 DFU, auto-flashing an unknown
  chip, and bundling every board's image in the installer.

## Board definition addition

The board-descriptor interface grows one optional block (spec + schema updated with Mike's permission; this
note is the request). It is data, so a third party can add a board without a core change:

```json
"firmware": {
  "tool": "esptool",
  "chip": "esp32",
  "baud": 460800,
  "image": {
    "url": "https://github.com/mkarliner/ThingStudio/releases/download/v0.7.2/thingstudio-classic-esp32-14.0.1-7e7c73b.bin",
    "sha256": "5acd9580170b172551f91310605465379d644689670b1f33d89e4e3724f7afc4",
    "offset": 0
  },
  "runtime": "none"
}
```

For the Freenove S3, `image` points at the pinned MicroPython `.bin` (its URL carries the release; its sha256
pins the bytes) and `runtime` is `"install"`. The image is a *default*, not a lock: a local file overrides it.

## Backend API

Three endpoints on the existing admin API (Host-allowlisted, local only), all with a fixed argv and no shell:

- `GET /api/firmware` — the board definitions' firmware blocks, and which images are cached.
- `POST /api/firmware/detect` `{port}` — runs `esptool ... flash_id`, returns `{chip, mac, description}` or a
  named failure (no port, no bootloader, timeout).
- `POST /api/firmware/flash` `{port, board}` or `{port, imagePath}` — starts a job; returns `{id}`.
- `GET /api/firmware/jobs/{id}` — `{state: running|done|failed, line, progress, error}`. The editor polls at
  ~250 ms; no new WebSocket protocol.

The backend downloads the image before starting the flash, so the flash step itself is local and repeatable.
`esptool` must be hash-pinned in `backend/requirements.txt` and added to `docs/third-party-licenses.md`.

## Editor flow

Tools → **Install firmware…**:

1. Pick a port (the existing port list; a board that doesn't answer `HELLO` is the trigger).
2. Detect the chip; match it to the board definitions that carry a `firmware` block, or let the user pick.
3. Show the board, the image's version and source (downloaded/cached/local), and **warn that flashing erases
   flows, settings and WiFi credentials**.
4. Flash with one progress line (percentage and the current step). One reset per step; the CH340 may
   re-enumerate — the backend reopens the port rather than failing the whole flash for that.
5. If the image has no runtime, run the existing runtime install as step two, then connect.

## Failure rules (the project's, applied here)

- One deterministic path: detect → download → flash → (install runtime) → connect. No retry chains, no
  "try a smaller image" repairs; a failure stops the flow and says so once.
- Every failure names the step, the figure (chip, bytes written, `host:port`), and the one next step. A hash
  mismatch, an unknown chip, or a port that never opens refuses; a slow write warns and continues.
- Nothing is erased until the user has confirmed the warning.

## Phases

1. **Backend**: esptool pinned, detect + flash jobs, image download/cache/verify, tests with a fake esptool.
2. **Board data**: `firmware` blocks for the CYD and Freenove S3; descriptor spec/schema and conformance test.
3. **Editor**: the Install firmware… dialog and job polling.
4. **Hardware**: blank CYD (our image) and blank S3 (stock + runtime), each end to end; record the exact
   sequence and failure lines in the brief.
5. **Docs**: an install page update and a debugging entry for each refusal.

## Answers to the open questions (Mike, 2026-10-24)

- **Runtime only**: yes. A board already running MicroPython gets the "install runtime only" action; the
  same dialog offers it.
- **Unknown chip**: refuse. The message says the editor has no firmware for this chip and points at
  <https://micropython.org/download/> — download the right build for the chip, then use **Choose a file…** to
  flash it from disk. No guessing a nearby board.
- **Port naming**: verify with esptool on the CYD and the Mac (the backend already normalises `/dev/cu.*` and
  `COM7` for pyserial; esptool is given the same string).

## Not just ESP32

The `firmware` block is **tool-neutral** and the job API knows only "run this board's tool". ESP32 is two
architectures (Xtensa: classic, S2, S3; RISC-V: C3, C6, H2, P4), and the same design must take RP2040/RP2350
(BOOTSEL + `.uf2` copy, no esptool), STM32 (DFU), and whatever comes later. Concretely:

- `tool` is an open string with a backend registry: `"esptool"` now; `"uf2"` and `"dfu"` are the planned
  entries, added without changing the board schema or the editor dialog.
- The block names the architecture/family (`chip` for esptool, a volume/pattern for UF2, a DFU id for STM32),
  so a board with no matching firmware is refused by name rather than mis-flashed.
- The editor only ever shows "flash this board's image, then install the runtime if needed"; tool choice and
  command line stay in the backend.
