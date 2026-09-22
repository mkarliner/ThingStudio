# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/runtime_installer.py
#
# Adapter between raw_repl.py (pure protocol, no filesystem/manifest opinions -- see its own
# header) and runtime_manifest.py (the shared file list, device-runtime/runtime_manifest.py):
# locates device-runtime/src on disk, reads CORE_FILES/LISTENER_FILE/(optionally) VENDOR_FILES
# off it, and hands raw_repl.install_runtime() an already-ordered [(dest_name, bytes), ...]
# list. Kept separate from raw_repl.py so that module stays testable with zero filesystem
# dependency, and separate from ws_relay.py's WS-message wiring so this piece stays testable
# without a WebSocket at all.
#
# Where device-runtime/src actually lives on disk is a real open question this doesn't solve:
# _default_runtime_src_dir() below assumes a dev/repo-checkout layout (this file's own path,
# walked up to the repo root, then into device-runtime/src) -- correct today, not guaranteed
# correct once MVP item 7 (packaging -- curl|sh/Homebrew/PowerShell/winget/scoop/zip, "every
# route bundles the runtime") actually ships a built app. `runtime_src_dir` is a constructor
# parameter specifically so packaging can override it later without touching this module's
# actual logic -- CLAUDE.md's "don't paint into a dead end" principle applied to a real one-way
# door: hardcoding the dev-layout assumption INTO install logic (rather than injecting it) would
# strand this code the moment packaging picks a different layout.
#
# NOT yet verified against real hardware -- see raw_repl.py's own header.

from __future__ import annotations

from pathlib import Path

from typing import TYPE_CHECKING

from . import raw_repl
from .raw_repl import RawReplTimeouts

if TYPE_CHECKING:
    from .raw_repl import _SerialPort  # type-only: a private Protocol, not a public re-export


def _default_runtime_src_dir() -> Path:
    """backend/src/thingstudio_backend/runtime_installer.py -> repo root -> device-runtime/src.
    See this module's header on why this is a default, not an assumption baked into the actual
    install logic below."""
    return Path(__file__).resolve().parents[3] / "device-runtime" / "src"


class RuntimeInstaller:
    """Reads the shared manifest (device-runtime/runtime_manifest.py) off `runtime_src_dir` and
    pushes it onto a board via raw_repl.install_runtime(). One instance is reusable across
    multiple install calls (e.g. one per backend process), since manifest/file-reading is cheap
    and boards are connected one at a time anyway (serial_relay.py's own one-backend-one-device
    v1 scope)."""

    def __init__(self, runtime_src_dir: Path | None = None) -> None:
        self.runtime_src_dir = runtime_src_dir or _default_runtime_src_dir()

    def _read(self, relative_path: str) -> bytes:
        path = self.runtime_src_dir / relative_path
        try:
            return path.read_bytes()
        except OSError as exc:
            raise raw_repl.RawReplError("reading local runtime file", f"{path}: {exc}") from exc

    def build_file_list(self, include_vendor: bool = True) -> list[tuple[str, bytes]]:
        """Imports runtime_manifest.py fresh each call (not at module import time) so a manifest
        edit is picked up without restarting the backend process -- cheap (a few small files),
        and matches this project's general "don't make a dev loop worse than it needs to be"
        posture more than it costs anything real."""
        import importlib.util
        import sys

        manifest_path = self.runtime_src_dir.parent / "runtime_manifest.py"
        spec = importlib.util.spec_from_file_location("thingstudio_runtime_manifest", manifest_path)
        if spec is None or spec.loader is None:
            raise raw_repl.RawReplError("loading runtime manifest", f"could not load {manifest_path}")
        manifest = importlib.util.module_from_spec(spec)
        # Registered in sys.modules before exec_module -- importlib's own documented requirement
        # for a module that might (this one doesn't, but a future edit could) import itself
        # recursively or get re-imported elsewhere in the same process.
        sys.modules[spec.name] = manifest
        spec.loader.exec_module(manifest)

        files: list[tuple[str, bytes]] = []
        for name in manifest.CORE_FILES:
            files.append((name, self._read(name)))
        files.append(("main.py", self._read(manifest.LISTENER_FILE)))
        if include_vendor:
            for src_rel, dest_name in manifest.VENDOR_FILES:
                files.append((dest_name, self._read(f"vendor/{src_rel}")))
        return files

    def install(self, port: "_SerialPort", include_vendor: bool = True, timeouts: RawReplTimeouts = RawReplTimeouts()) -> None:
        """Pushes the full manifest onto `port`'s board and hard-resets it. Raises
        raw_repl.RawReplError (from whichever step failed) on any problem -- see
        raw_repl.install_runtime()'s own docstring on why there's no partial-success case."""
        files = self.build_file_list(include_vendor)
        raw_repl.install_runtime(port, files, timeouts)
