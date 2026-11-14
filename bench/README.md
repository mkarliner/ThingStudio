# Device performance bench

Measurements of MicroPython on the boards ThingStudio supports, with a clear
line between what was measured on hardware and what was measured on a host
build. This is the evidence base for the "is MicroPython too slow?" question,
not a marketing page.

Status: the scripts run on the MicroPython unix port and are validated for
syntax/logic. Hardware runs are the next step (see `results/README.md` for the
file each run produces). The ThingStudio-overhead flows in `flows/` and the
Pico logic-analyser firmware live in their own repos/workstreams; this folder
starts with the MicroPython baseline.

**Continuing in a new session?** Read
[`../docs/working-notes/device-performance-bench-brief.md`](../docs/working-notes/device-performance-bench-brief.md)
first; it has the current state, the VM run order, and the open questions.

## What is here

```
device/bench.py        single-file MicroPython baseline: interpreter, GC,
                       asyncio, machine.Timer, ADC, external IRQ, _thread
device/viper_bench.py  plain vs @micropython.native vs @micropython.viper
host/run_bench.py      copy to a board (mpremote) or run a local unix port,
                       parse the JSON block, write a results file
host/summarise.py      turn one or more result files into a markdown table
results/               one JSON file per run; schema in results/README.md
flows/                 ThingStudio flows for the same workloads (next)
RUNBOOK.md             first hardware session: pins, order, VM/USB notes
```

## Quick start

Host side:

```sh
python3 -m pip install mpremote
python3 bench/host/run_bench.py --port /dev/ttyACM0 --label esp32s3
```

The runner copies `device/bench.py` to `:bench.py`, calls
`bench.main([...])`, prints the console output, and writes
`results/YYYY-MM-DD-HHMM-esp32s3.json`.

No host at all:

```sh
mpremote connect /dev/ttyACM0 run bench/device/bench.py
```

or paste `device/bench.py` into Thonny and run it. The JSON block is printed
last; the human-readable lines above it are the same data.

Validate the script logic without a board (no `machine.Timer` on the unix
port, so that one test reports an error; everything else runs):

```sh
python3 bench/host/run_bench.py \
  --local ~/micropython/ports/unix/build-standard/micropython \
  --tests interp,gc,async,thread --label unix
```

Viper/native comparison:

```sh
python3 bench/host/run_bench.py --port /dev/ttyACM0 --suite viper --label esp32s3
```

## What each test measures

| Test | What it does | Metric to quote |
|---|---|---|
| `interp` | tight loop, integer add, function call, attribute read, dict lookup, float add, list append, `%` formatting | ops/s and ns/op; median of 5 runs |
| `gc` | `gc.collect()` time, a 1 KB allocate/free cycle, heap before/after | collect µs, churn µs, free heap |
| `async` | `sleep_ms(0)` task switches, `sleep_ms(1)` lateness, two-task ping-pong | switches/s, wake p50/p99/max, drift |
| `timer` | `machine.Timer` periodic callbacks at 100/1k/5k/10k/20k Hz | achieved Hz, missed, interval p50/p99/max |
| `adc` | `read_u16()` polling, round-robin across pins, `read_uv()` | samples/s per channel, total samples/s |
| `irq` | external pin edges; optional marker output toggled in the handler | rough edges/s, missed; latency from the LA, not software |
| `thread` | one vs two `_thread` CPU loops | scaling ratio |
| `viper` | integer sum, CRC-style loop, u16 scaling, GS4 pixel expansion, float loop | µs and speedup vs plain |

The timer callback is deliberately minimal (timestamp + histogram increment +
optional pin toggle) and defaults to the **soft** path, because a hard ISR must
not allocate and those operations allocate. `--timer-hard` asks for the hard
path anyway; if the port accepts it, treat the result as "the port's hard
callback context", not as something user Python code can do.

The `irq` test is deliberately rougher: its handler only increments a wrapping
byte and toggles a marker pin, because a real GPIO ISR cannot allocate either.
The software count loses wraps between 1 ms samples, so use the marker pin and
a logic analyser for exact counts and latency. The test is a presence/rough-rate
check, not a latency measurement.

## The IRQ rig

`--irq-pin` expects a clean external signal; a floating pin measures noise.
For the first pass, a Pico or any signal generator producing a 3.3 V square
wave is enough. Add `--irq-out-pin` to toggle a marker pin inside the
handler and measure input-edge → output-edge latency with a logic analyser or
scope, rather than trusting `ticks_us` inside the interrupt.

Software timestamps in an IRQ handler are biased by the measurement itself
and by interrupt masking. Use the software figure for throughput and the
hardware capture for latency. The Pico LA repo (sibling workstream, currently
`~/pico-la`) exists for exactly this; its `docs/recipes.md` has the wiring and
capture settings.

## Reading the numbers

- **Distributions, not averages.** Real-time claims are about the tail. Quote
  p99/max as well as the median, and say how many samples.
- **Name the context.** Port, firmware version, CPU frequency, whether WiFi or
  BLE was active, and whether the display was updating. A number without those
  is not reproducible.
- **Timer callbacks are not one thing.** On some ports `machine.Timer` runs in
  a hard ISR, on others a soft IRQ or an `esp_timer` task. The result records
  `hard` as the API accepted it; read the port docs before calling it a
  hard-real-time figure.
- **The unix port is a logic check, not a board.** It is useful for ratios and
  for catching a broken test; never publish its absolute figures as a board
  result.
- **Run it more than once.** A busy host or a background WiFi stack moves the
  tail. The runner records five reps for the interpreter; repeat the whole
  suite if any figure looks surprising.

## Results

See `results/README.md`. Filenames are
`YYYY-MM-DD-HHMM-<label>[-viper].json`. Keep the raw JSON; put prose and
caveats in the working note, not in the result file.

## For users who want to try it

The device script is intentionally dependency-free. Copy it, run it, keep the
JSON. The only board-specific inputs are ADC pins (`--adc-pins`) and the IRQ
wiring (`--irq-pin`, `--irq-out-pin`). Everything else has a safe default.

## Licence

Apache-2.0. See the repository `LICENSE`.
