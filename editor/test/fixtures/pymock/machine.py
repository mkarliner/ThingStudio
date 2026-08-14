# Minimal stand-in for MicroPython's `machine` module, used only to run
# compiler output through real CPython in tests (this sandbox has no
# MicroPython -- see docs/working-notes/validation/mvp-validation-plan.md).
# Not a substitute for the real headless-unix-port check; closest thing
# achievable without real MicroPython or hardware.


class Pin:
    OUT = "OUT"
    IN = "IN"

    # Test-controlled input values for gpio_in-style reads, keyed by
    # physical pin number -- set by a test BEFORE running the generated
    # flow (e.g. `machine.Pin.INPUT_VALUES[12] = 1`) to simulate a real
    # stimulus, the software-only analog of the witness rig's
    # DRIVE_GPIO/hardware equivalent. Defaults to 0 for any pin a test
    # hasn't set, preserving every pre-gpio_in test's behavior unchanged
    # (none of them ever called .value() with no args -- gpio_out only
    # ever writes).
    INPUT_VALUES = {}

    def __init__(self, pin, mode):
        self._pin = pin
        self._mode = mode
        print("PIN_INIT %s %s" % (pin, mode))

    def value(self, v=None):
        if v is None:
            return Pin.INPUT_VALUES.get(self._pin, 0)
        print("PIN_VALUE %s %s" % (self._pin, 1 if v else 0))


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
