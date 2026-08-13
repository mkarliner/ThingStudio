# harness.py -- POC-A on-device "runtime"
#
# Flashed ONCE to the board as main.py. Never itself redeployed. Everything
# under test -- the two-coroutine program -- arrives afterwards as raw .py
# source text over the same USB-serial line the REPL normally uses, wrapped
# in a crude ad hoc text protocol, and is exec()'d directly on the device.
#
# Deliberately out of scope (see design doc S15.1): mpy-cross/bytecode, the
# real S13 wire protocol, fault isolation beyond "don't crash the listener",
# state persistence, multi-flow.
#
# Protocol (all ASCII, line-oriented, one frame = one deploy):
#   browser -> device : b"###DEPLOY-BEGIN###\n"
#                        <payload source lines, each ending in \n>
#                        b"###DEPLOY-END###\n"
#   device  -> browser: b"DEPLOY_OK before=<int> after=<int> dt_ms=<int>\n"
#                     or b"DEPLOY_ERR <exception repr>\n"
#
# Anything the deployed payload itself prints (e.g. "TOGGLE ..." / "BTN ...")
# goes out over the same serial line as-is and shows up in the browser's raw
# console. A background task also prints "MEM t=<ms> free=<int>" every 5s,
# independent of deploys, so memory creep across many redeploys is visible
# in the console/log even between explicit before/after samples.

import sys
import gc
import utime
import micropython
import uasyncio as asyncio

micropython.kbd_intr(-1)  # stdin is ours now; don't let a stray byte raise KeyboardInterrupt

BEGIN = b"###DEPLOY-BEGIN###\n"
END = b"###DEPLOY-END###\n"

_tasks = []  # tasks spawned by the *deployed payload* -- tracked so a
             # redeploy can cancel exactly these, and nothing else (not the
             # listener, not the mem monitor).


def spawn(coro):
    """Payload scripts call spawn(coro()) instead of asyncio.create_task()
    directly, so the harness can find and cancel these tasks on the next
    redeploy instead of leaking one pair of tasks per deploy."""
    t = asyncio.create_task(coro)
    _tasks.append(t)
    return t


async def _cancel_running():
    global _tasks
    for t in _tasks:
        try:
            t.cancel()
        except Exception:
            pass
    _tasks = []
    await asyncio.sleep_ms(10)  # give cancellations a tick to land before pins are reused


async def _deploy(src):
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


async def _listener():
    sreader = asyncio.StreamReader(sys.stdin)
    lines = []
    collecting = False
    while True:
        raw = await sreader.readline()
        if not raw:
            await asyncio.sleep_ms(20)
            continue
        if raw == BEGIN:
            lines = []
            collecting = True
            continue
        if raw == END:
            collecting = False
            src = b"".join(lines).decode()
            await _deploy(src)
            continue
        if collecting:
            lines.append(raw)


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
