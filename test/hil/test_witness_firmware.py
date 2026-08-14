# SPDX-License-Identifier: Apache-2.0
# test/hil/test_witness_firmware.py
#
# Off-device tests for witness_firmware.py, run against the headless
# MicroPython unix-port build (same one device-runtime/test/README.md
# documents building). Real IRQ-triggered IO timing is inherently a
# hardware-only concern (same reasoning the validation plan already
# applies everywhere else in this project) -- what's actually covered
# here without a board: command parsing/argument validation (every ERR
# path), DRIVE_GPIO's synchronous pin-set behavior (no timing involved, a
# fake machine.Pin is enough to verify it end-to-end), and the PWM
# frequency/duty-cycle math itself (_pwm_result_from_edges), which is
# pulled out of _cmd_measure_pwm specifically so it's testable against a
# synthetic edge list -- this is the part most likely to have an actual
# arithmetic bug, and the part real hardware testing would be slowest to
# catch a regression in (you'd have to notice a slightly-wrong duty-cycle
# number, not a crash).

import sys

# minitest.py lives in device-runtime/test/, not here -- reused rather
# than duplicated (see that file's own header for why it exists at all:
# no `unittest` module in this project's MicroPython build).
_this_dir = __file__.rsplit("/", 1)[0] if "/" in __file__ else "."
sys.path.insert(0, _this_dir + "/../../device-runtime/test")
import minitest

# A fake `machine` module, injected into sys.modules BEFORE importing
# witness_firmware, so its `import machine` succeeds and DRIVE_GPIO can be
# exercised end-to-end without real hardware. witness_firmware.py itself
# already degrades to `machine = None` when this isn't present (e.g. if
# this test file is skipped) -- this is strictly additive, not a change to
# how the real firmware behaves when actually flashed.


class _FakePin:
    IN = "IN"
    OUT = "OUT"
    IRQ_RISING = 1
    IRQ_FALLING = 2

    def __init__(self, num, mode):
        self.num = num
        self.mode = mode
        self._value = 0
        self._handler = None

    def value(self, v=None):
        if v is None:
            return self._value
        self._value = v

    def irq(self, trigger=0, handler=None):
        # Real edge-triggered TIMING is a hardware-only concern (this
        # file's header) -- but storing/invoking the handler synchronously
        # is enough to drive the edge-count-cap logic in
        # _cmd_watch_edges/_cmd_measure_pwm off-device (test_..._cap_stops_...
        # below), which is really just "does this list stop growing once
        # it hits N", not a timing question at all.
        self._handler = handler

    def fire(self, value):
        """Test helper: simulates one interrupt firing with `value` as the
        pin's level at that instant. No-op if nothing's currently armed
        (mirrors real hardware after `.irq(handler=None)`)."""
        self._value = value
        if self._handler is not None:
            self._handler(self)


class _NoisyFakePin(_FakePin):
    """A fake pin whose irq() immediately fires a whole burst of synthetic
    edges (values from `pattern`, in order) as soon as it's armed -- enough
    to drive _MAX_WATCH_EDGES's cap logic (witness_firmware.py) off-device
    without needing real concurrent interrupt timing, which this file's
    header already scopes out as hardware-only. The cap itself exists
    because of a real hardware run
    (docs/working-notes/validation/mvp-validation-plan.md's dated Results
    entry) that hit exactly this: a jumper picking up 352 spurious edges
    in a 10ms window, cascading into a MemoryError inside the edge
    handler once a real multi-second capture ran."""

    def __init__(self, num, mode, pattern):
        super().__init__(num, mode)
        self._pattern = pattern

    def irq(self, trigger=0, handler=None):
        super().irq(trigger, handler)
        if handler is not None:
            for v in self._pattern:
                if self._handler is None:  # disarmed itself mid-storm (p.irq(handler=None)) -- matches the real early-stop behavior under test
                    break
                self.fire(v)


class _FakeMachine:
    Pin = _FakePin


sys.modules["machine"] = _FakeMachine()

minitest.add_src_to_path()  # not actually needed (witness_firmware.py is a sibling of this test file), kept for import-order clarity
sys.path.insert(0, _this_dir)
import witness_firmware  # noqa: E402


# --- command parsing / argument validation --------------------------------


def test_ping():
    assert witness_firmware.handle_line("PING") == ["PONG"]


def test_ping_rejects_arguments():
    out = witness_firmware.handle_line("PING extra")
    assert len(out) == 1 and out[0].startswith("ERR")


def test_unknown_command():
    out = witness_firmware.handle_line("FROBNICATE 1 2 3")
    assert out == ["ERR unknown command: FROBNICATE"]


def test_empty_line_is_a_noop():
    assert witness_firmware.handle_line("") == []
    assert witness_firmware.handle_line("   ") == []


def test_drive_gpio_wrong_arg_count():
    out = witness_firmware.handle_line("DRIVE_GPIO 5")
    assert len(out) == 1 and out[0].startswith("DRIVE_ERR")


def test_drive_gpio_non_integer_args():
    out = witness_firmware.handle_line("DRIVE_GPIO five 1")
    assert len(out) == 1 and out[0].startswith("DRIVE_ERR")


def test_drive_gpio_rejects_non_binary_value():
    out = witness_firmware.handle_line("DRIVE_GPIO 5 2")
    assert len(out) == 1 and "0 or 1" in out[0]


def test_watch_edges_wrong_arg_count():
    out = witness_firmware.handle_line("WATCH_EDGES 3")
    assert len(out) == 1 and out[0].startswith("EDGES_ERR")


def test_watch_edges_rejects_non_positive_duration():
    out = witness_firmware.handle_line("WATCH_EDGES 3 0")
    assert len(out) == 1 and out[0].startswith("EDGES_ERR")


def test_measure_pwm_rejects_zero_cycles():
    out = witness_firmware.handle_line("MEASURE_PWM 7 0 1000")
    assert len(out) == 1 and "n_cycles" in out[0]


def test_heartbeat_watch_wrong_arg_count():
    out = witness_firmware.handle_line("HEARTBEAT_WATCH 0 1000")
    assert len(out) == 1 and out[0].startswith("HEARTBEAT_ERR")


def test_i2c_slave_emulate_reports_not_implemented():
    out = witness_firmware.handle_line("I2C_SLAVE_EMULATE 0x40 somemap")
    assert len(out) == 1 and "not implemented" in out[0]


# --- DRIVE_GPIO end-to-end against the fake Pin ---------------------------


def test_drive_gpio_sets_and_reads_back_via_fake_pin():
    witness_firmware._output_pins.clear()
    out = witness_firmware.handle_line("DRIVE_GPIO 5 1")
    assert out == ["DRIVE_OK 5 1"]
    assert witness_firmware._output_pins[5].value() == 1

    out2 = witness_firmware.handle_line("DRIVE_GPIO 5 0")
    assert out2 == ["DRIVE_OK 5 0"]
    assert witness_firmware._output_pins[5].value() == 0  # same Pin object reused, not re-created


# --- PWM math, against synthetic edge lists (the actual bug-prone part) --


def test_pwm_math_50_percent_duty_1khz():
    # 1kHz, 50% duty: period = 1000us, high for 500us. Three full periods
    # (4 rising edges) starting at t=0.
    edges = []
    t = 0
    for _ in range(4):
        edges.append((t, 1))  # rising
        edges.append((t + 500, 0))  # falling, 500us later
        t += 1000
    out = witness_firmware._pwm_result_from_edges(6, edges, 1000)
    assert len(out) == 1
    line = out[0]
    assert line.startswith("PWM_RESULT 6 ")
    assert "freq_hz=1000.00" in line
    assert "duty_pct=50.00" in line
    assert "cycles=3" in line


def test_pwm_math_25_percent_duty_2khz():
    # 2kHz, 25% duty: period = 500us, high for 125us.
    edges = []
    t = 0
    for _ in range(5):
        edges.append((t, 1))
        edges.append((t + 125, 0))
        t += 500
    out = witness_firmware._pwm_result_from_edges(6, edges, 1000)
    line = out[0]
    assert "freq_hz=2000.00" in line
    assert "duty_pct=25.00" in line
    assert "cycles=4" in line


def test_pwm_math_too_few_edges_reports_error_not_garbage():
    out = witness_firmware._pwm_result_from_edges(6, [(0, 1)], 500)
    assert len(out) == 1
    assert out[0].startswith("PWM_ERR")
    assert "500" in out[0]


def test_pwm_math_handles_ticks_us_wraparound():
    # utime.ticks_us() wraps around periodically on real hardware
    # (MicroPython's documented ticks_diff()-safe arithmetic model, not a
    # plain integer subtraction) -- construct an edge list that straddles
    # a wrap point near the top of the ticks range and confirm the period/
    # duty math (which uses utime.ticks_diff/ticks_add throughout, never
    # raw subtraction) still comes out right rather than silently
    # producing a huge bogus period.
    import utime

    near_top = (1 << 29) - 200  # unix port's ticks period is 2**29 on typical builds; comfortably close to a wrap either way
    edges = [
        (near_top, 1),
        (utime.ticks_add(near_top, 250), 0),
        (utime.ticks_add(near_top, 1000), 1),
        (utime.ticks_add(near_top, 1250), 0),
        (utime.ticks_add(near_top, 2000), 1),
    ]
    out = witness_firmware._pwm_result_from_edges(6, edges, 1000)
    line = out[0]
    assert "freq_hz=1000.00" in line
    assert "duty_pct=25.00" in line


# --- edge-count cap: a real noise storm must stop cleanly, not exhaust memory ---


def test_watch_edges_stops_early_on_a_noise_storm():
    storm = [1] * (witness_firmware._MAX_WATCH_EDGES + 50)  # constant value=1, same shape the real hardware run actually hit
    noisy = _NoisyFakePin(3, _FakePin.IN, pattern=storm)
    original_pin_in = witness_firmware._pin_in
    witness_firmware._pin_in = lambda pin_num: noisy
    try:
        out = witness_firmware.handle_line("WATCH_EDGES 3 1000")
    finally:
        witness_firmware._pin_in = original_pin_in
    assert len(out) == 1
    assert out[0].startswith("EDGES_ERR")
    assert "too many edges" in out[0]


def test_watch_edges_does_not_cap_a_normal_small_edge_count():
    # Confirms the cap doesn't false-positive on an ordinary result --
    # a real gpio_out-style single transition (one edge) reports normally.
    noisy = _NoisyFakePin(3, _FakePin.IN, pattern=[1])
    original_pin_in = witness_firmware._pin_in
    witness_firmware._pin_in = lambda pin_num: noisy
    try:
        out = witness_firmware.handle_line("WATCH_EDGES 3 1000")
    finally:
        witness_firmware._pin_in = original_pin_in
    assert out[0] == "EDGES 3 1"
    assert out[1] == "EDGE 0 1"
    assert out[2] == "EDGES_DONE"


def test_measure_pwm_stops_early_on_a_noise_storm_instead_of_hanging_or_exhausting_memory():
    # Alternating 1/0 -- a shape that would otherwise look like real PWM
    # edges -- but with a requested n_cycles so high the edge-count cap
    # has to be what stops this, not the normal "enough cycles observed"
    # success path. Isolates the cap specifically, rather than relying on
    # "MEASURE_PWM handles a noisy signal by coincidence."
    storm = [i % 2 for i in range(witness_firmware._MAX_WATCH_EDGES + 50)]
    noisy = _NoisyFakePin(7, _FakePin.IN, pattern=storm)
    original_pin_in = witness_firmware._pin_in
    witness_firmware._pin_in = lambda pin_num: noisy
    try:
        out = witness_firmware.handle_line("MEASURE_PWM 7 999999 1000")
    finally:
        witness_firmware._pin_in = original_pin_in
    assert len(out) == 1
    assert out[0].startswith("PWM_ERR")
    assert "too many edges" in out[0]


minitest.run(
    [
        test_ping,
        test_ping_rejects_arguments,
        test_unknown_command,
        test_empty_line_is_a_noop,
        test_drive_gpio_wrong_arg_count,
        test_drive_gpio_non_integer_args,
        test_drive_gpio_rejects_non_binary_value,
        test_watch_edges_wrong_arg_count,
        test_watch_edges_rejects_non_positive_duration,
        test_measure_pwm_rejects_zero_cycles,
        test_heartbeat_watch_wrong_arg_count,
        test_i2c_slave_emulate_reports_not_implemented,
        test_drive_gpio_sets_and_reads_back_via_fake_pin,
        test_pwm_math_50_percent_duty_1khz,
        test_pwm_math_25_percent_duty_2khz,
        test_pwm_math_too_few_edges_reports_error_not_garbage,
        test_pwm_math_handles_ticks_us_wraparound,
        test_watch_edges_stops_early_on_a_noise_storm,
        test_watch_edges_does_not_cap_a_normal_small_edge_count,
        test_measure_pwm_stops_early_on_a_noise_storm_instead_of_hanging_or_exhausting_memory,
    ]
)
