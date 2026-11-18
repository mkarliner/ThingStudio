# Chip temperature node (ESP32 internal sensor) — scoping

Status: built, 2026-11-17, in Mike's `~/.thingstudio/custom-nodes/` (decisions at the end). Classic ESP32 dropped
2026-11-18: its sensor returns a fixed value. Works on the C3 (Mike, 2026-11-18); C5 and S3 pending. No interface
change: it uses the custom node format as it stands (`interfaces/node-descriptor/`).

## What it is

A polled `source` that reads the chip's own temperature sensor and sends it in °C. No wiring, no parts: every
ESP32 board has one. It reads the die, not the room. The die runs warmer than the air, and WiFi warms it further,
so it suits "is the board overheating" and relative trends, not room temperature.

## What MicroPython offers (checked against our own images)

Two functions, never both on one chip. Grepping the built images in `firmware/out/` for the qstrs:

| Image | `esp32.raw_temperature()` | `esp32.mcu_temperature()` |
|---|---|---|
| classic ESP32 (15.x) | yes | no |
| ESP32-C3 (15.x) | no | yes |
| ESP32-C5 (15.x) | no | yes |
| ESP32-S3 (16.0.0) | no | yes |

- `raw_temperature()` (classic ESP32 only): an integer in **°F**, uncalibrated. On most chips it returns one fixed
  value (2026-11-18, decision 5), so the node refuses it.
- `mcu_temperature()` (S2, S3, C3, C5, C6): a float in **°C**, using ESP-IDF 5's calibrated `temperature_sensor`
  driver. Added in MicroPython 1.23 for C3/S2/S3. The S2 runs stock firmware; it should have it, unchecked.
- Upstream docs note that the reading sits above ambient because the chip warms while it runs.

## Design

### Package

`chip_temp.node.json` + `chip_temp.node.py` in Mike's own `~/.thingstudio/custom-nodes/`, not in the repo.
Palette name **chip temp**, type `mike/chip_temp`, group `hardware` (where `bme280` sits).

Properties:

| name | kind | default | notes |
|---|---|---|---|
| `intervalMs` | number | 10000 | required for a polled source |
| `id` | nodeId | `""` | so the node can report its own status |

Output: one port, `number`. `payload` is °C (float). `topic` is `''`. No extra fields in v1.

### Finding the sensor: a probe at setup, not a board check at compile time

Setup code picks a reader once, by asking the firmware what it has, and keeps it for `emit`:

```python
_id = properties['id']
_read = None
try:
    import esp32
    if hasattr(esp32, 'mcu_temperature'):
        _read = esp32.mcu_temperature
    elif hasattr(esp32, 'raw_temperature'):
        raise RuntimeError("chip temp: the classic ESP32's temperature sensor returns a fixed value, not a "
                           "reading. Use an ESP32-S2, S3, C3 or C5, or an external sensor")
except ImportError:
    pass
if _read is None:
    raise RuntimeError('chip temp: this board has no chip temperature sensor ThingStudio can read')

_ok = None  # last status sent: None (none yet), True, False

async def emit(properties):
    nonlocal _ok
    try:
        t = _read()
    except Exception as e:
        if _ok is not False:
            runtime.report_status(_id, 'error', 'read failed: %s' % e)
            _ok = False
        return None          # skip this cycle; keep polling
    if _ok is not True:
        runtime.report_status(_id, 'connected')
        _ok = True
    return {'payload': t, 'topic': ''}
```

Why a probe rather than `requires` or a `target` check:

- It works on boards we haven't defined and on the board-less compile ("expect unsupported boards").
- The firmware is the only source of truth. A processor list in the package would copy a fact the firmware
  already holds, and drift.
- `requires.capabilities` would need a new word (e.g. `chip-temp`) in every processor file. That is core data a
  custom package can't add, and without it the node would show greyed out everywhere. Revisit if it ever
  becomes a built-in.

The cost: on a chip without the sensor, the flow stops when it starts, not at compile time. The message says
what's wrong. Optional later: a `.compile.py` warning when `ctx.target` is a known non-ESP32 processor.

### Fault handling

- **No sensor (permanent):** raise at setup. The flow stops at start with one console line naming the node.
- **A read fails (transient):** status dot **error** with the reason, return `None` so this cycle sends nothing,
  keep polling. Status goes back to **connected** after the next good read. A status is sent only when it
  changes, so the link isn't flooded. Polled sources can return `None` to skip a cycle (`compile.ts`, the
  `if msg is not None` guard), so this needs no runtime change.
- **Classic ESP32:** refused at setup with its own message (decision 5). A stuck-value check was considered and
  not built: on most classic chips it would never pass.

### Hardware singleton?

No pin, bus or ADC channel is used, so there is nothing to claim. `mcu_temperature()` installs the IDF driver once
(a static handle in `modesp32.c`), so two `chip temp` nodes in one flow are safe. Say so in the package comment,
so nobody adds a `runtime.shared` call on reflex.

### Scope is not shape

Scope: ESP32 family. Shape: the probe is an ordered list of "if the firmware has X, read it like this".
**A second one would need:** one more branch. For example, RP2040/RP2350 read ADC channel 4 through
`runtime.shared('adc', 4, (), lambda: machine.ADC(4))`, converted with `27 - (v - 0.706) / 0.001721`. That's why
the name is `chip temp`, not `esp32 temp`.

## Work

1. Done: the two package files in `~/.thingstudio/custom-nodes/`. Nothing in the repo changes, so no repo
   tests or user docs.
2. Done: the generated setup/emit run under CPython (no MicroPython unix port on the VM) with fake `esp32`
   modules: no module and neither function raise the message; `mcu_temperature` passes through; a classic chip
   raises its own message (re-checked 2026-11-18); a failing read reports `error` once, returns `None`, then
   `connected` once on recovery.
3. Done: `chip temp` -> `debug` compiles with `--strict --layout` (mpy-cross syntax check included) for
   `cyd`, `kitchen-sink-c3`, `esp32-c5-340x`, `freenove-s3-4in` and `lolin-s2-mini`.
4. Classic ESP32 (CYD): done 2026-11-18, the value never moved; refused since. ESP32-C3 (kitchen-sink): works
   (Mike, 2026-11-18). Pending, hardware check by Mike: ESP32-C5, ESP32-S3. For each board, record the reading at
   idle and after WiFi has been up for 5 minutes, and check it moves when the chip warms.

Side finding, separate from this node: `custom-nodes.md` says the folder "starts with two examples, `doubler` and
`dht22`", but `example_nodes/` holds five packages. Check what is actually seeded and fix the sentence.

## Decisions (Mike, 2026-11-17)

1. **Where:** Mike's own custom-nodes folder. Not shipped, not built-in.
2. **Units:** °C only.
3. **Offset:** none. The node reports the actual chip temperature.
4. **Interval:** 10 s default.
5. **Classic ESP32:** included from the start, with the "does it move" hardware check. **Superseded 2026-11-18:**
   it doesn't move. Mike's CYD read 52.222224 °C (raw 126 °F) on every read. Widely reported: the classic chip's
   `raw_temperature()` returns a fixed value (often 128 °F) even under a hair dryer, and ESPHome treats a raw 128 as
   invalid and discards it. The node now refuses the classic chip at setup, naming the chips that work. A fixed
   number reported as a temperature is worse than a node that says it can't.
