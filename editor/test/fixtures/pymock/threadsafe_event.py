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
# this node replaced it). Backed by plain asyncio.Event, which is correct
# enough for a single-thread, single-core CPython process where nothing
# actually crosses a thread/ISR boundary -- NOT a substitute for the real
# primitive's thread-safety, which only matters, and can only be verified,
# on real hardware.

import asyncio


class ThreadSafeEvent(asyncio.Event):
    pass
