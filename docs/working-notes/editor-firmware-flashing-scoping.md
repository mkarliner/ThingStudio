# Editor firmware flashing: scoping

Status: scoped 2026-10-24; **revised 2026-10-25** after Mike's point that this is not an ESP32 feature — it is
for every board that can run MicroPython. Phases 1–2 are built against the earlier shape and are being
refactored to match this note; nothing is committed yet. Phase 3 (the editor dialog) has not started.

## The two "blank" states

1. **No MicroPython**: a board sitting in a bootloader — ESP32 in ROM download mode, RP2040/RP2350 in BOOTSEL,
   STM32 in DFU, an nRF52 in its UF2 bootloader. Nothing on the serial line answers.
2. **MicroPython, no Thingstudio runtime**: the board runs a REPL but never sends `HELLO`, so the editor can
   connect but not deploy.

Two actions cover both: **install the runtime** (state 2, and the second step after flashing an image that has no
runtime) and **flash an image** (state 1). The runtime install is the existing path the editor already uses over
the WebSocket connection; the firmware work never reimplements it.

## The rule that shapes everything

**The generic path is the main path; board data is a shortcut, never a gate.** Any board MicroPython publishes an
image for must be reachable without us adding a board definition: the user says how the board is connected,
picks the image MicroPython publishes for it, and the tool follows from the transport. A board definition only
pre-fills that dialog for a board we know.

Corollaries, all decided 2026-10-25:

- **The transport is asked, not inferred.** The user chooses serial port / mounted drive / DFU device; the
  backend lists the concrete targets for that choice. No probing of ports nobody selected, no guessing a board
  from a volume label. Auto-detect is a named later step, not an assumption — and it will not change the API,
  because a target already carries its kind.
- **Tools live in the core backend; boards are data.** A third party adds a board by naming a tool, not by
  supplying an `argv` — running package-provided commands is exactly what the project's postures rule out.
  Adding a tool is a core change and an interface change, deliberately.
- **Board RAM, install-time cost and drift** are not concerns here; this is a host-side action.

## First slice, and what follows

- **Tools in the first slice: `esptool`** (ESP32 family: classic, S2, S3, C3, C6, …; also ESP8266) **and `uf2`**
  (RP2040/RP2350 and nRF52 boards whose bootloader mounts as a drive). Together these cover 9 of the 10 board
  definitions in the repo — five ESP32s, Pico, Pico W, Pico 2, XIAO nRF52840.
- **Eight of the ten board definitions carry a recipe** (2026-10-25): the Freenove S3 and the stock-ESP32
  boards (Wemos D1 R32 at 0x1000, LOLIN S2 Mini at 0x1000, LuatOS C3 at 0) over `esptool`, and Pico, Pico W,
  Pico 2 and XIAO nRF52840 over `uf2`. Every image is MicroPython v1.29.0 from micropython.org, downloaded and
  hash-checked. The two left: the **CYD**, whose own image needs the runtime-install split (below) and a new
  release to point at, and the **pyboard**, which waits for `dfu`.
- **The CYD's image was not self-sufficient** — no `/main.py`, and its library inventory was not on the board —
  so its block was withdrawn on 2026-10-25 rather than shipped as a trap. The fix landed on the runtime-install
  side, not the board block: **Install runtime…** writes the boot script always, the runtime core only when the
  board is not a custom image (recognised by its frozen `deps_frozen` module), and the inventory is frozen into
  the image. No new board-descriptor key; the CYD's block returns with the next release's image.
  `outstanding-items/firmware-custom-image-boot-files.md`.
- **`dfu` comes after** (STM32/pyboard: `dfu-util -a 0 -D`), as one more entry in the same registry and one more
  board file. Deferred by Mike, 2026-10-25.
- **Out of scope for now**: RP2040/RP2350 through a non-UF2 bootloader, boards that need SWD/ST-Link, vendor-locked
  boards, and auto-detection. Those get a refusal that names the limit and points at
  <https://micropython.org/download/> and the vendor's own instructions — the "expect unsupported boards anyway"
  rule applied to a host action.

## Board definition addition

The board descriptor grows one optional block. It is data, so a third-party board can carry one; it is
tool-shaped, so a new tool does not add a top-level key to every board file.

```json
"firmware": {
  "tool": "esptool",
  "transport": "serial",
  "image": {
    "url": "https://github.com/mkarliner/ThingStudio/releases/download/v0.7.2/thingstudio-classic-esp32-14.0.1-7e7c73b.bin",
    "sha256": "5acd9580170b172551f91310605465379d644689670b1f33d89e4e3724f7afc4"
  },
  "runtime": "none",
  "flash": { "chip": "esp32", "baud": 460800, "offset": 0 }
}
```

```json
"firmware": {
  "tool": "uf2",
  "transport": "volume",
  "image": { "url": "https://micropython.org/resources/firmware/RPI_PICO2-20260824-v1.29.0.uf2",
             "sha256": "…" },
  "runtime": "install",
  "flash": {}
}
```

- `tool`, `transport`, `image {url, sha256}`, `runtime` mean the same thing for every tool.
  `image`'s format is not stored: the tool implies it (`.bin` for `esptool`, `.uf2` for `uf2`), so a mismatched
  file is refused by name at flash time instead of being described twice.
- `flash` is the tool's own vocabulary: `chip`, `baud`, `offset` for `esptool`; nothing for `uf2` (the volume
  comes from the target the user picked). A key the tool does not know is refused by name.
- `runtime: "install"` means the image has no Thingstudio runtime, so the editor runs the normal install after
  flashing. It is a hint to the editor, not a second backend job.
- The image is a **default, not a lock**: **Choose a file…** overrides it. A hash is checked when the block names
  one; a local file with no hash is flashed as given (after one confirmation line saying so).

## Backend API

Four endpoints on the existing admin API (Host-allowlisted, local only), all with a fixed argv and no shell:

- `GET /api/firmware/boards` — the board definitions' firmware blocks and which images are cached.
- `GET /api/firmware/targets?transport=serial|volume` — **enumeration only**: the serial ports pyserial sees,
  or the mounted volumes the backend can find (`/Volumes` on macOS, `/media` and `/run/media` on Linux, drive
  letters on Windows). It never probes or identifies anything.
- `POST /api/firmware/flash` — `{target: {kind, value}, board?, imagePath?}` starts a job and returns `{id}`.
  `board` uses that board's recipe; `imagePath` alone is the generic path; both may be given, and the board
  supplies the hash the file is checked against. A target whose kind does not match the tool's transport is
  refused before anything runs.
- `GET /api/firmware/jobs/{id}` — `{state: running|done|failed, step, line, progress, error}`. The editor polls
  at ~250 ms; no new WebSocket protocol.

The backend downloads the image before the flash starts (cache in `~/.thingstudio/firmware/<sha256>.<ext>`), so
the flash step itself is local and repeatable. `esptool` is hash-pinned in `backend/requirements.txt` and listed
in `docs/third-party-licenses.md`; it is GPL-2.0-or-later, invoked as a subprocess and never imported.

## Editor flow

Tools → **Install firmware…**:

1. **Where is the board?** Three choices, each with one line of instruction — *serial port* (ESP32 download mode,
   or a board already running MicroPython), *mounted drive* (hold BOOTSEL while plugging in), *DFU device*
   (planned). Plus **install the runtime only** for a board that answers as MicroPython.
2. Pick the concrete target from the list the backend returns; a typed path is always allowed for a volume.
3. Pick the image: the detected board's pinned image, or **Choose a file…** with a link to
   <https://micropython.org/download/>. Show the version and where it came from (cached/local).
4. **Warn that flashing erases flows, settings and WiFi credentials**, once, before anything is written.
5. Flash, with one progress line (percentage and the current step). One reset per step; a board that
   re-enumerates (CH340) is reported, not quietly re-opened in a retry chain.
6. If the image has no runtime, run the existing install, then connect.

## Failure rules (the project's, applied here)

- One deterministic path: choose target → choose image → download → flash → (install runtime) → connect. No retry
  chains, no "try a smaller image" repairs; a failure stops the flow and says so once.
- Every failure names the step, the figure (target, chip, bytes, `host:port`, the file) and the one next step.
  A hash mismatch, an unknown tool, a mismatched transport, or a target that vanishes refuses; nothing is
  repaired on the user's behalf.
- Nothing is erased until the user has confirmed the warning.

## Phases

1. **Backend** — target enumeration, the tool registry (`esptool`, `uf2`), jobs, image download/cache/verify,
   tests with a fake esptool and a temp volume. Built once, now being refactored to the target/tool shape above.
2. **Board data** — descriptor spec/schema built; eight boards carry a recipe (ESPT INT32 stock images for the
   S3/S2/C3/classic, UF2 for the four RP2/nRF boards). Left: the CYD (next release's image) and the pyboard
   (`dfu`).
3. **Editor** — the Install firmware… dialog and job polling.
4. **Hardware** — blank S3 (stock MicroPython + runtime) and a Pico 2 (UF2), each end to end, then the CYD once
   its boot files are written; record the exact sequence and failure lines in the brief.
5. **Docs** — the install page section and a debugging entry for each refusal (written 2026-10-25;
   `custom-firmware.md` still describes the manual install, which is what works for that image).

## Answers and decisions

**Mike, 2026-10-24**

- **Runtime only**: yes. A board already running MicroPython gets the "install runtime only" action; the same
  dialog offers it.
- **Unknown chip**: refuse. The message says the editor has no firmware for this chip and points at
  <https://micropython.org/download/> — download the right build for the chip, then use **Choose a file…**. No
  guessing a nearby board.
- **Port naming**: verify with esptool on the CYD and the Mac (the backend already normalises `/dev/cu.*` and
  `COM7` for pyserial; esptool is given the same string).

**Mike, 2026-10-25**

- **This is for all boards that can run MicroPython**, not an ESP32 feature. Hence the generic-path-first rule
  above, `uf2` in the first slice, and board definitions as shortcuts.
- **Do not build auto-detect for the first cut.** Ask the user which transport to use; keep detection open as a
  later step.
- **The `firmware` block is tool-shaped** (`tool` + `transport` + `image` + `runtime` + `flash`), so a new tool
  does not mean a new top-level key in every board file.
- **`dfu` after** `esptool` and `uf2`.
