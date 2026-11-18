# Editor firmware flashing

Status: decision. Mike, 2026-10-24: **flashing a board from blank inside the editor comes first**, ahead of the
grid editor and the launch backlog. Detail and phasing: `../editor-firmware-flashing-scoping.md`.

## The decisions

- **The backend flashes, not the browser.** It owns the serial port in "via backend" mode, has pyserial, and
  already installs the runtime. It runs `esptool` as a subprocess with a fixed argv. No browser flasher, no new
  npm dependency; direct-WebSerial mode does not offer the action.
- **Two blank states, one flow**: no MicroPython (ESP32 ROM bootloader), or MicroPython with no runtime
  (nothing answers `HELLO`). Detect the chip, flash an image, install the runtime when the image has none.
- **Images are pinned data with a local-file escape hatch.** *(Superseded 2026-10-25 by
  `firmware-catalogue.md`: images live in the catalogue, `firmware/builds.json`, keyed by chip family; a board
  only names a build. The pin, the cache in `~/.thingstudio/firmware/`, the sha256 check and the local file all
  stay.)* The first cut put a `firmware` block on each board definition (tool, chip, baud, URL, sha256, offset,
  whether the runtime is included).
- **First slice: classic ESP32 (CYD) and ESP32-S3 (Freenove).** The CYD uses Thingstudio's own image (runtime
  included); the S3 uses stock MicroPython, then the runtime install as the same flow's second step.
- **The fault rules apply**: one deterministic path, one reset per step, no retry or repair chain, each failure
  naming the step, the figures and the next action; nothing is erased before the warning is confirmed.
- **Runtime-only** is offered for a board already running MicroPython (Mike, 2026-10-24).
- **An unknown chip is refused**, not mapped to a nearby board: the message points at
  <https://micropython.org/download/> and the user flashes the downloaded file with **Choose a file…**.
- **Tool-neutral by design**: the `firmware` block names a tool (`esptool` first; `uf2` and `dfu` planned) and
  the chip/family. ESP32 spans Xtensa (classic/S2/S3) and RISC-V (C3/C6/H2/P4); RP2040/RP2350 and STM32 follow
  with their own tool entries, without changing the board schema or the editor dialog.
- Not in the first slice: RP2040/RP2350 UF2 (BOOTSEL volume), STM32 DFU, auto-flashing an unknown chip.

## Interface impact

The board descriptor gains an optional `firmware` block (`interfaces/board-descriptor/SPEC.md` and
`{board,processor}.schema.json`, with its conformance test). The backend gains firmware endpoints on its admin
API (`detect`, `flash` job, job status). `esptool` becomes a hash-pinned backend requirement and a line in
`docs/third-party-licenses.md`.

## 2026-11-18 — The browser flashes too (Mike)

Reverses "the backend flashes, not the browser" and "no new npm dependency" for the online build. The install page
(`editor/setup.html`, served at web.thingstudio.net/setup) writes ESP32 images with **esptool-js 0.7.1**
(Apache-2.0, Espressif; pinned, installed with scripts off, in `docs/third-party-licenses.md`) and gives UF2 boards their file to drag. Same catalogue, same rules:
the chip family owns the address, erase before writing, one path, every failure named. The chip is read from the
bootloader, which is the catalogue decision's "ask the tool what it already knows". The installed editor keeps its
backend flasher; whether its Tools → Install firmware should open the install page instead is Mike's call (he found
the install page better, 2026-11-18). Plan: `online-editor-webserial-briefing.md`, sections C and D.

2026-11-18, Mike: the page is "Set up a board", at **web.thingstudio.net/setup**, on the editor's own origin
(one CSP, one Permissions-Policy, no CORS for the firmware mirror). The file is `editor/setup.html`; its code
stays in `editor/src/install/`.
