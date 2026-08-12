# Minimal stand-in for MicroPython's `machine` module, used only to run
# compiler output through real CPython in tests (this sandbox has no
# MicroPython -- see docs/working-notes/validation/mvp-validation-plan.md).
# Not a substitute for the real headless-unix-port check; closest thing
# achievable without real MicroPython or hardware.


class Pin:
    OUT = "OUT"
    IN = "IN"

    def __init__(self, pin, mode):
        self._pin = pin
        self._mode = mode
        print("PIN_INIT %s %s" % (pin, mode))

    def value(self, v=None):
        if v is None:
            return 0
        print("PIN_VALUE %s %s" % (self._pin, 1 if v else 0))
