# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/runtime.py
#
# The device-side module a compiled flow imports to reach the scheduler --
# the real, named successor to pocs/poc-a's and pocs/poc-d's harness.py
# (see the naming decision in
# docs/working-notes/repo-structure-and-conventions.md: no
# "harness" in real v1 code).
#
# Design doc §5, "Fault isolation" -- half 1 (per-task exception boundary),
# implemented here: "An uncaught exception inside a node's coroutine is
# caught at the per-task boundary (uasyncio surfaces exceptions on task
# completion) instead of crashing the whole event loop. The failing
# subgraph's task stops and reports a structured error back over the
# transport... while the rest of the flow keeps running."
#
# Two things had to change from the pre-hardware stub (see git history)
# to make that real:
#
# 1. spawn() now wraps every coroutine in _guarded(), which catches at
#    task completion instead of letting uasyncio's "Task exception wasn't
#    retrieved" default kill the task silently. Catching inside the task
#    itself (rather than via some external supervisor) is what lets the
#    task return normally afterward -- an unretrieved exception is exactly
#    the failure mode POC-D's listener hit (see listener.py's own header),
#    and the fix there and here is the same shape: never let a bare
#    exception be the last thing a task does.
#
# 2. NodeError exists so a *specific node's* failure inside a multi-node
#    chain can be reported accurately. The current compiler
#    (editor/src/compiler/compile.ts) generates one coroutine per
#    independently-triggered chain (source -> transform* -> sink), not one
#    coroutine per node (§5: "each node, or more likely each
#    independently-triggered subgraph... is a coroutine") -- so without
#    this, an exception anywhere in a multi-node chain could only be
#    blamed on the whole chain, not the one node that actually raised.
#    compile.ts now wraps each transform/sink node's call in a
#    try/except that raises NodeError(node_id, original_exception) before
#    it can unwind past that node's own call site; _guarded() below is
#    what turns that back into an accurate NODE_ERROR report. An exception
#    NOT wrapped in NodeError (e.g. a bug in buildMsg itself, before any
#    node-specific call) still gets reported, blamed on the chain's source
#    node as a documented fallback rather than silently lost.
#
# 3. register_cleanup()/the _cleanups registry (added
#    docs/working-notes/redeploy-cleanup-and-network-fault-detection-briefing.md,
#    Problem 1) -- cancel_running() cancelling a task never touched any
#    OS-level resource (a socket) that task's *module-level* setup code
#    claimed, since that resource isn't owned by the cancelled task's own
#    stack frame. The only thing that used to release it was the old
#    `_flow` module object itself getting garbage-collected, which is
#    exactly why redeploying the same flow twice back-to-back used to fail
#    the first time with an EADDRINUSE-style OSError and succeed on the
#    second -- collection timing, not anything deterministic. This
#    registry is the explicit, symmetric counterpart to
#    compile.ts's mergeSetup dedup on the setup side: a node's generated
#    setup statement self-registers its own cleanup (e.g.
#    `runtime.register_cleanup("udp-send-sock", lambda: _udp_send_sock.close())`)
#    right where it creates the resource, and cancel_running() below is
#    what actually calls every registered cleanup, deterministically, on
#    every redeploy -- no longer relying on GC timing at all.
#
# 4. register_trigger()/fire_trigger()/the _triggers registry (added
#    2026-09-02, inject click-only live-fire feature,
#    docs/working-notes/outstanding-items/inject-click-fire-missing.md) --
#    the device-side half of a new §13 TRIGGER message (messages.py):
#    inject.ts's codegenEventSource constructs a per-instance event object
#    at module scope and self-registers it here under its own node ID
#    (the same string listener.py's NODE_ERROR/runtime.spawn's fallback
#    attribution already use), exactly the same self-registration shape
#    register_cleanup() established for udp_send/udp_receive's sockets.
#    listener.py's dispatch loop calls fire_trigger(node_id) when a
#    TRIGGER arrives; inject's coroutine is blocked on that event's
#    .wait(), so firing it is what makes a click actually run the chain.
#    Cleared in cancel_running() below (a stale entry pointing at a
#    since-replaced flow's event object must not silently keep working,
#    or silently keep failing to look up a same-numbered but different
#    node from a new flow) -- same "must not outlive a redeploy" reasoning
#    _cleanups already follows, but with no cleanup *function* to call
#    here, just references to drop.

import uasyncio as asyncio

_tasks = []  # tasks spawned by the deployed flow -- tracked so a redeploy
             # can cancel exactly these, same bookkeeping as pocs/poc-a and pocs/poc-d.

_cleanups = {}  # key -> callable; see this file's header, point 3. Keyed the
                # same way setup-statement dedup already works
                # (compile.ts's mergeSetup, "first node's code wins") so two
                # nodes sharing one resource don't register (and double-close)
                # it twice.

_triggers = {}  # node_id (string) -> event object with a .set() method;
                 # see this file's header, point 4 (added 2026-09-02, inject
                 # click-only live-fire feature).

# Set by listener.py once it's importable (device-runtime/src/listener.py)
# so this module stays independently importable/testable without ever
# needing to import the listener itself -- avoids a runtime<->listener
# circular import, and keeps this file's own off-device tests
# (device-runtime/test/test_runtime.py) free of any transport/serial
# dependency. Signature: on_node_error(node_id: str, exception_type: str,
# exception_message: str) -> None. Must never raise -- see _report_error's
# own try/except around calling it.
on_node_error = None


class NodeError(Exception):
    """Raised by compiler-generated per-node call wrappers (see this file's
    header) to tag which node an exception happened in before the per-task
    boundary in _guarded() catches it. `node_id` matches NODE_ERROR's wire
    field (messages.py): always a string, even though graph node IDs are
    numeric in the compiler (editor/src/compiler/graph.ts) -- stringified
    at codegen time."""

    def __init__(self, node_id, orig):
        super().__init__(node_id, orig)
        self.node_id = node_id
        self.orig = orig


def _exception_type_name(exc):
    # type(exc).__name__ is confirmed identical in shape between CPython
    # and the MicroPython unix-port build used for this project's
    # off-device tests (device-runtime/test/README.md) -- both give the
    # bare class name (e.g. "ZeroDivisionError"), matching NODE_ERROR's
    # exceptionType field (messages.py / editor/src/protocol/messages.ts).
    return type(exc).__name__


def _report_error(node_id, exc):
    node_label = node_id if node_id is not None else "unknown"
    exc_type = _exception_type_name(exc)
    exc_message = str(exc)
    # Always printed, independent of on_node_error -- keeps a human-
    # readable trail on the serial console even before/without a listener
    # attached, same spirit as every prior POC's plain print()-based
    # status lines.
    print("NODE_ERROR node=%s type=%s msg=%s" % (node_label, exc_type, exc_message))
    if on_node_error is not None:
        try:
            on_node_error(str(node_label), exc_type, exc_message)
        except Exception as e:  # noqa: BLE001 -- reporting itself must never be able to kill a task
            print("NODE_ERROR report callback failed: %r" % (e,))


async def _guarded(coro, fallback_node_id):
    """The actual per-task exception boundary. Runs `coro` to completion;
    any exception it raises is caught HERE, inside the task, so the task
    itself always completes normally -- uasyncio never sees an unretrieved
    exception, and every other task on the event loop is completely
    unaffected (design doc §5's own claim, made concretely true by this
    function existing)."""
    try:
        await coro
    except asyncio.CancelledError:
        raise  # a redeploy cancelling this task is not a fault -- must propagate normally
    except NodeError as e:
        _report_error(e.node_id, e.orig)
    except Exception as e:  # noqa: BLE001 -- this IS the fault boundary; anything not already a NodeError is still reported, not silently dropped
        _report_error(fallback_node_id, e)


def spawn(coro, node_id=None):
    """Spawn a flow-generated coroutine under the per-task fault boundary.
    `node_id` (a string) is the chain's source node -- used only as the
    fallback attribution for an exception that happens outside any
    NodeError-wrapped call (see this file's header, point 2). Compiler-
    generated code always passes it; it's optional here so hand-written
    coroutines (this file's own off-device tests, or a POC-style throwaway
    script) can still call spawn() without a node graph behind them."""
    t = asyncio.create_task(_guarded(coro, node_id))
    _tasks.append(t)
    return t


def register_cleanup(key, fn):
    """Registers a callable to run the next time the currently-deployed
    flow is torn down (redeploy today; any future stop path would get this
    for free too) -- see this file's header, point 3. Only the first
    registration for a given key sticks, matching mergeSetup's own "first
    node's code wins" precedent, so e.g. two udp_receive nodes
    (incorrectly) sharing one port don't each register their own close on
    what's actually one shared socket."""
    if key not in _cleanups:
        _cleanups[key] = fn


def register_trigger(node_id, event):
    """Registers the live-trigger event object for one source node --
    see this file's header, point 4. Unlike register_cleanup(), this is
    NOT deduped by "first registration wins": node_id is already unique
    per node instance (the compiler's own per-node ID, not a shared
    resource key like a pin or port number), so a second registration
    under the same key can only mean a redeploy landed on a node that
    reused a previous flow's ID -- overwriting is correct there, not a
    conflict to guard against."""
    _triggers[node_id] = event


def fire_trigger(node_id):
    """Fires the named node's live-trigger event, if one is currently
    registered -- called from listener.py's dispatch loop on an incoming
    TRIGGER message. A node_id with no registered event (unknown, stale
    from a since-changed canvas, or simply not an inject node) is not an
    error: logged and ignored, same "the device is untrusted input, degrade
    gracefully" reasoning every other adversarial-input path in this
    listener/runtime pair already follows."""
    event = _triggers.get(node_id)
    if event is None:
        print("TRIGGER_IGNORED no live node registered for id=%s" % (node_id,))
        return
    event.set()


async def cancel_running():
    global _tasks
    for t in _tasks:
        try:
            t.cancel()
        except Exception:
            pass
    _tasks = []
    _triggers.clear()
    await asyncio.sleep_ms(10)
    # Cleanups run AFTER the grace period above, not before -- closing a
    # socket out from under a task that's still mid-recvfrom()/sendto() on
    # it (before cancellation has actually propagated) risks a confusing
    # exception inside the task being torn down, instead of a clean
    # CancelledError. Each cleanup gets its own try/except so one
    # resource's failure to close cleanly can't block the others from
    # running or crash the redeploy itself -- same "never let one failure
    # kill the whole path" convention _report_error/_send_message_safe
    # already follow in listener.py.
    for key, fn in _cleanups.items():
        try:
            fn()
        except Exception as e:  # noqa: BLE001 -- one resource's cleanup failing must never block the others or the redeploy itself
            print("CLEANUP_ERR key=%s %r" % (key, e))
    _cleanups.clear()
