# test/hil

Hardware-in-the-loop tests: witness firmware, pin-map config, and test scripts driving the two-ESP32 witness+DUT rig -- see `../../docs/working-notes/validation/mvp-validation-plan.md`.

Not run in CI (needs physical hardware, per `../../docs/working-notes/repo-structure-and-conventions.md`'s CI split) -- stays a manual, documented local gate.

## What's here

- `pin-map.md` -- which physical GPIO goes where on both boards, and why (strapping pins avoided, the I2C/PWM pin conflict and its resolution). **Currently wired: `gpio_out`, `interrupt`, PWM, and heartbeat rows only** -- I2C is deliberately not wired yet (pin-map.md's own fallback recommendation: wire the digital rows now, decide I2C's pins when the slave-mode spike is actually scheduled, since fault isolation doesn't need it). The `interrupt` row (DUT GPIO4 / witness GPIO5) is the same physical pair `gpio_in` used before it was removed 2026-08-17 (Tier 1 item 5) -- only the DUT-side node changed, not the wiring.
- `witness_firmware.py` -- the witness board's firmware. One image, flashed once, driven over its own USB serial link with the line-based command protocol below. See its own header comment for the full command reference; summary here.
- `test_witness_firmware.py` -- off-device tests for the firmware's command parsing, `DRIVE_BOUNCE`'s settle behavior, and PWM math, run against the headless MicroPython unix-port build (`../../device-runtime/test/README.md` has the build recipe). Real IRQ-triggered timing is a hardware-only concern by nature; not attempted off-device.
- `hil_common.py` -- shared DUT/witness serial-link helpers (`DutLink`, `WitnessLink`, `compile_flow`), used by both driver scripts below. Not runnable on its own.
- `run_fault_isolation_checks.py` -- the driver script that actually exercises `../../docs/working-notes/validation/mvp-validation-plan.md`'s "Fault isolation" scenarios against real witness+DUT hardware over real serial ports. Push-button once both boards are flashed and wired, not manual typing into two terminal sessions.
- `run_gpio_pwm_timer_checks.py` -- the driver script for Tier 1's GPIO/timer node batch's hardware pass (interrupt, pwm_out, timer -- gpio_out was already covered indirectly by the fault-isolation script's own GPIO12 use). Same pattern as `run_fault_isolation_checks.py`: deploys hand-written flows matching the real node codegen (`editor/src/node-library/{interrupt,pwm-out,timer}.ts`) over the real §13 protocol, drives/observes via the witness's `DRIVE_GPIO`/`DRIVE_BOUNCE`/`WATCH_EDGES`/`MEASURE_PWM` commands. 2026-08-17: `check_gpio_in` replaced by `check_interrupt` (Mike's explicit call when gpio_in's removal surfaced this script as an unanticipated stop condition -- repurpose rather than just drop its coverage), which also validates the node's debounce cooldown against a real simulated-bounce sequence (`DRIVE_BOUNCE`), not just a clean single edge.

## Witness firmware: command protocol

Line-based text, one line in, one or more lines out. Full detail (exact reply shapes, error cases) in `witness_firmware.py`'s own header comment -- summary:

| Command | Used for |
|---|---|
| `PING` | connectivity check |
| `DRIVE_GPIO <pin> <value>` | `interrupt` node validation -- witness drives a known clean signal |
| `DRIVE_BOUNCE <pin> <final_value> <bounces> <interval_ms>` | `interrupt` node debounce validation -- witness simulates a bouncy mechanical transition |
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

For the GPIO/timer node batch's hardware pass, same setup, different script:

```sh
python3 run_gpio_pwm_timer_checks.py --witness-port /dev/ttyUSB0 --dut-port /dev/ttyUSB1 --mpy-cross /path/to/mpy-cross
```

Runs, in order: `interrupt` (witness drives DUT GPIO4 both HIGH and LOW via `DRIVE_GPIO`, confirms a real deployed interrupt→gpio_out mirror flow fires and propagates each correctly via the hard-IRQ-to-`ThreadSafeEvent`-to-coroutine handoff, observed via `WATCH_EDGES`; then drives one `DRIVE_BOUNCE` sequence and confirms the node's debounce cooldown suppresses it entirely -- zero additional mirrored edges), `pwm_out` (deploys a fixed 1000Hz/50%-duty flow, confirms via `MEASURE_PWM` within a loose tolerance -- this rig's own documented breadboard ringing, see `pin-map.md`, means don't expect lab-instrument precision here), and `timer` (deploys a 300ms-interval flow toggling a pin, confirms via `WATCH_EDGES`'s edge timestamps that the actual inter-edge interval is close to configured). Same pass/fail summary format as the fault-isolation script.

## Open items this doc doesn't resolve

- The I2C pin conflict noted in pin-map.md -- pick a resolution before that pair gets wired (not needed for this task).
- External I2C pull-ups (~4.7kΩ) -- unchanged from pin-map.md's own note, not relevant until I2C is wired.
- `I2C_SLAVE_EMULATE` itself -- pending the slave-mode spike, Tier 1 scope.
