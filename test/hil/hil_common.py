# SPDX-License-Identifier: Apache-2.0
# test/hil/hil_common.py
#
# Shared serial-link helpers for the witness+DUT rig's driver scripts.
# Extracted from run_fault_isolation_checks.py once a second driver
# script (run_gpio_pwm_timer_checks.py) needed the exact same DUT/witness
# link classes -- keeping two independent copies of the same
# base64/readline framing and line-based command protocol logic was a
# real risk of drift, not just duplication.
#
# Requires `pyserial` (not yet a tracked project dependency -- see
# docs/third-party-licenses.md's note on this) and, for the flow's own bytecode, a native
# `mpy-cross` build (device-runtime/test/README.md has the build recipe). Installing the libraries a
# flow imports also needs `node`: they are compiled with the editor's vendored mpy-cross WASM
# (compile_dependencies), because only that reproduces the hashes a board reports and lets a deploy
# skip what the board already has.

import base64
import os
import subprocess
import sys
import time

try:
    import serial
except ImportError:
    print("ERR: pyserial not installed. `pip install pyserial` -- see test/hil/README.md.", file=sys.stderr)
    sys.exit(2)

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(THIS_DIR, "..", "..", "device-runtime", "src")
sys.path.insert(0, SRC_DIR)

import protocol  # noqa: E402

F64_PREFIX = "F64:"
BAUD_RATE = 115200


class DutLink:
    """Talks §13 over a real serial port to the DUT, base64/readline-framed
    per listener.py's own contract (fault-isolation-briefing.md's stated
    default) -- the pyserial equivalent of editor/src/protocol/transport.ts's
    WebSerialTransport, kept separate rather than shared since this script
    runs under plain CPython, not a browser."""

    def __init__(self, port_path, timeout_s=8, exclusive=False):
        # exclusive=True (POSIX) makes a second program fail to open rather than interleave bytes
        # with this one -- without it Linux happily lets two readers split the same stream.
        kwargs = {"exclusive": True} if exclusive and os.name == "posix" else {}
        self.ser = serial.Serial(port_path, BAUD_RATE, timeout=timeout_s, **kwargs)
        self.decoder = protocol.ProtocolStreamDecoder()

    def send_message(self, message):
        frame = protocol.encode_message(message)
        line = F64_PREFIX + base64.b64encode(frame).decode("ascii") + "\n"
        self.ser.write(line.encode("ascii"))
        self.ser.flush()

    def send_raw_line(self, text):
        self.ser.write((text + "\n").encode("ascii"))
        self.ser.flush()

    def read_line(self):
        raw = self.ser.readline()
        if not raw:
            return None
        return raw.decode("utf-8", "replace").rstrip("\r\n")

    def wait_for_message(self, predicate, timeout_s, description):
        deadline = time.time() + timeout_s
        debug_lines = []
        while time.time() < deadline:
            line = self.read_line()
            if line is None:
                continue
            if not line.startswith(F64_PREFIX):
                debug_lines.append(line)
                continue
            try:
                frame = base64.b64decode(line[len(F64_PREFIX) :])
            except Exception:
                continue
            for result in self.decoder.push(frame):
                if "message" in result and predicate(result["message"]):
                    return result["message"]
        raise TimeoutError("timed out waiting for %s; debug output seen:\n%s" % (description, "\n".join(debug_lines)))

    def close(self):
        self.ser.close()


class WitnessLink:
    """Line-based command protocol client for witness_firmware.py."""

    def __init__(self, port_path, timeout_s=5):
        self.ser = serial.Serial(port_path, BAUD_RATE, timeout=timeout_s)

    def command(self, line, terminator_prefixes, timeout_s=5):
        """Sends one command line, collects reply lines until one starts
        with any of `terminator_prefixes` (inclusive)."""
        self.ser.write((line + "\n").encode("ascii"))
        self.ser.flush()
        deadline = time.time() + timeout_s
        replies = []
        while time.time() < deadline:
            raw = self.ser.readline()
            if not raw:
                continue
            text = raw.decode("utf-8", "replace").rstrip("\r\n")
            replies.append(text)
            if any(text.startswith(p) for p in terminator_prefixes):
                return replies
        raise TimeoutError("witness command %r did not complete in %ss; saw: %r" % (line, timeout_s, replies))

    def close(self):
        self.ser.close()


def compile_flow(mpy_cross, tmpdir, name, source, arch=None):
    """Compile `source` to bytecode.

    Runs mpy-cross with *relative* file names from inside tmpdir. mpy-cross embeds the
    source path in the .mpy, so compiling an absolute path in a random temp directory made
    the same library hash differently on every deploy -- every deploy then re-sent every
    dependency. A relative name keeps the bytes (and therefore dependency_hash) stable.
    """
    py_name = name + ".py"
    mpy_name = name + ".mpy"
    with open(os.path.join(tmpdir, py_name), "w") as f:
        f.write(source)
    command = [mpy_cross]
    if arch:
        command.append("-march=" + arch)
    command += ["-o", mpy_name, py_name]
    subprocess.run(command, cwd=tmpdir, check=True, capture_output=True)
    with open(os.path.join(tmpdir, mpy_name), "rb") as f:
        return f.read()


# --- Flow dependencies (2026-10-07, docs/working-notes/flow-dependencies-scoping.md) ----------------
# Runtimes from 7.0.0 hold vendored libraries only in /lib, installed per flow. A host tool that
# deploys a flow installs the libraries it imports first, the same way the editor does -- and skips the
# ones the board reports holding (install_dependencies), so a custom image's frozen copies stay frozen.

import hashlib  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402

# The editor's own mpy-cross (see compile_dependencies' docstring): the only tool that reproduces the
# hashes a board reports. Node + a vendored WASM file, both already part of the repo.
REPO = os.path.join(THIS_DIR, "..", "..")
DEP_COMPILE_JS = os.path.join(THIS_DIR, "dep_compile.mjs")

_IMPORT_RE = re.compile(r"^\s*(?:import\s+([\w.]+(?:\s*,\s*[\w.]+)*)|from\s+([\w.]+)\s+import\b)", re.M)


def imported_modules(source):
    """Top-level module names a Python source imports (same rule as the editor's compiler)."""
    out = set()
    for m in _IMPORT_RE.finditer(source):
        names = m.group(1).split(",") if m.group(1) else [m.group(2)]
        for n in names:
            out.add(n.strip().split(".")[0].split(" as ")[0].strip())
    return out


def _manifest_dependencies():
    path = os.path.join(THIS_DIR, "..", "..", "device-runtime", "runtime_manifest.py")
    spec = importlib.util.spec_from_file_location("hil_runtime_manifest", path)
    manifest = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manifest)
    return {d["name"]: d for d in manifest.DEPENDENCIES}


def needed_dependencies(source):
    """Dependency entries (runtime_manifest.DEPENDENCIES) the source needs, with their requires."""
    by_name = _manifest_dependencies()
    by_module = {}
    for d in by_name.values():
        for _src, board_name in d["files"]:
            by_module[board_name[:-3]] = d["name"]
    todo = [by_module[m] for m in sorted(imported_modules(source)) if m in by_module]
    out = []
    while todo:
        name = todo.pop(0)
        if name in [d["name"] for d in out]:
            continue
        out.append(by_name[name])
        todo.extend(by_name[name]["requires"])
    return out


def dependency_hash(files):
    """files: {board file name: bytes}. Same scheme as the editor (flow-dependencies.ts)."""
    h = hashlib.sha256()
    for name in sorted(files):
        h.update(("%s\n%d\n" % (name, len(files[name]))).encode())
        h.update(files[name])
    return h.hexdigest()[:16]


def libraries_to_send(required, inventory):
    """Which of `required` ({name: hash}) the board still needs, given what it reported holding in HELLO.
    Same rule as the editor's librariesToSend (flow-dependencies.ts): send everything when there is no
    inventory (no HELLO, or a board too old to report one), and skip a library only when the hashes agree.
    A different hash is sent, not trusted: the board's copy is then not the code this flow was compiled
    against."""
    return [name for name in sorted(required) if inventory is None or inventory.get(name) != required[name]]


def compile_dependencies(deps, outdir, log=print):
    """Compiles a flow's libraries with the editor's own mpy-cross, returning {name: {hash, files}}.

    Not compile_flow()'s native mpy-cross: the hash is over the .mpy bytes and mpy-cross embeds the
    source file's name in them, so only the editor's tool (input always /in.py, no -march) reproduces
    the hash a board reports -- which is the whole point of the inventory check below. dep_compile.mjs
    is that compiler; see its header for the incident (2026-10-26)."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node is not on PATH: installing libraries needs the editor's mpy-cross "
                           "(node test/hil/dep_compile.mjs). Install Node 22+, or pass "
                           "dependencies={} if the flow's libraries are already on the board")
    wasm = os.path.join(REPO, "editor", "public", "vendor", "mpy-cross", "mpy-cross.mjs")
    if not os.path.exists(wasm):
        raise RuntimeError("%s is missing -- the editor's mpy-cross moves, so point DEP_COMPILE at it" % wasm)

    spec = [{"name": dep["name"],
             "files": [{"board": board_name.replace(".py", ".mpy"),
                        "source": os.path.join(SRC_DIR, "vendor", src_rel)}
                       for src_rel, board_name in dep["files"]]}
            for dep in deps]
    if not spec:
        return {}
    work = os.path.join(outdir, "dep-compile")
    os.makedirs(work, exist_ok=True)
    spec_path = os.path.join(work, "spec.json")
    with open(spec_path, "w") as f:
        json.dump(spec, f)
    result = subprocess.run([node, DEP_COMPILE_JS, spec_path, work], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("compiling the flow's libraries failed: %s" % (result.stderr.strip() or result.returncode))
    return {d["name"]: {"hash": d["hash"], "files": d["files"]} for d in json.loads(result.stdout)["deps"]}


def install_dependencies(dut, tmpdir, source, log=print, inventory=None):
    """Compiles the libraries `source` imports and DEP_PUTs the ones the board hasn't got. Returns
    {name: hash} for every library the flow needs, for DEPLOY's own `dependencies`.

    `inventory` is what the board reported in HELLO (`dependencies`); None means the caller never asked,
    so this asks (board_inventory) before deciding: a custom image freezes the libraries a flow imports,
    and pushing a copy into /lib shadows the frozen one -- the flow then loads its libraries from RAM and
    the image's heap saving is gone. Only a board that does not answer HELLO_REQUEST gets everything,
    which is what a board too old to report an inventory needs. `log` lets a caller route the
    per-library line into its own output (the device CLI's --json)."""
    deps = needed_dependencies(source)
    if deps and inventory is None:
        inventory = board_inventory(dut)
        log("board holds %d libraries" % len(inventory) if inventory is not None
            else "no library inventory from the board: sending every library")
    compiled = compile_dependencies(deps, tmpdir, log=log)
    required = {name: c["hash"] for name, c in compiled.items()}
    to_send = libraries_to_send(required, inventory)
    already = [name for name in required if name not in to_send]
    if already:
        log("already on the board: %s" % ", ".join(sorted(already)))
    for name in to_send:
        files = {}
        for entry in compiled[name]["files"]:
            with open(entry["path"], "rb") as f:
                files[entry["board"]] = f.read()
        # 1 KB pieces, each confirmed by DEP_ACK before the next (runtime 9.0.0: a USB-UART board has no
        # flow control), then a commit -- as the editor sends them (flow-dependencies.ts, main.ts).
        for fname in sorted(files):
            data = files[fname]
            for off in range(0, max(len(data), 1), 1024):
                dut.send_message({"type": "DEP_PUT", "name": name, "file": fname, "offset": off,
                                  "total": len(data), "data": data[off:off + 1024]})
                ack = dut.wait_for_message(
                    lambda m, f=fname, o=off: m["type"] == "DEP_ACK" and m.get("name") == name
                    and m.get("file") == f and m.get("offset") == o,
                    timeout_s=10, description="DEP_ACK for %s %s@%d" % (name, fname, off))
                if not ack["ok"]:
                    raise RuntimeError("sending %s failed at %s byte %d: %s %s"
                                       % (name, fname, off, ack.get("code"), ack.get("error")))
        dut.send_message({"type": "DEP_COMMIT", "name": name, "hash": required[name],
                          "files": {f: len(d) for f, d in files.items()}})
        res = dut.wait_for_message(lambda m: m["type"] == "DEP_RESULT" and m.get("name") == name, timeout_s=15,
                                   description="DEP_RESULT for %s" % name)
        if not res["ok"]:
            raise RuntimeError("installing %s failed: %s %s" % (name, res.get("code"), res.get("error")))
        log("Installed library %s (%s)" % (name, required[name]))
    return required


def board_inventory(dut, timeout_s=4.0, attempts=3):
    """What the board reports holding ({name: hash}), or None if it doesn't answer.

    A board that booted a while ago sent its HELLO long before this client existed, so ask. The question
    is idempotent, so it is asked again up to `attempts` times: a request sent while the listener is still
    coming up (or while it is busy starting the flow) is simply lost, and the first line after a replug can
    be garbled (learnings/hardware-bringup-hil-rig.md). None after all of them means the board really will
    not say, and the caller sends every library."""
    for _ in range(attempts):
        try:
            dut.send_message({"type": "HELLO_REQUEST"})
            hello = dut.wait_for_message(lambda m: m.get("type") == "HELLO", timeout_s=timeout_s, description="HELLO")
            return hello.get("dependencies") or {}
        except (TimeoutError, RuntimeError):
            continue
    return None


def deploy_message(dut, tmpdir, source, bytecode, log=print, inventory=None):
    """A DEPLOY for `source`'s bytecode, after installing the libraries it imports."""
    return {"type": "DEPLOY", "bytecode": bytecode, "staticData": b"",
            "dependencies": install_dependencies(dut, tmpdir, source, log=log, inventory=inventory)}
