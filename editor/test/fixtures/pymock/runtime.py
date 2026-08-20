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
#
# `sleep_ms` added 2026-08-18 (udp-receive.ts): real CPython asyncio has no
# such method (MicroPython-only, hence node-wifi-status.test.ts's/
# node-mqtt-subscribe.test.ts's own header notes on why THEIR repeatMs
# machinery can't run end-to-end here -- they were written before any node
# needed to actually execute a sleep_ms-driven loop off-device, so they
# just worked around the gap instead of closing it). udp-receive.ts's
# buildMsg is the first node body to call asyncio.sleep_ms ITSELF (not just
# compile.ts's outer per-iteration one) as a real, load-bearing part of its
# own poll/retry logic -- text-matching udp-receive's generated source
# wouldn't actually prove the retry loop works, only that it looks
# plausible. Adding a trivial real implementation here (ms -> real
# asyncio.sleep) closes that gap for good, purely additive (guarded by
# hasattr, and no existing generated code path was reaching this line
# before now, since every prior repeatMs-using test deliberately avoided
# running through this fixture) -- doesn't change any existing test's
# behavior, just makes a previously-impossible one (node-udp-receive.test.ts)
# possible. Fair game for any future node that wants the same.

import asyncio as _asyncio

asyncio = _asyncio

if not hasattr(asyncio, "sleep_ms"):

    async def _sleep_ms(ms):
        await asyncio.sleep(ms / 1000)

    asyncio.sleep_ms = _sleep_ms


# register_cleanup added 2026-08-20 (redeploy-cleanup-and-network-fault-
# detection-briefing.md, Problem 1): udp-send.ts/udp-receive.ts's
# generated setup statements now self-register a socket-close cleanup via
# `runtime.register_cleanup(key, fn)` right where they create the socket.
# This fixture doesn't need to ever actually invoke a registered cleanup
# (no test here calls a redeploy-equivalent path) -- it just needs to
# exist so running that generated setup code through this mock doesn't
# raise AttributeError, mirroring the real runtime.py's dedup-by-key
# contract closely enough to be a faithful stand-in either way.
_cleanups = {}


def register_cleanup(key, fn):
    if key not in _cleanups:
        _cleanups[key] = fn


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
