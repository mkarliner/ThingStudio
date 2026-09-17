# Minimal stand-in for MicroPython's `machine` module, used only to run
# compiler output through real CPython in tests (this sandbox has no
# MicroPython -- see docs/working-notes/validation/mvp-validation-plan.md).
# Not a substitute for the real headless-unix-port check; closest thing
# achievable without real MicroPython or hardware.

import time as _real_time


class Pin:
    OUT = "OUT"
    IN = "IN"

    # Added 2026-09-17 for eswitch.ts/ebutton.ts's new `pull` property (real-
    # hardware finding: an EMF 2022 TiDAL badge's buttons need the RP2040's
    # own internal pull-up, which this project's nodes had no way to
    # configure before now). Values are irrelevant here -- like IRQ_RISING/
    # IRQ_FALLING above, nothing in this mock dispatches on them, only
    # codegen-text assertions check the generated Pin(...) call's arguments.
    PULL_UP = "PULL_UP"
    PULL_DOWN = "PULL_DOWN"

    # Real-wall-clock schedule, added for node-eswitch.test.ts/
    # node-ebutton.test.ts: unlike interrupt.ts's own tests (which bypass
    # the coroutine entirely and drive buildMsg directly against
    # time_mock.py's virtual clock, since interrupt's real debounce logic
    # is entirely interrupt.ts's own synchronous code), ESwitch/EButton's
    # actual debounce/long-press/double-click logic lives inside the
    # vendored asyncio driver classes themselves (device-runtime/src/
    # vendor/primitives_events/) -- proving that logic actually works
    # needs a real running asyncio loop and real elapsed time, since
    # that's what `_poll()`'s own `await asyncio.sleep_ms(dt)` actually
    # waits on. SCHEDULE[pin] = [(offset_seconds, value), ...], sorted
    # ascending by offset; T0 is set once (by test setup code, to
    # time.monotonic()) right before the flow starts running. A pin not
    # present in SCHEDULE falls back to INPUT_VALUES's own static value --
    # every pre-existing test's behavior, completely unchanged.
    SCHEDULE = {}
    T0 = None

    # IRQ trigger flags, matching real machine.Pin's bit-flag values closely
    # enough for interrupt.ts's codegen to construct/combine them the same
    # way real MicroPython code would (`IRQ_RISING | IRQ_FALLING` for "both"
    # trigger mode) -- exact numeric values don't matter here since nothing
    # in this mock actually dispatches on them, only interrupt.ts's own
    # codegen-text assertions check the generated expression string.
    IRQ_RISING = 1
    IRQ_FALLING = 2

    # Test-controlled input values for gpio_in-style reads, keyed by
    # physical pin number -- set by a test BEFORE running the generated
    # flow (e.g. `machine.Pin.INPUT_VALUES[12] = 1`) to simulate a real
    # stimulus, the software-only analog of the witness rig's
    # DRIVE_GPIO/hardware equivalent. Defaults to 0 for any pin a test
    # hasn't set, preserving every pre-gpio_in test's behavior unchanged
    # (none of them ever called .value() with no args -- gpio_out only
    # ever writes). Kept under its original name even though gpio_in itself
    # is gone (2026-08-17) -- interrupt.ts's buildMsg reads .value() the
    # same way, and node-interrupt.test.ts drives it the same way node-gpio-
    # in.test.ts did.
    INPUT_VALUES = {}

    def __init__(self, pin, mode, pull=None):
        self._pin = pin
        self._mode = mode
        self._pull = pull
        print("PIN_INIT %s %s pull=%s" % (pin, mode, pull))

    def value(self, v=None):
        if v is None:
            if self._pin in Pin.SCHEDULE and Pin.T0 is not None:
                elapsed = _real_time.monotonic() - Pin.T0
                result = Pin.INPUT_VALUES.get(self._pin, 0)
                for offset, val in Pin.SCHEDULE[self._pin]:
                    if elapsed < offset:
                        break
                    result = val
                return result
            return Pin.INPUT_VALUES.get(self._pin, 0)
        print("PIN_VALUE %s %s" % (self._pin, 1 if v else 0))

    # ESwitch/EButton read pin state via call syntax (`self._pin()`), the
    # real machine.Pin's own documented shorthand for `.value()` with no
    # args -- not used by any pre-existing node in this project (they all
    # call `.value()` explicitly), so added here rather than assumed
    # already covered.
    def __call__(self):
        return self.value()

    def irq(self, trigger=None, handler=None):
        # No real hard-IRQ context exists in a CPython test process, and no
        # off-device test can fire one -- see interrupt.ts's own header and
        # this project's standing note that a real hardware pass is what
        # actually proves the IRQ handler fires and doesn't leak/crash.
        # This only needs to not blow up when interrupt.ts's setup code
        # calls it and to record what was registered, for tests that want
        # to assert on it.
        self._irq_trigger = trigger
        self._irq_handler = handler
        print("PIN_IRQ %s trigger=%s" % (self._pin, trigger))


class PWM:
    """Stand-in for machine.PWM, enough to observe pwm_out.ts's codegen:
    construction (with the wrapped Pin's number and configured freq) and
    every duty_u16() call. Real MicroPython's PWM wraps an already-
    constructed Pin, which is what pwm_out.ts's codegen does too
    (`machine.PWM(machine.Pin(N, machine.Pin.OUT), freq=F)`)."""

    def __init__(self, pin, freq=None, duty_u16=None):
        self._pin = pin
        self._freq = freq
        pin_num = pin._pin if isinstance(pin, Pin) else pin
        print("PWM_INIT %s freq=%s" % (pin_num, freq))
        if duty_u16 is not None:
            self.duty_u16(duty_u16)

    def freq(self, hz=None):
        if hz is None:
            return self._freq
        self._freq = hz

    def duty_u16(self, value=None):
        pin_num = self._pin._pin if isinstance(self._pin, Pin) else self._pin
        if value is None:
            return getattr(self, "_duty", 0)
        self._duty = value
        print("PWM_DUTY %s %s" % (pin_num, value))
