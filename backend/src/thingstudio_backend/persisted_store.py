# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/persisted_store.py
#
# The backend's own filesystem ownership of `~/.thingstudio`
# (docs/working-notes/local-persistence-scoping.md, Decision 1: "a small
# addition on top of [the backend] -- `pathlib.Path.home() / '.thingstudio'`,
# created on first use"). This module is where that note's explicitly
# undecided "internal layout" question gets answered, alongside
# docs/working-notes/outstanding-items/backend-persisted-data-protocol.md's
# shape decision (HTTP admin API, confirmed with Mike 2026-09-07).
#
# Layout, v1:
#   ~/.thingstudio/
#     flows/<name>.flow.json          -- one file per saved flow
#     custom-nodes/<name>.node.json   -- descriptor half of a package
#     custom-nodes/<name>.node.py     -- implementation half, same base name
#                                         (custom-node-authoring-scoping.md
#                                         Decision 3/4's two-file package
#                                         format, mirrored here unchanged)
#
# Deliberately flat, no subdirectories/nesting -- design doc §6 imagines a
# project directory of many flow files (a fleet of devices), but nothing
# forces that shape into this module yet and it's not decided anywhere.
# Flat names are a subset of nested names, so adding nesting later is
# additive, not a redesign (CLAUDE.md's "don't paint into a dead end"
# read the other way: the cheap version here doesn't foreclose the
# expensive one). Not decided: on-disk format versioning for custom node
# packages (local-persistence-scoping.md's own "what this note doesn't
# decide" already named this) -- flow files carry their own
# `formatVersion` field already (flow-file.ts) and this module treats
# their content as opaque text, so that versioning story is unaffected by
# anything here.
#
# WiFi credentials get no special handling -- per
# backend-persisted-data-protocol.md, they're just properties inside a
# flow file's `configs` array (thingstudio/config/wifi), not a separate
# secrets store. This module doesn't know the difference between a flow
# with WiFi creds in it and one without; there's no encryption-at-rest
# here, matching the project's existing (unrevisited) plaintext-flow-file
# stance (design doc §6).
#
# This module never parses a flow file's *schema* -- only enough to catch
# obviously-corrupt writes (valid JSON) before they land on disk. Full
# validation (formatVersion, node/edge/config shape) stays
# editor-side (flow-file.ts's parseFlowFile) -- duplicating that logic in
# Python here would be two schemas to keep in sync for a backend whose
# whole design point is staying thin (it doesn't decode CBOR either, for
# the same reason -- ws_relay.py's header comment).
#
# Custom node descriptors get the same opaque-JSON-text treatment; a
# node's .node.py implementation is stored and returned as plain text and
# never executed here or anywhere else in the backend -- matching
# custom-node-authoring-scoping.md Decision 5's "must never execute
# either file's content" constraint, extended to this, the one other
# place besides the editor that now touches these files.
#
# Fault handling (CLAUDE.md priority): every write is temp-file-then-
# `os.replace`, so a crash or disk-full mid-write can never leave a
# truncated/corrupt file in place of a previously-good one -- the OS-level
# rename is atomic on every platform this project targets. Every public
# method raises `PersistedStoreError` (never lets a bare `OSError`/
# `ValueError` escape) with a `NODE_ERROR`-prefixed message naming the
# operation, matching serial_relay.py/ws_relay.py's existing structured-
# error convention -- callers (the HTTP routes) turn that straight into a
# JSON error response, never a 500 with a bare traceback.

from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


class PersistedStoreError(Exception):
    """Raised for any invalid name, missing file, or filesystem failure.
    Always carries a NODE_ERROR-prefixed message naming the operation."""


class PersistedStoreNotFoundError(PersistedStoreError):
    """Specifically: the named flow/custom-node doesn't exist. Split out
    from the base error so HTTP routes can map it to 404 rather than 400/500
    without string-matching the message."""


@dataclass(frozen=True)
class CustomNodePackage:
    descriptor: str
    implementation: str


def _validate_name(name: str, *, kind: str) -> str:
    if not _NAME_RE.match(name):
        raise PersistedStoreError(
            f"NODE_ERROR: invalid {kind} name {name!r} -- must match {_NAME_RE.pattern} "
            "(letters, digits, '_', '-' only, 1-100 characters)"
        )
    return name


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, path)
    except OSError as exc:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise PersistedStoreError(f"NODE_ERROR: failed writing {path.name}: {exc}") from exc


def _validate_json_text(text: str, *, what: str) -> None:
    try:
        json.loads(text)
    except json.JSONDecodeError as exc:
        raise PersistedStoreError(f"NODE_ERROR: {what} is not valid JSON: {exc}") from exc


class PersistedStore:
    """Owns `~/.thingstudio` (or an injected base_dir, for tests -- same
    injectable-dependency pattern serial_relay.py's SerialConnection
    factory already uses in ws_relay.py). Created lazily: no directory is
    created on construction, only on first write, per
    local-persistence-scoping.md Decision 1."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir if base_dir is not None else Path.home() / ".thingstudio"
        self.flows_dir = self.base_dir / "flows"
        self.custom_nodes_dir = self.base_dir / "custom-nodes"

    # -- flows --------------------------------------------------------

    def list_flows(self) -> list[str]:
        if not self.flows_dir.is_dir():
            return []
        return sorted(p.name[: -len(".flow.json")] for p in self.flows_dir.glob("*.flow.json"))

    def read_flow(self, name: str) -> str:
        _validate_name(name, kind="flow")
        path = self.flows_dir / f"{name}.flow.json"
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise PersistedStoreNotFoundError(f"NODE_ERROR: no saved flow named {name!r}") from exc
        except OSError as exc:
            raise PersistedStoreError(f"NODE_ERROR: failed reading flow {name!r}: {exc}") from exc

    def write_flow(self, name: str, text: str) -> None:
        _validate_name(name, kind="flow")
        _validate_json_text(text, what=f"flow {name!r}")
        _atomic_write(self.flows_dir / f"{name}.flow.json", text)

    def delete_flow(self, name: str) -> None:
        _validate_name(name, kind="flow")
        path = self.flows_dir / f"{name}.flow.json"
        try:
            path.unlink()
        except FileNotFoundError as exc:
            raise PersistedStoreNotFoundError(f"NODE_ERROR: no saved flow named {name!r}") from exc
        except OSError as exc:
            raise PersistedStoreError(f"NODE_ERROR: failed deleting flow {name!r}: {exc}") from exc

    # -- custom node packages ------------------------------------------

    def list_custom_nodes(self) -> list[str]:
        if not self.custom_nodes_dir.is_dir():
            return []
        return sorted(p.name[: -len(".node.json")] for p in self.custom_nodes_dir.glob("*.node.json"))

    def read_custom_node(self, name: str) -> CustomNodePackage:
        _validate_name(name, kind="custom node")
        descriptor_path = self.custom_nodes_dir / f"{name}.node.json"
        impl_path = self.custom_nodes_dir / f"{name}.node.py"
        try:
            descriptor = descriptor_path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise PersistedStoreNotFoundError(f"NODE_ERROR: no saved custom node named {name!r}") from exc
        except OSError as exc:
            raise PersistedStoreError(f"NODE_ERROR: failed reading custom node {name!r}: {exc}") from exc
        try:
            implementation = impl_path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            # Descriptor exists but the .py half doesn't -- a genuinely
            # corrupt/partial package (e.g. from a failed write before this
            # module took over, or a hand-edited directory), not "doesn't
            # exist": the caller asked for something that's there but broken.
            raise PersistedStoreError(
                f"NODE_ERROR: custom node {name!r} has a descriptor but no implementation file "
                f"({impl_path.name} missing) -- package is incomplete"
            ) from exc
        except OSError as exc:
            raise PersistedStoreError(f"NODE_ERROR: failed reading custom node {name!r}: {exc}") from exc
        return CustomNodePackage(descriptor=descriptor, implementation=implementation)

    def write_custom_node(self, name: str, descriptor: str, implementation: str) -> None:
        _validate_name(name, kind="custom node")
        _validate_json_text(descriptor, what=f"custom node {name!r} descriptor")
        # implementation is opaque Python source text -- never parsed,
        # never executed here (see header); no validation beyond "is a
        # string", already enforced by the HTTP layer before this is called.
        _atomic_write(self.custom_nodes_dir / f"{name}.node.json", descriptor)
        _atomic_write(self.custom_nodes_dir / f"{name}.node.py", implementation)

    def delete_custom_node(self, name: str) -> None:
        _validate_name(name, kind="custom node")
        descriptor_path = self.custom_nodes_dir / f"{name}.node.json"
        impl_path = self.custom_nodes_dir / f"{name}.node.py"
        found = False
        for path in (descriptor_path, impl_path):
            try:
                path.unlink()
                found = True
            except FileNotFoundError:
                continue
            except OSError as exc:
                raise PersistedStoreError(f"NODE_ERROR: failed deleting custom node {name!r}: {exc}") from exc
        if not found:
            raise PersistedStoreNotFoundError(f"NODE_ERROR: no saved custom node named {name!r}")
