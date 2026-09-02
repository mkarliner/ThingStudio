# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/listener.py
#
# The real device-side §13 protocol listener -- design doc §5's "Fault
# isolation, half 2" (listener/transport task hardening), plus the actual
# listener/protocol handler device-runtime/src/runtime.py's own header
# note flagged as not-yet-built. Named "listener" per
# docs/working-notes/repo-structure-and-conventions.md ("harness" is
# retired). This is the direct successor to pocs/poc-d/harness.py's
# _listener()/main() -- same hardening shape, now speaking the real §13
# CBOR/framing protocol (protocol.py/messages.py/framing.py) instead of
# POC-D's ad hoc BEGIN/END text + base64-.mpy protocol.
#
# --- Why base64-over-readline() again, not raw binary reads -----------
#
# POC-D's actual hardware bug (see harness.py's own header, and design doc
# §15.5): reading a specific byte count from sys.stdin
# (read(n)/readexactly(n)) hung this port's event loop outright -- not
# slow, a genuine interpreter-level block that not even the device's own
# asyncio.wait_for() timeout could interrupt. readline() was reliable
# throughout that same debugging session. fault-isolation-briefing.md's own
# stated default is to keep riding binary payloads on readline()
# (base64-encoded) "unless a given port proves otherwise" -- this file
# does that for the *whole* real frame (2-byte length + type + CBOR body,
# framing.py's format), not just DEPLOY's bytecode the way POC-D did it:
# each complete frame is base64-encoded and sent as one line, prefixed
# "F64:" so it's unambiguous against this file's own human-readable debug
# print() lines (kept deliberately, same as every prior POC, for a plain
# serial monitor to still be useful during bring-up). The raw-binary path
# is NOT implemented here -- it needs the real hardware read(n) experiment
# fault-isolation-briefing.md calls out as still open ("Verify per-port")
# before it would be safe to try, and this default is functionally
# complete without it. Swapping the physical read strategy later only
# touches this file's _listener()/_send_message(); protocol.py/framing.py/
# messages.py/cbor.py are transport-agnostic and don't need to change.
#
# --- The two hardening properties themselves ---------------------------
#
# 1. The dispatch loop must never exit on an unhandled exception -- every
#    phase wrapped, logged as a structured error, loop continues. See
#    _listener()'s two nested try/excepts below: one around the readline()
#    itself, one around everything done with a line once received. Mirrors
#    harness.py's own "nothing inside the loop body is allowed to
#    propagate out and kill the task" comment, now over the real protocol.
# 2. Every blocking read is time-bounded (asyncio.wait_for, READ_TIMEOUT_S)
#    so a partial/garbled transfer degrades to "try again" within seconds,
#    never a hang.
#
# Neither depends on already knowing what went wrong -- deliberately, so
# this recovers from failure modes not seen yet too, same reasoning
# harness.py's header gives. Doesn't replace design doc §5's watchdog (the
# backstop for a task that never yields at all); nothing here can run if
# the event loop itself is wedged.

import sys
import gc
import binascii

import uasyncio as asyncio

import runtime
import protocol
import messages

try:
    import machine
except ImportError:
    machine = None  # off-device (unix-port tests) -- heartbeat/DEPLOY pin work below degrades gracefully

try:
    import os
except ImportError:
    os = None

# Boot-time recovery window (design doc §5, second mitigation layer,
# "physical-access-independent fallback... not a replacement for" the
# hardening above): for this short window, kbd_intr is still at its
# MicroPython default, so a real Ctrl-C drops to the normal REPL instead of
# ever reaching the point where this file takes over stdin. Same value
# harness.py used, carried forward rather than re-guessed. Overridable via
# THINGSTUDIO_BOOT_DELAY_S -- test/hil's own driver scripts and
# device-runtime/test/test_listener_integration.py both need this loop
# reachable in well under real hardware's 3s on every run; the env var is
# the test-only hook, the 3s default is what a real device always boots
# with.
_BOOT_DELAY_S = 3
try:
    _BOOT_DELAY_S = float(os.getenv("THINGSTUDIO_BOOT_DELAY_S", str(_BOOT_DELAY_S)))
except (AttributeError, ValueError):
    pass  # os is None off-device, or getenv unsupported -- real 3s default stands

# Where the deployed flow (and its optional static data) live on disk.
# Real default is the device's flash-backed VFS root ("/_flow.mpy",
# matching runtime.py's/harness.py's existing `import _flow` contract).
# Overridable for the same reason _BOOT_DELAY_S is: the unix-port build
# these off-device tests run against has NO device flash -- "/" is the
# real host filesystem root, which a test must never write to. Real
# hardware never sets these env vars, so this is a no-op there.
_FLOW_PATH = "/_flow.mpy"
_STATIC_DATA_PATH = "/_flow_static.bin"
try:
    _FLOW_PATH = os.getenv("THINGSTUDIO_FLOW_PATH", _FLOW_PATH)
    _STATIC_DATA_PATH = os.getenv("THINGSTUDIO_STATIC_DATA_PATH", _STATIC_DATA_PATH)
except AttributeError:
    pass

# Matches harness.py's READ_TIMEOUT_S -- see that file's own comment on why
# a single readline() wait (not a multiple of it) is what app.js's/the
# WebSerial transport client's deploy timeout needs to stay comfortably
# above.
READ_TIMEOUT_S = 8

F64_PREFIX = "F64:"

# test/hil/pin-map.md: DUT GPIO10, continuous toggle, independent of any
# printed/self-reported liveness signal (design doc: POC-D's worst bug took
# its own printed heartbeat down with the rest of the wedged event loop --
# the whole reason the witness rig watches this pin directly instead of
# trusting device output at all).
_HEARTBEAT_PIN = 10
_HEARTBEAT_PERIOD_MS = 200

_RUNTIME_VERSION = {"major": 0, "minor": 1, "patch": 0}  # pre-v1; bump deliberately, not implicitly, once real semver policy exists

_deploy_generation = 0  # bumped on every DEPLOY, purely diagnostic (not part of the wire protocol)


def _chip_type():
    try:
        return sys.implementation._machine  # e.g. "LuatOS-Core-ESP32C3 with ESP32C3" on real hardware
    except AttributeError:
        return "unknown"


def _free_flash_bytes():
    if os is None:
        return 0
    try:
        st = os.statvfs("/")
        return st[0] * st[3]  # f_frsize * f_bfree
    except (AttributeError, OSError):
        return 0  # unix-port dev filesystem, or a port without statvfs -- not a real device, 0 is honest


def _free_ram_bytes():
    gc.collect()
    return gc.mem_free()


def _send_message(message):
    """Encode + frame + base64-line-wrap one message and write it to
    stdout. Synchronous and best-effort: a write failure here must not be
    able to kill the calling task any more than a reporting-callback
    failure can (runtime.py's own _report_error has the same shape) --
    caught by this function's own caller sites, not inside here, so a
    genuine bug in this function itself isn't silently swallowed."""
    frame = protocol.encode_message(message)
    b64 = binascii.b2a_base64(frame).strip()  # b2a_base64 appends a trailing \n; strip it, we add our own
    if isinstance(b64, bytes):
        b64 = b64.decode("ascii")
    sys.stdout.write(F64_PREFIX + b64 + "\n")


def _send_message_safe(message):
    try:
        _send_message(message)
    except Exception as e:  # noqa: BLE001 -- sending a report must never be able to crash the caller
        print("LISTENER_ERR send failed for %s: %r" % (message.get("type"), e))


def _handle_node_error(node_id, exception_type, exception_message):
    """Wired up as runtime.on_node_error below -- design doc §5 half 1's
    NODE_ERROR finally gets a real device-side sender here, closing the
    loop fault-isolation-briefing.md called out ("this is where §13's real
    NODE_ERROR message... finally gets a real device-side sender")."""
    _send_message_safe(
        {
            "type": "NODE_ERROR",
            "nodeId": node_id,
            "exceptionType": exception_type,
            "exceptionMessage": exception_message,
        }
    )


runtime.on_node_error = _handle_node_error


async def _send_hello():
    _send_message_safe(
        {
            "type": "HELLO",
            "chipType": _chip_type(),
            "runtimeVersion": _RUNTIME_VERSION,
            "freeFlashBytes": _free_flash_bytes(),
            "freeRamBytes": _free_ram_bytes(),
        }
    )


async def _handle_deploy(msg):
    """Writes the deployed flow's bytecode (and, if present, static data)
    to the filesystem and imports it, same overall shape as
    harness.py's _deploy_mpy -- cancel what's running, write, import,
    report free space back. Where §13 DEPLOY carries both `bytecode` and
    `staticData` and doesn't specify their on-disk relationship (the
    design doc describes bytecode + static data as two logically distinct
    things, not their storage contract) -- this session's own filled gap,
    flagged same as messages.ts's own documented spec gaps: bytecode goes
    to /_flow.mpy (imported as `_flow`, matching runtime's existing
    contract); non-empty staticData goes to /_flow_static.bin, left for a
    future node type to read rather than interpreted here."""
    global _deploy_generation
    await runtime.cancel_running()
    gc.collect()
    before_ram = gc.mem_free()
    try:
        with open(_FLOW_PATH, "wb") as f:
            f.write(msg["bytecode"])
        if msg["staticData"]:
            with open(_STATIC_DATA_PATH, "wb") as f:
                f.write(msg["staticData"])
        if "_flow" in sys.modules:
            del sys.modules["_flow"]
        import _flow  # noqa: F401 -- executes _flow's top-level code, which calls runtime.spawn(...)
        _deploy_generation += 1
        gc.collect()
        _send_message_safe({"type": "DEPLOY_ACK", "freeFlashBytes": _free_flash_bytes(), "freeRamBytes": gc.mem_free()})
    except Exception as e:  # noqa: BLE001 -- a bad DEPLOY is adversarial-shaped input (design doc §13: DEPLOY_ERROR), never allowed to kill the listener
        print("DEPLOY_ERR %r (before_ram=%d)" % (e, before_ram))
        _send_message_safe({"type": "DEPLOY_ERROR", "code": type(e).__name__, "message": str(e)})


async def _dispatch(result):
    if "error" in result:
        # Adversarial input (framing.FramingError or
        # messages.MessageDecodeError) -- exactly the case the
        # fault-injection soak test (mvp-validation-plan.md) exercises 50x
        # in a row: log and move on, never raise past this function.
        print("LISTENER_ERR protocol %r -- recovering, not crashing" % (result["error"],))
        return

    msg = result["message"]
    msg_type = msg["type"]
    if msg_type == "DEPLOY":
        await _handle_deploy(msg)
    elif msg_type == "TRIGGER":
        # inject click-only live-fire feature (2026-09-02) -- fire-and-
        # forget, no ack (messages.py's own TRIGGER doc note): runtime.py's
        # fire_trigger already degrades an unknown/stale nodeId to a
        # logged no-op, so there's nothing more for this dispatch branch
        # to check or report.
        runtime.fire_trigger(msg["nodeId"])
    elif msg_type in ("STATE_READ", "STATE_WRITE"):
        # Tier 2 (design doc: flash-backed state store), not this task's
        # scope (fault-isolation-briefing.md's "Not in scope"). Logged, not
        # silently dropped, so a STATE_READ/WRITE sent against a Tier-0-only
        # device is an obvious no-op in the console rather than a mystery
        # timeout on the editor side.
        print("LISTENER_IGNORED %s not yet implemented (Tier 2)" % (msg_type,))
    else:
        # HELLO/DEPLOY_ACK/DEPLOY_ERROR/VALUE_STREAM/NODE_ERROR are all
        # device -> editor per §13; receiving one FROM the editor is
        # unexpected input, not a crash -- logged the same way any other
        # LISTENER_IGNORED case is.
        print("LISTENER_IGNORED unexpected message type from editor: %s" % (msg_type,))


_MAX_STALL_PUSHES = 5  # see _listener()'s "stalled decoder" handling below


async def _listener():
    sreader = asyncio.StreamReader(sys.stdin)
    decoder = protocol.ProtocolStreamDecoder()
    stall_pushes = 0
    while True:
        try:
            raw = await asyncio.wait_for(sreader.readline(), READ_TIMEOUT_S)
        except asyncio.TimeoutError:
            continue  # no data in a while -- normal, go around again
        except Exception as e:  # noqa: BLE001 -- hardening property 1: nothing here may kill this task
            print("LISTENER_ERR readline %r -- recovering, not crashing" % (e,))
            decoder.reset()
            await asyncio.sleep_ms(50)
            continue

        try:
            if not raw:
                await asyncio.sleep_ms(20)
                continue

            text = raw.decode() if isinstance(raw, bytes) else raw
            if not text.startswith(F64_PREFIX):
                print("LISTENER_IGNORED %r" % (text[:60],))
                continue

            b64 = text[len(F64_PREFIX) :].rstrip("\r\n")
            try:
                frame_bytes = binascii.a2b_base64(b64)
            except Exception as e:  # noqa: BLE001 -- malformed base64 is adversarial input, not a bug
                print("LISTENER_ERR bad base64 %r -- recovering" % (e,))
                continue

            results = decoder.push(frame_bytes)
            if results:
                stall_pushes = 0
                for result in results:
                    await _dispatch(result)
            elif decoder.pending_byte_count > 0:
                # framing.py's FrameDecoder can legitimately end up
                # "waiting for more bytes" on a length header that's
                # structurally plausible but never actually completes
                # (framing.py's own docstring: garbage that "declares a
                # plausible but wrong length" isn't distinguishable from a
                # real frame that hasn't finished arriving yet, by design
                # -- there's no resync marker). Left unbounded, that's a
                # real hazard this task's own soak test surfaced: one such
                # line permanently wedges the decoder, silently discarding
                # every real frame sent afterward, even though the task
                # itself never dies or hangs. Same "every wait must be
                # time-bounded" principle as READ_TIMEOUT_S above, applied
                # to "waiting to complete a frame" instead of "waiting for
                # a line" -- a few consecutive non-progressing pushes force
                # a reset rather than waiting forever.
                stall_pushes += 1
                if stall_pushes >= _MAX_STALL_PUSHES:
                    print(
                        "LISTENER_ERR frame decoder stalled (%d bytes buffered, no frame/error in %d pushes) -- resetting"
                        % (decoder.pending_byte_count, stall_pushes)
                    )
                    decoder.reset()
                    stall_pushes = 0
            else:
                stall_pushes = 0
        except Exception as e:  # noqa: BLE001 -- hardening property 1, second half: dispatch itself must never kill this task either
            print("LISTENER_ERR dispatch %r -- recovering, not crashing" % (e,))
            decoder.reset()
            stall_pushes = 0


async def _heartbeat():
    """Independent liveness signal for the witness rig's HEARTBEAT_WATCH
    (test/hil/pin-map.md: DUT GPIO10) -- deliberately NOT the old printed
    heartbeat pattern (pocs/poc-d's _mem_monitor), since design doc §5 and
    the validation plan are explicit that POC-D's worst bug took its own
    printed heartbeat down along with the rest of a wedged event loop, so
    self-reported liveness can't be trusted for exactly this test. A real
    GPIO toggle the witness board watches independently doesn't depend on
    this device's own print()/stdout path being alive at all. Degrades to
    a no-op (still yields normally) when `machine` isn't available, e.g.
    under this project's off-device unix-port tests."""
    pin = None
    if machine is not None:
        try:
            pin = machine.Pin(_HEARTBEAT_PIN, machine.Pin.OUT)
        except Exception as e:  # noqa: BLE001 -- a bad pin config must not block the rest of boot
            print("HEARTBEAT_ERR could not init pin %d: %r" % (_HEARTBEAT_PIN, e))
    value = 0
    while True:
        if pin is not None:
            value ^= 1
            pin.value(value)
        await asyncio.sleep_ms(_HEARTBEAT_PERIOD_MS)


def main():
    print("LISTENER_BOOTING -- Ctrl-C within %ds drops to REPL instead of starting the listener" % _BOOT_DELAY_S)
    try:
        import utime

        utime.sleep(_BOOT_DELAY_S)
    except ImportError:
        import time

        time.sleep(_BOOT_DELAY_S)

    try:
        import micropython

        micropython.kbd_intr(-1)  # stdin is ours now -- see this file's header on why
    except (ImportError, AttributeError):
        pass  # unix-port dev builds may not expose kbd_intr the same way; not a real device

    # Make sure the deployed flow's directory is importable (`import _flow`
    # in _handle_deploy) -- "" is MicroPython's own spelling for "current
    # VFS root" on real hardware, which is where _FLOW_PATH's default
    # ("/_flow.mpy") lives; a THINGSTUDIO_FLOW_PATH override (off-device
    # tests only) gets its own real directory added instead.
    flow_dir = _FLOW_PATH.rsplit("/", 1)[0]
    flow_dir = "" if flow_dir in ("", "/") else flow_dir
    if flow_dir not in sys.path:
        sys.path.insert(0, flow_dir)

    print("LISTENER_READY")
    asyncio.create_task(_listener())
    asyncio.create_task(_heartbeat())
    asyncio.create_task(_send_hello())
    asyncio.get_event_loop().run_forever()


if __name__ == "__main__":
    main()
