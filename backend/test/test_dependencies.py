# SPDX-License-Identifier: Apache-2.0
# backend/test/test_dependencies.py
#
# dependencies.py (flow dependencies, 2026-10-07): loading and checking runtime_manifest.py's
# DEPENDENCIES list, and the real repo's list resolving cleanly. Fake trees in tmp_path, same
# approach as test_runtime_installer.py.

from __future__ import annotations

from pathlib import Path

import pytest

from thingstudio_backend.dependencies import DependencyListError, dependencies_json, load_dependencies


def _tree(root: Path, deps_literal: str, files: dict[str, str] | None = None) -> Path:
    src = root / "device-runtime" / "src"
    (src / "vendor").mkdir(parents=True)
    for rel, text in (files or {"a/a.py": "# a", "b/b.py": "# b"}).items():
        path = src / "vendor" / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    (root / "device-runtime" / "runtime_manifest.py").write_text(
        "CORE_FILES = []\nLISTENER_FILE = 'listener.py'\nDEPENDENCIES = " + deps_literal + "\n"
    )
    return src


def test_loads_entries_with_sources(tmp_path: Path) -> None:
    src = _tree(tmp_path, "[{'name': 'a', 'files': [('a/a.py', 'a.py')], 'requires': ['b']},"
                          " {'name': 'b', 'files': [('b/b.py', 'b.py')], 'requires': []}]")
    deps = load_dependencies(src)
    assert [d.name for d in deps] == ["a", "b"]
    assert deps[0].requires == ("b",)
    assert deps[0].modules == ("a",)
    assert dependencies_json(deps) == {
        "dependencies": [
            {"name": "a", "requires": ["b"], "files": [{"name": "a.py", "source": "# a"}]},
            {"name": "b", "requires": [], "files": [{"name": "b.py", "source": "# b"}]},
        ]
    }


@pytest.mark.parametrize(
    "literal, fragment",
    [
        ("[{'name': 'a-b', 'files': [('a/a.py', 'a.py')]}]", "plain module-style name"),
        ("[{'name': 'a', 'files': [('a/a.py', 'a.py')]}, {'name': 'a', 'files': [('b/b.py', 'b.py')]}]", "listed twice"),
        ("[{'name': 'a', 'files': []}]", "non-empty list"),
        ("[{'name': 'a', 'files': [('a/a.py', '../a.py')]}]", "plain name ending .py"),
        ("[{'name': 'a', 'files': [('a/missing.py', 'a.py')]}]", "can't read"),
        ("[{'name': 'a', 'files': [('a/a.py', 'a.py')], 'requires': ['nope']}]", "isn't in the list"),
        ("[{'name': 'a', 'files': [('a/a.py', 'a.py')]}, {'name': 'b', 'files': [('b/b.py', 'a.py')]}]", "also a file of"),
        ("[{'name': 'a', 'files': [('a/a.py', 'a.py')], 'requires': ['b']},"
         " {'name': 'b', 'files': [('b/b.py', 'b.py')], 'requires': ['a']}]", "loop"),
    ],
)
def test_rejects_a_bad_list_with_a_named_error(tmp_path: Path, literal: str, fragment: str) -> None:
    src = _tree(tmp_path, literal)
    with pytest.raises(DependencyListError) as exc:
        load_dependencies(src)
    assert fragment in str(exc.value)


def test_the_real_manifest_resolves() -> None:
    """The repo's own DEPENDENCIES: every file present, requires known, no loops."""
    deps = load_dependencies()
    names = {d.name for d in deps}
    assert {"mqtt_as", "events", "delay_ms"} <= names
    events = next(d for d in deps if d.name == "events")
    assert events.requires == ("delay_ms",)
    assert all(f.source for d in deps for f in d.files)
