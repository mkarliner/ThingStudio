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
# WiFi/MQTT-broker credentials: superseded 2026-09-13
# (docs/working-notes/outstanding-items/credential-storage-design.md) --
# they now DO get special handling, in their own store below, keyed by
# name rather than by flow/config-node id. A flow's `thingstudio/config/
# wifi` and `thingstudio/config/mqtt-broker` configs hold only a
# `credentialName` reference now; the real secret values live here:
#
#   ~/.thingstudio/
#     credentials/wifi/<name>.json          -- { "ssid": ..., "password": ... }
#     credentials/mqtt-broker/<name>.json   -- { "broker": ..., "port": ...,
#                                                 "username": ..., "password": ... }
#
# Same opaque-JSON-blob treatment as flows (below): this module never
# knows or validates which keys a credential bundle actually holds, same
# "backend stays thin" reasoning as the rest of this file. There's still
# no encryption-at-rest -- reading a credential back returns the real
# secret in plaintext, same risk profile every other file in
# `~/.thingstudio` already has (posture-1 auth is a Host-allowlist only;
# see credential-storage-design.md's own "named security trade-off" for
# why this isn't a new regression).
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

# Fixed set, not free-form -- matches config-types.ts's own CONFIG_TYPES
# keys (minus the "thingstudio/config/" prefix, which is editor-internal
# and not part of this module's own naming). Kept as a tuple rather than
# derived from anything editor-side; this module doesn't import editor
# code and isn't going to start now for two literal strings.
_CREDENTIAL_TYPES = ("wifi", "mqtt-broker")


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


def _validate_credential_type(credential_type: str) -> str:
    if credential_type not in _CREDENTIAL_TYPES:
        raise PersistedStoreError(
            f"NODE_ERROR: invalid credential type {credential_type!r} -- must be one of {_CREDENTIAL_TYPES}"
        )
    return credential_type


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
        self.credentials_dir = self.base_dir / "credentials"

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

    # -- WiFi/MQTT-broker credentials -----------------------------------
    # Opaque JSON blob per name, same treatment as flows above -- this
    # module never parses or validates a credential bundle's own keys
    # (ssid/password, or broker/port/username/password); that's
    # admin_api.py's/the editor's business, same "backend doesn't know
    # flow schema" split flows already use.

    def list_credentials(self, credential_type: str) -> list[str]:
        _validate_credential_type(credential_type)
        d = self.credentials_dir / credential_type
        if not d.is_dir():
            return []
        return sorted(p.stem for p in d.glob("*.json"))

    def read_credential(self, credential_type: str, name: str) -> str:
        _validate_credential_type(credential_type)
        _validate_name(name, kind="credential")
        path = self.credentials_dir / credential_type / f"{name}.json"
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise PersistedStoreNotFoundError(
                f"NODE_ERROR: no saved {credential_type} credential named {name!r}"
            ) from exc
        except OSError as exc:
            raise PersistedStoreError(f"NODE_ERROR: failed reading {credential_type} credential {name!r}: {exc}") from exc

    def write_credential(self, credential_type: str, name: str, text: str) -> None:
        _validate_credential_type(credential_type)
        _validate_name(name, kind="credential")
        _validate_json_text(text, what=f"{credential_type} credential {name!r}")
        _atomic_write(self.credentials_dir / credential_type / f"{name}.json", text)

    def delete_credential(self, credential_type: str, name: str) -> None:
        _validate_credential_type(credential_type)
        _validate_name(name, kind="credential")
        path = self.credentials_dir / credential_type / f"{name}.json"
        try:
            path.unlink()
        except FileNotFoundError as exc:
            raise PersistedStoreNotFoundError(
                f"NODE_ERROR: no saved {credential_type} credential named {name!r}"
            ) from exc
        except OSError as exc:
            raise PersistedStoreError(f"NODE_ERROR: failed deleting {credential_type} credential {name!r}: {exc}") from exc
