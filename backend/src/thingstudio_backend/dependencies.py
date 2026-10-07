# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/dependencies.py
#
# Flow dependencies (2026-10-07, docs/working-notes/flow-dependencies-scoping.md): the libraries a
# compiled flow may import, from runtime_manifest.py's DEPENDENCIES, with their sources -- served to
# the editor at /api/dependencies. The editor maps a flow's imports to these, compiles the files to
# .mpy and installs them on the board with DEP_PUT before DEPLOY.
#
# The list is checked here, on every load, rather than trusted: a typo in the manifest should be one
# clear error naming the entry, not a board that can't import a library at deploy time.

from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass
from pathlib import Path

from .assets import asset_dirs


class DependencyListError(Exception):
    """The manifest's DEPENDENCIES list is wrong; the message names the entry and the problem."""


@dataclass(frozen=True)
class DependencyFile:
    board_name: str  # e.g. "mqtt_as.py"
    source: str


@dataclass(frozen=True)
class Dependency:
    name: str
    requires: tuple[str, ...]
    files: tuple[DependencyFile, ...]

    @property
    def modules(self) -> tuple[str, ...]:
        return tuple(f.board_name[:-3] for f in self.files)


def _is_identifier(s: object) -> bool:
    return isinstance(s, str) and s.isidentifier()


def _load_manifest(runtime_src_dir: Path):
    manifest_path = runtime_src_dir.parent / "runtime_manifest.py"
    spec = importlib.util.spec_from_file_location("thingstudio_runtime_manifest_deps", manifest_path)
    if spec is None or spec.loader is None:
        raise DependencyListError(f"could not load {manifest_path}")
    manifest = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = manifest
    spec.loader.exec_module(manifest)
    return manifest


def load_dependencies(runtime_src_dir: Path | None = None) -> list[Dependency]:
    """Reads and checks DEPENDENCIES, with each file's source. Raises DependencyListError."""
    src = runtime_src_dir or asset_dirs().runtime_src
    manifest = _load_manifest(src)
    raw = getattr(manifest, "DEPENDENCIES", None)
    if not isinstance(raw, list):
        raise DependencyListError("runtime_manifest.py has no DEPENDENCIES list")

    deps: list[Dependency] = []
    seen_names: set[str] = set()
    seen_files: dict[str, str] = {}
    for i, entry in enumerate(raw):
        label = f"DEPENDENCIES[{i}]"
        if not isinstance(entry, dict):
            raise DependencyListError(f"{label} must be a dict")
        name = entry.get("name")
        if not _is_identifier(name):
            raise DependencyListError(f"{label}: name {name!r} must be a plain module-style name")
        label = f"dependency {name!r}"
        if name in seen_names:
            raise DependencyListError(f"{label} is listed twice")
        seen_names.add(name)
        requires = entry.get("requires", [])
        if not isinstance(requires, list) or not all(isinstance(r, str) for r in requires):
            raise DependencyListError(f"{label}: requires must be a list of names")
        files_raw = entry.get("files")
        if not isinstance(files_raw, list) or not files_raw:
            raise DependencyListError(f"{label}: files must be a non-empty list")
        files: list[DependencyFile] = []
        for pair in files_raw:
            if not (isinstance(pair, (tuple, list)) and len(pair) == 2 and all(isinstance(p, str) for p in pair)):
                raise DependencyListError(f"{label}: each file must be (vendor path, board file name)")
            vendor_rel, board_name = pair
            if not board_name.endswith(".py") or not board_name[:-3].isidentifier():
                raise DependencyListError(f"{label}: board file name {board_name!r} must be a plain name ending .py")
            if board_name in seen_files:
                raise DependencyListError(f"{label}: {board_name} is also a file of {seen_files[board_name]!r}")
            seen_files[board_name] = name
            path = src / "vendor" / vendor_rel
            try:
                source = path.read_text(encoding="utf-8")
            except OSError as exc:
                raise DependencyListError(f"{label}: can't read {path}: {exc}") from exc
            files.append(DependencyFile(board_name, source))
        deps.append(Dependency(name, tuple(requires), tuple(files)))

    by_name = {d.name: d for d in deps}
    for d in deps:
        for r in d.requires:
            if r not in by_name:
                raise DependencyListError(f"dependency {d.name!r} requires {r!r}, which isn't in the list")
    _check_no_cycles(by_name)
    return deps


def _check_no_cycles(by_name: dict[str, Dependency]) -> None:
    state: dict[str, int] = {}  # 1 = visiting, 2 = done

    def visit(name: str, path: list[str]) -> None:
        if state.get(name) == 2:
            return
        if state.get(name) == 1:
            raise DependencyListError("dependencies require each other in a loop: " + " -> ".join(path + [name]))
        state[name] = 1
        for r in by_name[name].requires:
            visit(r, path + [name])
        state[name] = 2

    for name in by_name:
        visit(name, [])


def dependencies_json(deps: list[Dependency]) -> dict:
    """The /api/dependencies body."""
    return {
        "dependencies": [
            {
                "name": d.name,
                "requires": list(d.requires),
                "files": [{"name": f.board_name, "source": f.source} for f in d.files],
            }
            for d in deps
        ]
    }
