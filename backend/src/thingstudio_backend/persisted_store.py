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
#     presets/<type>/<name>.json      -- named per-node-kind property
#                                         bundles (added 2026-09-22, see the
#                                         "Presets" section further down)
#     processors/<id>.json            -- hand-written processor and board
#     boards/<id>.json                   definitions (added 2026-09-23, MVP
#                                         item 4, see "Definitions" below).
#                                         Read-only here: people write them
#                                         with a text editor.
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
# Presets: added 2026-09-22 (docs/working-notes/outstanding-items/
# presets-design.md, confirmed with Mike 2026-09-22) -- MVP item 4 ("sensible
# defaults per chip family") and road-to-mvp.md's own "things like board and
# processor definitions should be human editable files in the thingstudio
# config folder... spi setup should be saveable with a name" ask. Named,
# per-node-kind bundles of property values:
#
#   ~/.thingstudio/
#     presets/<type>/<name>.json    -- <type> is a node kind string (e.g.
#                                        "display_spi"), an OPEN namespace
#                                        unlike credentials' fixed
#                                        wifi/mqtt-broker tuple: presets
#                                        cover whichever node kinds are
#                                        complex enough to deserve one, no
#                                        backend code change needed to add
#                                        a new type later.
#
# Same opaque-JSON-blob treatment as flows/credentials -- this module never
# knows or validates which keys a given preset type's bundle holds (that's
# editor-side, same "backend stays thin" split as everywhere else in this
# file).
#
# One deliberate departure from the credentials pattern above:
# credentials are validated for JSON syntax only at write time
# (write_credential), because nothing expects a human to hand-edit a
# credential file directly. Presets are explicitly meant to be hand-edited
# outside the app (Mike's own "human editable files" framing) -- so a
# broken hand-edit has to be caught and flagged loudly at *list* time too,
# not just fail later when someone tries to load it. list_presets()
# therefore eagerly parses every file on disk and returns a `valid`/`error`
# flag per entry (see `PresetInfo` below); read_preset() re-validates for
# the same reason (a file can be edited-broken between a list and a read
# call). v1 scope is per-node presets only, no board/processor auto-seeding
# (board-processor-reference-data.md remains its own, separately-scoped,
# not-yet-built item -- this module only supplies the storage mechanism a
# future board-preset type could sit on top of).
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
# "board" (2026-09-24, WiFi transport): credentials/board/<hostname>.json -- { "password": ... }, the
# password tcp_relay.py answers a board's challenge with. Named by the board's hostname.
_CREDENTIAL_TYPES = ("wifi", "mqtt-broker", "board")


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


@dataclass(frozen=True)
class CustomNodeListing:
    """One package in list_custom_node_packages()'s result. `path` is the
    descriptor file, shown to the user in messages. `shadowed_by` is set when
    an earlier folder in the search list has a package with the same name,
    which then wins; None otherwise."""

    name: str
    path: Path
    shadowed_by: Path | None = None


def display_path(path: Path) -> str:
    """`path` with the home folder shown as `~`, for messages people read."""
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return str(path)


@dataclass(frozen=True)
class PresetInfo:
    """One entry in list_presets()'s result. `error` is None exactly when
    `valid` is True -- split into two fields rather than `error: str | None`
    doing double duty, so a caller checking `.valid` doesn't also need to
    remember that null-vs-non-null is the same signal."""

    name: str
    valid: bool
    error: str | None = None


@dataclass(frozen=True)
class DefinitionFile:
    """One file in list_definitions()'s result. `data` is the parsed JSON when
    `valid`, else None and `error` says why. Only JSON syntax (and the file
    name) is checked here; the editor's definitions.ts validates the fields,
    so the rules live in one place."""

    name: str
    valid: bool
    error: str | None = None
    data: object = None


_DEFINITION_KINDS = ("processors", "boards")


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
        # Folders searched for custom node packages, in order; for the same
        # package name, the first folder wins. Only the user's folder today.
        # A folder of built-in node packages shipped with the install would
        # go first (Mike, 2026-09-30: built-ins may move to the package
        # format, but beside the install, not in ~/.thingstudio). Writes and
        # deletes only ever touch custom_nodes_dir.
        self.custom_node_dirs: list[Path] = [self.custom_nodes_dir]
        self.credentials_dir = self.base_dir / "credentials"
        self.presets_dir = self.base_dir / "presets"
        self.processors_dir = self.base_dir / "processors"
        self.boards_dir = self.base_dir / "boards"

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

    def list_custom_node_packages(self) -> list[CustomNodeListing]:
        """Every package in every search folder, in search order, sorted by
        name within a folder. A name already found in an earlier folder is
        still listed, marked `shadowed_by`, so the editor can say so."""
        listings: list[CustomNodeListing] = []
        first_seen: dict[str, Path] = {}
        for folder in self.custom_node_dirs:
            if not folder.is_dir():
                continue
            for path in sorted(folder.glob("*.node.json")):
                name = path.name[: -len(".node.json")]
                listings.append(CustomNodeListing(name=name, path=path, shadowed_by=first_seen.get(name)))
                first_seen.setdefault(name, path)
        return listings

    def list_custom_nodes(self) -> list[str]:
        """Package names, each once, in the order the editor should load them."""
        return [p.name for p in self.list_custom_node_packages() if p.shadowed_by is None]

    def _find_custom_node(self, name: str) -> Path:
        """The folder holding package `name`: the first search folder that has
        its descriptor, else the user's folder (so "not found" names it)."""
        for folder in self.custom_node_dirs:
            if (folder / f"{name}.node.json").is_file():
                return folder
        return self.custom_nodes_dir

    def read_custom_node(self, name: str) -> CustomNodePackage:
        _validate_name(name, kind="custom node")
        folder = self._find_custom_node(name)
        descriptor_path = folder / f"{name}.node.json"
        impl_path = folder / f"{name}.node.py"
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

    # -- per-node presets --------------------------------------------------
    # docs/working-notes/outstanding-items/presets-design.md. Preset `type`
    # is an open namespace (any string passing _validate_name, same charset
    # as a name) rather than credentials' fixed _CREDENTIAL_TYPES tuple --
    # see this file's header for why. Eager JSON validity checking at list
    # (and read) time is the one real behavioral departure from the
    # credentials methods just above; everything else mirrors them.

    def list_presets(self, preset_type: str) -> list[PresetInfo]:
        _validate_name(preset_type, kind="preset type")
        d = self.presets_dir / preset_type
        if not d.is_dir():
            return []
        infos: list[PresetInfo] = []
        for path in sorted(d.glob("*.json"), key=lambda p: p.stem):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError as exc:
                infos.append(PresetInfo(name=path.stem, valid=False, error=f"failed reading file: {exc}"))
                continue
            try:
                json.loads(text)
            except json.JSONDecodeError as exc:
                infos.append(PresetInfo(name=path.stem, valid=False, error=f"not valid JSON: {exc}"))
                continue
            infos.append(PresetInfo(name=path.stem, valid=True))
        return infos

    def read_preset(self, preset_type: str, name: str) -> str:
        _validate_name(preset_type, kind="preset type")
        _validate_name(name, kind="preset")
        path = self.presets_dir / preset_type / f"{name}.json"
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise PersistedStoreNotFoundError(f"NODE_ERROR: no saved {preset_type} preset named {name!r}") from exc
        except OSError as exc:
            raise PersistedStoreError(f"NODE_ERROR: failed reading {preset_type} preset {name!r}: {exc}") from exc
        # Re-validated here, not just at write time (unlike credentials) --
        # presets are meant to be hand-edited outside the app, and a file
        # broken since the last list_presets() call must fail loudly and
        # specifically here rather than handing back unparseable text.
        _validate_json_text(text, what=f"{preset_type} preset {name!r} (hand-edited file may have a syntax error)")
        return text

    def write_preset(self, preset_type: str, name: str, text: str) -> None:
        _validate_name(preset_type, kind="preset type")
        _validate_name(name, kind="preset")
        _validate_json_text(text, what=f"{preset_type} preset {name!r}")
        _atomic_write(self.presets_dir / preset_type / f"{name}.json", text)

    def delete_preset(self, preset_type: str, name: str) -> None:
        _validate_name(preset_type, kind="preset type")
        _validate_name(name, kind="preset")
        path = self.presets_dir / preset_type / f"{name}.json"
        try:
            path.unlink()
        except FileNotFoundError as exc:
            raise PersistedStoreNotFoundError(f"NODE_ERROR: no saved {preset_type} preset named {name!r}") from exc
        except OSError as exc:
            raise PersistedStoreError(f"NODE_ERROR: failed deleting {preset_type} preset {name!r}: {exc}") from exc

    # -- processor and board definitions -----------------------------------
    # docs/working-notes/decisions/chip-board-definitions.md. Read-only: the
    # files are written by hand. Every *.json file is listed, including ones
    # with a bad name or bad JSON -- flagged invalid with the reason, never
    # skipped, so a mistake in a hand-edited file shows up in the editor
    # instead of silently doing nothing (same rule as list_presets above).

    def list_definitions(self, kind: str) -> list[DefinitionFile]:
        if kind not in _DEFINITION_KINDS:
            raise PersistedStoreError(f"NODE_ERROR: invalid definition kind {kind!r} -- must be one of {_DEFINITION_KINDS}")
        d = self.base_dir / kind
        if not d.is_dir():
            return []
        out: list[DefinitionFile] = []
        for path in sorted(d.glob("*.json"), key=lambda p: p.stem):
            if not _NAME_RE.match(path.stem):
                out.append(
                    DefinitionFile(
                        name=path.stem,
                        valid=False,
                        error=f"file name {path.name!r} must be letters, digits, '_' or '-' only, ending in .json",
                    )
                )
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                out.append(DefinitionFile(name=path.stem, valid=False, error=f"failed reading file: {exc}"))
                continue
            try:
                data = json.loads(text)
            except json.JSONDecodeError as exc:
                out.append(DefinitionFile(name=path.stem, valid=False, error=f"not valid JSON: {exc}"))
                continue
            out.append(DefinitionFile(name=path.stem, valid=True, data=data))
        return out
