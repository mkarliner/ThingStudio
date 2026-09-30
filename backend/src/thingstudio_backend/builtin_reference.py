# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/builtin_reference.py
#
# Copies the built-in processor and board definitions into
# ~/.thingstudio/processors/ and ~/.thingstudio/boards/ on backend start, so
# a user can see and change them without a copy of the repo (Mike,
# 2026-09-24).
#
# Only MISSING files are copied; an existing file is never touched (Mike's
# call, 2026-09-24). So a user edits a built-in in place, and gets the
# original back by deleting the file and restarting the backend. The known
# cost: when a later version changes a built-in, a user's existing copy
# (edited or not) still wins in the editor until they delete it. The editor
# only reports a user file as replacing a built-in when its content actually
# differs (definitions.ts), so untouched copies stay quiet.
#
# Runs at backend start rather than "install time" because Thingstudio has
# no install step of its own yet (pip install -e + a build). A failure here
# is logged and ignored: it must never stop the editor from starting, and
# the editor has its own bundled copy of the built-ins anyway.
#
# Source: editor/src/definitions/ in a dev checkout, _assets/definitions/
# in a packaged install (assets.py).

from __future__ import annotations

import logging
from pathlib import Path

from .assets import asset_dirs

log = logging.getLogger(__name__)

KINDS = ("processors", "boards")


def default_definitions_dir() -> Path:
    """editor/src/definitions in a dev checkout, _assets/definitions in a packaged install (assets.py)."""
    return asset_dirs().definitions


def copy_missing_builtins(data_dir: Path, source_dir: Path | None = None) -> list[str]:
    """Copies each built-in definition into <data_dir>/<kind>/ unless a file
    with that name is already there. Returns the "<kind>/<file>" paths copied.
    Raises OSError on failure; the caller decides whether that's fatal."""
    source_dir = source_dir or default_definitions_dir()
    if not all((source_dir / kind).is_dir() for kind in KINDS):
        raise OSError(f"built-in definitions not found at {source_dir}")
    copied: list[str] = []
    for kind in KINDS:
        out = data_dir / kind
        out.mkdir(parents=True, exist_ok=True)
        for src in sorted((source_dir / kind).glob("*.json")):
            dest = out / src.name
            if dest.exists():
                continue
            dest.write_bytes(src.read_bytes())
            copied.append(f"{kind}/{src.name}")
    return copied


def seed_builtin_definitions(data_dir: Path, source_dir: Path | None = None) -> None:
    """copy_missing_builtins, logging instead of raising."""
    try:
        copied = copy_missing_builtins(data_dir, source_dir)
    except OSError as exc:
        log.warning("could not copy built-in board/processor definitions into %s: %s", data_dir, exc)
        return
    if copied:
        log.info("copied built-in definitions into %s: %s", data_dir, ", ".join(copied))


# -- example custom nodes ------------------------------------------------------
#
# Two small custom node packages (example_nodes/, shipped inside this Python
# package) copied into ~/.thingstudio/custom-nodes/ the first time the backend
# runs, so a new user has real, readable examples in the palette (Mike,
# 2026-09-30). Only when that folder doesn't exist yet: once it does, it's the
# user's, and a deleted example stays deleted.

EXAMPLE_NODES_DIR = Path(__file__).resolve().parent / "example_nodes"


def copy_example_custom_nodes(data_dir: Path, source_dir: Path = EXAMPLE_NODES_DIR) -> list[str]:
    """Creates <data_dir>/custom-nodes/ holding the example packages, unless
    that folder already exists. Returns the file names copied. Raises OSError
    on failure; the caller decides whether that's fatal."""
    out = data_dir / "custom-nodes"
    if out.exists():
        return []
    files = sorted(p for p in source_dir.glob("*.node.*") if p.suffix in (".json", ".py"))
    if not files:
        raise OSError(f"example custom nodes not found at {source_dir}")
    out.mkdir(parents=True)
    for src in files:
        (out / src.name).write_bytes(src.read_bytes())
    return [p.name for p in files]


def seed_example_custom_nodes(data_dir: Path, source_dir: Path = EXAMPLE_NODES_DIR) -> None:
    """copy_example_custom_nodes, logging instead of raising."""
    try:
        copied = copy_example_custom_nodes(data_dir, source_dir)
    except OSError as exc:
        log.warning("could not copy the example custom nodes into %s: %s", data_dir / "custom-nodes", exc)
        return
    if copied:
        log.info("copied example custom nodes into %s: %s", data_dir / "custom-nodes", ", ".join(copied))
