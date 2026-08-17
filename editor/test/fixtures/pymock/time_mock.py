# Minimal stand-in for MicroPython's time.ticks_ms()/time.ticks_diff(),
# used only to run generated flow code through real CPython in tests (this
# sandbox has no MicroPython -- see
# docs/working-notes/validation/mvp-validation-plan.md). Real Python's
# stdlib `time` module has neither function -- MicroPython-specific -- so
# without this fixture, any generated code that calls them (interrupt.ts's
# debounce cooldown) would hit an AttributeError the instant it ran.
#
# NOT named time.py, unlike every other fixture in this directory (machine.py,
# network.py, mqtt_as.py) -- deliberately, not an oversight. Those all rely
# on this directory being first on PYTHONPATH so a generated `import X`
# resolves here instead of (or because there is no) a same-named stdlib
# module. `time` doesn't work that way: it's a true CPython built-in
# (`"time" in sys.builtin_module_names`), resolved by the interpreter's
# built-in importer before the path-based finder ever runs, so no PYTHONPATH
# placement can shadow it -- a real gap in this project's off-device-test
# convention, only surfaced now because no vendored/mocked module before
# this one happened to collide with a CPython builtin name. The workaround,
# done once here rather than generalized speculatively: whatever test needs
# this must explicitly inject it as sys.modules["time"] before the generated
# snippet's own `import time` runs -- see node-interrupt.test.ts's runEvents,
# which does exactly that. Worth knowing about if a future vendored module
# ever collides with another CPython builtin name (`os`, `sys`, `io`, etc.).
#
# Test-controllable rather than wall-clock-based, matching machine.py's
# Pin.INPUT_VALUES pattern: a test drives CLOCK.now directly to get exact,
# deterministic control over debounce timing decisions (e.g. "an edge 10ms
# after the last accepted one is still within a 50ms cooldown") instead of
# a real-clock test that would be slow and flaky.
#
# Passes through anything it doesn't define itself (monotonic, sleep,
# etc.) to the real stdlib `time` module -- not just tidiness. A real run
# hit this directly: a genuinely different bug in the test harness raised
# an exception, and reporting that exception needed `threading`, which
# does `from time import monotonic` -- since sys.modules["time"] was
# already swapped to this mock (node-interrupt.test.ts's runEvents does
# that before running any generated snippet), that import failed too,
# burying the real error under an unrelated ImportError from Python's own
# internals rather than showing it. `_real_time` is captured at THIS
# module's own import time, before anything has redirected sys.modules
# ["time"] yet (that redirect happens one line later, in the generated
# test script, after `import time_mock` has already completed) -- so this
# is a genuine reference to the real builtin, not circular.

import time as _real_time


class _Clock:
    now = 0


CLOCK = _Clock()


def ticks_ms():
    return CLOCK.now


def ticks_diff(a, b):
    # Real MicroPython's ticks_diff() handles wraparound at a platform-
    # specific bit width; no test here drives CLOCK.now anywhere near that
    # range, so plain subtraction is faithful enough for what these tests
    # actually check.
    return a - b


def __getattr__(name):
    # PEP 562 module-level __getattr__ -- only reached for names this
    # mock doesn't define itself (ticks_ms/ticks_diff/CLOCK above all
    # resolve normally first). `from time import monotonic` and similar
    # fall through to here and get the real implementation.
    return getattr(_real_time, name)
