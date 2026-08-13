# Minimal stand-in for device-runtime/src/runtime.py's spawn()/asyncio/
# NodeError contract, using CPython's real `asyncio` instead of
# MicroPython's `uasyncio`. Only correct for a coroutine that actually
# terminates (the "manual"/run-once inject case) -- `spawn` runs it to
# completion via `asyncio.run()`, which can't stand in for real concurrent
# `while True` flow tasks or real uasyncio task-completion semantics (see
# device-runtime/test/test_runtime.py, run against the real MicroPython
# unix-port build, for that). Good enough for the compiler-output
# regression check this fixture exists for; not a general async test
# harness.
#
# Mirrors device-runtime/src/runtime.py's NodeError/_guarded/spawn shape
# closely enough that compiler-generated try/except-wrapped node calls
# (editor/src/compiler/compile.ts's nodeCallWithFaultBoundary) behave the
# same way here as on-device: an exception is reported (printed, so the
# regression tests can assert on it) rather than propagating and crashing
# the whole mock run.

import asyncio as _asyncio

asyncio = _asyncio


class NodeError(Exception):
    def __init__(self, node_id, orig):
        super().__init__(node_id, orig)
        self.node_id = node_id
        self.orig = orig


async def _guarded(coro, fallback_node_id):
    try:
        await coro
    except NodeError as e:
        print("NODE_ERROR node=%s type=%s msg=%s" % (e.node_id, type(e.orig).__name__, str(e.orig)))
    except Exception as e:
        node_label = fallback_node_id if fallback_node_id is not None else "unknown"
        print("NODE_ERROR node=%s type=%s msg=%s" % (node_label, type(e).__name__, str(e)))


def spawn(coro, node_id=None):
    return _asyncio.run(_guarded(coro, node_id))
