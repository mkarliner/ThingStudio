# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/catalogue_source.py
#
# Which firmware catalogue the Install firmware dialog shows, and why (decisions/firmware-catalogue.md,
# 2026-11-06). Three candidates, newest serial wins:
#
#   site     https://docs.thingstudio.net/catalogue/builds.json, fetched when the dialog asks
#   saved    the last catalogue accepted from the site, kept in ~/.thingstudio/firmware/catalogue/
#   bundled  the copy that shipped with this install (firmware/builds.json)
#
# The site's catalogue counts only if its detached Ed25519 signature (builds.json.sig: key id + signature over the
# file's exact bytes) verifies against a public key shipped with this install (firmware/catalogue-keys.json), and
# its serial is not older than one already accepted (no rollback). Anything else is refused once, with a reason the
# dialog shows, and the saved or bundled copy is used. A build is bytes written onto the user's board, and the
# per-version sha256 only pins what the catalogue says -- so whoever can change the catalogue picks the image. The
# signature is what makes the site's copy as trustworthy as the bundled one.
#
# With no keys shipped (signing not set up yet), the site is not asked at all: the bundled copy is the catalogue.

from __future__ import annotations

import base64
import json
import logging
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import assets
from .persisted_store import PersistedStore

logger = logging.getLogger(__name__)

SITE_URL = "https://docs.thingstudio.net/catalogue/builds.json"
FETCH_TIMEOUT_S = 4.0
# The dialog asks on every open; the site changes a few times a release. Five minutes keeps a reopened dialog
# instant without hiding a new catalogue for long.
CACHE_S = 300.0
MAX_BYTES = 1_000_000


class CatalogueRefused(Exception):
    """A candidate catalogue that must not be used; the message says why, for the dialog."""


@dataclass(frozen=True)
class Chosen:
    data: dict
    source: str  # "site" | "saved" | "bundled"
    serial: int
    note: str  # why the site's copy was not used, or "" -- shown beside the source in the dialog

    def public(self) -> dict:
        return {"source": self.source, "serial": self.serial, "note": self.note}


# -- keys and signatures -----------------------------------------------------------------------------------


def keys_path() -> Path:
    return assets.asset_dirs().builds.parent / "catalogue-keys.json"


def load_keys(path: Path | None = None) -> dict[str, bytes]:
    """Key id -> raw 32-byte Ed25519 public key. A missing file means signing is not set up: no keys."""
    path = path if path is not None else keys_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.warning("catalogue keys %s unreadable (%s); the site's catalogue will not be used", path, exc)
        return {}
    keys: dict[str, bytes] = {}
    for key_id, b64 in (raw.get("keys") or {}).items() if isinstance(raw, dict) else []:
        try:
            key = base64.b64decode(str(b64), validate=True)
        except ValueError:
            logger.warning("catalogue key %r is not base64; ignored", key_id)
            continue
        if len(key) == 32:
            keys[str(key_id)] = key
        else:
            logger.warning("catalogue key %r is not a 32-byte Ed25519 key; ignored", key_id)
    return keys


def verify(body: bytes, sig: bytes, keys: dict[str, bytes]) -> dict:
    """The parsed catalogue, if `sig` is a valid signature of exactly `body` by one of `keys`; else refused."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    try:
        envelope = json.loads(sig.decode("utf-8"))
        key_id = str(envelope["keyId"])
        signature = base64.b64decode(str(envelope["signature"]), validate=True)
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise CatalogueRefused(f"signature file unreadable ({exc.__class__.__name__})") from exc
    key = keys.get(key_id)
    if key is None:
        raise CatalogueRefused(f"signed by key {key_id!r}, which this install does not know")
    try:
        Ed25519PublicKey.from_public_bytes(key).verify(signature, body)
    except InvalidSignature as exc:
        raise CatalogueRefused(f"signature does not match (key {key_id})") from exc
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CatalogueRefused(f"signed but not JSON ({exc})") from exc
    if not isinstance(data, dict):
        raise CatalogueRefused("signed but not a catalogue object")
    return data


def serial_of(data: dict) -> int:
    serial = data.get("serial")
    return serial if isinstance(serial, int) and not isinstance(serial, bool) and serial >= 0 else 0


# -- fetching ----------------------------------------------------------------------------------------------


def fetch(url: str, timeout: float = FETCH_TIMEOUT_S) -> bytes:
    """The bytes at `url`, bounded in time and size. Raises OSError (incl. URLError) on any failure."""
    request = urllib.request.Request(url, headers={"User-Agent": "Thingstudio catalogue"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 -- fixed https URL
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise OSError(f"{url} is larger than {MAX_BYTES} bytes")
    return body


# -- choosing ----------------------------------------------------------------------------------------------


def _saved_dir(store: PersistedStore) -> Path:
    return store.base_dir / "firmware" / "catalogue"


def _read_saved(store: PersistedStore, keys: dict[str, bytes]) -> tuple[dict, bytes, bytes] | None:
    folder = _saved_dir(store)
    try:
        body = (folder / "builds.json").read_bytes()
        sig = (folder / "builds.json.sig").read_bytes()
    except OSError:
        return None
    try:
        return verify(body, sig, keys), body, sig
    except CatalogueRefused as exc:
        # Checked again because the file sits in the user's home folder; a copy that no longer verifies is dropped.
        logger.warning("saved catalogue in %s no longer verifies (%s); not used", folder, exc)
        return None


def _save(store: PersistedStore, body: bytes, sig: bytes) -> None:
    folder = _saved_dir(store)
    try:
        folder.mkdir(parents=True, exist_ok=True)
        for name, data in (("builds.json", body), ("builds.json.sig", sig)):
            tmp = folder / f".{name}.tmp"
            tmp.write_bytes(data)
            tmp.replace(folder / name)
    except OSError as exc:
        logger.warning("could not save the site's catalogue to %s (%s); it is still used this time", folder, exc)


def choose(
    store: PersistedStore,
    *,
    bundled_path: Path | None = None,
    keys: dict[str, bytes] | None = None,
    fetcher: Callable[[str], bytes] | None = None,
    url: str = SITE_URL,
    validate: Callable[[dict, str], object] | None = None,
) -> Chosen:
    """The catalogue to use now. `validate(data, where)` raises on a catalogue whose contents don't parse (the
    flash module's own parser); a site copy that fails it is refused like a bad signature."""
    bundled_path = bundled_path if bundled_path is not None else assets.asset_dirs().builds
    fetcher = fetcher if fetcher is not None else fetch
    keys = keys if keys is not None else load_keys(bundled_path.parent / "catalogue-keys.json")
    try:
        bundled = json.loads(bundled_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        bundled = None  # load_catalogue reports the bundled copy's own problem when it is the one used
    bundled_serial = serial_of(bundled) if isinstance(bundled, dict) else 0
    best = Chosen(data=bundled if isinstance(bundled, dict) else {}, source="bundled", serial=bundled_serial, note="")
    if not keys:
        return best

    saved = _read_saved(store, keys)
    if saved is not None and serial_of(saved[0]) > best.serial:
        best = Chosen(data=saved[0], source="saved", serial=serial_of(saved[0]), note="")
    # The no-rollback floor: the newest catalogue this install has accepted from the site, or shipped with.
    floor = max(bundled_serial, serial_of(saved[0]) if saved is not None else 0)

    note = ""
    try:
        body = fetcher(url)
        sig = fetcher(url + ".sig")
        data = verify(body, sig, keys)
        serial = serial_of(data)
        if serial < floor:
            raise CatalogueRefused(f"serial {serial} is older than {floor}, already accepted")
        if validate is not None:
            try:
                validate(data, url)
            except Exception as exc:  # the parser's own error type; its message is the reason
                raise CatalogueRefused(f"signed, but not a valid catalogue ({exc})") from exc
        if serial > (serial_of(saved[0]) if saved is not None else -1):
            _save(store, body, sig)
        if serial >= best.serial:
            best = Chosen(data=data, source="site", serial=serial, note="")
    except CatalogueRefused as exc:
        note = f"The catalog from docs.thingstudio.net was refused: {exc}."
        logger.warning("site catalogue refused: %s", exc)
    except (OSError, ValueError) as exc:  # unreachable, timed out, HTTP error, oversized
        note = "docs.thingstudio.net was not reachable."
        logger.info("site catalogue not fetched: %s", exc)
    return Chosen(data=best.data, source=best.source, serial=best.serial, note=note)


# -- a short-lived memo, so a dialog reopened within minutes does not wait on the network again ----------------

_lock = threading.Lock()
_memo: tuple[float, tuple[Path, Path], Chosen] | None = None


def current(
    store: PersistedStore, bundled_path: Path, validate: Callable[[dict, str], object] | None = None
) -> Chosen:
    global _memo
    with _lock:
        now = time.monotonic()
        key = (store.base_dir, bundled_path)
        if _memo is not None and _memo[1] == key and now - _memo[0] < CACHE_S:
            return _memo[2]
        chosen = choose(store, bundled_path=bundled_path, validate=validate)
        _memo = (now, key, chosen)
        return chosen


def forget() -> None:
    """Drop the memo (tests; and after a flash fails because a build vanished)."""
    global _memo
    with _lock:
        _memo = None
