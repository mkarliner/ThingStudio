# Bench results

One JSON file per run, named `YYYY-MM-DD-HHMM-<label>[-viper].json`. The label
is the board name by default (`--label` overrides it). Keep files as produced
by `host/run_bench.py`; add interpretation and caveats in the working note.

## Schema

```json
{
  "meta": {
    "platform": "esp32",
    "version": "3.4.0; MicroPython v1.29.0 on ...",
    "implementation": "...",
    "uname": {"sysname": "...", "machine": "ESP32S3", "...": "..."},
    "freq_hz": 240000000,
    "mem_free": 123456,
    "mem_alloc": 7890,
    "mem_free_after": 120000
  },
  "config": {
    "tests": ["interp", "gc", "async", "timer", "adc", "thread"],
    "reps": 5,
    "duration_ms": 500,
    "timer_freqs": [100, 1000, 5000, 10000, 20000],
    "timer_id": -1,
    "timer_hard": false,
    "adc_pins": [26],
    "irq_pin": null,
    "irq_out_pin": null,
    "irq_hz": null
  },
  "tests": {
    "interp": {"pass": {"n": 123, "us_median": 250000, "ops_per_s": 492000, "...": "..."}},
    "timer": {"1000": {"achieved_hz": 999.8, "missed": 0, "interval_us": {"p99": 1201, "...": "..."}}},
    "async": {"switch_per_s": 12345, "sleep_latency": {"p99": 1300, "...": "..."}},
    "adc": {"samples_per_s": 123456, "per_channel_per_s": 61728},
    "irq": {"count": 2000, "missed": 0, "achieved_hz": 4000, "note": "rough count; see the LA"},
    "thread": {"scaling": 1.01, "...": "..."}
  },
  "collection": {
    "collected_at": "2026-11-14T14:42:00+00:00",
    "method": "mpremote",
    "target": "/dev/ttyACM0",
    "host": "Linux-...",
    "python": "3.13.0",
    "repo_commit": "0f703515",
    "bench_sha256": "...",
    "suite": "bench",
    "command": "..."
  }
}
```

The viper suite has the same envelope but `tests.<name>.variants.<plain|native|viper>`
with `us_median`, `us`, and `speedup_vs_plain`, or `skipped`/`error`.

## Rules

- **Do not edit measured values.** If a run is invalid, delete the file and
  say why in the working note.
- **Include the collection block.** Board name alone is not enough; firmware,
  CPU frequency, and the bench file hash are how a later run is compared.
- **One board per file.** Aggregating across boards produces a number nobody
  can reproduce.
- **Note the environment in the working note, not here:** WiFi/BLE on or off,
  display updating, what was plugged in, ambient temperature if it matters.
- **Tail figures are the point.** If the file has a histogram, keep it; it is
  what lets a later reader recompute p99 when the analysis changes.

## Aggregating

```sh
python3 bench/host/summarise.py bench/results/*.json
```

Prints a markdown table per suite. It does not average across boards; each row
is one file.
