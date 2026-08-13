# harness.py -- POC-D on-device "runtime"
#
# Extends POC-A's harness (poc-a/harness.py) with a second, binary-safe deploy
# path for real .mpy bytecode, alongside the original raw-text exec() path
# (kept working, unchanged, for fallback/debugging). See design doc §15.5 for
# exact scope: this is still a crude ad hoc protocol, not §13's real one.
#
# FIRST REAL HARDWARE RUNS (2026-08-11) found real problems -- see
# poc-d/README.md's "Debugging the first real run" section for the full
# story. Root cause, localized precisely via MPY_STEP checkpoint prints
# (still in the source below, now unreachable dead paths removed): a deploy
# attempt hung completely -- the *entire event loop* stopped, including the
# independent _mem_monitor heartbeat, not just the deploy listener -- right
# after logging "reading N bytes of bytecode", i.e. inside
# `sreader.readexactly(n)` (equivalently `sreader.read(n)`, same underlying
# primitive). Not a slow wait: even the device's own `asyncio.wait_for`
# 8-second internal timeout never fired either, meaning the call wasn't
# cooperatively yielding at all -- a genuine blocking hang at the interpreter
# level, not "waiting on an event that's slow to arrive". `readline()`, by
# contrast, worked reliably every single time in this whole debugging
# session (including reading the MPY-BEGIN header line itself, right before
# the hang). So rather than chase a low-level stream/driver quirk specific
# to reading an arbitrary byte count from `sys.stdin` on this port -- not
# fixable from Python -- the binary payload now rides entirely on
# `readline()`: base64-encoded and sent as a single text line. No more
# `read(n)`/`readexactly(n)` anywhere in this file.
#
# Protocol (adds to POC-A's BEGIN/END text framing, which still works as-is):
#   browser -> device : b"###MPY-B64:<base64 of .mpy bytecode>###\n"
#   device  -> browser: b"MPY_OK before=<int> after=<int> dt_ms=<int>\n"
#                     or b"MPY_ERR <exception repr>\n"
#
# The deployed flow module (compiled by poc-d/compiler.js from the canvas
# graph) does `import harness_api` and calls `harness_api.spawn(coro())` --
# harness_api is a synthetic module object injected into sys.modules below
# (not a real file), exposing this harness's task-tracking `spawn` and its
# `asyncio` instance so a real `import`ed module can reach them the way
# POC-A's exec(src, ns)-injected namespace let raw text reach them.

import sys
import gc
import utime
import micropython
import uasyncio as asyncio
import binascii

# Boot-time recovery window, added after the incident above: for this short
# window, kbd_intr is still at its default (Ctrl-C raises KeyboardInterrupt
# normally), so a real Ctrl-C here propagates out of main() entirely and
# MicroPython drops to its normal REPL, no reflash needed. Once the window
# elapses, we commit to disabling it below, same as before -- the harness
# still needs uninterrupted ownership of stdin for the deploy protocol once
# it's actually running. This doesn't fix the listener-death bug (that's the
# try/except hardening further down); it's the physical-access-independent
# fallback for whatever this doesn't catch.
_BOOT_DELAY_S = 3
print("HARNESS_BOOTING -- Ctrl-C within %ds drops to REPL instead of starting the harness" % _BOOT_DELAY_S)
utime.sleep(_BOOT_DELAY_S)

micropython.kbd_intr(-1)  # stdin is ours now; don't let a stray byte raise KeyboardInterrupt

if "" not in sys.path:
    sys.path.insert(0, "")  # make sure /_flow.mpy on the root fs is importable

BEGIN = b"###DEPLOY-BEGIN###\n"
END = b"###DEPLOY-END###\n"
MPY_B64_PREFIX = b"###MPY-B64:"
MPY_B64_SUFFIX = b"###"

_tasks = []  # tasks spawned by the *deployed flow* -- tracked so a redeploy
             # (either kind) can cancel exactly these, same as POC-A.


def spawn(coro):
    t = asyncio.create_task(coro)
    _tasks.append(t)
    return t


class _HarnessAPI:
    pass


harness_api = _HarnessAPI()
harness_api.spawn = spawn
harness_api.asyncio = asyncio
sys.modules["harness_api"] = harness_api  # so `import harness_api` resolves without a real file


async def _cancel_running():
    global _tasks
    for t in _tasks:
        try:
            t.cancel()
        except Exception:
            pass
    _tasks = []
    await asyncio.sleep_ms(10)


async def _deploy_source(src):
    """POC-A's original path -- raw .py source, exec()'d. Unchanged."""
    await _cancel_running()
    gc.collect()
    before = gc.mem_free()
    t0 = utime.ticks_ms()
    ns = {"spawn": spawn, "asyncio": asyncio}
    try:
        exec(src, ns)
        gc.collect()
        after = gc.mem_free()
        dt = utime.ticks_diff(utime.ticks_ms(), t0)
        print("DEPLOY_OK before=%d after=%d dt_ms=%d" % (before, after, dt))
    except Exception as e:
        print("DEPLOY_ERR %r" % (e,))


async def _deploy_mpy(data):
    """POC-D's new path -- real .mpy bytecode, written to disk and imported."""
    print("MPY_STEP cancel_running")
    await _cancel_running()
    gc.collect()
    before = gc.mem_free()
    t0 = utime.ticks_ms()
    try:
        print("MPY_STEP write_file len=%d" % len(data))
        with open("/_flow.mpy", "wb") as f:
            f.write(data)
        print("MPY_STEP write_file done")
        if "_flow" in sys.modules:
            del sys.modules["_flow"]
        print("MPY_STEP import_flow")
        import _flow  # executes _flow's top-level code, which calls harness_api.spawn(...)
        print("MPY_STEP import_flow done")
        gc.collect()
        after = gc.mem_free()
        dt = utime.ticks_diff(utime.ticks_ms(), t0)
        print("MPY_OK before=%d after=%d dt_ms=%d" % (before, after, dt))
    except Exception as e:
        print("MPY_ERR %r" % (e,))


# How this incident happened, and the fix: an old (POC-A) harness got sent a
# POC-D binary frame it had never heard of. Its readline() choked on raw
# bytecode, raised, and because _listener()'s while-loop body had no
# try/except at all, the *task itself* died -- uasyncio logged "Task
# exception wasn't retrieved" and the listener silently stopped existing.
# kbd_intr(-1) (needed so stray protocol bytes can't trigger a KeyboardInterrupt
# mid-transfer -- see top of file) also means there's no REPL to fall back to
# once that happens: the only way back in was a full esptool reflash.
#
# Two independent hardenings against that whole failure class, both applied
# below: (1) nothing inside the loop body is allowed to propagate out and
# kill the task -- every phase is wrapped, logs an *_ERR line, and the loop
# continues; (2) every blocking read that waits on a specific byte count or
# a specific trailer is time-bounded (asyncio.wait_for), so a partial/garbled
# transfer degrades to a logged error within seconds instead of hanging
# forever. Neither of these depends on already knowing what went wrong --
# that's the point: this should recover from failure modes we haven't seen
# yet too, not just this specific one. Doesn't replace §5's watchdog, which
# is the backstop for the different failure mode of a task that never yields
# at all (nothing here can run if the event loop itself is wedged) -- see
# design doc's note on this (added after this incident).
#
# Bounds the wait for each incoming line. Now that the binary payload rides
# on a single base64 line (see file header -- read(n)/readexactly(n) turned
# out to hang this port outright, not just be slow), there's only ever one
# readline() wait per exchange, so app.js's client-side deploy timeout just
# needs to stay comfortably above this single value, not a multiple of it.
READ_TIMEOUT_S = 8


async def _listener():
    sreader = asyncio.StreamReader(sys.stdin)
    lines = []
    collecting = False
    while True:
        try:
            raw = await asyncio.wait_for(sreader.readline(), READ_TIMEOUT_S)
        except asyncio.TimeoutError:
            continue  # no data in a while -- normal, just go around again
        except Exception as e:
            print("LISTENER_ERR readline %r -- recovering, not crashing" % (e,))
            lines = []
            collecting = False
            await asyncio.sleep_ms(50)
            continue

        try:
            if not raw:
                await asyncio.sleep_ms(20)
                continue

            if raw.startswith(MPY_B64_PREFIX):
                print("MPY_STEP got b64 line, %d chars" % len(raw))
                body = raw[len(MPY_B64_PREFIX):].rstrip(b"\r\n")
                if not body.endswith(MPY_B64_SUFFIX):
                    print("MPY_ERR malformed b64 frame (missing ### suffix)")
                    continue
                body = body[: -len(MPY_B64_SUFFIX)]
                try:
                    data = binascii.a2b_base64(body)
                except Exception as e:
                    print("MPY_ERR bad base64 %r" % (e,))
                    continue
                print("MPY_STEP decoded %d bytes, deploying" % len(data))
                await _deploy_mpy(data)
                continue

            if raw == BEGIN:
                lines = []
                collecting = True
                continue
            if raw == END:
                collecting = False
                src = b"".join(lines).decode()
                await _deploy_source(src)
                continue
            if collecting:
                lines.append(raw)
                continue
            # Anything else, while not collecting raw-text lines, used to be
            # dropped completely silently -- which looks *identical* from the
            # browser side to "the frame never arrived" (both just time out
            # with zero device output). Logging it costs nothing and turns
            # that ambiguity into an actual diagnostic.
            print("LISTENER_IGNORED %r" % (raw[:60],))
        except Exception as e:
            # Catch-all: whatever this was, don't let it kill the task.
            print("LISTENER_ERR dispatch %r -- recovering, not crashing" % (e,))
            lines = []
            collecting = False


async def _mem_monitor():
    while True:
        gc.collect()
        print("MEM t=%d free=%d" % (utime.ticks_ms(), gc.mem_free()))
        await asyncio.sleep(5)


def main():
    print("HARNESS_READY")
    asyncio.create_task(_listener())
    asyncio.create_task(_mem_monitor())
    asyncio.get_event_loop().run_forever()


main()
