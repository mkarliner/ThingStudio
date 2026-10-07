# SPDX-License-Identifier: Apache-2.0
# backend/test/test_runtime_installer.py
#
# Unit tests for runtime_installer.py -- a temp dir stands in for device-runtime/src (never the
# real one), so this stays hermetic and isn't coupled to the real manifest's current contents
# drifting. A separate real-manifest smoke test (test_runtime_installer_reads_the_real_manifest
# below) confirms the actual device-runtime/runtime_manifest.py + device-runtime/src on disk
# resolve and read cleanly, without pushing anything to a fake port -- catches "someone renamed
# a vendor file and forgot this" without needing a board.

from __future__ import annotations

from pathlib import Path

import pytest

from thingstudio_backend import raw_repl
from thingstudio_backend.runtime_installer import RuntimeInstaller


def _write_fake_device_runtime(root: Path) -> Path:
    """Builds a minimal device-runtime/{runtime_manifest.py, src/...} tree under `root`,
    mirroring the real one's shape closely enough to exercise RuntimeInstaller for real."""
    device_runtime = root / "device-runtime"
    src = device_runtime / "src"
    vendor = src / "vendor" / "somelib"
    vendor.mkdir(parents=True)

    (src / "errors.py").write_text("# errors")
    (src / "runtime.py").write_text("# runtime")
    (src / "listener.py").write_text("# listener")
    (vendor / "somelib.py").write_text("# vendored")

    (device_runtime / "runtime_manifest.py").write_text(
        "CORE_FILES = ['errors.py', 'runtime.py']\n"
        "LISTENER_FILE = 'listener.py'\n"
        "DEPENDENCIES = [{'name': 'somelib', 'files': [('somelib/somelib.py', 'somelib.py')], 'requires': []}]\n"
        "LEGACY_ROOT_FILES = ['oldlib.py']\n"
    )
    return src


def test_build_file_list_is_the_runtime_only_no_libraries(tmp_path: Path) -> None:
    # Flow dependencies (2026-10-07): vendored libraries are installed per flow by Deploy, not here.
    src_dir = _write_fake_device_runtime(tmp_path)
    installer = RuntimeInstaller(runtime_src_dir=src_dir)

    files = installer.build_file_list()

    assert [name for name, _ in files] == ["errors.py", "runtime.py", "main.py"]
    by_name = dict(files)
    assert by_name["errors.py"] == b"# errors"
    # LISTENER_FILE's contents land under the "main.py" dest name, not its own source filename.
    assert by_name["main.py"] == b"# listener"


def test_legacy_root_files_cover_both_formats(tmp_path: Path) -> None:
    installer = RuntimeInstaller(runtime_src_dir=_write_fake_device_runtime(tmp_path))
    assert installer.legacy_root_files() == ["oldlib.py", "oldlib.mpy"]


def test_build_file_list_raises_a_clear_error_for_a_missing_file(tmp_path: Path) -> None:
    src_dir = _write_fake_device_runtime(tmp_path)
    (src_dir / "runtime.py").unlink()
    installer = RuntimeInstaller(runtime_src_dir=src_dir)

    with pytest.raises(raw_repl.RawReplError) as exc_info:
        installer.build_file_list()
    assert exc_info.value.step == "reading local runtime file"
    assert "runtime.py" in str(exc_info.value)


def test_install_drives_raw_repl_install_runtime_with_the_built_file_list(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    src_dir = _write_fake_device_runtime(tmp_path)
    installer = RuntimeInstaller(runtime_src_dir=src_dir)

    captured: dict[str, object] = {}

    def fake_install_runtime(port: object, files: list[tuple[str, bytes]], timeouts: object, on_progress: object = None, remove: object = None) -> None:
        captured["port"] = port
        captured["files"] = files
        captured["remove"] = remove

    monkeypatch.setattr(raw_repl, "install_runtime", fake_install_runtime)

    sentinel_port = object()
    installer.install(sentinel_port)  # type: ignore[arg-type] -- a real serial.Serial in production

    assert captured["port"] is sentinel_port
    assert [name for name, _ in captured["files"]] == ["errors.py", "runtime.py", "main.py"]
    # Old root copies of vendored libraries are deleted: they would shadow /lib.
    assert "oldlib.py" in captured["remove"] and "oldlib.mpy" in captured["remove"]  # type: ignore[operator]


def test_runtime_installer_reads_the_real_manifest_without_pushing_anything() -> None:
    """No fake tree here -- confirms the actual repo's device-runtime/runtime_manifest.py and
    device-runtime/src resolve and every listed file is actually present and readable, without
    needing a board. This is the test that would catch a renamed/removed vendor file the
    manifest wasn't updated for."""
    installer = RuntimeInstaller()  # default path: real device-runtime/src
    files = installer.build_file_list()
    names = [name for name, _ in files]
    assert "main.py" in names  # the listener, always present under this dest name
    assert len(files) == len(set(names)), f"duplicate destination filenames: {names}"
    assert all(len(data) > 0 for _, data in files), "a manifest file read back empty"


def test_build_file_list_stamps_the_runtime_build_marker_when_git_knows_it(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """HELLO.runtimeBuild came back null after the first real in-editor install (2026-09-23) -- only
    deploy_runtime.py wrote this file. Now both paths do."""
    from thingstudio_backend import runtime_installer

    src_dir = _write_fake_device_runtime(tmp_path)
    monkeypatch.setattr(runtime_installer, "runtime_build_sha", lambda _dir: "abc123")
    files = RuntimeInstaller(runtime_src_dir=src_dir).build_file_list()
    assert files[-1] == ("_runtime_build.txt", b"abc123")


def test_build_file_list_skips_the_marker_without_git(tmp_path: Path) -> None:
    src_dir = _write_fake_device_runtime(tmp_path)  # tmp_path is not a git checkout
    names = [name for name, _ in RuntimeInstaller(runtime_src_dir=src_dir).build_file_list()]
    assert "_runtime_build.txt" not in names


def test_runtime_build_sha_reads_the_last_commit_touching_the_src_dir(tmp_path: Path) -> None:
    import shutil
    import subprocess

    from thingstudio_backend.runtime_installer import runtime_build_sha

    if shutil.which("git") is None:
        pytest.skip("git not installed")
    src_dir = _write_fake_device_runtime(tmp_path)
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t", "PATH": __import__("os").environ["PATH"]}
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True, env=env)
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True, env=env)
    subprocess.run(["git", "commit", "-qm", "x"], cwd=tmp_path, check=True, env=env)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=tmp_path, check=True, capture_output=True, text=True, env=env)
    assert runtime_build_sha(src_dir) == head.stdout.strip()


# --- precompiled installs (2026-09-25) ------------------------------------------------------------


def test_source_files_lists_every_py_with_listener_under_its_own_name(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("thingstudio_backend.runtime_installer.runtime_build_sha", lambda _d: "abc")
    installer = RuntimeInstaller(runtime_src_dir=_write_fake_device_runtime(tmp_path))
    assert installer.source_files() == [
        ("errors.py", "# errors"),
        ("runtime.py", "# runtime"),
        ("listener.py", "# listener"),
    ]


def test_with_compiled_swaps_in_mpy_stubs_main_and_removes_stale_py() -> None:
    files = [("errors.py", b"e"), ("main.py", b"l"), ("somelib.py", b"s"), ("_runtime_build.txt", b"abc")]
    compiled = {"errors.mpy": b"M1", "listener.mpy": b"M2"}
    out, remove = RuntimeInstaller.with_compiled(files, compiled)
    assert out == [
        ("errors.mpy", b"M1"),
        ("listener.mpy", b"M2"),
        ("main.py", b"import listener\nlistener.main()\n"),
        ("somelib.py", b"s"),  # nothing compiled for it: pushed as source
        ("_runtime_build.txt", b"abc"),
    ]
    assert remove == ["errors.py", "listener.py", "somelib.mpy"]


def test_with_nothing_compiled_it_is_a_source_install_that_clears_old_mpy() -> None:
    files = [("errors.py", b"e"), ("main.py", b"l")]
    out, remove = RuntimeInstaller.with_compiled(files, {})
    assert out == files
    assert remove == ["errors.mpy", "listener.mpy", "listener.py"]


def test_install_passes_compiled_files_and_removals_through(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    installer = RuntimeInstaller(runtime_src_dir=_write_fake_device_runtime(tmp_path))
    captured: dict[str, object] = {}

    def fake_install_runtime(port: object, files: list[tuple[str, bytes]], timeouts: object, on_progress: object = None, remove: object = None) -> None:
        captured["files"] = [n for n, _ in files]
        captured["remove"] = remove

    monkeypatch.setattr(raw_repl, "install_runtime", fake_install_runtime)
    installer.install(object(), compiled={"runtime.mpy": b"M"})  # type: ignore[arg-type]
    assert "runtime.mpy" in captured["files"] and "runtime.py" not in captured["files"]
    assert "runtime.py" in captured["remove"]  # type: ignore[operator]
