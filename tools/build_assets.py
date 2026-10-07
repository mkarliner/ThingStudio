#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/build_assets.py
#
# Copies everything a packaged backend needs into backend/src/thingstudio_backend/_assets/, where
# assets.py looks when it isn't running from a dev checkout, and pyproject.toml ships it as package data:
#
#   _assets/editor/                      <- editor/dist        (npm run build)
#   _assets/docs/                        <- site/              (mkdocs build)
#   _assets/device-runtime/src/          <- device-runtime/src
#   _assets/device-runtime/runtime_manifest.py
#   _assets/device-runtime/runtime_build_sha.txt   git SHA of the last commit touching device-runtime/src
#   _assets/definitions/{boards,processors}/*.json <- editor/src/definitions
#
# Run with `make assets` (which builds the editor and docs first), or directly after building them.
# Stdlib only, so CI can run it with any Python 3.10+.
#
# Fails, naming what's wrong, rather than packaging something broken: an unbuilt or stale editor/docs
# build, a runtime file the manifest names but that isn't there, or no git SHA to stamp. A package with a
# month-old editor inside would fail silently on every user's machine, so staleness is an error here,
# not the warning the dev-checkout banner gives. Pass --allow-stale / --allow-no-sha to override.

from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO / "backend" / "src" / "thingstudio_backend" / "_assets"
DEFINITION_KINDS = ("boards", "processors")
RUNTIME_BUILD_STAMP = "runtime_build_sha.txt"  # must match assets.py
_IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")


class BuildError(Exception):
    pass


def _newest(paths: list[Path]) -> Path | None:
    files: list[Path] = []
    for p in paths:
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            files.extend(f for f in p.rglob("*") if f.is_file())
    files = [f for f in files if f.name != ".DS_Store"]
    return max(files, key=lambda f: f.stat().st_mtime, default=None)


def check_built(built: Path, sources: list[Path], what: str, build_cmd: str, allow_stale: bool) -> None:
    """`built` exists and no file under `sources` is newer than it."""
    if not built.is_file():
        raise BuildError(f"{what} isn't built ({built} missing). Run: {build_cmd}")
    newest = _newest(sources)
    if newest is not None and newest.stat().st_mtime > built.stat().st_mtime:
        msg = f"{what} build is older than {newest}. Run: {build_cmd}"
        if not allow_stale:
            raise BuildError(msg + " (or pass --allow-stale)")
        print(f"warning: {msg}", file=sys.stderr)


def check_runtime_manifest(repo: Path) -> None:
    """Every file runtime_manifest.py names exists, so an install from the package can't fail on a
    missing file that the build could have caught."""
    manifest_path = repo / "device-runtime" / "runtime_manifest.py"
    spec = importlib.util.spec_from_file_location("thingstudio_runtime_manifest_check", manifest_path)
    if spec is None or spec.loader is None:
        raise BuildError(f"can't load {manifest_path}")
    manifest = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manifest)
    src = repo / "device-runtime" / "src"
    deps = getattr(manifest, "DEPENDENCIES", [])
    names = [*manifest.CORE_FILES, manifest.LISTENER_FILE, *(f"vendor/{s}" for d in deps for s, _dest in d["files"])]
    missing = [n for n in names if not (src / n).is_file()]
    if missing:
        raise BuildError(f"runtime_manifest.py names files not in device-runtime/src: {', '.join(missing)}")


def runtime_sha(repo: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%H", "--", "device-runtime/src"],
            cwd=repo, capture_output=True, text=True, check=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    sha = out.stdout.strip() or None
    if sha:
        dirty = subprocess.run(
            ["git", "status", "--porcelain", "--", "device-runtime/src"],
            cwd=repo, capture_output=True, text=True, timeout=10,
        )
        if dirty.stdout.strip():
            print(
                "warning: device-runtime/src has uncommitted changes; the stamped SHA names the last commit, "
                "not what's being packaged.",
                file=sys.stderr,
            )
    return sha


def build(repo: Path, out: Path, allow_stale: bool = False, allow_no_sha: bool = False) -> list[str]:
    """Builds `out` from `repo`. Returns a short summary, one line per part."""
    editor = repo / "editor"
    check_built(
        editor / "dist" / "index.html",
        [editor / "src", editor / "index.html"],
        "the editor", "make editor", allow_stale,
    )
    check_built(
        repo / "site" / "index.html",
        [repo / "mkdocs.yml", repo / "docs" / "user-guide"],
        "the docs", "make docs", allow_stale,
    )
    check_runtime_manifest(repo)
    defs = editor / "src" / "definitions"
    for kind in DEFINITION_KINDS:
        if not any((defs / kind).glob("*.json")):
            raise BuildError(f"no built-in {kind} definitions in {defs / kind}")
    sha = runtime_sha(repo)
    if not sha and not allow_no_sha:
        raise BuildError(
            "couldn't get a git SHA for device-runtime/src (no git, or not a checkout). Boards installed from "
            "this package would report runtimeBuild=null. Pass --allow-no-sha to package anyway."
        )

    # Build beside the target, then swap, so a failed copy never leaves a half-filled _assets/.
    tmp = out.with_name(out.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    shutil.copytree(editor / "dist", tmp / "editor", ignore=_IGNORE)
    shutil.copytree(repo / "site", tmp / "docs", ignore=_IGNORE)
    rt = tmp / "device-runtime"
    shutil.copytree(repo / "device-runtime" / "src", rt / "src", ignore=_IGNORE)
    shutil.copy2(repo / "device-runtime" / "runtime_manifest.py", rt / "runtime_manifest.py")
    if sha:
        (rt / RUNTIME_BUILD_STAMP).write_text(sha + "\n")
    for kind in DEFINITION_KINDS:
        (tmp / "definitions" / kind).mkdir(parents=True)
        for f in sorted((defs / kind).glob("*.json")):
            shutil.copy2(f, tmp / "definitions" / kind / f.name)
    if out.exists():
        shutil.rmtree(out)
    tmp.rename(out)

    def count(p: Path) -> int:
        return sum(1 for f in p.rglob("*") if f.is_file())

    return [
        f"editor       {count(out / 'editor')} files",
        f"docs         {count(out / 'docs')} files",
        f"runtime      {count(out / 'device-runtime' / 'src')} files, build {sha[:12] if sha else 'unstamped'}",
        f"definitions  {count(out / 'definitions')} files",
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Copy built assets into the backend package (_assets/).")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output folder (default: {DEFAULT_OUT})")
    parser.add_argument("--allow-stale", action="store_true", help="package an editor/docs build older than its sources")
    parser.add_argument("--allow-no-sha", action="store_true", help="package without a runtime build SHA")
    args = parser.parse_args(argv)
    try:
        summary = build(REPO, args.out, args.allow_stale, args.allow_no_sha)
    except (BuildError, OSError) as exc:
        print(f"build_assets: {exc}", file=sys.stderr)
        return 1
    print(f"Assets written to {args.out}")
    for line in summary:
        print("  " + line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
