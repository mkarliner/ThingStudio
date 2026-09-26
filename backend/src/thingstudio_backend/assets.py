# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/assets.py
#
# Where the backend finds the files it serves or pushes: the built editor, the built docs, the device
# runtime (device-runtime/src + runtime_manifest.py) and the built-in processor/board definitions.
#
# Two layouts, decided once for all four, never mixed:
#
# - Dev checkout: this file sits at <repo>/backend/src/thingstudio_backend/, so the repo paths are used
#   (editor/dist, site/, device-runtime/src, editor/src/definitions). Detected by the repo's own
#   backend/pyproject.toml and device-runtime/ being where they should be.
# - Packaged install (MVP item 7): tools/build_assets.py copied everything into _assets/ next to this
#   file, and the package ships it as package data.
#
# A dev checkout wins even when _assets/ exists (someone ran tools/build_assets.py locally to test a
# package). Otherwise a rebuilt editor/dist would be silently shadowed by the stale copy in _assets/,
# the same "serves old files, no error" trap editor_site.py's stale-build banner exists for.
#
# Each module keeps its own default_*() function and its injection parameter (--static-dir,
# --docs-dir, RuntimeInstaller(runtime_src_dir), copy_missing_builtins(source_dir)); those defaults
# now call into here instead of each walking up to the repo root itself.

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
PACKAGED_ASSETS_DIR = PACKAGE_DIR / "_assets"

# Written by tools/build_assets.py next to the packaged runtime (…/_assets/device-runtime/): the git SHA
# of the last commit touching device-runtime/src, which a packaged install has no git to look up.
RUNTIME_BUILD_STAMP = "runtime_build_sha.txt"


def _repo_root() -> Path | None:
    parents = PACKAGE_DIR.parents
    return parents[2] if len(parents) > 2 else None


def is_dev_checkout(repo_root: Path | None = None) -> bool:
    root = repo_root if repo_root is not None else _repo_root()
    return root is not None and (root / "backend" / "pyproject.toml").is_file() and (root / "device-runtime").is_dir()


@dataclass(frozen=True)
class AssetDirs:
    layout: str  # "dev checkout" or "packaged"
    editor: Path
    docs: Path
    runtime_src: Path  # runtime_manifest.py is expected in its parent
    definitions: Path


def dev_asset_dirs(repo_root: Path) -> AssetDirs:
    return AssetDirs(
        layout="dev checkout",
        editor=repo_root / "editor" / "dist",
        docs=repo_root / "site",
        runtime_src=repo_root / "device-runtime" / "src",
        definitions=repo_root / "editor" / "src" / "definitions",
    )


def packaged_asset_dirs(assets_dir: Path = PACKAGED_ASSETS_DIR) -> AssetDirs:
    return AssetDirs(
        layout="packaged",
        editor=assets_dir / "editor",
        docs=assets_dir / "docs",
        runtime_src=assets_dir / "device-runtime" / "src",
        definitions=assets_dir / "definitions",
    )


def asset_dirs() -> AssetDirs:
    root = _repo_root()
    if root is not None and is_dev_checkout(root):
        return dev_asset_dirs(root)
    return packaged_asset_dirs()


def missing_assets(dirs: AssetDirs) -> list[str]:
    """What a packaged install needs and doesn't have, as readable lines. Empty when complete. Only
    meaningful for the packaged layout: a dev checkout reports unbuilt parts through its own pages."""
    checks = [
        (dirs.editor / "index.html", "editor"),
        (dirs.docs / "index.html", "docs"),
        (dirs.runtime_src.parent / "runtime_manifest.py", "device runtime"),
        (dirs.definitions / "boards", "board definitions"),
        (dirs.definitions / "processors", "processor definitions"),
    ]
    return [f"{what} ({path})" for path, what in checks if not path.exists()]
