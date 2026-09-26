#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/smoke_test_bundle.py
#
# Checks a bundle from tools/make_bundle.py the way a user would meet it: unpacks the archive into a
# fresh folder (proving the folder still works after it moves), starts it with the launcher, and checks
# that the editor, docs, runtime sources and definitions are served from the packaged layout. On
# macOS/Linux it also starts it through a symlink, the way the installer puts it on PATH.
#
# Stdlib only; run with any Python 3.10+. Exit status 0 = pass. Every failure names the check that failed
# and prints the backend's own output.

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

START_TIMEOUT_S = 60


class SmokeError(Exception):
    pass


def unpack(archive: Path, dest: Path) -> Path:
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            z.extractall(dest)
    else:
        with tarfile.open(archive) as tar:
            if hasattr(tarfile, "tar_filter"):
                tar.extractall(dest, filter="tar")
            else:
                tar.extractall(dest)
    folders = [p for p in dest.iterdir() if p.is_dir()]
    if len(folders) != 1:
        raise SmokeError(f"archive should hold one top folder, found {[p.name for p in folders]}")
    return folders[0]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(port: int, path: str, timeout: float = 10) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        # The launcher is a .cmd; killing cmd.exe alone would leave python.exe running.
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def check_running(launcher: Path, data_dir: Path, log_path: Path) -> list[str]:
    port = free_port()
    cmd = [str(launcher), "--no-browser", "--port", str(port), "--data-dir", str(data_dir), "--log-level", "INFO"]
    passed: list[str] = []
    with log_path.open("w") as log:
        proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=tempfile.gettempdir())
        try:
            deadline = time.monotonic() + START_TIMEOUT_S
            while True:
                if proc.poll() is not None:
                    raise SmokeError(f"backend exited early with status {proc.returncode}")
                try:
                    if get(port, "/api/alive", timeout=2)[0] == 200:
                        break
                except OSError:
                    pass
                if time.monotonic() > deadline:
                    raise SmokeError(f"backend didn't answer /api/alive within {START_TIMEOUT_S}s")
                time.sleep(0.5)
            passed.append("started and answered /api/alive")

            status, body = get(port, "/")
            if status != 200 or b"<html" not in body.lower() or b"isn't built" in body:
                raise SmokeError(f"/ returned {status}, not the editor")
            passed.append("editor served at /")

            status, body = get(port, "/docs/")
            if status != 200 or b"aren't built" in body:
                raise SmokeError(f"/docs/ returned {status}, not the docs")
            passed.append("docs served at /docs/")

            status, body = get(port, "/api/runtime-sources", timeout=30)
            files = json.loads(body).get("files", []) if status == 200 else []
            names = {f["name"] for f in files}
            if status != 200 or "listener.py" not in names or "runtime.py" not in names:
                raise SmokeError(f"/api/runtime-sources returned {status} with {sorted(names)}")
            passed.append(f"runtime sources served ({len(files)} files)")

            status, body = get(port, "/api/definitions")
            defs = json.loads(body) if status == 200 else {}
            if status != 200 or not defs.get("boards") or not defs.get("processors"):
                raise SmokeError(f"/api/definitions returned {status}: {body[:200]!r}")
            passed.append("definitions served")
            if not any((data_dir / "boards").glob("*.json")):
                raise SmokeError(f"built-in board definitions weren't copied into {data_dir / 'boards'}")
            passed.append("built-in definitions copied into the data folder")
        finally:
            stop(proc)

    log_text = log_path.read_text(errors="replace")
    if "serving the packaged layout" not in log_text:
        raise SmokeError("backend didn't report the packaged layout (is it reading a repo checkout instead?)")
    if "NODE_ERROR" in log_text:
        raise SmokeError("backend logged a NODE_ERROR")
    passed.append("packaged layout, no NODE_ERROR in the log")
    return passed


def check_runtime_stamp(folder: Path) -> str:
    py = folder / "python" / ("python.exe" if os.name == "nt" else "bin/python3")
    code = (
        "from thingstudio_backend.runtime_installer import RuntimeInstaller;"
        "f = dict(RuntimeInstaller().build_file_list());"
        "print(f.get('_runtime_build.txt', b'').decode())"
    )
    out = subprocess.run([str(py), "-I", "-c", code], capture_output=True, text=True, cwd=tempfile.gettempdir())
    sha = out.stdout.strip()
    if out.returncode != 0 or len(sha) != 40:
        raise SmokeError(f"runtime build stamp missing or wrong: {sha!r} {out.stderr[-500:]}")
    return f"runtime build stamp {sha[:12]}"


def smoke(archive: Path) -> list[str]:
    passed: list[str] = []
    with tempfile.TemporaryDirectory(prefix="ts smoke ") as tmp:  # a space in the path, on purpose
        tmp_path = Path(tmp)
        folder = unpack(archive, tmp_path / "unpacked")
        passed.append(f"unpacked {archive.name} to a new folder")
        windows = os.name == "nt"
        launcher = folder / ("thingstudio.cmd" if windows else "thingstudio")
        if not launcher.exists():
            raise SmokeError(f"no launcher at {launcher}")
        log = tmp_path / "backend.log"
        try:
            passed += check_running(launcher, tmp_path / "data", log)
            if not windows:
                bindir = tmp_path / "bin"
                bindir.mkdir()
                (bindir / "thingstudio").symlink_to(launcher)
                passed += [f"via symlink: {p}" for p in check_running(bindir / "thingstudio", tmp_path / "data2", log)]
        except SmokeError:
            if log.exists():
                print("---- backend output ----\n" + log.read_text(errors="replace") + "\n------------------------")
            raise
        passed.append(check_runtime_stamp(folder))
    return passed


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print("usage: smoke_test_bundle.py <thingstudio-...tar.gz|zip>", file=sys.stderr)
        return 2
    try:
        for line in smoke(Path(args[0]).resolve()):
            print(f"ok  {line}")
    except (SmokeError, OSError, ValueError) as exc:
        print(f"FAIL  {exc}", file=sys.stderr)
        return 1
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
