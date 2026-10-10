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
    # Wall-clock UTC seconds for time.time(); ntptime's mock sets it. None until set (falls through to the real
    # clock, as before).
    epoch = None


CLOCK = _Clock()


def time():
    # Added 2026-10-10 for node-clock.test.ts. Tests set CLOCK.epoch directly.
    return _real_time.time() if CLOCK.epoch is None else CLOCK.epoch


def ticks_ms():
    return CLOCK.now


def ticks_diff(a, b):
    # Real MicroPython's ticks_diff() handles wraparound at a platform-
    # specific bit width; no test here drives CLOCK.now anywhere near that
    # range, so plain subtraction is faithful enough for what these tests
    # actually check.
    return a - b


def ticks_add(t, delta):
    # Added 2026-09-17 for node-eswitch.test.ts/node-ebutton.test.ts: the
    # vendored Delay_ms (device-runtime/src/vendor/primitives_events/
    # delay_ms.py, used by EButton's long-press/double-click timers) calls
    # this to compute an absolute deadline (`ticks_add(ticks_ms(), duration)`
    # in `trigger()`), then `ticks_diff(that deadline, ticks_ms())`
    # immediately after in `_run()` to recover `duration` as the argument
    # to a REAL `asyncio.sleep_ms()` -- these two calls happen back-to-back
    # with no `await` between them, so it's fine that CLOCK.now here is a
    # frozen, test-controlled value rather than a real advancing clock:
    # both calls read the identical frozen snapshot, so `ticks_diff`
    # recovers `duration` exactly regardless of what CLOCK.now actually is.
    # The real passage of time for these tests' long-press/double-click
    # timing comes entirely from that real `asyncio.sleep_ms()` call, not
    # from this clock advancing at all.
    return t + delta


def sleep_ms(ms):
    # Added 2026-09-17 for node-display-spi.test.ts: st7789py.py's own
    # hard_reset()/soft_reset()/init() call `time.sleep_ms(...)` for real
    # panel boot/settle delays (up to ~970ms total across a full init
    # sequence) -- these tests only need the write SEQUENCE to happen
    # correctly, not real elapsed wall-clock time, so this advances the
    # same test-controlled CLOCK ticks_ms()/ticks_add() already use rather
    # than actually blocking -- consistent with this file's own
    # "test-controllable rather than wall-clock-based" design note above,
    # and keeps the test suite fast.
    CLOCK.now += ms


def __getattr__(name):
    # PEP 562 module-level __getattr__ -- only reached for names this
    # mock doesn't define itself (ticks_ms/ticks_diff/CLOCK above all
    # resolve normally first). `from time import monotonic` and similar
    # fall through to here and get the real implementation.
    return getattr(_real_time, name)
