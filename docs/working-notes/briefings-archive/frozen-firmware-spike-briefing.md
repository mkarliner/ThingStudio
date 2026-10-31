# Frozen firmware spike -- briefing

Written 2026-10-08 with Mike. Context: `mikes-questions-and-points.md` (the "spike" bullet),
`decisions/gui-layout.md` (2026-10-06, no custom firmware for MVP), `gui-layout-widget-system-scoping.md`
("Pure Python vs. C", "Memory and the Pico"), `learnings/micropython-device-runtime.md` (2026-10-07 memory entries).

## Why now

Mike's hardware experience since the 2026-10-06 decision:

- **Fragmentation on the CYD.** After the test display flow ran, loading `mqtt_basic` was erratic. Free bytes in
  total were not the problem; a block big enough for the import was.
- **Stock ESP32s are close to full** with one simple `mqtt_as` flow.
- **Fonts** are RAM-resident when imported from the filesystem. Peter Hinch's
  [micropython-font-to-py](https://github.com/peterhinch/micropython-font-to-py) generates Python modules and,
  as far as we remember, documents freezing them as bytecode so glyph data stays in flash. **Verify in its README.**

The 2026-10-06 rejection was for install-route and board-coverage cost, not performance. This spike puts a number
on the other side of that trade. It does not reverse the decision; it decides whether an optional tier is worth it.

## Question

How much heap, and how much fragmentation, does freezing `mqtt_as`, the runtime and the fonts buy on the boards
we test, compared with precompiled `.mpy` files on stock firmware?

Hybrid idea to check, not assume: a frozen module should be overridable by a copy on the filesystem, so a board
with a custom build still accepts pushed libraries and stock firmware stays the default route. Believed from
MicroPython's default `sys.path` (`''`, `.frozen`, `/lib`) -- confirm on a unix-port build before relying on it.

## Measurements

MicroPython's `gc` has `mem_free()` and `mem_alloc()` but **no largest-free-block call**. Use either:

- `micropython.mem_info()`, which prints `max free sz` in 16-byte blocks (the figure behind the 2026-10-07 learning),
  or
- bisect with `bytearray(n)` inside try/except `MemoryError`, then `gc.collect()`.

On ESP32 also record `esp32.idf_heap_info(esp32.HEAP_DATA)`: free and largest block. WiFi draws from that heap.

At each stage record **free**, **largest free block**, and (ESP32) **IDF free / largest**:

| Stage | What |
|---|---|
| S0 | Fresh boot, nothing imported |
| S1 | Runtime + listener up, as the editor leaves it |
| S2 | After `import mqtt_as` |
| S3 | MQTT flow deployed, WiFi + broker connected |
| S4 | Display flow (gs4, CYD) deployed and running |
| S5 | Then the MQTT flow again, repeated 5 times, **hard reset between runs and without** |

S4 then S5 is the CYD case. Record whether the load fails, and at which stage.

## Builds to compare (same boards, same flows)

- **Stock:** current firmware, runtime 7.0.0 installed precompiled (today's route). This is the baseline.
- **Frozen A:** `mqtt_as` only.
- **Frozen B:** runtime + listener + `mqtt_as` + display drivers.
- **Frozen C:** B plus the prebuilt font set (`gui-font-pipeline-scoping.md`).

Build with a user manifest: `make BOARD=<board> FROZEN_MANIFEST=<path>/manifest.py` with `freeze()` lines for our
modules. Do it in a scratch directory, never on the shared mount (Linux binaries; see CLAUDE.md on the sandbox).
Boards: CYD (classic ESP32, no PSRAM), ESP32-C3, Pico W. Unix port first for the `sys.path` and override checks.

## Also try, because they might make the build unnecessary

Cheap mitigations on stock firmware, measured against the same stages:

- Import the large modules at boot, before WiFi starts and before any flow allocates.
- `gc.collect()` before each import and before a flow's buffers are allocated.
- Allocate the display framebuffer once, early, and keep it.

If these fix the CYD case, say so. They don't help the "stock ESP32 is full" case, which only frozen code or less
code addresses.

## Decision criteria

- Saving under ~15 KB of heap and no fragmentation benefit: stock route stays, close the spike.
- Fragmentation case fixed by freezing but not by the mitigations, or fonts dominate the saving: write up an
  optional "Thingstudio firmware" tier (supported boards only, stock route unchanged) as a post-MVP item, with
  the cost per board and what happens to runtime updates (reflash vs push; version-bump rules in CLAUDE.md).
- Override check fails (frozen copy can't be replaced by a pushed one): freezing then forces reflash for every
  runtime change. Treat that as a strong argument against, and say so.

## Out of scope

Shipping builds, OTA, an install page, CI for firmware, any board beyond the three above.

## Branch and git

Own branch, like the nano-gui spike. Git writes are Mike's, in a real Terminal, with `rm -f .git/index.lock` first
(CLAUDE.md, "Git writes from the agent sandbox").

```sh
rm -f .git/index.lock
git switch -c spike/frozen-firmware
```

## Findings

### Desk half, 2026-10-08 (unix port; scripts in `pocs/frozen-firmware-spike/`)

- **`mqtt_as` as `.mpy`: 11,359 bytes** (37,235 as source), mpy-cross from MicroPython master 2026-10-02.
- **Heap kept per import, frozen vs `.mpy` from the filesystem** (unix port, 64-bit, so absolute numbers are
  roughly twice an ESP32's; the ratio is the point). `gc.mem_alloc()` after `gc.collect()`, before and after:

  | Module | `.mpy` file | frozen |
  |---|---|---|
  | `mqtt_as` | 26,720 | 9,728 |
  | `thingstudio_gui` | 10,816 | 3,616 |
  | `tsgui_readout` | 2,048 | 512 |
  | `font_body16` | 9,024 | 896 |
  | `font_digits48` | 5,600 | 736 |
  | `font_digits64` | 8,896 | 768 |
  | **total** | **63,104** | **16,256** |

  About **75% less heap** overall; fonts almost all of theirs (the glyph `bytes` stay in flash). Frozen code also
  needs no large contiguous block at import time, which is the CYD fragmentation failure.
- **Override: works, and it's ours to choose.** Default unix `sys.path` is `['', '.frozen', ...]`; ESP32's is
  `['', '.frozen', '/lib']`. With `/lib` *after* `.frozen` (what `deps.ensure_on_path()` does today, appending)
  the frozen copy wins; with `/lib` inserted before `.frozen` a pushed copy wins. So a custom build can keep
  accepting pushed libraries: put `/lib` first, report frozen modules and their hashes in HELLO, and have Deploy
  skip sending a library the firmware already has at the same hash. Then a runtime or library update never
  forces a reflash; it just overrides until the next firmware.
- **ROMFS, the alternative the font_to_py docs point to.** MicroPython 1.25+ can mount a read-only filesystem in
  flash (`mpremote romfs deploy`); `.mpy` files there run in place, so the RAM benefit matches freezing *without
  rebuilding firmware for each change*. But it's **off in stock builds** for our boards: `MICROPY_VFS_ROM`
  defaults to 0, rp2's `MICROPY_HW_ROMFS_BYTES` is 0, and ESP32_GENERIC uses a partition table without a romfs
  partition (`partitions-4MiB-romfs.csv` exists in the tree, no stock board uses it). So it still needs one custom
  firmware per board, but only **once**: a stock build plus ROMFS, after which runtime, libraries and fonts are
  pushed into ROMFS like files. Worth measuring alongside Frozen A-C.
- **Not done here: ESP32 / RP2 firmware builds.** This sandbox can't reach Espressif's download servers (the
  ESP-IDF toolchains), so those builds need Mike's Mac with ESP-IDF, or a GitHub Actions job using Espressif's
  `espressif/idf` image (a workflow file: Mike applies it, per CLAUDE.md). The board stages S0-S5 are Mike's.

**Verdict so far:** the heap saving is well past the ~15 KB threshold above, so the board stages are worth
running. The ROMFS route should be built and measured first, because it keeps updates as cheap as today.

### Closed, 2026-10-08 (Mike's call)

The spike has met its goals; the board stages (S0-S5) and the Frozen A-C and ROMFS firmware builds are **not**
run, and aren't needed to decide. What it established:

- Freezing saves about 75% of the heap those modules use (unix port only, no device build yet), and a pushed
  copy can override a frozen one if `/lib` is put before `.frozen` on `sys.path`. So an optional firmware
  tier is feasible without making every runtime change a reflash.
- Most of the CYD's trouble was the display, not the libraries: a 38,400-byte frame and a 9 KB message that
  couldn't be allocated. Drawing in ~5 KB strips (banded rendering, runtime 9.2.0 era) removed the frame.
- Boards with PSRAM don't need it. The Freenove ESP32-S3 Display shows 7,888 KB free with the octal-PSRAM
  firmware (121 KB with the wrong one).
- What's left is the classic ESP32 without PSRAM, the C3 and the Pico, where fonts and `mqtt_as` dominate.

**Outcome:** frozen/custom firmware stays deferred as an optional, supported-boards-only tier. Tracked as the
`outstanding-items.md`. Note: libraries already go to the board as precompiled `.mpy` (Deploy compiles them
with mpy-cross before DEP_PUT), so the stock baseline is `.mpy`, and the 75% is saved over that. A cheaper stock
idea, not built: keep font glyph data out of the heap (read from a flash file on demand) instead of importing
it, since fonts dominate the saving.
