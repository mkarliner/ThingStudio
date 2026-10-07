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
# docs/third-party-licenses.md's note on this) and, for compile_flow, a
# native `mpy-cross` build (device-runtime/test/README.md has the build
# recipe).

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

    def __init__(self, port_path, timeout_s=8):
        self.ser = serial.Serial(port_path, BAUD_RATE, timeout=timeout_s)
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


def compile_flow(mpy_cross, tmpdir, name, source):
    py_path = os.path.join(tmpdir, name + ".py")
    mpy_path = os.path.join(tmpdir, name + ".mpy")
    with open(py_path, "w") as f:
        f.write(source)
    subprocess.run([mpy_cross, "-o", mpy_path, py_path], check=True, capture_output=True)
    with open(mpy_path, "rb") as f:
        return f.read()


# --- Flow dependencies (2026-10-07, docs/working-notes/flow-dependencies-scoping.md) ----------------
# Runtimes from 7.0.0 hold vendored libraries only in /lib, installed per flow. A host tool that
# deploys a flow installs the libraries it imports first, the same way the editor does. Always
# sends every needed library (no inventory diff): test tools favour simple over fast.

import hashlib  # noqa: E402
import importlib.util  # noqa: E402
import re  # noqa: E402

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


def install_dependencies(dut, mpy_cross, tmpdir, source):
    """Compiles and DEP_PUTs every library `source` imports. Returns {name: hash} for DEPLOY."""
    vendor = os.path.join(SRC_DIR, "vendor")
    required = {}
    for dep in needed_dependencies(source):
        files = {}
        for src_rel, board_name in dep["files"]:
            with open(os.path.join(vendor, src_rel)) as f:
                mpy = compile_flow(mpy_cross, tmpdir, "dep_" + board_name[:-3], f.read())
            files[board_name[:-3] + ".mpy"] = mpy
        digest = dependency_hash(files)
        # 1 KB pieces then a commit, as the editor sends them (flow-dependencies.ts's libraryMessages).
        for fname in sorted(files):
            data = files[fname]
            for off in range(0, max(len(data), 1), 1024):
                dut.send_message({"type": "DEP_PUT", "name": dep["name"], "file": fname, "offset": off,
                                  "total": len(data), "data": data[off:off + 1024]})
        dut.send_message({"type": "DEP_COMMIT", "name": dep["name"], "hash": digest,
                          "files": {f: len(d) for f, d in files.items()}})
        res = dut.wait_for_message(lambda m: m["type"] == "DEP_RESULT" and m.get("name") == dep["name"], timeout_s=15,
                                   description="DEP_RESULT for %s" % dep["name"])
        if not res["ok"]:
            raise RuntimeError("installing %s failed: %s %s" % (dep["name"], res.get("code"), res.get("error")))
        print("Installed library %s (%s)" % (dep["name"], digest))
        required[dep["name"]] = digest
    return required


def deploy_message(dut, mpy_cross, tmpdir, source, bytecode):
    """A DEPLOY for `source`'s bytecode, after installing the libraries it imports."""
    return {"type": "DEPLOY", "bytecode": bytecode, "staticData": b"",
            "dependencies": install_dependencies(dut, mpy_cross, tmpdir, source)}
