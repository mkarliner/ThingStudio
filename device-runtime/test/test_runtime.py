# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_runtime.py
#
# Off-device tests for runtime.py's per-task fault isolation boundary
# (design doc §5, half 1), run against the headless MicroPython unix-port
# build -- this is real `uasyncio` task/scheduling behavior, which is
# exactly the thing the design doc itself says off-device CPython mocking
# can't stand in for (editor/test/compiler.regression.test.ts's own header
# comment makes the same point about its CPython pymock fixture). Not a
# substitute for the real hardware pass (the validation plan's own
# "inherently about uasyncio task behavior under real scheduling" line for
# this exact test) -- this is the closest thing achievable without a board,
# using real uasyncio rather than a mock.

import minitest

minitest.add_src_to_path()

import uasyncio as asyncio
import runtime


def _reset_runtime():
    runtime._tasks = []
    runtime.on_node_error = None
    runtime._cleanups = {}
    runtime._triggers = {}


def test_node_error_reported_with_correct_node_id():
    _reset_runtime()
    reports = []
    runtime.on_node_error = lambda node_id, exc_type, exc_msg: reports.append((node_id, exc_type, exc_msg))

    async def failing():
        raise runtime.NodeError("42", ValueError("bad thing"))

    async def scenario():
        t = runtime.spawn(failing(), "1")
        await asyncio.sleep_ms(50)
        assert t.done()

    asyncio.run(scenario())

    assert len(reports) == 1
    node_id, exc_type, exc_msg = reports[0]
    assert node_id == "42"  # the NodeError's own node_id, NOT the chain's source ("1")
    assert exc_type == "ValueError"
    assert exc_msg == "bad thing"


def test_unwrapped_exception_falls_back_to_source_node_id():
    _reset_runtime()
    reports = []
    runtime.on_node_error = lambda node_id, exc_type, exc_msg: reports.append((node_id, exc_type, exc_msg))

    async def failing():
        raise KeyError("payload")  # not wrapped in NodeError -- e.g. a bug in generated glue code itself

    async def scenario():
        runtime.spawn(failing(), "7")
        await asyncio.sleep_ms(50)

    asyncio.run(scenario())

    assert len(reports) == 1
    node_id, exc_type, exc_msg = reports[0]
    assert node_id == "7"  # falls back to the chain's source node id
    assert exc_type == "KeyError"


def test_missing_node_id_falls_back_to_unknown():
    _reset_runtime()
    reports = []
    runtime.on_node_error = lambda node_id, exc_type, exc_msg: reports.append((node_id, exc_type, exc_msg))

    async def failing():
        raise RuntimeError("no source id available")

    async def scenario():
        runtime.spawn(failing())  # node_id omitted entirely
        await asyncio.sleep_ms(50)

    asyncio.run(scenario())
    assert reports[0][0] == "unknown"


def test_other_tasks_keep_running_after_one_fails():
    # This is design doc §5's actual claim, made concrete: "the rest of the
    # flow keeps running." Two independent tasks; one raises immediately,
    # the other counts ticks for a while afterward -- it must not be
    # affected by the first task's failure or by uasyncio's scheduling of
    # it.
    _reset_runtime()
    reports = []
    runtime.on_node_error = lambda node_id, exc_type, exc_msg: reports.append(node_id)
    ticks = []

    async def failing():
        raise runtime.NodeError("1", Exception("boom"))

    async def survivor():
        for i in range(5):
            ticks.append(i)
            await asyncio.sleep_ms(10)

    async def scenario():
        runtime.spawn(failing(), "1")
        t2 = runtime.spawn(survivor(), "2")
        await asyncio.sleep_ms(100)
        assert t2.done()

    asyncio.run(scenario())

    assert reports == ["1"]
    assert ticks == [0, 1, 2, 3, 4]


def test_cancellation_is_not_reported_as_a_node_error():
    # cancel_running() (a redeploy) must not look like a fault -- CancelledError
    # has to propagate out of _guarded() undisturbed, not get reported via
    # on_node_error.
    _reset_runtime()
    reports = []
    runtime.on_node_error = lambda node_id, exc_type, exc_msg: reports.append(node_id)

    async def long_runner():
        await asyncio.sleep(10)

    async def scenario():
        runtime.spawn(long_runner(), "1")
        await asyncio.sleep_ms(20)
        await runtime.cancel_running()
        await asyncio.sleep_ms(20)

    asyncio.run(scenario())
    assert reports == []


def test_report_callback_failure_does_not_crash_the_task():
    # "Reporting itself must never be able to kill a task" -- exercised
    # directly: on_node_error itself raises.
    _reset_runtime()

    def bad_callback(node_id, exc_type, exc_msg):
        raise RuntimeError("reporting is broken too")

    runtime.on_node_error = bad_callback

    async def failing():
        raise runtime.NodeError("1", Exception("boom"))

    async def scenario():
        t = runtime.spawn(failing(), "1")
        await asyncio.sleep_ms(50)
        assert t.done()  # must complete normally despite the callback itself raising

    asyncio.run(scenario())  # must not raise out of the whole scenario


def test_spawn_tracks_tasks_for_cancel_running():
    _reset_runtime()

    async def noop():
        await asyncio.sleep(10)

    async def scenario():
        runtime.spawn(noop(), "1")
        runtime.spawn(noop(), "2")
        assert len(runtime._tasks) == 2
        await runtime.cancel_running()
        assert runtime._tasks == []

    asyncio.run(scenario())


def test_register_cleanup_runs_on_cancel_running():
    # docs/working-notes/redeploy-cleanup-and-network-fault-detection-briefing.md,
    # Problem 1: register_cleanup/cancel_running is the explicit,
    # deterministic replacement for relying on GC timing to release an
    # OS-level resource (e.g. a socket) a redeployed flow's module-level
    # setup code claimed.
    _reset_runtime()
    closed = []
    runtime.register_cleanup("sock", lambda: closed.append("sock"))

    async def scenario():
        await runtime.cancel_running()

    asyncio.run(scenario())
    assert closed == ["sock"]


def test_register_cleanup_dedups_by_key_first_wins():
    # Matches compile.ts's mergeSetup dedup precedent -- two nodes sharing
    # one resource must not double-register (and double-close) it.
    _reset_runtime()
    closed = []
    runtime.register_cleanup("sock", lambda: closed.append("first"))
    runtime.register_cleanup("sock", lambda: closed.append("second"))

    async def scenario():
        await runtime.cancel_running()

    asyncio.run(scenario())
    assert closed == ["first"]


def test_cleanup_registry_cleared_after_cancel_running():
    # A stale cleanup from a prior deploy must not re-fire (e.g. against
    # an already-closed socket) on a later redeploy that doesn't
    # re-register it.
    _reset_runtime()
    calls = []
    runtime.register_cleanup("sock", lambda: calls.append(1))

    async def scenario():
        await runtime.cancel_running()
        await runtime.cancel_running()

    asyncio.run(scenario())
    assert calls == [1]


def test_one_cleanup_raising_does_not_prevent_others_from_running():
    _reset_runtime()
    ran = []

    def bad():
        raise RuntimeError("close failed")

    runtime.register_cleanup("bad", bad)
    runtime.register_cleanup("good", lambda: ran.append("good"))

    async def scenario():
        await runtime.cancel_running()

    asyncio.run(scenario())  # must not raise out of cancel_running/the scenario
    assert ran == ["good"]


# --- register_trigger/fire_trigger/_triggers (2026-09-02, inject
# click-only live-fire feature) -----------------------------------------


def test_fire_trigger_sets_the_registered_event():
    _reset_runtime()

    class FakeEvent:
        def __init__(self):
            self.was_set = False

        def set(self):
            self.was_set = True

    evt = FakeEvent()
    runtime.register_trigger("1", evt)
    runtime.fire_trigger("1")
    assert evt.was_set is True


def test_fire_trigger_on_unknown_node_id_is_a_no_op():
    _reset_runtime()

    # Must not raise -- an untrusted/stale wire nodeId degrades gracefully,
    # same contract every other §13 message already follows.
    runtime.fire_trigger("does-not-exist")


def test_register_trigger_overwrites_a_previous_registration_for_the_same_id():
    # Unlike register_cleanup's dedup-by-key, a second registration under
    # the same node_id is expected (a redeploy reusing that numeric ID for
    # a different node) and must win -- see register_trigger's own
    # docstring.
    _reset_runtime()
    calls = []
    runtime.register_trigger("1", type("E", (), {"set": lambda self: calls.append("first")})())
    runtime.register_trigger("1", type("E", (), {"set": lambda self: calls.append("second")})())
    runtime.fire_trigger("1")
    assert calls == ["second"]


def test_triggers_cleared_on_cancel_running():
    _reset_runtime()

    class FakeEvent:
        def set(self):
            pass

    runtime.register_trigger("1", FakeEvent())

    async def scenario():
        await runtime.cancel_running()

    asyncio.run(scenario())
    assert runtime._triggers == {}
    # A stale nodeId from before the redeploy must now be a no-op, not a
    # crash and not a silent wake of some *new* flow's unrelated node that
    # happens to reuse the same ID with a fresh registration this test
    # never made.
    runtime.fire_trigger("1")


minitest.run(
    [
        test_fire_trigger_sets_the_registered_event,
        test_fire_trigger_on_unknown_node_id_is_a_no_op,
        test_register_trigger_overwrites_a_previous_registration_for_the_same_id,
        test_triggers_cleared_on_cancel_running,
        test_node_error_reported_with_correct_node_id,
        test_unwrapped_exception_falls_back_to_source_node_id,
        test_missing_node_id_falls_back_to_unknown,
        test_other_tasks_keep_running_after_one_fails,
        test_cancellation_is_not_reported_as_a_node_error,
        test_report_callback_failure_does_not_crash_the_task,
        test_spawn_tracks_tasks_for_cancel_running,
        test_register_cleanup_runs_on_cancel_running,
        test_register_cleanup_dedups_by_key_first_wins,
        test_cleanup_registry_cleared_after_cancel_running,
        test_one_cleanup_raising_does_not_prevent_others_from_running,
    ]
)
