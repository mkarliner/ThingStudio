# test/hil

Hardware-in-the-loop tests: witness firmware, pin-map config, and test scripts driving the two-ESP32 witness+DUT rig -- see `../../docs/working-notes/validation/mvp-validation-plan.md`.

Not run in CI (needs physical hardware, per `../../docs/working-notes/repo-structure-and-conventions.md`'s CI split) -- stays a manual, documented local gate.

## What's here

- `pin-map.md` -- which physical GPIO goes where on both boards, and why (strapping pins avoided, the I2C/PWM pin conflict and its resolution). **Currently wired: `gpio_out`, `gpio_in`, PWM, and heartbeat rows only** -- I2C is deliberately not wired yet (pin-map.md's own fallback recommendation: wire the digital rows now, decide I2C's pins when the slave-mode spike is actually scheduled, since fault isolation doesn't need it).
- `witness_firmware.py` -- the witness board's firmware. One image, flashed once, driven over its own USB serial link with the line-based command protocol below. See its own header comment for the full command reference; summary here.
- `test_witness_firmware.py` -- off-device tests for the firmware's command parsing and PWM math, run against the headless MicroPython unix-port build (`../../device-runtime/test/README.md` has the build recipe). Real IRQ-triggered timing is a hardware-only concern by nature; not attempted off-device.
- `run_fault_isolation_checks.py` -- the driver script that actually exercises `../../docs/working-notes/validation/mvp-validation-plan.md`'s "Fault isolation" scenarios against real witness+DUT hardware over real serial ports. Push-button once both boards are flashed and wired, not manual typing into two terminal sessions.

## Witness firmware: command protocol

Line-based text, one line in, one or more lines out. Full detail (exact reply shapes, error cases) in `witness_firmware.py`'s own header comment -- summary:

| Command | Used for |
|---|---|
| `PING` | connectivity check |
| `DRIVE_GPIO <pin> <value>` | `gpio_in` node validation -- witness drives a known signal |
| `WATCH_EDGES <pin> <duration_ms>` | `gpio_out` node validation -- exact transition timestamps |
| `MEASURE_PWM <pin> <n_cycles> <timeout_ms>` | PWM duty-cycle/frequency measurement |
| `HEARTBEAT_WATCH <pin> <timeout_ms> <min_transitions>` | fault-injection soak test's independent liveness check |
| `I2C_SLAVE_EMULATE <addr> <register_map>` | not implemented -- gated on the I2C/SPI slave-mode spike (`../../docs/working-notes/validation/mvp-validation-plan.md`) |

## Setup

1. Two LuatOS CORE-ESP32-C3 boards (or confirm your boards match -- see pin-map.md's own "verify against your actual boards" note), each with its own independent USB connection to the host.
2. Wire per `pin-map.md`'s table (GPIO/PWM/heartbeat rows + GND; I2C not yet).
3. Flash `witness_firmware.py` onto the **witness** board as `main.py` (standard MicroPython "run this on boot" convention -- e.g. via `mpremote cp witness_firmware.py :main.py` or `ampy put witness_firmware.py main.py`, whichever tool your setup already uses).
4. Flash the real listener onto the **DUT** board: `device-runtime/src/{errors,cbor,framing,messages,protocol,runtime,listener}.py`, all copied to the device's filesystem root, with `listener.py` as (or invoked from) `main.py`.
5. Identify both boards' serial device paths (e.g. `/dev/ttyUSB0`, `/dev/ttyACM0` on Linux; `/dev/tty.usbserial-*` on macOS) -- `run_fault_isolation_checks.py --help` for how to pass them in.

## Running the checks

```sh
pip install pyserial  # not yet a tracked project dependency -- see docs/third-party-licenses.md's note on this
python3 run_fault_isolation_checks.py --witness-port /dev/ttyUSB0 --dut-port /dev/ttyUSB1 --mpy-cross /path/to/mpy-cross
```

Runs, in order, the validation plan's three "Fault isolation" scenarios (per-task boundary, listener/transport hardening regression, 50-frame fault-injection soak test with witness-verified liveness) and prints a pass/fail summary plus the exact numbers to paste into `mvp-validation-plan.md`'s dated Results entry. See that script's own header for what each check actually asserts.

## Open items this doc doesn't resolve

- The I2C pin conflict noted in pin-map.md -- pick a resolution before that pair gets wired (not needed for this task).
- External I2C pull-ups (~4.7kΩ) -- unchanged from pin-map.md's own note, not relevant until I2C is wired.
- `I2C_SLAVE_EMULATE` itself -- pending the slave-mode spike, Tier 1 scope.
