# Minimal stand-in for the vendored ThreadSafeEvent
# (device-runtime/src/vendor/threadsafe_event/threadsafe_event.py), used
# only to run compiler output through real CPython in tests -- see
# docs/working-notes/validation/mvp-validation-plan.md. Not a substitute
# for the real headless-unix-port/hardware check: CPython's asyncio has no
# ThreadSafeFlag (MicroPython-specific, which the real vendored file's
# __init__ constructs), and there is no hard-IRQ context to simulate in a
# CPython test process at all -- no off-device test can exercise the
# actual hard-IRQ-to-asyncio handoff this class exists for (see
# interrupt.ts's own header comment and device-runtime/src/vendor/
# threadsafe_event/README.md's hard-IRQ-safety trace).
#
# This stand-in exists only so generated setup code that constructs a
# ThreadSafeEvent instance doesn't blow up at import/construction time.
# node-interrupt.test.ts never calls .wait()/.set() on it -- it runs the
# node's buildMsg snippet directly, skipping the coroutine/waitStatement
# entirely (same approach node-gpio-in.test.ts used for gpio_in before
# this node replaced it).
#
# Behavior change, 2026-09-02 (inject click-only live-fire feature):
# inject.ts is a SECOND event-source node using this class, and unlike
# interrupt's tests, inject's downstream-node tests (node-debug.test.ts,
# node-function.test.ts, node-mqtt-publish.test.ts, and many more --
# grep the test suite for `thingstudio/inject`) genuinely need
# `.wait()`/`.set()` to work end to end through a real asyncio loop, since
# they run the FULL compiled flow through python3 as a subprocess to
# check a downstream node's actual behavior, not just inject's own
# buildMsg in isolation. That surfaced a real hazard the previous simple
# `class ThreadSafeEvent(asyncio.Event): pass` never hit (nothing
# previously called .wait() on one): compiler-generated setup code
# constructs this at bare module scope, before any event loop is running
# (compile.ts assembles module-level setup statements ahead of the
# coroutines/runtime.spawn() calls that create one) -- and on Python 3.9,
# `asyncio.Event.__init__` eagerly binds to whatever `get_event_loop()`
# returns AT CONSTRUCTION TIME (legacy auto-create-a-loop behavior,
# removed in 3.10), which then mismatches the separate loop
# `runtime.py`'s own `spawn()` creates later via `asyncio.run()`. Result:
# `RuntimeError: Task ... got Future attached to a different loop` --
# textually the exact same class of bug already fixed, for the exact same
# reason, in `mqtt-shared.ts`'s `asyncio.Lock()` (see that file's own
# header for the full trace). Real MicroPython uasyncio's Event/
# ThreadSafeFlag have no equivalent construction-time binding at all, so
# this is purely a CPython test-harness artifact -- fixed HERE, in this
# stand-in, rather than in interrupt.ts/inject.ts's real codegen, since
# module-scope `ThreadSafeEvent()` construction is correct, necessary
# production code with nothing to defer on real hardware.
#
# Fix: defer creating the real `asyncio.Event` until the first actual
# `wait()`/`set()`/`is_set()` call (which only ever happens from inside a
# coroutine, i.e. after `runtime.py`'s `spawn()` has already started a
# real running loop via `asyncio.run()`) -- `self._flag` tracks "has this
# ever been set" independent of whether the real Event object exists yet,
# so `set()` called before any `wait()` (the ordinary click-then-process
# ordering) is never lost.

import asyncio


class ThreadSafeEvent:
    def __init__(self):
        self._flag = False
        self._event = None  # real asyncio.Event, constructed lazily -- see this file's header

    def _ensure(self):
        if self._event is None:
            self._event = asyncio.Event()
            if self._flag:
                self._event.set()

    def set(self):
        self._flag = True
        if self._event is not None:
            self._event.set()

    def clear(self):
        self._flag = False
        if self._event is not None:
            self._event.clear()

    def is_set(self):
        return self._flag

    async def wait(self):
        self._ensure()
        await self._event.wait()
