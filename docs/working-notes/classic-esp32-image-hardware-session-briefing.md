# Classic-ESP32 image: first hardware session — briefing

Written 2026-10-22, end of session. Topic: the custom classic-ESP32 image went from unbuilt to booting and running
the GUI flow on the CYD — and the deploy-over-a-running-flow problem was found, half-solved, and then deliberately
left for a designed fix. Scope and reasoning: `classic-esp32-firmware-briefing.md`,
`decisions/classic-esp32-firmware.md`. Rule Mike stated during the session: `AGENTS.md` ("one deterministic path, not
a recovery chain").

## Where the work stands, in one paragraph

The image builds, flashes, boots into the listener on its own, and runs the GUI hero flow on a CYD that stock
MicroPython could not run at all (the gate's `MemoryError allocating 13317 bytes`). Deploying *over* that running
flow is still unreliable: the flow now transfers in 1 KB pieces, and then the board can fail to *start* it — 376
bytes of allocation, heap fragmented. That is a board limit, not a missing retry, and the next session's first job
is to design the deploy sequence around it rather than patch it.

## Done and verified on hardware

- **Image**: MicroPython v1.28.0 + ESP-IDF v5.5.1, one merged 1.70 MB `.bin`, 3 MB single-app slot, no OTA. Every
  module `runtime_manifest.py` lists is frozen (`stage.py` derives the set, so it cannot drift), including the
  port's own `_boot.py`/`flashbdev.py`/`inisetup.py` — forgetting those left the first image with no filesystem.
- **Boots on its own**: `LISTENER_READY`, `chipType "Thingstudio classic ESP32 (generic) with ESP32"`, all 34
  libraries listed in `HELLO.dependencies`, idle free RAM 149,408 / IDF 140,088 / largest block 110,592.
- **GUI flow runs**: weather station drawing on the CYD; 9,537 bytes of bytecode; free RAM 41,520 and largest IDF
  block 10,752 with the flow running.
- **Deploy skips frozen libraries**: `already on the board: font_body12 … st7796py` — the pieces that matched were
  not pushed. The ones that were pushed are explained below.
- **Runtime updates without a reflash**: `Tools → Install runtime…` put 11.1.1 → 11.2.x → 11.3.0 on the board
  over USB. Note what that means: an install pushes `CORE_FILES` into root, which shadows the frozen runtime (root
  comes before `.frozen`). Fine once the image and editor versions match; during a session of version bumps the
  board is never running its frozen runtime.
- **`/lib` before `.frozen`** (runtime 11.1.0), so a pushed library still overrides a frozen one, with a unix-port
  test for the order.
- **Frozen libraries stay in the index** (11.1.1): `remove_unused` was pruning them out of `_deps.json`, which made
  the next Deploy push copies over them.
- **Chunked deploy** (11.3.0, protocol ids 21–23, Mike's approval): `FLOW_PUT`/`FLOW_COMMIT`/`FLOW_ACK`, 1 KB
  pieces paced by an ack, temp file moved into place on commit. Pieces were verified arriving and acking on the CYD.
  A `MemoryError` during decode now answers `DEPLOY_ERROR` instead of leaving the editor to time out.

## Open, and the reason the gate has not passed

**Deploy over a running GUI flow.** On this board a running GUI flow leaves the MicroPython heap (a *split* heap —
`gc.mem_free()` sums several regions) without any block big enough for the next flow, either to receive or to start.
Measured on the way: 116 KB free and a 9,538-byte allocation failing; then pieces transferring fine and the start
failing on 376 bytes.

Four things were tried in order; three were removed again because each was a local answer to the previous error:

1. free the running flow and retry — freed RAM, not contiguity (removed);
2. drop the flow module and its library modules — 50 → 116 KB, still no 10 KB block (removed);
3. clear the flow, soft-restart, deploy — worked sometimes, hid the limit (removed);
4. chunked transfer — keeps, but only fixes the receive half.

The sequence to design instead (briefing, §"Deploying over a running flow"): one deploy decided before anything is
sent — stop the flow, free, receive, start; a "stop the flow, keep Thingstudio" action, which does not exist today
(the menu has Remove flow…, which deletes it, and Stop flow & open prompt, which ends Thingstudio); and one refusal
before transfer when the board cannot fit it. Then the five-cycle gate (A ↔ B, no manual resets) — never yet
run to completion.

## Smaller open items

- **Frozen runtime check still unmeasured**: to test the shipped configuration (frozen runtime, `runtimeBuild`
  null), the board has to be reflashed and *not* have a runtime installed over it.
- **Index pollution**: my CLI deploys wrote native-`mpy-cross` hashes into `/lib/_deps.json`, so the editor
  re-sent those libraries. A fresh flash leaves the image's own hashes (built with the editor's WASM) and nothing is
  pushed.
- **`install.sh` on this VM**: `/dev/ttyUSB0` returns EIO after some closes (CH340 through VMware passthrough, on an
  unpowered hub); an unplug/replug clears it, and a session must not probe the port by opening and closing it.
  Mike has a powered hub on order. The one-session provisioner used here was throwaway, not committed.
- **Board location**: the CYD is attached to Mike's Mac (`/dev/cu.usbserial-14420`), not to the agent VM. Anything
  driven from here needs the board moved back.
- **Docs page for the image** still not written (waiting on a reflash-verified configuration and the gate).

## Environment left behind (agent VM)

- ESP-IDF v5.5.1 at `/home/agent/esp/esp-idf` (installed, `export.sh` works, esp32 toolchain present).
- MicroPython v1.28.0 at `/home/agent/esp/micropython` (unix port built, used for the device test suite).
- Build: `MICROPY_DIR=/home/agent/esp/micropython firmware/classic-esp32/build.sh` with `IDF_PATH` exported.
  Current artifact: `firmware/classic-esp32/out/thingstudio-classic-esp32-11.3.0-9bbbc29.bin`.
- Playwright's browser cache was deleted to make disk room (~658 MB); `playwright install` restores it before
  `tools/screenshots.py` is used again.

## Commits this session (in order)

`f8e76ea` `/lib` before frozen modules · `21f70f5` image assets and docs · `bf2e91c` first build ·
`9c0b600` boots on the CYD · `fec2388` keep frozen libraries in the index · `1191fa7` display_spi bundle fix +
`npm run build` in CI · `43c4b42` flows left to right · `9ea2688` resend a dropped library piece ·
`92b3bad` free the flow for a retried deploy · `5074235` wait for HELLO before the retry ·
`7ea54f9` drop the flow module ·
`2f596f2` drop the library modules · `b083197` clear-flow-and-restart escalation (removed again in `9bbbc29`) ·
`751a6b5` chunked deploy · `9bbbc29` remove the escalation · `af188a1` decision note · `4c75777` state the limit.

## Next session, in order

1. Write the deploy sequence down (the four steps above) and check it against the board's real states before
   writing code.
2. Add the missing transition — stop the flow but keep the listener and the saved flow — since both the deploy
   sequence and any "your board is too full" advice depend on it.
3. Move the deploy onto it: refuse early, or stop-and-free first, never "send and recover".
4. Reflash 11.3.x, do the S0-S5 numbers again on a clean board, then the five-cycle gate.
5. Only then the user-facing page for the image.

## Questions for Mike

- Is a deploy that *restarts the flow* acceptable (i.e. the flow is down for the duration), or must it stay up?
  That decides whether the sequence can stop-then-receive, or needs the receive side to work with the flow running.
- Should the editor refuse a deploy it knows cannot fit, rather than attempt it? The two feel different to a user.
- After the gate: does the image stay optional-but-documented, or does the CYD path make it the recommended route
  for GUI flows on classic ESP32?
