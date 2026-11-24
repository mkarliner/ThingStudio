# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/user_libraries.py
#
# User libraries (interfaces/library-format/SPEC.md, 2026-11-24): Python of the user's own that a flow can import,
# sent to the board on Deploy exactly as the built-in libraries are. Two kinds of source folder, in this order:
# ~/.thingstudio/libraries/, then each custom-node bundle's lib/ (node-descriptor SPEC §3.1), bundles in name order.
#
# Fault handling, per the spec: a refused library is left out of the catalog with one message naming it, its origin
# and the reason; the others still load. Nothing here raises for a user's mistake. Two user sources offering the same
# name are BOTH refused -- never first-wins -- and no user library may shadow a built-in library, a runtime module or
# a firmware module, because /lib is first on the board's sys.path and the shadow would silently win everywhere.
#
# `requires` is worked out by scanning imports with the editor's rule (flow-dependencies.ts findImportedModules, also
# test/hil/hil_common.py's imported_modules): an import that names a catalog library is a requires; anything else is
# assumed to be firmware, as for generated code.

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .dependencies import Dependency, DependencyFile

# Must equal interfaces/library-format/reserved-names.json (test_user_libraries.py checks it), the same pattern as
# the node-descriptor schema test: the published list can't drift from the code that applies it.
RESERVED_RUNTIME: frozenset[str] = frozenset({"listener", "main", "boot"})
RESERVED_FIRMWARE: frozenset[str] = frozenset({
    "array", "asyncio", "binascii", "bluetooth", "btree", "builtins", "cmath", "collections", "cryptolib",
    "deflate", "dht", "errno", "esp", "esp32", "espnow", "framebuf", "gc", "hashlib", "heapq", "io", "json",
    "machine", "math", "micropython", "mip", "neopixel", "network", "ntptime", "onewire", "os", "platform",
    "pyb", "random", "re", "requests", "rp2", "select", "socket", "ssl", "struct", "sys", "time", "tls",
    "uasyncio", "ubinascii", "ucollections", "uctypes", "uerrno", "uhashlib", "uheapq", "uio", "ujson",
    "uos", "uplatform", "urandom", "ure", "urequests", "uselect", "usocket", "ussl", "ustruct", "usys",
    "utime", "uzlib", "vfs", "webrepl", "zlib",
})

_IMPORT_RE = re.compile(r"^[ \t]*(?:import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)|from[ \t]+([\w.]+)[ \t]+import\b)", re.M)


def imported_modules(source: str) -> set[str]:
    """Top-level module names `source` imports (the editor's findImportedModules rule)."""
    out: set[str] = set()
    for m in _IMPORT_RE.finditer(source):
        names = m.group(1).split(",") if m.group(1) else [m.group(2)]
        for n in names:
            top = n.strip().split(".")[0]
            if top:
                out.add(top)
    return out


@dataclass(frozen=True)
class LibrarySource:
    """One folder libraries are read from. `origin` names it in messages: "libraries" or "bundle:<name>"."""

    origin: str
    path: Path


@dataclass(frozen=True)
class LibraryRefusal:
    library: str
    origin: str
    message: str  # the whole console line


@dataclass
class _Candidate:
    name: str
    origin: str
    files: list[DependencyFile]
    problem: str | None = None


def _skip(name: str) -> bool:
    return name.startswith(".") or name.startswith("_")


def _read_entry(entry: Path, origin: str) -> _Candidate | None:
    """One top-level entry of a source folder as a candidate library, or None when the spec says to ignore it."""
    if _skip(entry.name):
        return None
    if entry.is_file():
        if not entry.name.endswith(".py"):
            return None
        stem = entry.name[:-3]
        cand = _Candidate(stem, origin, [])
        if not stem.isidentifier():
            cand.problem = f"{entry.name} is not a plain module name (letters, digits and _ only)"
            return cand
        try:
            cand.files.append(DependencyFile(entry.name, entry.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError) as exc:
            cand.problem = f"can't read {entry.name}: {exc}"
        return cand
    if not entry.is_dir():
        return None
    # Inside a package only caches and hidden folders are skipped; _private.py modules are ordinary.
    py_files = sorted(
        p for p in entry.rglob("*.py")
        if not any(part.startswith(".") or part == "__pycache__" for part in p.relative_to(entry).parts)
    )
    if not (entry / "__init__.py").is_file():
        if py_files:
            return _Candidate(entry.name, origin, [], f"{entry.name}/ holds .py files but no __init__.py, so it isn't a package")
        return None
    cand = _Candidate(entry.name, origin, [])
    if not entry.name.isidentifier():
        cand.problem = f"{entry.name}/ is not a plain module name (letters, digits and _ only)"
        return cand
    for p in py_files:
        rel = p.relative_to(entry.parent).as_posix()
        stems = [part[:-3] if part.endswith(".py") else part for part in rel.split("/")]
        if not all(s.isidentifier() for s in stems):
            cand.problem = f"{rel} is not a plain module path (every folder and file name must be letters, digits and _)"
            return cand
        try:
            cand.files.append(DependencyFile(rel, p.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError) as exc:
            cand.problem = f"can't read {rel}: {exc}"
            return cand
    return cand


def _cycle_members(requires: dict[str, set[str]]) -> dict[str, list[str]]:
    """Names on a requires cycle, each mapped to one cycle through it (for the message)."""
    found: dict[str, list[str]] = {}

    def walk(start: str, node: str, path: list[str], seen: set[str]) -> None:
        for nxt in sorted(requires.get(node, ())):
            if nxt == start:
                loop = path + [start]
                for member in path:
                    found.setdefault(member, loop)
            elif nxt not in seen and nxt in requires:
                walk(start, nxt, path + [nxt], seen | {nxt})

    for name in requires:
        walk(name, name, [name], {name})
    return found


def load_user_libraries(
    sources: list[LibrarySource],
    builtins: list[Dependency],
    runtime_modules: set[str],
) -> tuple[list[Dependency], list[LibraryRefusal]]:
    """The user libraries from `sources`, as catalog entries (source "user"), and every refusal. `builtins` is the
    built-in catalog; `runtime_modules` the runtime's own module names (runtime_manifest.py CORE_FILES)."""
    candidates: list[_Candidate] = []
    for src in sources:
        if not src.path.is_dir():
            continue
        for entry in sorted(src.path.iterdir(), key=lambda p: p.name):
            cand = _read_entry(entry, src.origin)
            if cand is not None:
                candidates.append(cand)

    builtin_names = {d.name for d in builtins}
    refusals: list[LibraryRefusal] = []

    def refuse(c: _Candidate, why: str) -> None:
        refusals.append(LibraryRefusal(c.name, c.origin, f"library {c.name} ({c.origin}) refused: {why}"))

    by_name: dict[str, list[_Candidate]] = {}
    for c in candidates:
        by_name.setdefault(c.name, []).append(c)

    accepted: list[_Candidate] = []
    for c in candidates:
        others = [o.origin for o in by_name[c.name] if o is not c]
        if c.name in builtin_names:
            refuse(c, f"its name shadows the built-in library {c.name}")
        elif c.name in runtime_modules or c.name in RESERVED_RUNTIME:
            refuse(c, f"its name shadows the runtime module {c.name}")
        elif c.name in RESERVED_FIRMWARE:
            refuse(c, f"its name shadows the firmware module {c.name}")
        elif others:
            refuse(c, f"offered by {' and '.join([c.origin] + others)} -- rename one")
        elif c.problem is not None:
            refuse(c, c.problem)
        else:
            accepted.append(c)

    def requires_of(c: _Candidate, known: set[str]) -> set[str]:
        imported: set[str] = set()
        for f in c.files:
            imported |= imported_modules(f.source)
        return {m for m in imported if m in known and m != c.name}

    known = builtin_names | {c.name for c in accepted}
    user_names = {c.name for c in accepted}
    requires = {c.name: requires_of(c, known) & user_names for c in accepted}
    on_cycle = _cycle_members(requires)
    if on_cycle:
        kept: list[_Candidate] = []
        for c in accepted:
            if c.name in on_cycle:
                refuse(c, "its imports form a cycle: " + " -> ".join(on_cycle[c.name]))
            else:
                kept.append(c)
        accepted = kept
        known = builtin_names | {c.name for c in accepted}

    deps = [
        Dependency(c.name, tuple(sorted(requires_of(c, known))), tuple(c.files), source="user", origin=c.origin)
        for c in accepted
    ]
    return deps, refusals
