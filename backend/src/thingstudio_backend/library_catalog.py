# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/library_catalog.py
#
# The whole library catalog a flow can import: the built-ins (dependencies.py, runtime_manifest.py) followed by the
# user's own libraries (user_libraries.py, interfaces/library-format/SPEC.md). Its own module so dependencies.py,
# user_libraries.py and persisted_store.py stay free of each other: /api/dependencies and /api/custom-nodes both call
# here, the second because a refused library skips the bundle that ships it (node-descriptor SPEC §3.1).

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from .dependencies import Dependency, load_dependencies, runtime_module_names
from .persisted_store import PersistedStore
from .user_libraries import LibraryRefusal, load_user_libraries


def library_catalog(store: PersistedStore, runtime_src_dir: Path | None = None) -> tuple[list[Dependency], list[LibraryRefusal]]:
    """Built-ins then user libraries, and every user library refused. Raises DependencyListError only for a broken
    built-in list (our bug, not the user's)."""
    builtins = load_dependencies(runtime_src_dir)
    # A bundle is skipped whole (node-descriptor SPEC §3.1), lib/ included: a structurally broken one contributes no
    # libraries, and one with a refused library loses its other libraries too. Its refusal messages still stand.
    _listings, bundles = store.scan_custom_nodes(None)
    broken = {f"bundle:{b.name}" for b in bundles if b.problems}
    sources = [s for s in store.library_sources() if s.origin not in broken]
    user, refusals = load_user_libraries(sources, builtins, runtime_module_names(runtime_src_dir))
    lost = {r.origin for r in refusals if r.origin.startswith("bundle:")}
    if lost:
        dropped = {d.name for d in user if d.origin in lost}
        user = [replace(d, requires=tuple(r for r in d.requires if r not in dropped)) for d in user if d.origin not in lost]
    return builtins + user, refusals


def library_problems(refusals: list[LibraryRefusal]) -> dict[str, list[str]]:
    """Refused library names by origin, for PersistedStore's bundle check."""
    out: dict[str, list[str]] = {}
    for r in refusals:
        out.setdefault(r.origin, [])
        if r.library not in out[r.origin]:
            out[r.origin].append(r.library)
    return out
