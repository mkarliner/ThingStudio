# Device performance bench — continuation brief

Status: live handoff, 2026-11-14. The bench kit and the Pico LA design are
written; **no board numbers exist yet**. The next session runs the kit on the
VM with USB passthrough, then writes the internal results note.

Read first: [`../../bench/README.md`](../../bench/README.md),
[`../../bench/RUNBOOK.md`](../../bench/RUNBOOK.md),
[`../../bench/results/README.md`](../../bench/results/README.md), and the
existing MicroPython learnings in
[`learnings/micropython-device-runtime.md`](learnings/micropython-device-runtime.md)
(the UDP loopback and viper entries are the only real device data so far).

## Why this exists

Potential users have dismissed MicroPython and ThingStudio as "hopelessly
slow" for hard-real-time work. The goal is not to win that argument by
assertion; it is to publish real, reproducible device numbers, including where
MicroPython loses. The questions that prompted it:

1. Can it saturate ADC sampling?
2. Can it configure a 20 kHz systick?
3. Can it link interrupts together?
4. How easily can UART/I²C/SPI run concurrently?
5. What about CAN and USB?
6. How does it handle threaded programs?

The honest expected shape: MicroPython loses the 20 kHz *Python callback*
argument; hardware timers, PIO and native modules can win it. It wins
millisecond-scale control, I/O orchestration and networking. ThingStudio's
per-hop dispatch should be a small fraction of the total, but that is exactly
what the flow suite is for.

## Scope

In scope: device-side MicroPython and the ThingStudio runtime on real boards.
Out of scope: editor and compiler performance (believed fine), mpy-cross
compile latency (already measured at ~0.87 ms in Chrome), and a datasheet-level
CAN/USB feature matrix for an expert audience.

## Decisions already made

- **Board trio:** ESP32-S3 (Freenove 4"), RP2040 (Pico W), ESP32-C3 (LuatOS).
  Classic ESP32/CYD, C5, RP2350, nRF52840 and STM32F405 are out for now; the
  pyboard comes back only for a one-off CAN demo if wanted.
- **Device-only focus.** Do not spend the session on the editor/compiler.
- **Internal first.** A working note and raw results before any blog/docs page.
- **Pico LA is its own repo** (`~/pico-la` in this workspace), because it is
  useful to other people and should be documented independently. Firmware is
  pending; the design/protocol/recipes are committed.
- **No datasheet matrix.** Show concurrency and real costs; answer CAN/USB in a
  paragraph, not a table of every pin.

## Current state

### ThingStudio repo

The working tree currently has `bench/` **untracked** and one modified
`README.md` line (project layout). Commit or copy these before moving to the
VM; a fresh clone will not have them.

```
bench/README.md              what the kit measures and how to read it
bench/RUNBOOK.md             VM/USB setup, suggested pins, run order
bench/device/bench.py        MicroPython baseline, single file, no deps
bench/device/viper_bench.py  plain vs native vs viper, exec-based
bench/host/run_bench.py      mpremote/local runner, JSON capture, result file
bench/host/summarise.py      result JSON -> markdown table
bench/results/README.md      result schema and rules
bench/flows/README.md        ThingStudio-overhead flows (not written yet)
```

Validated on the MicroPython unix port: both suites run end-to-end, the runner
writes results, and `summarise.py` produces tables. **Those unix figures are
logic/ratio checks, not board results.** `machine.Timer` does not exist on the
unix port, so timer results there are errors; that is expected.

### Pico LA repo

`/home/mike/pico-la`, git repo with two commits (`770c026`, `1b1f216`).

```
README.md              scope, comparison with sigrok-pico and gusmanb, hardware
docs/design.md         capture architecture, timing model, calibration, limits
docs/protocol.md       v0 USB CDC command contract
docs/recipes.md        IRQ latency, timer jitter, bus contention, ADC
firmware/README.md     pin map and build plan; firmware not implemented
host/la.py             protocol client plus offline latency analysis
```

The host latency path is tested with synthetic captures. The firmware is
deliberately not written yet: the contract is settled so it can be implemented
against something stable.

### What is already real data

- UDP loopback flow on a board at Mike's bench (2026-11-14): ~18 pkt/s, RTT
  ~56 ms, `tx=rx`, `late=0`; the ~100/s receive ceiling never bound. This is
  the two-node flow path, not raw UDP.
- Viper GS4 expansion on the unix port: ~0.25 ms/frame, ~42× plain Python.
  Host-only; not a board figure.
- `mpy-cross.wasm` ~0.87 ms average compile in Chrome. Editor-side, out of
  scope.

Everything else in the design docs about speed is an estimate. Do not quote a
calculated figure as measured.

## First VM session

### Setup

- Flash stock MicroPython on each board; record the exact version. Do not mix
  firmware within a comparison.
- Close Thonny, the ThingStudio backend, and any monitor holding the port.
- Pass the board's USB device through to the VM:
  `mpremote connect list` should show it. Linux VM paths are usually
  `/dev/ttyACM*` or `/dev/ttyUSB*`; macOS host paths are
  `/dev/tty.usbmodem*`/`/dev/tty.usbserial-*`.
- `python3 -m pip install mpremote pyserial`.

### Suggested pins

Verify against the board definition before trusting these.

| Board | IRQ in | Marker out | ADC | Notes |
|---|---|---|---|---|
| ESP32-S3 Freenove 4" | GPIO4 | GPIO5 | GPIO6 | Display 10/11/12/45/46; touch 15–18; avoid USB 19/20 |
| Pico W | GP2 | GP3 | GP26 | GP23/24/25/29 are the WiFi chip |
| ESP32-C3 LuatOS | GPIO1 | GPIO2 | GPIO4 | Avoid 18/19 native USB, 20/21 bridge, 9 BOOT, 11 flash |

Second marker if needed: S3 GPIO7, Pico GP4, C3 GPIO3.

### Run order

1. **No wiring, all three boards.** Most data, least bench time.

   ```sh
   python3 bench/host/run_bench.py --port /dev/ttyACM0 --label esp32s3 --adc-pins 6
   python3 bench/host/run_bench.py --port /dev/ttyACM0 --suite viper --label esp32s3
   ```

   Pico W ADC defaults to GP26; C3 needs `--adc-pins 4`.

2. **S3 wired:** IRQ + marker to the scope/LA, then the timer/ThingStudio
   overhead flows once they exist.

   ```sh
   python3 bench/host/run_bench.py --port /dev/ttyACM0 --label esp32s3 \
     --tests irq --irq-pin 4 --irq-out-pin 5 --irq-hz 1000 --duration-ms 500
   ```

3. **Pico W and C3** the same way, after the S3 tells us whether the story
   holds. Stop early if the expected wall is confirmed; the matrix does not
   need every cell filled.

4. **Radios/display second pass.** Baseline with WiFi/BLE off and display idle;
   repeat the key tests with WiFi on (S3/C3/Pico W) and the display updating
   (S3) to show interference. Record which case each file is.

### Commands and files

- Results land in `bench/results/YYYY-MM-DD-HHMM-<label>[-viper].json`.
- Copy them back into the repo; do not transcribe by hand.
- `python3 bench/host/summarise.py bench/results/*.json` makes the table.
- If `mpremote` is not on PATH, the runner falls back to
  `python3 -m mpremote`; if that fails, install it.

## Measurement rules

- **Distributions, not averages.** Quote p50/p99/max and sample counts.
- **Context is part of the number:** board, firmware, CPU frequency, radios,
  display, and what else was running.
- **Timer callbacks default to soft.** A hard ISR cannot allocate; the bench
  callback timestamps and increments histogram buckets. `--timer-hard` asks
  for hard anyway, but the real hard-ISR number comes from a marker pin and
  the LA.
- **The `irq` test is a rough count.** Its handler only increments a wrapping
  byte and toggles a marker. Latency comes from the LA/scope, not software
  timestamps inside an ISR.
- **One board per result file.** Never average across ports.
- **Do not edit measured values.** If a run is invalid, delete it and explain
  why in the note.
- **Unix port figures are not board figures.** Never publish them as such.

## Remaining work, in order

1. **P0 hardware runs** (above): S3, Pico W, C3; baseline + viper; S3 IRQ and
   ADC.
2. **`bench/flows/`**: timer→gpio, interrupt→gpio, ADC with/without sink,
   chain lengths 1/5/10, marker pins. Compare against the baseline and report
   the per-hop slope. Prerequisites: `npm run build:cli` in `editor/` for
   `device_cli.py`, and a native `mpy-cross`
   (`device-runtime/test/README.md` has the build recipe).
3. **Pico LA firmware**: sampled capture + trigger + CSV, then loopback
   calibration and generator. The stopgap is `sigrok-pico` (21 digital + 3
   analog, PulseView/sigrok-cli); spend at most an hour on it before deciding.
4. **P1:** bus concurrency on S3 (display + I²C + UART, marker pins), display
   frame time, RP2040 PIO pass-through, C3 floor if not already done.
5. **Internal note** with method, tables, raw files, and caveats. Then, and
   only then, a docs/blog summary for users.

## Open questions for Mike

- Which MicroPython build per board: latest stock, or the ThingStudio-tested
  image? Use one consistently, and say which.
- Should the first published table include WiFi-on numbers, or baseline only
  with a "radios change the tail" note?
- Is a pyboard + CAN transceiver demo wanted, or is a written capability
  answer enough?
- For the LA: write our firmware next, or wait for the first scope captures to
  show what resolution/features are actually needed?

## Do not

- Do not rewrite `bench.py` before running it on hardware; report a failure
  first. The soft/hard ISR constraints are deliberate.
- Do not quote the unix-port numbers as device performance.
- Do not add calculated figures to the results files.
- Do not expand to more boards before the trio shows the story.
- Do not turn the CAN/USB question into a datasheet survey; answer it with the
  measured/known limitation and move on.
