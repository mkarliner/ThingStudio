# SPDX-License-Identifier: Apache-2.0
# test/hil/witness_firmware.py
#
# The witness board's firmware -- one small, reusable, configurable image,
# not one-off code per test, per
# docs/working-notes/validation/mvp-validation-plan.md's "Hardware-in-the-
# loop rig: witness + DUT" section and fault-isolation-briefing.md's
# "Witness firmware contract". Flashed once onto the witness board (the
# second LuatOS CORE-ESP32-C3 -- see test/hil/pin-map.md), driven over ITS
# OWN independent USB serial link with a simple line-based text protocol.
# Deliberately NOT §13's CBOR/framing protocol -- this is test
# infrastructure observing/stimulating the DUT, not the product's own
# runtime, "same spirit as the POCs' own ad hoc harness protocols" per the
# validation plan.
#
# Commands (one line in, one or more lines out, always terminated by a
# single-word status/summary line so a driver script knows when a command
# is done without guessing):
#
#   PING
#     -> PONG
#
#   DRIVE_GPIO <pin> <value>
#     Configure <pin> as an output (idempotent -- safe to call repeatedly)
#     and set it to 0 or 1. Used for gpio_in node validation: the witness
#     drives a known signal, the DUT is expected to read it.
#     -> DRIVE_OK <pin> <value>
#     -> DRIVE_ERR <reason>
#
#   WATCH_EDGES <pin> <duration_ms>
#     Arms an IRQ on <pin> (both edges), waits <duration_ms>, reports every
#     edge seen as a (timestamp_us, new_value) pair via ticks_us() -- exact
#     transition timestamps instead of eyeballing an LED (gpio_out node
#     validation; test/hil/pin-map.md wires DUT GPIO12 -> witness GPIO3 for
#     this).
#     -> EDGES <pin> <count>
#     -> EDGE <ticks_us> <value>          (repeated <count> times)
#     -> EDGES_DONE
#
#   MEASURE_PWM <pin> <n_cycles> <timeout_ms>
#     Edge-captures on <pin> until <n_cycles> full periods (rising-edge to
#     rising-edge) are observed or <timeout_ms> elapses, then reports
#     average frequency and duty cycle -- PWM duty-cycle/frequency
#     measurement (test/hil/pin-map.md: DUT GPIO6 -> witness GPIO7).
#     -> PWM_RESULT <pin> freq_hz=<f> duty_pct=<d> cycles=<n>
#     -> PWM_ERR <reason>                 (e.g. timeout with too few edges)
#
#   HEARTBEAT_WATCH <pin> <timeout_ms> <min_transitions>
#     Watches <pin> for at least <min_transitions> level changes within
#     <timeout_ms> -- the fault-injection soak test's independent liveness
#     check (design doc §5 / the validation plan: POC-D's worst bug took
#     its own *printed* heartbeat down with the rest of a wedged event
#     loop, so self-reported liveness can't be trusted for exactly this
#     test; this pin is watched directly instead). test/hil/pin-map.md:
#     DUT GPIO10 -> witness GPIO0.
#     -> HEARTBEAT_OK <pin> transitions=<n>
#     -> HEARTBEAT_TIMEOUT <pin> transitions=<n>
#
#   I2C_SLAVE_EMULATE <addr> <register_map>
#     Not implemented -- gated on the I2C/SPI slave-mode spike
#     (mvp-validation-plan.md: "genuinely optional for *this* task... only
#     run it now if it's cheap to fold in alongside the rig build").
#     Responds, doesn't silently drop, so a driver script sees a clear
#     reason rather than a hanging read.
#     -> ERR I2C_SLAVE_EMULATE not implemented (pending slave-mode spike, see mvp-validation-plan.md)
#
# Any unparseable line, wrong argument count, or non-numeric argument gets
# a clear ERR reply and the dispatch loop keeps going -- one bad command
# from a driver script shouldn't require a physical reflash to recover
# from, same "never crash on adversarial input" spirit as the DUT's own
# listener.py, even though this file isn't held to that file's stricter
# time-bounded-read bar (this is test infrastructure with a human or a
# driver script on the other end, not a device fielding untrusted input in
# the field).

import sys
import gc
import utime

try:
    import machine
except ImportError:
    machine = None  # lets this file be imported (not run) off-device for a syntax/structure check


def _pin_in(pin_num, pull=None):
    """`pull` matters for the watching commands below (WATCH_EDGES,
    MEASURE_PWM, HEARTBEAT_WATCH): a real hardware run observed a steady,
    very regular ~27-29us-spaced edge burst on the watch pin even before
    any flow had been deployed on the DUT -- i.e. while the DUT's
    corresponding output pin was still undriven/floating. A floating input
    with no pull is an antenna; that pattern (near-constant period, no
    correlation with any real DUT activity) is more consistent with
    picked-up ambient EMI than with a real signal or true crosstalk. A
    defined idle level via an internal pull-down should hold the pin
    steady until something actually drives it. If this doesn't fully
    resolve it, the ESP32's internal pulls are weak (~45k ohm) and a
    physical ~4.7k external pull-down would be the next step."""
    return machine.Pin(pin_num, machine.Pin.IN, pull)


def _arm_irq(pin, handler):
    """Arms an edge IRQ on `pin`. A real hardware run of this task's own
    driver script hit a MemoryError ("allocating 16384 bytes") on the
    FIRST WATCH_EDGES/MEASURE_PWM/HEARTBEAT_WATCH call in a session --
    almost certainly ESP32's GPIO interrupt service needing a one-time
    chunk of memory on first use, hitting heap fragmentation (a later
    call using the identical pin.irq() pattern succeeded once that cost
    had already been paid). gc.collect() right before arming maximizes
    contiguous free heap for that one-time allocation -- cheap, and
    exactly the kind of defensive move worth having regardless of the
    precise root cause."""
    gc.collect()
    pin.irq(trigger=machine.Pin.IRQ_RISING | machine.Pin.IRQ_FALLING, handler=handler)


def _pin_out(pin_num):
    return machine.Pin(pin_num, machine.Pin.OUT)


_output_pins = {}  # pin_num -> configured machine.Pin(OUT), reused across DRIVE_GPIO calls

# A real GPIO transition is 1-2 edges; even a fast PWM signal captured for
# a couple seconds is a few hundred. This bounds the worst case instead:
# a real hardware run (docs/working-notes/validation/mvp-validation-plan.md's
# dated Results entry) hit real electrical noise on a jumper -- 352 edges
# in just a 10ms window, all reading the same value, i.e. the interrupt
# re-firing without a real level change -- and without a cap, WATCH_EDGES'
# and MEASURE_PWM's `edges` list grows without bound for as long as the
# noise continues, eventually exhausting the heap (that run's actual
# failure: a MemoryError raised repeatedly from inside the edge handler
# itself, badly enough that even MicroPython's own exception-message
# formatting broke under the memory pressure). Hitting this cap always
# means "stop and report a clear, bounded error," never "silently return
# a truncated-but-plausible-looking result" -- a noise storm looks nothing
# like a real signal, so there's no reasonable partial answer to salvage.
_MAX_WATCH_EDGES = 2000


def _cmd_ping(args):
    if args:
        return ["ERR PING takes no arguments"]
    return ["PONG"]


def _cmd_drive_gpio(args):
    if len(args) != 2:
        return ["DRIVE_ERR expected: DRIVE_GPIO <pin> <value>"]
    try:
        pin_num = int(args[0])
        value = int(args[1])
    except ValueError:
        return ["DRIVE_ERR pin and value must be integers"]
    if value not in (0, 1):
        return ["DRIVE_ERR value must be 0 or 1"]
    try:
        if pin_num not in _output_pins:
            _output_pins[pin_num] = _pin_out(pin_num)
        _output_pins[pin_num].value(value)
    except Exception as e:  # noqa: BLE001 -- a bad pin number is adversarial-shaped input here too
        return ["DRIVE_ERR %r" % (e,)]
    return ["DRIVE_OK %d %d" % (pin_num, value)]


def _cmd_watch_edges(args):
    if len(args) != 2:
        return ["EDGES_ERR expected: WATCH_EDGES <pin> <duration_ms>"]
    try:
        pin_num = int(args[0])
        duration_ms = int(args[1])
    except ValueError:
        return ["EDGES_ERR pin and duration_ms must be integers"]
    if duration_ms <= 0:
        return ["EDGES_ERR duration_ms must be positive"]

    edges = []
    stopped_early = [False]  # boxed, same closure-mutation pattern _cmd_heartbeat_watch already uses

    def _on_edge(p):
        edges.append((utime.ticks_us(), p.value()))
        if len(edges) >= _MAX_WATCH_EDGES:
            stopped_early[0] = True
            p.irq(handler=None)

    try:
        pin = _pin_in(pin_num, pull=machine.Pin.PULL_DOWN)
        _arm_irq(pin, _on_edge)
    except Exception as e:  # noqa: BLE001
        return ["EDGES_ERR %r" % (e,)]

    # Polls in short increments rather than one long sleep_ms(duration_ms)
    # specifically so hitting the cap can return early instead of still
    # waiting out the rest of a multi-second duration_ms once there's
    # nothing more to learn -- same style _cmd_measure_pwm's own
    # early-stop-on-enough-cycles loop already uses below.
    deadline = utime.ticks_add(utime.ticks_ms(), duration_ms)
    while utime.ticks_diff(deadline, utime.ticks_ms()) > 0:
        if stopped_early[0]:
            break
        utime.sleep_ms(5)
    pin.irq(handler=None)

    if stopped_early[0]:
        return [
            "EDGES_ERR too many edges (>= %d) captured on pin %d -- likely signal noise or a bad connection, not a clean transition; capture stopped early"
            % (_MAX_WATCH_EDGES, pin_num)
        ]

    out = ["EDGES %d %d" % (pin_num, len(edges))]
    out += ["EDGE %d %d" % (t, v) for t, v in edges]
    out.append("EDGES_DONE")
    return out


def _cmd_measure_pwm(args):
    if len(args) != 3:
        return ["PWM_ERR expected: MEASURE_PWM <pin> <n_cycles> <timeout_ms>"]
    try:
        pin_num = int(args[0])
        n_cycles = int(args[1])
        timeout_ms = int(args[2])
    except ValueError:
        return ["PWM_ERR pin, n_cycles, and timeout_ms must be integers"]
    if n_cycles < 1:
        return ["PWM_ERR n_cycles must be at least 1"]

    edges = []  # (ticks_us, value)
    stopped_early = [False]

    def _on_edge(p):
        edges.append((utime.ticks_us(), p.value()))
        rising = [t for t, v in edges if v == 1]
        if len(rising) >= n_cycles + 1:
            p.irq(handler=None)  # captured enough full periods -- stop early rather than waiting out the full timeout
        elif len(edges) >= _MAX_WATCH_EDGES:
            # A real PWM signal reaches n_cycles rising edges long before
            # this many total edges accumulate -- getting here means
            # something (not a clean PWM waveform) kept the IRQ firing
            # without ever completing n_cycles periods. Same cap/reasoning
            # as _cmd_watch_edges above.
            stopped_early[0] = True
            p.irq(handler=None)

    try:
        pin = _pin_in(pin_num, pull=machine.Pin.PULL_DOWN)
        _arm_irq(pin, _on_edge)
    except Exception as e:  # noqa: BLE001
        return ["PWM_ERR %r" % (e,)]

    deadline = utime.ticks_add(utime.ticks_ms(), timeout_ms)
    while utime.ticks_diff(deadline, utime.ticks_ms()) > 0:
        rising = [t for t, v in edges if v == 1]
        if len(rising) >= n_cycles + 1 or stopped_early[0]:
            break
        utime.sleep_ms(5)
    pin.irq(handler=None)

    if stopped_early[0]:
        return [
            "PWM_ERR too many edges (>= %d) captured on pin %d before reaching %d cycles -- likely signal noise or a bad connection, not a clean PWM waveform"
            % (_MAX_WATCH_EDGES, pin_num, n_cycles)
        ]

    return _pwm_result_from_edges(pin_num, edges, timeout_ms)


def _pwm_result_from_edges(pin_num, edges, timeout_ms):
    """The actual frequency/duty-cycle computation, pulled out of
    _cmd_measure_pwm so it's testable against a synthetic edge list without
    any real IRQ/timing involved (device-runtime-style off-device testing
    -- see test/hil/test_witness_firmware.py). `edges` is a list of
    (ticks_us, value) pairs in chronological order, exactly the shape
    _cmd_measure_pwm's IRQ handler accumulates."""
    rising = [t for t, v in edges if v == 1]
    if len(rising) < 2:
        return ["PWM_ERR timed out: only %d rising edge(s) observed in %dms (need at least 2)" % (len(rising), timeout_ms)]

    periods_us = [utime.ticks_diff(rising[i + 1], rising[i]) for i in range(len(rising) - 1)]
    avg_period_us = sum(periods_us) / len(periods_us)
    freq_hz = 1_000_000.0 / avg_period_us if avg_period_us > 0 else 0.0

    # Duty cycle: for each rising edge, find the next falling edge after it
    # and within the same period.
    duty_samples = []
    for i in range(len(rising) - 1):
        period_start, period_end = rising[i], rising[i + 1]
        falling_in_period = [t for t, v in edges if v == 0 and _between(t, period_start, period_end)]
        if falling_in_period:
            high_us = utime.ticks_diff(falling_in_period[0], period_start)
            period_us = utime.ticks_diff(period_end, period_start)
            if period_us > 0:
                duty_samples.append(100.0 * high_us / period_us)

    duty_pct = sum(duty_samples) / len(duty_samples) if duty_samples else -1.0  # -1 signals "couldn't determine" (e.g. always-high signal, no falling edge captured)

    return ["PWM_RESULT %d freq_hz=%.2f duty_pct=%.2f cycles=%d" % (pin_num, freq_hz, duty_pct, len(periods_us))]


def _between(t, start, end):
    return utime.ticks_diff(t, start) >= 0 and utime.ticks_diff(end, t) >= 0


def _cmd_heartbeat_watch(args):
    if len(args) != 3:
        return ["HEARTBEAT_ERR expected: HEARTBEAT_WATCH <pin> <timeout_ms> <min_transitions>"]
    try:
        pin_num = int(args[0])
        timeout_ms = int(args[1])
        min_transitions = int(args[2])
    except ValueError:
        return ["HEARTBEAT_ERR pin, timeout_ms, and min_transitions must be integers"]

    transitions = [0]  # boxed so the closure can mutate it without `nonlocal` (MicroPython supports nonlocal, but this matches this file's other handlers' style)

    def _on_edge(p):
        transitions[0] += 1

    try:
        pin = _pin_in(pin_num, pull=machine.Pin.PULL_DOWN)
        _arm_irq(pin, _on_edge)
    except Exception as e:  # noqa: BLE001
        return ["HEARTBEAT_ERR %r" % (e,)]

    deadline = utime.ticks_add(utime.ticks_ms(), timeout_ms)
    while utime.ticks_diff(deadline, utime.ticks_ms()) > 0:
        if transitions[0] >= min_transitions:
            break
        utime.sleep_ms(10)
    pin.irq(handler=None)

    if transitions[0] >= min_transitions:
        return ["HEARTBEAT_OK %d transitions=%d" % (pin_num, transitions[0])]
    return ["HEARTBEAT_TIMEOUT %d transitions=%d" % (pin_num, transitions[0])]


def _cmd_i2c_slave_emulate(args):
    return ["ERR I2C_SLAVE_EMULATE not implemented (pending slave-mode spike, see mvp-validation-plan.md)"]


_COMMANDS = {
    "PING": _cmd_ping,
    "DRIVE_GPIO": _cmd_drive_gpio,
    "WATCH_EDGES": _cmd_watch_edges,
    "MEASURE_PWM": _cmd_measure_pwm,
    "HEARTBEAT_WATCH": _cmd_heartbeat_watch,
    "I2C_SLAVE_EMULATE": _cmd_i2c_slave_emulate,
}


def handle_line(line):
    """Parses and dispatches one command line, returns a list of reply
    lines (never raises -- any exception in a handler is caught here so
    one bad command can't take down the whole session)."""
    line = line.strip()
    if not line:
        return []
    parts = line.split()
    cmd, args = parts[0], parts[1:]
    handler = _COMMANDS.get(cmd)
    if handler is None:
        return ["ERR unknown command: %s" % (cmd,)]
    try:
        return handler(args)
    except Exception as e:  # noqa: BLE001 -- a handler bug must not kill the session; report it and keep going
        return ["ERR %s handler failed: %r" % (cmd, e)]


def main():
    print("WITNESS_READY")
    while True:
        try:
            line = sys.stdin.readline()
        except Exception as e:  # noqa: BLE001
            print("ERR readline failed: %r" % (e,))
            continue
        if not line:
            utime.sleep_ms(20)
            continue
        for reply in handle_line(line):
            print(reply)


if __name__ == "__main__":
    main()
