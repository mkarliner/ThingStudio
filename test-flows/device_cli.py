#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/device_cli.py
#
# A headless command line for a Thingstudio board over USB serial: list ports, ask for HELLO,
# install the runtime, deploy a .flow.json (compile + deploy), fire an inject node, run console
# commands, restart or stop the listener, and watch the console. Built for scripting and for
# agents (the thingstudio-board skill wraps it); the editor remains the normal path.
#
# It deliberately reuses test/hil/hil_common.py's DutLink/compile_flow/deploy_message rather than
# growing a second implementation of §13 framing, the dependency install, or the DEPLOY shape --
# the same reason test-flows/deploy_flow.py already does. If a third consumer needs those
# primitives, promote them out of test/hil into a shared host module then, not preemptively.
#
# Flow files are compiled by the editor's own headless compiler (editor/dist-cli/
# thingstudio-compile.mjs, `npm run build:cli`), so the CLI and the editor cannot disagree about
# what a flow means. Deploying already-compiled .py skips that step.
#
# Examples:
#   python3 test-flows/device_cli.py list
#   python3 test-flows/device_cli.py hello --port /dev/ttyACM0
#   python3 test-flows/device_cli.py runtime install --port /dev/ttyACM0
#   python3 test-flows/device_cli.py flow deploy my.flow.json --port /dev/ttyACM0 \
#       --mpy-cross ~/mpy-src/mpy-cross/build/mpy-cross --trigger inject0001
#   python3 test-flows/device_cli.py exec --port /dev/ttyACM0 "settings.namespaces()"
#
# Needs pyserial and, for flow deploy, a native mpy-cross (device-runtime/test/README.md).
# `runtime install` shells out to deploy_runtime.py and needs mpremote.

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(THIS_DIR)
HIL_DIR = os.path.join(REPO_ROOT, "test", "hil")
COMPILE_CLI = os.path.join(REPO_ROOT, "editor", "dist-cli", "thingstudio-compile.mjs")
DEPLOY_RUNTIME = os.path.join(THIS_DIR, "deploy_runtime.py")
MPY_BUILD_DOC = "device-runtime/test/README.md"

EXAMPLES = """examples:
  device_cli.py list
  device_cli.py hello --port /dev/ttyACM0
  device_cli.py runtime install --port /dev/ttyACM0
  device_cli.py flow deploy my.flow.json --port /dev/ttyACM0 \\
      --mpy-cross ~/mpy-src/mpy-cross/build/mpy-cross --trigger inject0001
  device_cli.py exec --port /dev/ttyACM0 "settings.namespaces()"
  device_cli.py watch --port /dev/ttyACM0
"""

sys.path.insert(0, HIL_DIR)
try:
    import serial
    from serial.tools import list_ports
    from hil_common import DutLink, compile_flow, deploy_message
except ImportError as e:  # pragma: no cover - environment problem, not a code path
    print("ERR: %s -- pyserial is needed (see test/hil/README.md)." % e, file=sys.stderr)
    sys.exit(2)


class CliError(Exception):
    pass


# --- output ---------------------------------------------------------------------------------


def emit(kind, json_mode, text=None, message=None):
    """One event. Human mode is the same [console]/[protocol] shape deploy_flow.py prints;
    JSON mode is one object per line (NDJSON), so a script or agent can parse it."""
    if json_mode:
        record = {"kind": kind}
        if text is not None:
            record["text"] = text
        if message is not None:
            record["message"] = message
        print(json.dumps(record), flush=True)
        return
    if message is not None:
        print("[protocol] %s" % json.dumps(message, sort_keys=True), flush=True)
    elif kind == "console":
        print("[console] %s" % text, flush=True)
    elif kind == "status":
        print(text, flush=True)
    else:
        print("[%s] %s" % (kind, text), flush=True)


def die(message):
    raise CliError(message)


# --- port + link ----------------------------------------------------------------------------


def ports(include_all=False):
    """USB serial ports only by default -- a Linux box also lists ttyS0-3 as serial ports, and
    those are never a board. `--all` shows everything."""
    found = list_ports.comports()
    if not include_all:
        found = [p for p in found if p.vid is not None or "USB" in (p.hwid or "").upper()]
    return sorted(found, key=lambda p: p.device)


def resolve_port(args):
    if getattr(args, "port", None):
        return args.port
    env = os.environ.get("THINGSTUDIO_PORT")
    if env:
        return env
    found = ports()
    if len(found) == 1:
        return found[0].device
    if not found:
        die("no serial ports found. Connect the board on USB, or pass --port.")
    die(
        "several serial ports: %s. Choose one with --port (or set THINGSTUDIO_PORT)."
        % ", ".join("%s (%s)" % (p.device, p.description or "no description") for p in found)
    )


def open_link(port):
    try:
        dut = DutLink(port, exclusive=True)
    except serial.SerialException as e:
        text = str(e)
        if "Permission denied" in text:
            die(
                "cannot open %s: permission denied. On Linux add yourself to the serial group "
                "(sudo usermod -aG dialout $USER), then log out and in again." % port
            )
        if "Resource busy" in text or "in use" in text or "Errno 16" in text or "exclusively lock" in text or "Errno 11" in text:
            die(
                "cannot open %s: the port is held by another program. Disconnect in the editor "
                "(or close mpremote/Thonny) and try again." % port
            )
        die("cannot open %s: %s" % (port, text))
    dut.ser.timeout = 0.25  # responsive loops; DutLink's own 8s is for boot-time HELLO only
    return dut


def handle_line(line, dut, json_mode):
    """Prints one serial line; returns True if an F64 frame was decoded."""
    if not line.startswith("F64:"):
        emit("console", json_mode, text=line)
        return False
    try:
        frame = base64.b64decode(line[len("F64:"):])
    except Exception:
        emit("console", json_mode, text=line)
        return False
    for result in dut.decoder.push(frame):
        if "message" in result:
            emit("message", json_mode, message=result["message"])
        else:
            emit("console", json_mode, text="unreadable frame: %r" % (result.get("error"),))
    return True


def drain(dut, seconds, json_mode):
    end = time.time() + seconds
    while time.time() < end:
        line = dut.read_line()
        if line is not None:
            handle_line(line, dut, json_mode)


def wait_for(dut, predicate, timeout_s, description, on_console=None):
    end = time.time() + timeout_s
    while time.time() < end:
        line = dut.read_line()
        if line is None:
            continue
        if not line.startswith("F64:"):
            # Console output can arrive before the awaited message (the flow starts, then
            # DEPLOY_ACK is sent). Dropping it here lost one-time lines such as wifi_status's
            # first connected report, so the network pass saw a soak failure the board never had.
            if on_console is not None:
                on_console(line)
            continue
        try:
            frame = base64.b64decode(line[len("F64:"):])
        except Exception:
            continue
        for result in dut.decoder.push(frame):
            if "message" in result and predicate(result["message"]):
                return result["message"]
    raise CliError("timed out after %ss waiting for %s" % (timeout_s, description))


def hello(dut, timeout_s=8):
    dut.ser.reset_input_buffer()
    dut.send_message({"type": "HELLO_REQUEST"})
    return wait_for(dut, lambda m: m["type"] == "HELLO", timeout_s, "HELLO")


def infer_arch(chip_type):
    """Mirror of editor/src/app/native-arch.ts, from HELLO's free-form chipType. Only matters
    for a flow that uses @micropython.viper/native; harmless otherwise."""
    s = (chip_type or "").lower()
    if "esp32c3" in s or "esp32-c3" in s or "esp32c6" in s or "esp32-c6" in s:
        return "rv32imc", True
    if "esp32" in s:
        return "xtensawin", True
    if "rp2040" in s:
        return "armv6m", True
    if "rp2350" in s:
        return "armv7emsp", False
    if "stm32f4" in s:
        return "armv7emsp", True
    return "xtensawin", False


# --- commands -------------------------------------------------------------------------------


def cmd_list(args):
    found = ports(include_all=args.all)
    if args.json:
        print(json.dumps([{"device": p.device, "description": p.description, "hwid": p.hwid} for p in found]))
        return 0
    if not found:
        print("No USB serial ports found." + ("" if args.all else " (--all also lists built-in UARTs)"))
        return 0
    for p in found:
        print("%-20s %-40s %s" % (p.device, p.description or "", p.hwid or ""))
    return 0


def cmd_hello(args):
    port = resolve_port(args)
    dut = open_link(port)
    try:
        message = hello(dut, args.timeout)
    except CliError as e:
        die(
            "%s. Check --port, that the runtime is installed, and that the listener is running "
            "(a board sitting at the MicroPython prompt answers nothing -- reset it)." % e
        )
    finally:
        dut.close()
    if args.json:
        print(json.dumps(message, sort_keys=True))
    else:
        version = message.get("runtimeVersion") or {}
        emit("status", False, text="board %s" % port)
        emit("status", False, text="  runtime  %s.%s.%s  build %s" % (
            version.get("major"), version.get("minor"), version.get("patch"), message.get("runtimeBuild")))
        emit("status", False, text="  chip     %s" % message.get("chipType"))
        emit("status", False, text="  flow     %r  safe mode %s" % (
            message.get("currentFlowName"), message.get("safeMode")))
        emit("status", False, text="  wifi     %s  address %s" % (
            message.get("hasWifi"), message.get("networkAddress")))
        deps = message.get("dependencies") or {}
        emit("status", False, text="  libs     %s" % (", ".join(sorted(deps)) or "none"))
    return 0


def cmd_watch(args):
    port = resolve_port(args)
    dut = open_link(port)
    try:
        emit("status", args.json, text="watching %s (Ctrl-C to stop)" % port)
        if args.timeout:
            drain(dut, args.timeout, args.json)
        else:
            while True:
                line = dut.read_line()
                if line is not None:
                    handle_line(line, dut, args.json)
    except KeyboardInterrupt:
        pass
    finally:
        dut.close()
    return 0


def cmd_exec(args):
    port = resolve_port(args)
    dut = open_link(port)
    try:
        dut.send_message({"type": "EXEC", "code": args.code})
        drain(dut, args.timeout, args.json)
    finally:
        dut.close()
    return 0


def cmd_trigger(args):
    port = resolve_port(args)
    dut = open_link(port)
    try:
        dut.send_message({"type": "TRIGGER", "nodeId": args.node_id})
        drain(dut, args.timeout, args.json)
    finally:
        dut.close()
    return 0


def cmd_restart(args):
    port = resolve_port(args)
    dut = open_link(port)
    try:
        dut.send_message({"type": "RESTART", "hard": args.hard})
        end = time.time() + args.timeout
        ready = False
        while time.time() < end:
            line = dut.read_line()
            if line is None:
                continue
            if not line.startswith("F64:"):
                emit("console", args.json, text=line)
                if "LISTENER_READY" in line:
                    ready = True
                continue
            try:
                frame = base64.b64decode(line[len("F64:"):])
            except Exception:
                continue
            for result in dut.decoder.push(frame):
                if "message" in result:
                    emit("message", args.json, message=result["message"])
        if not ready:
            emit("status", args.json, text="no LISTENER_READY within %ss" % args.timeout)
    finally:
        dut.close()
    return 0


def cmd_stop(args):
    port = resolve_port(args)
    dut = open_link(port)
    try:
        dut.send_message({"type": "STOP_TO_PROMPT"})
        drain(dut, args.timeout, args.json)
    finally:
        dut.close()
    return 0


def cmd_runtime_install(args):
    port = resolve_port(args)
    if not os.path.exists(DEPLOY_RUNTIME):
        die("%s is missing" % DEPLOY_RUNTIME)

    # The listener turns Ctrl-C off, so mpremote cannot enter the raw REPL while it is running.
    # Ask a live board to stop at the prompt first (the editor's Install does the same); a board
    # already at the prompt just ignores the line.
    dut = open_link(port)
    try:
        dut.send_message({"type": "STOP_TO_PROMPT"})
        drain(dut, 2.0, args.json)
    finally:
        dut.close()

    command = [sys.executable, DEPLOY_RUNTIME, "--port", port]
    if args.wipe:
        command.append("--wipe")
    emit("status", args.json, text="running %s" % " ".join(command))
    code = subprocess.call(command)
    if code != 0:
        return code
    if args.no_reset:
        emit("status", args.json, text="not resetting; reset the board to boot the listener")
        return 0
    mpremote = shutil.which("mpremote")
    if not mpremote:
        emit("status", args.json, text="mpremote not found; reset the board to boot the listener")
        return 0
    emit("status", args.json, text="resetting %s" % port)
    return subprocess.call([mpremote, "connect", port, "reset"])


def find_mpy_cross(args):
    if args.mpy_cross:
        return args.mpy_cross
    env = os.environ.get("THINGSTUDIO_MPY_CROSS")
    if env:
        return env
    found = shutil.which("mpy-cross")
    if found:
        return found
    die("no mpy-cross found. Pass --mpy-cross, set THINGSTUDIO_MPY_CROSS, or build one "
        "(%s)." % MPY_BUILD_DOC)


def compile_flow_file(path, arch, args):
    """A FlowFile JSON through the editor's own headless compiler. Returns the .py text."""
    if not path.endswith(".json"):
        try:
            with open(path) as f:
                return f.read()
        except OSError as e:
            die("cannot read %s: %s" % (path, e))
    if not os.path.exists(COMPILE_CLI):
        die("%s is missing. Build it in editor/: npm run build:cli" % COMPILE_CLI)
    out = tempfile.NamedTemporaryFile("r", suffix=".py", delete=False)
    out.close()
    command = ["node", COMPILE_CLI, "--out", out.name, "--arch", arch, path]
    try:
        result = subprocess.run(command, capture_output=True, text=True)
    except OSError as e:
        os.unlink(out.name)
        die("cannot run node (%s). The headless compiler needs Node 22 or later." % e)
    if result.returncode != 0:
        os.unlink(out.name)
        die("compile failed:\n%s%s" % (result.stdout, result.stderr))
    with open(out.name) as f:
        source = f.read()
    os.unlink(out.name)
    for line in (result.stdout + result.stderr).splitlines():
        if line.strip() and not line.startswith("wrote "):
            emit("status", args.json, text=line)
    return source


def flow_name_of(path):
    if not path.endswith(".json"):
        return None
    try:
        with open(path) as f:
            name = json.load(f).get("flowName")
        return name if isinstance(name, str) and name else None
    except (OSError, ValueError):
        return None


def cmd_flow_deploy(args):
    flow_name = args.flow_name or flow_name_of(args.flow)
    if not flow_name:
        emit(
            "status", args.json,
            text="WARN: no flow name. Values written to runtime.settings will be stored under \"\", "
                 "which the editor never uses. Pass --flow-name, or put flowName in the flow file.",
        )

    mpy_cross = find_mpy_cross(args)
    port = resolve_port(args)
    dut = open_link(port)
    try:
        # Ask the board what it is, both to report it and to pick mpy-cross -march for viper code. Its
        # HELLO also carries the library inventory, which is what lets the deploy below skip what the
        # board already holds (a frozen image holds everything its flows need).
        inventory = None
        try:
            info = hello(dut, 3)
            inventory = info.get("dependencies") or {}
            chip = info.get("chipType") or ""
            arch, confirmed = infer_arch(chip)
            emit("status", args.json, text="board: %s (runtime %s.%s.%s)" % (
                chip,
                (info.get("runtimeVersion") or {}).get("major"),
                (info.get("runtimeVersion") or {}).get("minor"),
                (info.get("runtimeVersion") or {}).get("patch")))
            if not confirmed:
                emit("status", args.json,
                     text="note: unrecognised chip, using mpy-cross -march=%s (only matters for viper)" % arch)
        except CliError:
            arch = "xtensawin"
            emit("status", args.json,
                 text="no HELLO: continuing anyway; using -march=%s (reset the board for a HELLO, "
                      "and check the runtime is installed)" % arch)
        if args.arch:
            arch = args.arch

        source = compile_flow_file(args.flow, arch, args)

        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                bytecode = compile_flow(mpy_cross, tmpdir, "flow", source, arch)
                message = deploy_message(
                    dut, tmpdir, source, bytecode,
                    log=lambda text: emit("status", args.json, text=text),
                    inventory=inventory,
                )
            except subprocess.CalledProcessError as e:
                detail = (e.stderr or b"").decode("utf-8", "replace").strip()
                die("mpy-cross failed%s" % (":\n%s" % detail if detail else " (%s)" % e))
            except OSError as e:
                die("cannot run mpy-cross %s: %s" % (mpy_cross, e))
            if flow_name:
                message["flowName"] = flow_name
            emit("status", args.json, text="deploying %d bytes (%s)" % (
                len(bytecode), "flow %r" % flow_name if flow_name else "unnamed"))
            dut.send_message(message)
            ack = wait_for(
                dut, lambda m: m["type"] == "DEPLOY_ACK", 20, "DEPLOY_ACK",
                on_console=lambda line: handle_line(line, dut, args.json),
            )

        if ack.get("ok") is False:
            emit("message", args.json, message=ack)
            die("DEPLOY failed: %s" % (ack.get("error") or ack.get("code") or "unknown"))
        emit("message", args.json, message=ack)

        pending = list(args.trigger)
        next_trigger_at = time.time() + 1.5
        end = time.time() + args.timeout
        while time.time() < end:
            if pending and time.time() >= next_trigger_at:
                node_id = pending.pop(0)
                emit("status", args.json, text="trigger %s" % node_id)
                dut.send_message({"type": "TRIGGER", "nodeId": node_id})
                next_trigger_at = time.time() + 2.0
            line = dut.read_line()
            if line is not None:
                handle_line(line, dut, args.json)
        if args.watch:
            emit("status", args.json, text="watching (Ctrl-C to stop)")
            try:
                while True:
                    line = dut.read_line()
                    if line is not None:
                        handle_line(line, dut, args.json)
            except KeyboardInterrupt:
                pass
    finally:
        dut.close()
    return 0


# --- argument parsing -----------------------------------------------------------------------


def common(sub, timeout_default):
    sub.add_argument("--port", help="serial port (default: the one port found, or THINGSTUDIO_PORT)")
    sub.add_argument("--json", action="store_true", help="one JSON object per line instead of text")
    sub.add_argument("--timeout", type=float, default=timeout_default,
                     help="seconds to collect output after the command (default %ss)" % timeout_default)


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="device_cli.py",
        description="Headless Thingstudio board control over USB serial.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=EXAMPLES,
    )
    commands = parser.add_subparsers(dest="command", required=True)

    p = commands.add_parser("list", help="list serial ports")
    p.add_argument("--all", action="store_true", help="include built-in UARTs as well as USB ports")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_list)

    p = commands.add_parser("hello", help="ask the board for HELLO")
    common(p, 8)
    p.set_defaults(func=cmd_hello)

    p = commands.add_parser("watch", help="stream console output and protocol messages")
    common(p, 0)
    p.set_defaults(func=cmd_watch)

    p = commands.add_parser("exec", help="run a console command (listener globals include `settings`)")
    common(p, 2)
    p.add_argument("code")
    p.set_defaults(func=cmd_exec)

    p = commands.add_parser("trigger", help="fire a TRIGGER for an inject/startup node id")
    common(p, 2)
    p.add_argument("node_id")
    p.set_defaults(func=cmd_trigger)

    p = commands.add_parser("restart", help="restart the flow/listener")
    common(p, 15)
    p.add_argument("--hard", action="store_true", help="hard reset (drops native-USB boards off the bus)")
    p.set_defaults(func=cmd_restart)

    p = commands.add_parser("stop", help="stop the listener at the MicroPython prompt")
    common(p, 5)
    p.set_defaults(func=cmd_stop)

    runtime = commands.add_parser("runtime", help="runtime maintenance")
    runtime_commands = runtime.add_subparsers(dest="runtime_command", required=True)
    p = runtime_commands.add_parser("install", help="push device-runtime/src onto the board")
    common(p, 5)
    p.add_argument("--wipe", action="store_true", help="erase the board's filesystem first (DESTRUCTIVE)")
    p.add_argument("--no-reset", action="store_true",
                   help="do not reset afterwards (a native-USB board drops off the bus on a hard reset)")
    p.set_defaults(func=cmd_runtime_install)

    flow = commands.add_parser("flow", help="flow deployment")
    flow_commands = flow.add_subparsers(dest="flow_command", required=True)
    p = flow_commands.add_parser("deploy", help="compile and deploy a .flow.json (or an already-compiled .py)")
    common(p, 6)
    p.add_argument("flow", help="a .flow.json file, or compiled MicroPython source")
    p.add_argument("--flow-name", help="the flow's name (default: the flow file's own flowName)")
    p.add_argument("--trigger", action="append", default=[], metavar="NODE_ID",
                   help="fire this inject/startup node after deploy (repeatable, 2s apart)")
    p.add_argument("--watch", action="store_true", help="keep watching after --timeout instead of exiting")
    p.add_argument("--mpy-cross", help="native mpy-cross binary (or THINGSTUDIO_MPY_CROSS, or on PATH)")
    p.add_argument("--arch", help="mpy-cross -march override (default: inferred from the board's HELLO)")
    p.set_defaults(func=cmd_flow_deploy)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except CliError as e:
        print("ERR: %s" % e, file=sys.stderr)
        return 1
    except serial.SerialException as e:
        print("ERR: serial connection lost: %s" % e, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
