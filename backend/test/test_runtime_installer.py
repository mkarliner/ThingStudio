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
        "VENDOR_FILES = [('somelib/somelib.py', 'somelib.py')]\n"
    )
    return src


def test_build_file_list_reads_core_listener_and_vendor_files_in_order(tmp_path: Path) -> None:
    src_dir = _write_fake_device_runtime(tmp_path)
    installer = RuntimeInstaller(runtime_src_dir=src_dir)

    files = installer.build_file_list(include_vendor=True)

    assert [name for name, _ in files] == ["errors.py", "runtime.py", "main.py", "somelib.py"]
    by_name = dict(files)
    assert by_name["errors.py"] == b"# errors"
    # LISTENER_FILE's contents land under the "main.py" dest name, not its own source filename.
    assert by_name["main.py"] == b"# listener"
    assert by_name["somelib.py"] == b"# vendored"


def test_build_file_list_can_skip_vendor_files(tmp_path: Path) -> None:
    src_dir = _write_fake_device_runtime(tmp_path)
    installer = RuntimeInstaller(runtime_src_dir=src_dir)

    files = installer.build_file_list(include_vendor=False)

    assert [name for name, _ in files] == ["errors.py", "runtime.py", "main.py"]


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

    def fake_install_runtime(port: object, files: list[tuple[str, bytes]], timeouts: object) -> None:
        captured["port"] = port
        captured["files"] = files

    monkeypatch.setattr(raw_repl, "install_runtime", fake_install_runtime)

    sentinel_port = object()
    installer.install(sentinel_port)  # type: ignore[arg-type] -- a real serial.Serial in production

    assert captured["port"] is sentinel_port
    assert [name for name, _ in captured["files"]] == ["errors.py", "runtime.py", "main.py", "somelib.py"]


def test_runtime_installer_reads_the_real_manifest_without_pushing_anything() -> None:
    """No fake tree here -- confirms the actual repo's device-runtime/runtime_manifest.py and
    device-runtime/src resolve and every listed file is actually present and readable, without
    needing a board. This is the test that would catch a renamed/removed vendor file the
    manifest wasn't updated for."""
    installer = RuntimeInstaller()  # default path: real device-runtime/src
    files = installer.build_file_list(include_vendor=True)
    names = [name for name, _ in files]
    assert "main.py" in names  # the listener, always present under this dest name
    assert len(files) == len(set(names)), f"duplicate destination filenames: {names}"
    assert all(len(data) > 0 for _, data in files), "a manifest file read back empty"
