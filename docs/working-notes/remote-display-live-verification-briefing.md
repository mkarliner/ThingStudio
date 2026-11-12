# Remote display — live verification briefing

Status: handoff, 2026-11-12 (evening). The remote-display MVP's software side is landed and live-verified down
to the wire on the S3; what remains is the hardware checkpoints and one structural problem found while testing.
Supersedes `remote-display-implementation-briefing.md` (its software tasks 1-4 are done; see "Landed" below).

## Read first

1. `outstanding-items/wifi-deploy-chicken-and-egg.md` — the structural problem Mike logged: a flow's WiFi
   config is what joins the network, so a WiFi deploy that joins differently strands the board. **A design
   answer, not a patch** — Mike's words. Deciding the direction is the first design conversation to have.
2. `remote-display-production-tasks.md` — tasks 1-5, 7 marked done; the remaining ones are below.
3. `decisions/remote-display.md` — including 2026-11-12's "remote screens are not phone screens".

## Landed this session (all on `remote-display-spike`, pushed)

Token in the WebSocket subprotocol (runtime/editor **16.0.0**, page and board moved together); login route rate
limit (429 past 10/min, 503 while busy); the SPEC 5.1 form contract (payload `{form, values}`); page dots and
carousel removed (nav is board-owned, order = pages' declaration order); the untested-board compiler warning
(`editor/src/definitions/remote-display-measurements.ts` is the measured registry); the SPEC line-by-line
review with vectors updated; the phone-language sweep (the page / the viewer / any device); editor UX from
Mike's drive (remote screen auto-creates its web server; the configRef + form has a real Save);
`install.sh` refuses an ambiguous image pick; **the reconnect fix**: session start marks the surface full so a
viewer connecting to a running flow receives a whole `screen` message — found live on the S3, missed by the
unix-port suite (it never reconnects to a live surface).

## The board, as it stands

Freenove ESP32-S3 4.0" at **192.168.10.110**, board password `electr1c`, running flow 'untitled flow' (a remote
screen, one page 'abc'). **It still runs the pre-fix image `96f689a`** — the flash never took in three attempts
(the page's served wording is the fingerprint; a real flash erases the board, so a surviving password proves
no flash happened). `firmware/out/esp32-s3/` holds three images; the right one is

```
thingstudio-esp32-s3-16.0.0-8790056.bin   sha256 81c84053…   (current head, has the fix)
```

## Remaining work, in order

1. **Flash `8790056` for real** (USB; `install.sh` now refuses ambiguous picks, name the file anyway). Then
   bring-up from bare: `SET_BOARD_SETTINGS` (password) + deploy a remote flow, both over USB. Then:
   - fingerprint the served page (first comment line says "The remote display's page -- a browser page on
     any device"),
   - run the walkthrough (login -> 101 via subprotocol -> definition -> **`screen` on connect** -> values,
     heartbeat, pong),
   - heap figures from `hello --json` (`freeIdfHeapBytes` / `largestIdfHeapBlockBytes`; last measured on the
     old image: 80,044 / 38,912 with the flow running — recorded in `remote-display-spike-results.md`),
   - `firmware/record-tested.sh <image> "<board>" "<what you ran and saw>"` -> commits `tested.json`,
   - the phone checkpoint (a real browser, both hands: login, tap, form, slider) — Mike's.
2. **The chicken-and-egg design conversation** (the outstanding item above) — before more flows land on more
   boards. Direction options and Mike's "no patch-overs" rule are in the detail file.
3. **C3 custom image measurement** (task 6, non-blocking): build, flash, measure, verdict either way.
4. **Mike's open interface call**: SPEC 4 lists wire widget kinds `trend`/`histogram`/`slider`; the wire says
   `trend` (the one history widget -- its user-guide page is Histogram) and `ctl` (§5's message type already
   says ctl). Amend the spec or rename the wire kind? Everything else in the SPEC review is settled.

## Environment (every toolchain this work used)

- MicroPython unix port (device tests): `~/micropython-1.29.0/ports/unix/build-standard/micropython`
  — same tree as the existing `mpy-cross`, so bytecode versions match. New-machine recipe:
  `device-runtime/test/README.md`.
- Device tests: `THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/r_b.json
  THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/r_s.json <micropython> device-runtime/test/test_remote_display.py`
  (and `test_ts_http_ws.py`). Redirect output to a file — piped micropython flushes at exit.
- Live-board CLI: `~/bvenv/bin/python test-flows/device_cli.py … --host 192.168.10.110 --password electr1c`
  (`device_cli` needs pyserial; the system python3 lacks it, `bvenv` has it).
- Firmware build/flash: `. ~/esp/esp-idf-5.5.2/export.sh && MICROPY_DIR=~/micropython-1.29.0
  firmware/build.sh esp32-s3`; flash with `PORT=<port> firmware/install.sh esp32-s3 <image>`.
- Editor: `(cd editor && npm run build:cli)` after any pull; `find editor/src editor/test -name "*.js"
  -type f -delete` before trusting tests; `npm ci --ignore-scripts`, never bare `npm install`.
- The boardless page-client harness used for live verification is scratch at `/tmp/rd_client.py` (login
  derivation, masked frames, HMAC+counter, definition assembly, pong). Worth cleaning up into `test-flows/`
  when the fresh-flash checkpoint is run -- it drove every check a phone would short of the actual browser.

## Done when

- The `8790056` image is flashed (fingerprinted), the walkthrough shows `screen` on connect, heap figures
  recorded, `record-tested.sh` committed, phone checkpoint passed -- task 5 closed, merge gate reviewable.
- The chicken-and-egg direction is decided (a `decisions/` entry exists, the design note written, or a
  scoping session scheduled).
- This brief is replaced by a merge note.
