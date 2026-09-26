#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/make_bundle.py
#
# Builds one self-contained Thingstudio folder for one platform, and archives it (MVP item 7, step 2):
#
#   thingstudio-<version>-<platform>/
#     python/          python-build-standalone CPython, with the backend and its deps installed into it
#     thingstudio      launcher (thingstudio.cmd on Windows); runs `python -I -m thingstudio_backend`
#     README.txt, LICENSE, BUILD.txt
#
# Archived as .tar.gz (macOS/Linux: keeps symlinks and the executable bit) or .zip (Windows).
#
# Must run ON the target platform (CI runs one job per platform): pip installs the backend's
# dependencies with the bundled Python itself, so aiohttp's compiled wheels match it. Dependencies are
# wheels only (--only-binary=:all:), so a platform missing a wheel fails the build instead of compiling
# something against the CI machine that may not run elsewhere. Versions are pinned by
# packaging/constraints.txt, so two builds of the same tag ship the same dependencies.
#
# Needs backend/src/thingstudio_backend/_assets/ filled first (tools/build_assets.py, `make assets`);
# refuses to bundle without it. Python 3.10+, stdlib only.

from __future__ import annotations

import argparse
import hashlib
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import re
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PACKAGING = REPO / "packaging"
PBS_RELEASE = "20260901"
PYTHON_VERSION = "3.12.14"
PBS_URL = "https://github.com/astral-sh/python-build-standalone/releases/download/{release}/{name}"

# Our platform name -> python-build-standalone target triple.
TARGETS = {
    "macos-arm64": "aarch64-apple-darwin",
    "macos-x86_64": "x86_64-apple-darwin",
    "linux-x86_64": "x86_64-unknown-linux-gnu",
    "linux-aarch64": "aarch64-unknown-linux-gnu",
    "windows-x86_64": "x86_64-pc-windows-msvc",
}


# Oldest glibc a Linux bundle must run on: Debian 10, Ubuntu 20.04 and Raspberry Pi OS Bullseye all have
# 2.28 or later. Every compiled wheel installed must carry a manylinux tag at or below it (check_glibc_floor).
GLIBC_FLOOR = (2, 28)
_MANYLINUX_ALIASES = {"manylinux1": (2, 5), "manylinux2010": (2, 12), "manylinux2014": (2, 17)}


class BundleError(Exception):
    pass


def host_platform() -> str:
    system = {"Darwin": "macos", "Linux": "linux", "Windows": "windows"}.get(platform.system())
    machine = platform.machine().lower()
    if machine in ("arm64", "aarch64"):
        arch = "arm64" if system == "macos" else "aarch64"
    elif machine in ("x86_64", "amd64"):
        arch = "x86_64"
    else:
        arch = None
    if system is None or arch is None:
        raise BundleError(f"unsupported build machine: {platform.system()} {platform.machine()}")
    return f"{system}-{arch}"


def pbs_archive_name(target: str) -> str:
    return f"cpython-{PYTHON_VERSION}+{PBS_RELEASE}-{target}-install_only_stripped.tar.gz"


def expected_sha256(name: str) -> str:
    for line in (PACKAGING / "python-build-standalone.sha256").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            digest, _, file_name = line.partition("  ")
            if file_name == name:
                return digest
    raise BundleError(f"no pinned SHA-256 for {name} in packaging/python-build-standalone.sha256")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_python(target: str, cache: Path, local: Path | None) -> Path:
    """The pinned CPython archive, from `local` or downloaded into `cache`, checked against its pinned hash."""
    name = pbs_archive_name(target)
    want = expected_sha256(name)
    path = local or cache / name
    if local is None and not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        url = PBS_URL.format(release=PBS_RELEASE, name=name.replace("+", "%2B"))
        print(f"downloading {url}")
        tmp = path.with_suffix(".part")
        try:
            with urllib.request.urlopen(url, timeout=60) as resp, tmp.open("wb") as out:
                shutil.copyfileobj(resp, out)
        except OSError as exc:
            raise BundleError(f"download of {url} failed: {exc}") from exc
        tmp.replace(path)
    got = sha256_of(path)
    if got != want:
        raise BundleError(f"{path.name}: SHA-256 {got} doesn't match the pinned {want}. Refusing to use it.")
    return path


def extract_all(tar: tarfile.TarFile, dest: Path) -> None:
    """tarfile's "tar" filter (rejects absolute paths and ../ escapes) where this Python has it (3.12,
    and 3.10.12+/3.11.4+ backports); plain extraction otherwise -- the archive's hash is already checked."""
    if hasattr(tarfile, "tar_filter"):
        tar.extractall(dest, filter="tar")
    else:
        tar.extractall(dest)


def check_glibc_floor(site_packages: Path) -> str:
    """Fails if any installed compiled wheel needs a newer glibc than GLIBC_FLOOR. pip picks wheels for the
    build machine's glibc (a recent CI image), and a multi-tagged wheel is fine, but a dependency update
    that drops old manylinux tags would otherwise ship a bundle that won't start on older Linux."""
    worst = (0, 0)
    for wheel in sorted(site_packages.glob("*.dist-info/WHEEL")):
        floors = []
        for line in wheel.read_text().splitlines():
            tag = line.partition("Tag:")[2].strip() if line.startswith("Tag:") else ""
            plat = tag.rsplit("-", 1)[-1] if tag else ""
            if plat.startswith("manylinux"):
                name = plat.rsplit("_", 1)[0]  # drop the arch (x86_64 / aarch64)
                if name in _MANYLINUX_ALIASES:
                    floors.append(_MANYLINUX_ALIASES[name])
                else:
                    m = re.match(r"manylinux_(\d+)_(\d+)", plat)
                    if m:
                        floors.append((int(m.group(1)), int(m.group(2))))
        if floors:
            need = min(floors)
            if need > GLIBC_FLOOR:
                raise BundleError(
                    f"{wheel.parent.name} needs glibc {need[0]}.{need[1]}, newer than the "
                    f"{GLIBC_FLOOR[0]}.{GLIBC_FLOOR[1]} floor. Pin an older version in packaging/constraints.txt."
                )
            worst = max(worst, need)
    return f"{worst[0]}.{worst[1]}" if worst != (0, 0) else "any"


def run(cmd: list[str], **kw) -> None:
    print("+ " + " ".join(str(c) for c in cmd), flush=True)
    result = subprocess.run(cmd, **kw)
    if result.returncode != 0:
        raise BundleError(f"command failed ({result.returncode}): {' '.join(str(c) for c in cmd)}")


def backend_version() -> str:
    """[project] version from backend/pyproject.toml (a regex, not tomllib, so Python 3.10 works)."""
    m = re.search(r'^version\s*=\s*"([^"]+)"', (REPO / "backend" / "pyproject.toml").read_text(), re.M)
    if not m:
        raise BundleError("no version = \"...\" line in backend/pyproject.toml")
    return m.group(1)


def git_commit() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def bundle(plat: str, out_dir: Path, python_archive: Path | None = None, cache: Path | None = None) -> Path:
    """Builds the folder and its archive in out_dir. Returns the archive's path."""
    if plat not in TARGETS:
        raise BundleError(f"unknown platform {plat!r}; one of {', '.join(TARGETS)}")
    if plat != host_platform():
        raise BundleError(f"building {plat} needs a {plat} machine (this is {host_platform()}); see this file's header")
    assets = REPO / "backend" / "src" / "thingstudio_backend" / "_assets"
    if not (assets / "editor" / "index.html").is_file():
        raise BundleError(f"{assets} isn't filled. Run `make assets` (or tools/build_assets.py) first.")

    version = backend_version()
    name = f"thingstudio-{version}-{plat}"
    root = out_dir / name
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    windows = plat.startswith("windows")

    archive = fetch_python(TARGETS[plat], cache or out_dir / ".cache", python_archive)
    with tarfile.open(archive) as tar:
        extract_all(tar, root)  # the archive's top folder is python/
    py = root / "python" / ("python.exe" if windows else "bin/python3")
    if not py.exists():
        raise BundleError(f"{py} not found after unpacking {archive.name}")

    # Backend wheel first, then install that wheel wheels-only (see header). -I keeps the builder's own
    # environment variables and user site-packages out of the bundled Python.
    with tempfile.TemporaryDirectory() as wheel_dir:
        run([str(py), "-I", "-m", "pip", "wheel", "--quiet", "--no-deps", "--no-cache-dir", "-w", wheel_dir,
             str(REPO / "backend")])
        wheels = list(Path(wheel_dir).glob("thingstudio_backend-*.whl"))
        if len(wheels) != 1:
            raise BundleError(f"expected one backend wheel, got {[w.name for w in wheels]}")
        run([str(py), "-I", "-m", "pip", "install", "--quiet", "--no-cache-dir", "--only-binary=:all:",
             "-c", str(PACKAGING / "constraints.txt"),
             "--no-warn-script-location", "--root-user-action=ignore", str(wheels[0])])
    shutil.rmtree(REPO / "backend" / "build", ignore_errors=True)  # setuptools' in-tree leftovers
    glibc = ""
    if plat.startswith("linux"):
        site = next((root / "python" / "lib").glob("python3.*/site-packages"))
        glibc = f"needs glibc {check_glibc_floor(site)}+\n"

    # pip's console script hard-codes this build machine's path to python, so it breaks once the folder
    # moves. The launcher below replaces it.
    for script in ("bin/thingstudio-backend", "Scripts/thingstudio-backend.exe", "Scripts/thingstudio-backend"):
        (root / "python" / script).unlink(missing_ok=True)

    launcher = "thingstudio.cmd" if windows else "thingstudio"
    shutil.copy2(PACKAGING / "launcher" / launcher, root / launcher)
    if not windows:
        mode = (root / launcher).stat().st_mode
        (root / launcher).chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    shutil.copy2(PACKAGING / "README.txt", root / "README.txt")
    shutil.copy2(REPO / "LICENSE", root / "LICENSE")
    (root / "BUILD.txt").write_text(
        f"thingstudio {version}\nplatform {plat}\ncommit {git_commit()}\n"
        f"python {PYTHON_VERSION} (python-build-standalone {PBS_RELEASE}, {TARGETS[plat]})\n" + glibc
    )

    if windows:
        out = out_dir / f"{name}.zip"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(root.rglob("*")):
                z.write(p, p.relative_to(out_dir))
    else:
        out = out_dir / f"{name}.tar.gz"
        with tarfile.open(out, "w:gz") as tar:
            tar.add(root, arcname=name)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a self-contained Thingstudio folder and archive.")
    parser.add_argument("--platform", default=None, help=f"one of {', '.join(TARGETS)} (default: this machine)")
    parser.add_argument("--out", type=Path, default=REPO / "dist", help="output folder (default: dist/)")
    parser.add_argument("--python-archive", type=Path, default=None,
                        help="use this python-build-standalone archive instead of downloading it (hash still checked)")
    args = parser.parse_args(argv)
    try:
        out = bundle(args.platform or host_platform(), args.out, args.python_archive)
    except (BundleError, OSError) as exc:
        print(f"make_bundle: {exc}", file=sys.stderr)
        return 1
    print(f"Built {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
