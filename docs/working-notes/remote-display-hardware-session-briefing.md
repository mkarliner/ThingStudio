# Remote display spike — hardware session briefing

Status: handoff, 2026-11-07. Continues `remote-display-spike-code-side-briefing.md` (the code half) and
`remote-display-spike-briefing.md` (the hardware plan). Branch `remote-display-spike`, clean tree, seven commits on
top of `e48c7eb`. Nothing merged.

## The one-paragraph version

The feature works board-side and, on a board with memory to spare, end to end from a phone. Three real bugs were
found on hardware and fixed with tests: a socket never released per request (an ESP32 answers ten requests, then
resets everything), the page hashing the TSAUTH1 salt as hex text instead of its bytes (every login 401), and input
frames going out flat instead of under `"m"` (every tap silently dropped). A fourth, the modal painting blank,
and a fifth, a redeploy leaving port 80 bound, are fixed and tested but **the port fix is not installed on the
board**. Mike's call: the remote display ships as a custom firmware build; stock installs on small ESP32 boards are
out of scope (`decisions/remote-display.md`, 2026-11-07). Pico W is explicitly not ruled out.

## Where the hardware stands

- **ESP32-C3, no PSRAM — "does not fit", and that is the answer the session came for.** 66 KB of MicroPython heap
  free throughout, but the IDF heap (WiFi + lwIP) fell from 30,200 B at boot to **1,312 B, largest block 448**.
  At that point the board stays associated at RSSI -52 and moves no packets in either direction; the page's login
  gets `400 Bad Request` because the server's 5 s header read times out. Not a leak that tuning fixes.
- **Freenove ESP32-S3 4.0" (Octal-SPIRAM) — fits easily**: 8.0 MB gc heap, 8.07 MB IDF heap, largest block
  7.7 MB. Running `remote-spike`, page at `http://192.168.10.110/ts/remote/`, board password `electr1c`,
  hostname `ts-b162c0`. Runtime 15.1.0 (build `dc511ad…`). Reachable only over WiFi: its single native-USB
  port is unreliable (below).
- Checkpoint table and every figure: `remote-display-spike-results.md` (now filled for both boards).

## Environment facts (the parts that cost time)

- **mpy-cross / unix-port MicroPython**: `git clone --depth 1 --branch v1.29.0
  https://github.com/micropython/micropython.git /tmp/opencode/mpy-src`, `make -C mpy-cross`,
  `make -C ports/unix` (needs `make -C ports/unix submodules` first). Board firmware is 1.29.0, so use that tag.
  Scratch builds live in `/tmp/opencode` and do not survive the machine.
- **Editor**: `cd editor && ./node_modules/.bin/tsc --noEmit && npm test` (1,379 tests at handoff). `node_modules`
  was already installed; no `npm install` was run this session. Check for stray `.js` before trusting a test run.
- **Device suite**: `THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/bs.json` and
  `THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/ds.json` in the environment, then
  `/tmp/opencode/mpy-src/ports/unix/build-standard/micropython device-runtime/test/test_<name>.py`.
- **Serial on the S3**: opening the port **resets the board**. A `STOP_TO_PROMPT` sent immediately after opening
  lands during `LISTENER_BOOTING` and is ignored. Wait for the listener (its WiFi transport answering is proof)
  before sending.
- **The S3's USB is not a console you can rely on**: small writes arrive, large ones do not (the ~1.3 KB `HELLO`
  came back as a 448-byte fragment with no `F64:` prefix; a 1,500-char print produced nothing). Use the WiFi
  transport for everything protocol-shaped.
- **WiFi transport (the editor's real path, and this session's saving grace)**: TCP 7462, board speaks first
  `TSAUTH1 <host> <nonce hex> <salt hex> <iters>`, client answers `TSAUTH1 <hex HMAC-SHA256(sha256^N(salt_bytes +
  password), nonce)>`, board answers `TSAUTH OK`, then `F64:` lines both ways plus plain `print()` output. Needs a
  board password (`SET_BOARD_SETTINGS`, min 8 chars) or the port never opens. A throwaway client
  (`/tmp/opencode/net_dut.py`) wrapped this with `DutLink`'s interface, so `hil_common`'s `deploy_message()` and
  whole deploys ran over TCP unchanged.
- **`STOP_TO_PROMPT` is USB-only** (`overUsb` guard) and on this image leaves the REPL on UART0 — stopping the
  listener over native USB strands the board until a power cycle. Reset is not wired to DTR/RTS on this unit.
  **Runtime installs on this board need a UART connection or an image built with the REPL on USB.**
- Board passwords were set during the session (C3 and S3): `electr1c`. The C3 is unplugged.

## What is left, in order

1. **Install the rebind fix on the S3** (`a34666e`: `runtime.cancel_running` awaits async cleanups, so the next
   flow can bind its port). Needs UART or a USB-REPL image; until then, a deploy onto a running flow needs one
   `RESTART` before the page comes back.
2. **Checkpoints 4, 5, 7, 8, 9** on the S3, phone in hand: settings form + threshold across a reboot, deadman
   timing (`REMOTE_SAFE led off`, measured), asset/peak-RAM figures, mDNS/QR (QR needs Mike's decision), and the
   SPEC read-through against hardware.
3. **Deferred to the full implementation** (Mike, 2026-11-07: "custom builds are for a full implementation"):
   the **Pico W** probe and the **custom S3 image** (folder landed as `esp32-s3` in 74c8cd4; no image recorded
   or offered yet). The spike is proven by the S3 with PSRAM running as-is.
4. **`device_cli` over the WiFi transport.** The session hand-rolled it twice; it belongs in the tool, both for
   boards like this one and because deploys over TCP do not disturb USB.
5. Known gaps unchanged: `?t=` token in the page URL (security-policy §3.8), captive-portal DNS unimplemented
   (results item 13), AP route untested, second-viewer take-over verified board-side only.

## Where the reasoning is

- `docs/working-notes/decisions/remote-display.md` — the scope decision and the memory evidence.
- `docs/working-notes/learnings/remote-display-spike.md` — 17 entries; the five from this session are the socket
  close, the salt/key derivation, `mount()`'s route keys, the input envelope, the modal paint ordering, and
  `__await__` missing on MicroPython coroutines (plus the UART0/REPL note).
- `docs/working-notes/remote-display-spike-results.md` — checkpoint table per board, every measured figure with
  how it was measured, the kill signals, and the verdict.
- `interfaces/remote-display/SPEC.md` — unchanged this session; the envelope (`{"c":n,"m":{...}}`) and the
  `TSAUTH1` challenge are the two places the page had drifted from it.

## Kill-or-rethink, updated

The C3 headroom signal is now a measured fail (and is why the feature is custom-build-only). Latency, deadman
reliability and iOS Safari's pure-JS TSAUTH1 are still open — the phone session reached login, rendering, live
values, working buttons and a rendered modal, which is most of checkpoint 2 and the start of 4.
