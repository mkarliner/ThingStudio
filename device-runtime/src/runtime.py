# device-runtime/src/runtime.py
#
# The device-side module a compiled flow imports to reach the scheduler --
# the real, named successor to pocs/poc-a's and pocs/poc-d's harness.py
# (see the naming decision in
# docs/working-notes/repo-structure-and-conventions.md: no
# "harness" in real v1 code). Deliberately minimal right now: this is the
# contract the compiler's generated code (editor/src/compiler) already
# depends on -- spawn() and a shared asyncio handle -- not yet the real
# listener/protocol handler or fault isolation from design doc §5. Those
# need real hardware validation (docs/working-notes/validation/) that
# can't happen in this environment; this stub exists so the compiler's
# output has something real to import and its assumptions are written
# down, not implicit.
#
# TODO (Tier 0, needs real hardware to build/validate against, see
# validation plan): the real listener/protocol handler (§13's CBOR
# framing), per-task fault isolation reporting NODE_ERROR, and the
# transport-task hardening POC-D's hardware run forced (never let the
# dispatch loop die, time-bound every blocking read, no read(n)/
# readexactly(n) without re-verifying against this port's known hang).

import uasyncio as asyncio

_tasks = []  # tasks spawned by the deployed flow -- tracked so a redeploy
             # can cancel exactly these, same bookkeeping as pocs/poc-a and pocs/poc-d.


def spawn(coro):
    t = asyncio.create_task(coro)
    _tasks.append(t)
    return t


async def cancel_running():
    global _tasks
    for t in _tasks:
        try:
            t.cancel()
        except Exception:
            pass
    _tasks = []
    await asyncio.sleep_ms(10)
