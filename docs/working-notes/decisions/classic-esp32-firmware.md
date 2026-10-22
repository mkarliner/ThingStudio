# Classic ESP32 custom firmware image — decisions

Status: decision, 2026-10-22. Scope, reasoning and open work:
`../classic-esp32-firmware-briefing.md`. Technical basis: `../frozen-firmware-spike-briefing.md`
(2026-10-08). Trigger: the CYD gate failure the same day (`gui-layout.md`, 2026-10-09 gate /
2026-10-22 result) — the hero GUI flow hit `MemoryError allocating 13317 bytes` on stock MicroPython.

## The decision

The MVP ships **one optional custom firmware image for classic ESP32** (Xtensa LX6, 4 MB, no PSRAM),
distributed as a release asset alongside stock MicroPython, which stays the default install. It
replaces the earlier "CYD only" reading (2026-10-22, first draft of the briefing): pins and panel
come from the editor's board descriptor, so the image carries no board-specific setup and the CYD is
the board it is *verified* on, not the only board it is for.

S2/S3/C3 are out: different silicon or partitions, and the S3's PSRAM removes the need. RP2040/RP2350
are out for now; the same technique applies when a board needs it.

## What makes it work

- **Freeze everything `runtime_manifest.py` lists**, derived from that file (`firmware/classic-esp32/
  stage.py`), not a second list — the image cannot ship a different set from what a stock install
  pushes. Frozen bytecode runs from flash, so the GUI stack, drivers and fonts never need a
  contiguous heap block at import.
- **`/lib` ahead of `.frozen`**: `deps.ensure_on_path()` inserts `LIB_DIR` at position 0 (it appended
  before 2026-10-22). Without this, a pushed copy of a library would lose to the frozen one and a
  library update through Deploy would silently do nothing.
- **`/lib/_deps.json` ships with the image**, hashed the way the editor hashes (`dependencyHash()`,
  compiled with the vendored mpy-cross WASM). `HELLO.dependencies` then reports the frozen libraries,
  `librariesToSend()` skips them, and no protocol change is needed. A hash mismatch only costs the
  saving (the editor pushes a real copy, which wins) — the failure mode is degrade, not break.
- **No `HELLO` change.** `runtimeVersion` already gates Deploy. Reporting frozen modules and hashes
  was considered and dropped: the index above gives the editor everything it needs. `runtimeBuild`
  reports `null` on these boards ("can't confirm"), which the editor's own check already handles.
- **Single-app partition table, merged image**: 3 MB app + 960 KB filesystem. Dual OTA on 4 MB gives
  1.5 MB per slot (MicroPython's own table) and the frozen set is expected to exceed that. Moving to
  OTA later costs one USB reflash, which is already the install path — the one-way door is cheap here.

## Install and integrity

`esptool write_flash 0x0 <merged.bin>`, then two `mpremote fs cp` lines for `/main.py` (a frozen
module cannot be the boot script) and `/lib/_deps.json`; `firmware/classic-esp32/install.sh` is those
three commands and is meant to be readable. No editor flashing in v1: the backend owns the serial
port, and the ROM bootloader protocol is a new subsystem where a half-right implementation bricks
boards.

Integrity is SHA-256 per artifact **plus** a rebuildable image — published build script, workflow and
pinned MicroPython/ESP-IDF versions. A checksum detects corruption, not tampering; the docs say so.
Signed firmware is deferred to the first OTA-capable release, where delivery over the air raises the
stakes; that is the named trigger, not an implicit "later".

## Repository placement

Build inputs live in this repo (`firmware/classic-esp32/`: stage script, manifest, board directory,
partition table, build/install scripts, CI workflow). Artifacts are release assets, never committed.

A separate firmware repo was considered and rejected: the frozen set *is* `runtime_manifest.py` plus
the vendored libraries, so a second repo needs a submodule or a pinned copy, and "image stale
relative to the runtime" becomes a silent failure mode. `runtimeBuild` stamping and the
`_RUNTIME_VERSION` ↔ `EDITOR_TARGET_VERSION` pairing also only work in one repo, and the
third-party-license ledger stays single.

Trigger to revisit: several image variants on their own release cadence, or signing/OTA
infrastructure with its own key custody and access controls.

## Version

`deps.ensure_on_path()`'s order change is 11.1.0 (minor): it is a behavior change to a pushed file,
but no codegen depends on it, and a 11.0 `.py` on the board runs 11.1 flows unchanged.

## Chunked deploy (2026-10-22, after the first hardware session)

The original design assumed a Deploy over a running flow just works; on the CYD it did not. Two device facts settled
it:

- **A whole `DEPLOY` needs one contiguous block the size of the message** (~1.3× the bytecode, base64-inflated).
  ESP32 MicroPython runs on a **split heap** (`MICROPY_GC_SPLIT_HEAP`), so `gc.mem_free()` sums several regions and
  116 KB "free" can still mean no 10 KB block. A 9,537-byte flow could not be deployed over a running GUI flow, and
  freeing the flow first did not help: stopping it freed RAM (50 → 116 KB) but left the heap too fragmented.
- **Failing was silent**, too: the allocation failed during CBOR decode, which no path answered, so the editor sat
  out its 30 s timeout.

Decision (Mike, same day): the flow goes in pieces, `FLOW_PUT` / `FLOW_COMMIT` / `FLOW_ACK` (ids 21–23, runtime
11.3.0), the same treatment `DEP_PUT`/`DEP_COMMIT` gave libraries in 8.0.0. Every allocation is one 1 KB piece, so it
fits wherever there is room. `DEPLOY` stays valid; the editor uses the chunked messages on 11.3.0+ and falls back
otherwise.

The editor-side workaround tried first and then removed — free the flow, retry, then clear the flow and restart the
board — is gone. It was an escalating recovery chain hiding a board limit, which is the "work badly" the project's
fault-handling rule exists to avoid.

**Status after testing the chunked path (2026-10-22 evening): the transfer works, the start does not.** Pieces
arrived and were acknowledged one by one; the commit then failed starting the flow, `MemoryError` allocating **376
bytes**, with the running GUI flow's memory freed but the heap fragmented. So chunking fixed the right thing and the
deploy-under-load problem is still open — it is not an allocation-size problem, it is that the board cannot hold a
running GUI flow and take another one in the same session.

Mike's call on the pattern, worth carrying further than this feature: *"we're spent hours on this… it falls squarely
on 'fail well, not work badly'."* A recovery step was added for each failure observed, and the design never stated
the limit. The sequence to build instead is in the briefing: one deterministic deploy (stop, free, receive, start),
a stop action that keeps the listener, and one refusal before anything is sent when it cannot fit.
