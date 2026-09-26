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


# ThreadSafeFlag added 2026-09-17 (node-eswitch.test.ts/node-ebutton.test.ts):
# real CPython asyncio has no such attribute at all (MicroPython-specific,
# for cross-core/hard-ISR signaling) -- the vendored Delay_ms
# (device-runtime/src/vendor/primitives_events/delay_ms.py, used by
# EButton's long-press/double-click timers) constructs one unconditionally
# in __init__, so running EButton through this fixture needs the name to
# resolve, same reasoning as sleep_ms above. A real hard-IRQ/cross-core
# signal has no CPython equivalent to simulate at all (same limitation
# threadsafe_event.py's own header already states) -- but Delay_ms never
# actually needs cross-core semantics, only "set from anywhere, wait from
# one coroutine, auto-clear on wait return" (MicroPython's own
# ThreadSafeFlag.wait() docs: "flag is automatically reset upon return from
# wait"), which a plain asyncio.Event provides. Deferred-construction of
# the real asyncio.Event, same fix and same reason as threadsafe_event.py's
# own stand-in (module-scope construction, before spawn()'s asyncio.run()
# has started a loop) -- see that file's header for the full trace.
if not hasattr(asyncio, "ThreadSafeFlag"):

    class _ThreadSafeFlag:
        def __init__(self):
            self._flag = False
            self._event = None  # real asyncio.Event, constructed lazily

        def _ensure(self):
            if self._event is None:
                self._event = asyncio.Event()
                if self._flag:
                    self._event.set()

        def set(self):
            self._flag = True
            if self._event is not None:
                self._event.set()

        async def wait(self):
            self._ensure()
            await self._event.wait()
            self._flag = False
            self._event.clear()  # auto-reset on return, per real ThreadSafeFlag semantics

    asyncio.ThreadSafeFlag = _ThreadSafeFlag


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


# report_status added 2026-09-10 (connection-status-indicator feature) --
# mirrors device-runtime/src/runtime.py's real report_status() closely
# enough for generated code that calls it (wifi-status.ts's buildMsg,
# mqtt-shared.ts's setup code) to run under this mock instead of raising
# AttributeError. Prints rather than pushing onto any wire (this fixture
# has no real §13 listener behind it at all), same "printed so a
# regression test can assert on it" convention _guarded()'s own
# NODE_ERROR line above already uses -- node-wifi-status.test.ts's own
# tests grep this exact line shape.
def report_status(node_id, state, text=None):
    print("NODE_STATUS node=%s state=%s text=%s" % (node_id, state, text))


# _report_error added 2026-09-26 (filter.ts): generated code calls it directly to report a fault without
# raising, so the flow keeps running. Same printed NODE_ERROR line as _guarded below.
def _report_error(node_id, exc):
    print("NODE_ERROR node=%s type=%s msg=%s" % (node_id, type(exc).__name__, str(exc)))


# shared() added 2026-09-26 -- same keyed singleton as device-runtime/src/runtime.py's.
_singletons = {}


def shared(kind, key, signature=None, factory=None):
    entry = _singletons.get((kind, key))
    if entry is not None:
        if factory is not None and entry[0] != signature:
            raise ValueError("%s %s is already set up as %r, not %r" % (kind, key, entry[0], signature))
        return entry[1]
    if factory is None:
        raise KeyError("no %s %s in this flow" % (kind, key))
    obj = factory()
    _singletons[(kind, key)] = (signature, obj)
    return obj


async def _guarded(coro, fallback_node_id):
    try:
        await coro
    except NodeError as e:
        print("NODE_ERROR node=%s type=%s msg=%s" % (e.node_id, type(e.orig).__name__, str(e.orig)))
    except Exception as e:
        node_label = fallback_node_id if fallback_node_id is not None else "unknown"
        print("NODE_ERROR node=%s type=%s msg=%s" % (node_label, type(e).__name__, str(e)))


# register_trigger/fire_trigger/_triggers added 2026-09-02 (inject
# click-only live-fire feature) -- the real device-runtime/src/runtime.py
# mirror of the same registry, so generated setup code that calls
# `runtime.register_trigger(node_id, evt)` (inject.ts) doesn't blow up
# under this mock. Unlike the real one, this fixture has no redeploy path
# to clear it on -- each test process runs exactly one compiled flow once,
# so there's nothing analogous to cancel_running() here to hook.
_triggers = {}


def register_trigger(node_id, event):
    _triggers[node_id] = event


def fire_trigger(node_id):
    event = _triggers.get(node_id)
    if event is not None:
        event.set()


# _AUTO_FIRE_DELAY_S / _MAX_RUN_S added the same day, for the same
# feature: this fixture's whole reason for existing is running a compiled
# flow's coroutine to completion so a test can assert on its printed
# output (this file's own header) -- correct only for a source that
# actually terminates on its own, which every inject-sourced test flow
# used to do (repeatMs=0 meant "build msg once, no loop"). Inject is now
# an always-looping event-source node (node-library/inject.ts's own
# 2026-09-02 header) exactly like interrupt/timer/wifi_status/
# mqtt_subscribe already were -- so left alone, `spawn()`'s old bare
# `asyncio.run(coro)` would simply hang forever on `await evt.wait()`,
# since nothing in a synthetic test process ever sends a real §13 TRIGGER.
#
# Rather than pushing a "manually fire this specific inject node" call
# into every one of the ~15 existing test files that use inject purely as
# "the thing that drives one message through the flow under test" (none
# of them are testing inject's own firing behavior -- node-inject.test.ts
# is where that actually lives now), this fixture simulates "a user
# clicked every inject node on the canvas shortly after connecting" once,
# generically, for any flow run through it: after a short delay (letting
# the flow's own coroutine actually reach its first `await evt.wait()`),
# every currently-registered trigger fires once. A coroutine that never
# terminates on its own (this now includes inject, plus every pre-existing
# always-looping source) is given a bounded run instead of an unbounded
# one -- hitting that bound and raising asyncio.TimeoutError is the
# EXPECTED outcome for such a source, not a test failure, mirroring
# exactly what node-wifi-status.test.ts's/node-mqtt-subscribe.test.ts's
# own headers already say about why THEIR repeating flows "can't run end
# to end through this" harness: they can now, briefly, which is enough to
# observe one message's worth of side effects.
_AUTO_FIRE_DELAY_S = 0.02
# Overridable via PYMOCK_MAX_RUN_S, added 2026-09-17: node-eswitch.test.ts/
# node-ebutton.test.ts drive several real state transitions through the
# vendored drivers' own real-time debounce/long-press/double-click polling
# (not pymock's virtual clock -- see machine.py's Pin.SCHEDULE header), so
# they need more real wall-clock budget than the 0.3s default comfortably
# allows once test-process scheduling jitter is accounted for. Reading the
# env var only when unset preserves every existing test's behavior exactly
# (none of them set it, so they keep getting 0.3s).
import os as _os

_MAX_RUN_S = float(_os.environ.get("PYMOCK_MAX_RUN_S", "0.3"))


async def _auto_fire_registered_triggers():
    await _asyncio.sleep(_AUTO_FIRE_DELAY_S)
    for event in list(_triggers.values()):
        event.set()


def spawn(coro, node_id=None):
    async def _run():
        firer = _asyncio.ensure_future(_auto_fire_registered_triggers())
        try:
            await _guarded(coro, node_id)
        finally:
            firer.cancel()

    try:
        _asyncio.run(_asyncio.wait_for(_run(), _MAX_RUN_S))
    except _asyncio.TimeoutError:
        # Expected for any source that loops forever (see this section's
        # header) -- the bounded run already let it process whatever
        # trigger(s)/wakes fired within the budget above; asyncio.wait_for
        # cancels the still-running task for us, same clean-cancellation
        # path _guarded()'s own `except NodeError`/`except Exception`
        # never sees (CancelledError isn't an Exception subclass).
        pass
