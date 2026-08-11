# POC-A: live MicroPython/uasyncio runtime over WebSerial

Tests the claim in design doc &sect;1/&sect;5 (see &sect;15.1 for exact scope): a live
MicroPython + `uasyncio` runtime on real ESP32-C3 hardware, driven from a
browser over WebSerial, gives a fast edit&ndash;deploy&ndash;see-it-run loop.

Board: LuatOS CORE-ESP32-C3, MicroPython already flashed.

**Files**

- `harness.py` &mdash; flashed ONCE as `main.py`. A crude text-protocol listener
  that `exec()`s whatever payload source the browser sends, tracks/cancels
  the payload's tasks across redeploys, and reports `gc.mem_free()`.
- `payload.py` &mdash; the hand-written test program: two `uasyncio` coroutines
  (LED blink on GPIO12, BOOT-button poll on GPIO9). This is what gets
  redeployed over and over; it never runs standalone as `main.py`.
- `index.html` &mdash; the bare-bones browser page (Connect/Disconnect, Deploy,
  50&times; stress test, raw console, CSV export).

No wiring needed &mdash; both onboard LEDs (GPIO12/13) and the onboard BOOT
button (GPIO9) are used, per the LuatOS CORE-ESP32-C3 pinout.

## 1. Push the harness onto the device

The harness only needs to be pushed once (re-push only if you edit
`harness.py`). From a terminal on your machine:

```bash
pip install mpremote
# find the port: macOS -> ls /dev/tty.*   (usually /dev/tty.usbserial-XXXX or /dev/tty.wchusbserialXXXX)
#                Linux -> ls /dev/ttyUSB* /dev/ttyACM*
#                Windows -> Device Manager, e.g. COM5

mpremote connect <PORT> fs cp harness.py :main.py
mpremote connect <PORT> reset
```

**Important:** close `mpremote` (and any other serial monitor / Thonny /
`screen` session) before opening the browser page. Web Serial needs
exclusive access to the port &mdash; only one program can hold it at a time.

After reset, the device boots straight into the harness (no REPL prompt is
reachable while it's running &mdash; that's intentional, see comments in
`harness.py`). To get back to a normal REPL for debugging, hold **BOOT**
and press **RESET** to enter download mode, or just reflash `main.py`.

## 2. Open the browser page

Chrome or Edge only (Web Serial API). Serve it over `http://` rather than
opening the file directly &mdash; in practice `file://` left Chrome's port
picker empty with no way to select the device:

```bash
cd poc-a
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

## 3. Run it

1. Click **Connect**, pick the device's serial port. You should see
   `HARNESS_READY` in the console within a second.
2. Click **Deploy test program**. Watch the onboard LED start blinking and
   the console fill with `BTN value=...` lines. The "last deploy" panel
   shows two latency numbers:
   - **click &rarr; DEPLOY_OK**: round-trip time for the harness to receive,
     `exec()`, and acknowledge the payload.
   - **click &rarr; first TOGGLE**: time until the payload's first actual GPIO
     change &mdash; the more honest "observable behavior change" number from
     &sect;15.1's success criteria.
3. Click **Deploy test program** again a few times. Confirm both coroutines
   are still running correctly after each redeploy (LED still blinks, BTN
   line still prints, no gap/hang).
4. Click **Run 50&times; redeploy stress test**. This automates 50 back-to-back
   redeploys and logs, per iteration: both latencies, `gc.mem_free()`
   before/after, and whether it errored or timed out. When it finishes it
   shows a pass/fail summary (failures, average/max latency, and memory
   drift between the first and last redeploy). Click **Download stress-test
   CSV** to save the raw data.

## 4. Results (LuatOS CORE-ESP32-C3, 2026-08-10)

| Criterion | Target | Observed |
|---|---|---|
| Deploy &rarr; observable behavior change (click&rarr;TOGGLE) | comfortably under 1s | **99ms** |
| Deploy &rarr; protocol ack (click&rarr;DEPLOY_OK) | &mdash; | avg **97ms**, max **98ms** (50-run stress test) |
| `gc.mem_free()` before/after a single deploy | sanity-check vs &sect;3's RAM assumptions | ~168&nbsp;KB free throughout &mdash; comfortable headroom against the 400KB SRAM baseline |
| Both coroutines keep running after a redeploy | yes/no, every time | **yes**, confirmed across multiple manual redeploys |
| ~50 consecutive redeploys, no crash/memory creep | 50/50 clean, no drift | **50/50 ok**, mem_free drift **-80 bytes** over 50 redeploys (noise, not creep) |

**Verdict:** POC-A's central bet holds. Both success-criteria latency numbers
(99ms observable, 97ms ack) land roughly 10x under the "comfortably under a
second" target, with essentially flat memory across 50 redeploys and no
crashes. Raw-text-vs-bytecode note (flagged in &sect;5): at this program
size, raw-source `exec()` is fast enough on its own that there's no latency
pressure forcing POC-B's precompiled-bytecode path &mdash; that decision can
be made on other grounds (RAM headroom at larger program sizes, parse-error
surface, etc.) rather than deploy speed.

## Protocol (for reference, not a real spec &mdash; see harness.py)

```
browser -> device : "###DEPLOY-BEGIN###\n" <payload source, line-terminated> "###DEPLOY-END###\n"
device  -> browser: "DEPLOY_OK before=<int> after=<int> dt_ms=<int>\n"
                  or "DEPLOY_ERR <exception repr>\n"
```
Everything else printed by the running payload (or the harness's periodic
`MEM t=<ms> free=<int>` line) just streams out over the same line and shows
up in the raw console as-is.

## Appendix: reflashing MicroPython (only if you ever need to)

```bash
pip install esptool
# grab the ESP32-C3 generic build from https://micropython.org/download/ESP32_GENERIC_C3/
esptool.py --chip esp32c3 --port <PORT> erase_flash
esptool.py --chip esp32c3 --port <PORT> --baud 460800 write_flash -z 0x0 <firmware>.bin
```
