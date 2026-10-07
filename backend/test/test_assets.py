# SPDX-License-Identifier: Apache-2.0
# backend/test/test_assets.py
#
# assets.py (dev checkout vs packaged layout) and tools/build_assets.py (fills _assets/).

import importlib.util
import os
import subprocess
from pathlib import Path

import pytest

from thingstudio_backend import assets
from thingstudio_backend.assets import (
    PACKAGED_ASSETS_DIR,
    RUNTIME_BUILD_STAMP,
    asset_dirs,
    is_dev_checkout,
    missing_assets,
    packaged_asset_dirs,
)
from thingstudio_backend.runtime_installer import RuntimeInstaller, runtime_build_sha

REPO = Path(__file__).resolve().parents[2]


def _load_build_assets():
    spec = importlib.util.spec_from_file_location("build_assets", REPO / "tools" / "build_assets.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build_assets = _load_build_assets()


# --- assets.py ---------------------------------------------------------------------


def test_this_repo_is_a_dev_checkout_and_uses_repo_paths() -> None:
    assert is_dev_checkout(REPO)
    dirs = asset_dirs()
    assert dirs.layout == "dev checkout"
    assert dirs.editor == REPO / "editor" / "dist"
    assert dirs.docs == REPO / "site"
    assert dirs.runtime_src == REPO / "device-runtime" / "src"
    assert dirs.definitions == REPO / "editor" / "src" / "definitions"


def test_outside_a_checkout_the_packaged_assets_are_used(monkeypatch, tmp_path) -> None:
    # An installed package: the folder three levels up is site-packages' parent, not a repo.
    monkeypatch.setattr(assets, "_repo_root", lambda: tmp_path)
    dirs = asset_dirs()
    assert dirs.layout == "packaged"
    assert dirs.editor == PACKAGED_ASSETS_DIR / "editor"
    assert dirs.runtime_src == PACKAGED_ASSETS_DIR / "device-runtime" / "src"


def test_no_repo_root_at_all_means_packaged(monkeypatch) -> None:
    monkeypatch.setattr(assets, "_repo_root", lambda: None)
    assert asset_dirs().layout == "packaged"


def test_missing_assets_names_every_missing_part(tmp_path) -> None:
    missing = missing_assets(packaged_asset_dirs(tmp_path))
    assert [m.split(" (")[0] for m in missing] == [
        "editor", "docs", "device runtime", "board definitions", "processor definitions",
    ]


def test_runtime_build_sha_prefers_the_stamp(tmp_path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / RUNTIME_BUILD_STAMP).write_text("deadbeef\n")
    assert runtime_build_sha(tmp_path / "src") == "deadbeef"


def test_runtime_build_sha_is_none_with_no_stamp_and_no_git(tmp_path) -> None:
    (tmp_path / "src").mkdir()
    assert runtime_build_sha(tmp_path / "src") is None


# --- tools/build_assets.py -----------------------------------------------------------


def _fake_repo(root: Path) -> Path:
    """The smallest repo build_assets accepts: sources older than their builds."""
    def write(rel: str, text: str = "x") -> Path:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return p

    sources = [
        write("editor/src/main.ts"),
        write("editor/index.html"),
        write("mkdocs.yml"),
        write("docs/user-guide/index.md"),
        write("device-runtime/src/runtime.py"),
        write("device-runtime/src/listener.py"),
        write("device-runtime/src/vendor/lib/thing.py"),
        write("device-runtime/src/__pycache__/runtime.cpython-311.pyc"),
        write("editor/src/definitions/boards/pico.json", "{}"),
        write("editor/src/definitions/processors/rp2040.json", "{}"),
        write(
            "device-runtime/runtime_manifest.py",
            'CORE_FILES = ["runtime.py"]\nLISTENER_FILE = "listener.py"\nDEPENDENCIES = [{"name": "thing", "files": [("lib/thing.py", "thing.py")], "requires": []}]\n',
        ),
    ]
    for p in sources:
        os.utime(p, (1_000_000, 1_000_000))
    write("editor/dist/index.html", "<html>")
    write("editor/dist/assets/app.js")
    write("site/index.html", "<html>")
    return root


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.email=t@example.com", "-c", "user.name=t", *args],
        cwd=repo, check=True, capture_output=True,
    )


def test_build_produces_a_complete_packaged_layout(tmp_path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    _git(repo, "init", "-q")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "init")
    out = tmp_path / "_assets"

    summary = build_assets.build(repo, out)

    dirs = packaged_asset_dirs(out)
    assert missing_assets(dirs) == []
    assert (out / "editor" / "assets" / "app.js").is_file()
    assert not (dirs.runtime_src / "__pycache__").exists()
    stamp = (out / "device-runtime" / RUNTIME_BUILD_STAMP).read_text().strip()
    assert len(stamp) == 40 and "unstamped" not in summary[2]
    # The packaged runtime installs exactly as a checkout's would, stamp included.
    files = dict(RuntimeInstaller(dirs.runtime_src).build_file_list())
    # Libraries aren't part of an install (flow dependencies, 2026-10-07); Deploy installs them.
    assert set(files) == {"runtime.py", "main.py", "_runtime_build.txt"}
    from thingstudio_backend.dependencies import load_dependencies

    assert [d.name for d in load_dependencies(dirs.runtime_src)] == ["thing"]
    assert files["_runtime_build.txt"].decode() == stamp


def test_build_replaces_an_old_assets_folder(tmp_path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    out = tmp_path / "_assets"
    (out / "editor").mkdir(parents=True)
    (out / "editor" / "left-over.js").write_text("old")
    build_assets.build(repo, out, allow_no_sha=True)
    assert not (out / "editor" / "left-over.js").exists()
    assert not (tmp_path / "_assets.tmp").exists()


def test_build_refuses_a_stale_editor(tmp_path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    os.utime(repo / "editor" / "dist" / "index.html", (500_000, 500_000))
    with pytest.raises(build_assets.BuildError, match="older than.*make editor"):
        build_assets.build(repo, tmp_path / "_assets", allow_no_sha=True)
    assert not (tmp_path / "_assets").exists()


def test_build_refuses_an_unbuilt_docs_site(tmp_path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    (repo / "site" / "index.html").unlink()
    with pytest.raises(build_assets.BuildError, match="docs isn't built.*make docs"):
        build_assets.build(repo, tmp_path / "_assets", allow_no_sha=True)


def test_build_refuses_a_manifest_naming_a_missing_file(tmp_path) -> None:
    repo = _fake_repo(tmp_path / "repo")
    (repo / "device-runtime" / "src" / "vendor" / "lib" / "thing.py").unlink()
    with pytest.raises(build_assets.BuildError, match="vendor/lib/thing.py"):
        build_assets.build(repo, tmp_path / "_assets", allow_no_sha=True)


def test_build_refuses_no_sha_unless_allowed(tmp_path) -> None:
    repo = _fake_repo(tmp_path / "repo")  # not a git repo
    with pytest.raises(build_assets.BuildError, match="--allow-no-sha"):
        build_assets.build(repo, tmp_path / "_assets")
    build_assets.build(repo, tmp_path / "_assets", allow_no_sha=True)
    assert not (tmp_path / "_assets" / "device-runtime" / RUNTIME_BUILD_STAMP).exists()
