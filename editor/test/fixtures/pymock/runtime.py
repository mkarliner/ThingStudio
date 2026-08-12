# Minimal stand-in for device-runtime/src/runtime.py's spawn()/asyncio
# contract, using CPython's real `asyncio` instead of MicroPython's
# `uasyncio`. Only correct for a coroutine that actually terminates (the
# "manual"/run-once inject case) -- `spawn` runs it to completion via
# `asyncio.run()`, which can't stand in for real concurrent `while True`
# flow tasks. Good enough for the compiler-output regression check this
# fixture exists for; not a general async test harness.

import asyncio as _asyncio

asyncio = _asyncio


def spawn(coro):
    return _asyncio.run(coro)
