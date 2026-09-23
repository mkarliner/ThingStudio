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
import json
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

try:
    import wifi_provision
except ImportError:
    # Missing on a board bootstrapped by an older deploy_runtime.py, before this feature's module
    # was added to CORE_FILES -- degrades to "provisioning feature unavailable," never a boot
    # failure, same "a board that predates a feature just doesn't have it" contract every other
    # additive DEPLOY field in this file already follows (flowName/deployId, wifiProvision itself).
    wifi_provision = None

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

_RUNTIME_VERSION = {"major": 2, "minor": 0, "patch": 0}  # bumped 2026-09-23: EXEC, STOP_TO_PROMPT, safe mode (1.0.0 was 2026-09-10: NODE_STATUS)
# (runtime.report_status) is a hard dependency of wifi-status.ts's/mqtt-shared.ts's codegen now -- an editor
# with this change targeting a pre-2026-09-10 runtime would crash on deploy (AttributeError: report_status),
# not degrade gracefully. See CLAUDE.md's "Device-runtime version bump discipline" -- decideDeploy() only
# blocks on a major mismatch, so this is the level that actually matters.

# Belt-and-braces companion to _RUNTIME_VERSION, added 2026-09-05 (CLAUDE.md's
# "Device-runtime version bump discipline"): _RUNTIME_VERSION is a human-
# maintained semver the editor treats as a compatibility *decision*
# (version.ts's decideDeploy only gates on a `major` mismatch) -- it can't
# catch a change that landed in device-runtime/src without anyone
# remembering to bump it, exactly what happened with register_trigger
# (2026-09-02). This is NOT a replacement for that check, and deliberately
# isn't a content hash either (a hash would flag a same-behavior comment
# edit as "different" with no way to tell how much actually changed) --
# it's a plain git-SHA fingerprint of device-runtime/src at the moment
# test-flows/deploy_runtime.py last pushed it, purely informational: the
# editor logs a warning on mismatch (version.ts's checkRuntimeBuild),
# never blocks a DEPLOY over it the way a major-version mismatch does.
#
# Read once at boot from a plain marker file deploy_runtime.py writes
# alongside the runtime files themselves -- not a .py module, so there's
# nothing to re-import and no risk of it going stale mid-process. A board
# bootstrapped before this existed, or one deploy_runtime.py pushed
# without git available, simply has no file here and reports None -- an
# absent/None value means "can't confirm freshness this way," not
# "confirmed stale," and is handled as its own case (see checkRuntimeBuild).
_RUNTIME_BUILD_FILE = "_runtime_build.txt"


def _read_runtime_build():
    try:
        with open(_RUNTIME_BUILD_FILE) as f:
            build = f.read().strip()
        return build if build else None
    except OSError:
        return None


_RUNTIME_BUILD = _read_runtime_build()

_deploy_generation = 0  # bumped on every DEPLOY, purely diagnostic (not part of the wire protocol)

# Flow identity, added 2026-09-05 (decisions.md's "flow identity" entry,
# the direct follow-on to boot-time flow auto-resume): once a flow can
# survive a reset, "is the flow currently running on this board the one
# I have open" is a real question. _FLOW_META_PATH is a small sidecar
# JSON file written next to _FLOW_PATH/_STATIC_DATA_PATH, carrying the
# two identifiers HELLO/DEPLOY now also carry (messages.py's own note):
# flowName (the flow file's stable, human-edited name) and deployId (a
# fresh UUID the editor generates per Deploy click). _current_flow_name/
# _current_flow_deploy_id are the in-memory mirror _send_hello() actually
# reads -- updated by both _handle_deploy (a live DEPLOY) and
# _resume_flow (boot-time auto-resume), deliberately NOT re-read from
# disk on every HELLO: this must reflect whichever flow is *actually*
# running right now, and a live redeploy changes that without a reboot.
_FLOW_META_PATH = "/_flow_meta.json"
try:
    # Same THINGSTUDIO_*_PATH override reasoning as _FLOW_PATH/
    # _STATIC_DATA_PATH just above -- the unix-port build these
    # off-device tests run against has no device flash, "/" is the real
    # host filesystem root. Missed on this field's first pass (caught by
    # test_flow_identity_reported_in_hello_and_survives_resume failing --
    # without this override, every test process was silently reading/
    # writing the *same* real "/_flow_meta.json" on the test host,
    # instead of an isolated per-test tmpdir path).
    _FLOW_META_PATH = os.getenv("THINGSTUDIO_FLOW_META_PATH", _FLOW_META_PATH)
except AttributeError:
    pass

# wifi_provision.py's own boot-time marker (wifi-provisioning-captive-portal.md, 2026-09-14):
# {"selfProvision": bool, "allowReprovision": bool}, or absent -- whether the CURRENTLY deployed
# flow's wifi_status config says "unmanaged" (wifi-status.ts's computeWifiProvisionMarker(),
# editor-side). Same env-var-override reasoning as every other THINGSTUDIO_*_PATH above.
_WIFI_PROVISION_MARKER_PATH = "/_flow_wifi_provision.json"

# Boot-loop safe mode (2026-09-23, Mike: "need a way of deleting flows that cause a boot loop or
# similar lock out"). A flow that hard-crashes the board (MemoryError while loading, watchdog, a
# driver wedging the chip) used to crash it again on every boot, since every boot resumes the saved
# flow; the only way out was a Ctrl-C landing inside the 3s boot window. Now each boot with a saved
# flow bumps a counter on flash, and a flow that stays up for _STABLE_AFTER_MS clears it. After
# _SAFE_MODE_AFTER boots in a row that never got that far, the listener starts WITHOUT the flow and
# says so (a LISTENER_SAFE_MODE line, and HELLO.safeMode). A successful DEPLOY clears it.
# Catches crashes, not a flow that merely hogs the CPU -- the editor's "Remove flow" covers that.
_BOOT_COUNT_PATH = "/_boot_count"
_SAFE_MODE_AFTER = 3
_STABLE_AFTER_MS = 10000
_safe_mode = False
try:
    # Same off-device test override as every THINGSTUDIO_*_PATH above: the unix port has no device
    # flash, and a test must never write the real host's "/_boot_count".
    _BOOT_COUNT_PATH = os.getenv("THINGSTUDIO_BOOT_COUNT_PATH", _BOOT_COUNT_PATH)
    _STABLE_AFTER_MS = int(os.getenv("THINGSTUDIO_STABLE_AFTER_MS", str(_STABLE_AFTER_MS)))
except (AttributeError, ValueError):
    pass
try:
    _WIFI_PROVISION_MARKER_PATH = os.getenv("THINGSTUDIO_WIFI_PROVISION_MARKER_PATH", _WIFI_PROVISION_MARKER_PATH)
except AttributeError:
    pass
_current_flow_name = None
_current_flow_deploy_id = None


def _set_current_flow(flow_name, deploy_id):
    global _current_flow_name, _current_flow_deploy_id
    _current_flow_name = flow_name
    _current_flow_deploy_id = deploy_id


def _persist_flow_meta(flow_name, deploy_id):
    """Writes flow identity to flash so _resume_flow can recover it after
    a reset/power-cycle -- same persistence shape _FLOW_PATH/
    _STATIC_DATA_PATH already establish for the bytecode itself.
    Best-effort: by the time this is called the flow has already
    successfully started (see _handle_deploy), so a write failure here
    must not be able to fail a deploy that's already succeeded -- logged,
    not raised."""
    try:
        with open(_FLOW_META_PATH, "w") as f:
            json.dump({"flowName": flow_name, "deployId": deploy_id}, f)
    except Exception as e:  # noqa: BLE001 -- see docstring
        print("LISTENER_ERR could not persist flow metadata: %r" % (e,))


def _read_flow_meta():
    try:
        with open(_FLOW_META_PATH) as f:
            meta = json.load(f)
        return meta.get("flowName"), meta.get("deployId")
    except (OSError, ValueError):
        # OSError: no meta file (a board bootstrapped before this existed,
        # or a previous _persist_flow_meta write failed). ValueError:
        # malformed JSON (cbor.py's own "adversarial input must never be
        # able to escape" precedent applies here too) -- either way, "no
        # identity recorded" degrades to (None, None), never a crash.
        return None, None


def _persist_wifi_provision_marker(marker):
    """Writes (or clears) wifi_provision.py's own boot-time marker -- called from _handle_deploy
    right after a flow has successfully started, same timing/best-effort contract
    _persist_flow_meta() just above uses (a write failure here must not be able to fail a deploy
    that's already succeeded). `marker` is None for every flow that doesn't reference an "unmanaged"
    WiFi config -- the file is REMOVED in that case, not left stale from a previous flow that did
    use this feature (a flow-B redeploy over a flow-A that self-provisioned must not silently keep
    triggering flow-A's provisioning intent on flow-B's behalf)."""
    if marker is None:
        try:
            os.remove(_WIFI_PROVISION_MARKER_PATH)
        except OSError:
            pass  # nothing to remove -- the ordinary case for every flow that never used this feature
        return
    try:
        with open(_WIFI_PROVISION_MARKER_PATH, "w") as f:
            json.dump(marker, f)
    except Exception as e:  # noqa: BLE001 -- see _persist_flow_meta's own docstring for why this degrades, not raises
        print("LISTENER_ERR could not persist wifi provision marker: %r" % (e,))


def _read_wifi_provision_marker():
    try:
        with open(_WIFI_PROVISION_MARKER_PATH) as f:
            marker = json.load(f)
        if not isinstance(marker, dict):
            return None
        return marker
    except (OSError, ValueError):
        # OSError: no marker (the ordinary case -- this flow doesn't use the feature, or never
        # deployed one that does). ValueError: malformed JSON -- degrades to "no marker", same
        # adversarial-input contract _read_flow_meta() applies to its own file.
        return None


def _provision_wifi_if_needed():
    """Called once from main(), before _resume_flow() -- see that call site's own comment for why
    the order matters. A missing wifi_provision module (board bootstrapped before this feature
    existed) or a missing/absent marker (this flow doesn't reference an "unmanaged" WiFi config) both
    degrade to a no-op, not an error -- this is the ordinary case for every flow/board that isn't
    using this feature, unchanged from its absence."""
    if wifi_provision is None:
        return
    marker = _read_wifi_provision_marker()
    if marker is None:
        return
    try:
        wifi_provision.provision_if_needed(marker.get("selfProvision", False), marker.get("allowReprovision", False))
    except Exception as e:  # noqa: BLE001 -- wifi_provision.py's own header says it should never raise, but boot must
        # survive even a bug in this brand-new module -- same "adversarial/unexpected input never
        # allowed to kill boot" reasoning as every other phase in this file.
        print("LISTENER_ERR wifi provisioning raised unexpectedly: %r -- continuing boot anyway" % (e,))


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


def _handle_node_status(node_id, state, text):
    """Wired up as runtime.on_node_status below -- device-side sender for
    a §13 NODE_STATUS push (outstanding-items/node-status-indicators.md),
    same shape as _handle_node_error just above. `text` is optional on
    the wire (messages.py's own encode_message_body already drops any
    None-valued key before CBOR-encoding, matching every other optional
    field's convention in this protocol), so it's passed straight through
    here rather than special-cased."""
    _send_message_safe(
        {
            "type": "NODE_STATUS",
            "nodeId": node_id,
            "state": state,
            "text": text,
        }
    )


runtime.on_node_status = _handle_node_status


async def _send_hello():
    _send_message_safe(
        {
            "type": "HELLO",
            "chipType": _chip_type(),
            "runtimeVersion": _RUNTIME_VERSION,
            "runtimeBuild": _RUNTIME_BUILD,
            "currentFlowName": _current_flow_name,
            "currentFlowDeployId": _current_flow_deploy_id,
            "freeFlashBytes": _free_flash_bytes(),
            "freeRamBytes": _free_ram_bytes(),
            "safeMode": _safe_mode,
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
    # Nothing is genuinely running from this point until the code below
    # re-confirms otherwise -- added 2026-09-05 alongside flow identity:
    # previously a failed redeploy (import _flow raising, below) still
    # left the OLD flow's name/deployId looking "current" even though
    # cancel_running() had already killed it, which would have made
    # HELLO lie about what's actually running.
    _set_current_flow(None, None)
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
        _persist_flow_meta(msg["flowName"], msg["deployId"])
        _leave_safe_mode()
        _persist_wifi_provision_marker(msg.get("wifiProvision"))
        _set_current_flow(msg["flowName"], msg["deployId"])
        _deploy_generation += 1
        gc.collect()
        _send_message_safe({"type": "DEPLOY_ACK", "freeFlashBytes": _free_flash_bytes(), "freeRamBytes": gc.mem_free()})
    except Exception as e:  # noqa: BLE001 -- a bad DEPLOY is adversarial-shaped input (design doc §13: DEPLOY_ERROR), never allowed to kill the listener
        print("DEPLOY_ERR %r (before_ram=%d)" % (e, before_ram))
        _send_message_safe({"type": "DEPLOY_ERROR", "code": type(e).__name__, "message": str(e)})


def _resume_flow():
    """Boot-time flow auto-resume, added 2026-09-05
    (docs/working-notes/outstanding-items/reset-before-deploy.md's point 2
    -- Mike's own words, real hardware finding: "not persisting flows to
    survive reset or power cycle is pretty fundamental. fix it."). Before
    this, a previously-DEPLOYed flow only ever (re)started via
    _handle_deploy() -- i.e. only on a live DEPLOY message arriving over
    an already-open connection -- even though the compiled bytecode this
    function reads (_FLOW_PATH) survives on the device's own flash the
    whole time. Every reset/power-cycle silently lost the running flow
    until a human noticed and manually redeployed. Called once from
    main(), synchronously, before run_forever() starts -- same timing
    _listener()/_heartbeat()/_send_hello() below already rely on: uasyncio
    lets a task be scheduled (asyncio.create_task) before the loop is
    actually running, which is exactly what `import _flow`'s top-level
    runtime.spawn(...) calls do.

    Deliberately NOT routed through _handle_deploy() itself: there's no
    incoming DEPLOY message here (no bytecode/staticData to write --
    _FLOW_PATH/_STATIC_DATA_PATH already hold whatever the last real
    DEPLOY wrote), nothing running yet for cancel_running() to cancel, and
    no DEPLOY_ACK to send (nothing sent a request for this to acknowledge,
    and boot is almost certainly too early for an editor to be connected
    to receive it anyway). The one thing both paths share -- `import
    _flow` -- is the only thing this function does.

    A missing flow file (never deployed, or a board bootstrapped before
    this existed) is the ordinary, expected case, not a fault. A present
    but corrupt/incompatible flow file (this port's bytecode format
    changed, hand-edited, truncated write) must degrade to "didn't
    resume" and let boot continue -- a bad persisted flow must never be
    able to brick the listener itself, same "adversarial input, never
    allowed to kill the process" reasoning _handle_deploy's own
    DEPLOY_ERROR path already follows."""
    try:
        with open(_FLOW_PATH, "rb"):
            pass
    except OSError:
        print("LISTENER_BOOT no persisted flow at %s -- nothing to resume" % _FLOW_PATH)
        return
    try:
        import _flow  # noqa: F401 -- see _handle_deploy's own note: executes _flow's top-level code, which calls runtime.spawn(...)
        _set_current_flow(*_read_flow_meta())
        print("LISTENER_BOOT resumed persisted flow from %s" % _FLOW_PATH)
    except Exception as e:  # noqa: BLE001 -- a corrupt/incompatible persisted flow must degrade to "didn't resume", never crash boot
        print("LISTENER_BOOT_ERR could not resume persisted flow: %r" % (e,))


# Globals for EXEC commands. One dict for the life of the listener, so a variable set by one
# command is there for the next (`p = machine.Pin(15)`, then `p.value()`), like a REPL session.
_exec_globals = {"__name__": "__command__"}
# Preloaded so quick checks work without an import line first (`gc.mem_free()`, `os.listdir()`,
# `machine.Pin(15).value()`). Each is optional: the unix port used for tests has no `machine`.
for _mod_name in ("gc", "os", "sys", "time", "machine"):
    try:
        _exec_globals[_mod_name] = __import__(_mod_name)
    except ImportError:
        pass


def _handle_exec(code):
    """Runs one command from the editor's command box and prints what a REPL would: an expression's
    repr (unless None), or a traceback. Output goes to stdout, which the backend relays to the
    editor console as plain lines -- no reply message needed. Tried as an expression first, then as
    a statement: eval() rejects statements at compile time, before anything runs, so nothing
    executes twice.

    Runs synchronously inside the listener task: a slow command (a long sleep, a loop) holds up the
    flow and the listener until it finishes. Fine for quick checks, which is what it's for; the
    docs say so. Exceptions never escape -- a bad command is user input, not a listener fault."""
    try:
        try:
            result = eval(code, _exec_globals)
        except SyntaxError:
            exec(code, _exec_globals)
        else:
            if result is not None:
                print(repr(result))
    except Exception as e:  # noqa: BLE001 -- see docstring
        try:
            sys.print_exception(e)
        except AttributeError:  # CPython (off-device tests) has no print_exception
            print("%s: %s" % (type(e).__name__, e))


async def _handle_stop_to_prompt():
    """Stops the flow and the listener and hands the serial line back to MicroPython's own REPL:
    Ctrl-C re-enabled, event loop stopped, so main() returns and main.py ends at ">>>". Nothing is
    rebooted or deleted -- a soft reset (Ctrl-D) or the reset button starts the listener and the
    saved flow again. Mike, 2026-09-23: a way to reach the Python prompt without rebooting."""
    await runtime.cancel_running()
    _set_current_flow(None, None)
    print("LISTENER_STOPPED -- at the Python prompt. Ctrl-D or the reset button restarts Thingstudio.")
    try:
        import micropython

        micropython.kbd_intr(3)
    except (ImportError, AttributeError):
        pass
    asyncio.get_event_loop().stop()


def _read_boot_count():
    try:
        with open(_BOOT_COUNT_PATH) as f:
            return int(f.read().strip() or "0")
    except (OSError, ValueError):
        return 0


def _write_boot_count(n):
    try:
        with open(_BOOT_COUNT_PATH, "w") as f:
            f.write(str(n))
    except OSError as e:
        # Degrades to "no boot-loop protection this boot", never a boot failure.
        print("LISTENER_BOOT_ERR could not write boot counter: %r" % (e,))


def _leave_safe_mode():
    global _safe_mode
    _safe_mode = False
    _write_boot_count(0)


def _flow_is_saved():
    try:
        with open(_FLOW_PATH, "rb"):
            return True
    except OSError:
        return False


def _check_boot_loop():
    """Called once at boot, before the saved flow is touched. Returns True if the flow should be
    skipped (safe mode). See _BOOT_COUNT_PATH's comment for the design."""
    global _safe_mode
    if not _flow_is_saved():
        return False
    count = _read_boot_count()
    if count >= _SAFE_MODE_AFTER:
        _safe_mode = True
        print(
            "LISTENER_SAFE_MODE -- the saved flow didn't stay up for %ds on the last %d boots, so it has NOT "
            "been started. Fix it and deploy again, or remove it from the board." % (_STABLE_AFTER_MS // 1000, count)
        )
        return True
    _write_boot_count(count + 1)
    return False


async def _mark_stable():
    """Clears the boot counter once the flow has stayed up for _STABLE_AFTER_MS."""
    await asyncio.sleep_ms(_STABLE_AFTER_MS)
    if not _safe_mode:
        _write_boot_count(0)


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
    elif msg_type == "HELLO_REQUEST":
        # No reset button on the Pico W (2026-09-05 real hardware pass)
        # surfaced this: _send_hello() only ever runs once, at boot, so a
        # board that's been running a while has no way to get the editor
        # back to a known state without a physical reset. Reusing the
        # exact same function boot uses -- deliberately no separate code
        # path to keep in sync, and no side effects beyond sending a
        # fresh HELLO (no redeploy, no runtime reload, nothing else).
        await _send_hello()
    elif msg_type == "EXEC":
        _handle_exec(msg["code"])
    elif msg_type == "STOP_TO_PROMPT":
        await _handle_stop_to_prompt()
    elif msg_type in ("STATE_READ", "STATE_WRITE"):
        # Tier 2 (design doc: flash-backed state store), not this task's
        # scope (fault-isolation-briefing.md's "Not in scope"). Logged, not
        # silently dropped, so a STATE_READ/WRITE sent against a Tier-0-only
        # device is an obvious no-op in the console rather than a mystery
        # timeout on the editor side.
        print("LISTENER_IGNORED %s not yet implemented (Tier 2)" % (msg_type,))
    else:
        # HELLO/DEPLOY_ACK/DEPLOY_ERROR/VALUE_STREAM/NODE_ERROR/NODE_STATUS
        # are all device -> editor per §13; receiving one FROM the editor
        # is unexpected input, not a crash -- logged the same way any
        # other LISTENER_IGNORED case is.
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

    # WiFi self-provisioning (wifi-provisioning-captive-portal.md, 2026-09-14) -- BEFORE
    # _resume_flow(), deliberately: _resume_flow()'s own `import _flow` executes the persisted
    # flow's generated wifiSetupStatement() code, which for an "unmanaged" WiFi config brings the
    # station interface up but issues no .connect() call of its own (wifi-status.ts's own header) --
    # this call is what actually gets it connected first, using a previously-learned credential or,
    # on first run, the captive portal. A no-op for every flow/board not using this feature (see
    # _provision_wifi_if_needed's own docstring).
    if _check_boot_loop():
        pass  # safe mode: skip WiFi provisioning and the saved flow; the listener still starts
    else:
        _provision_wifi_if_needed()
        _resume_flow()
        asyncio.create_task(_mark_stable())

    print("LISTENER_READY")
    asyncio.create_task(_listener())
    asyncio.create_task(_heartbeat())
    asyncio.create_task(_send_hello())
    asyncio.get_event_loop().run_forever()


if __name__ == "__main__":
    main()
