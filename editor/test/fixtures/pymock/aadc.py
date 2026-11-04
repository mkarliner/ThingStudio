# Stand-in for device-runtime/src/vendor/primitives_aadc/aadc.py under CPython, for node-adc.test.ts. The real AADC is
# an io.IOBase polled by MicroPython's StreamReader, which CPython can't run; this keeps its interface and its
# semantics: awaiting aadc(lower, upper) (or aadc(delta)) returns once the reading is outside the bounds (sense
# True, the default) or inside them (sense False), checking the ADC every millisecond.
import asyncio


class AADC:
    def __init__(self, adc):
        self._adc = adc
        self._lower = 0
        self._upper = 65535
        self._pol = True
        self._last = None

    def sense(self, normal):
        self._pol = normal

    def read_u16(self, last=False):
        if last:
            return self._last
        self._last = self._adc.read_u16()
        return self._last

    def __call__(self, lower=None, upper=None):
        if lower is not None:
            if upper is None:
                r = self.read_u16() if self._last is None else self._last
                self._lower = r - lower
                self._upper = r + lower
            else:
                self._lower = lower
                self._upper = upper
        return self

    def __await__(self):
        return self._ready().__await__()

    async def _ready(self):
        while not (self._pol ^ (self._lower <= self.read_u16() <= self._upper)):
            await asyncio.sleep(0.001)
        return self._last
