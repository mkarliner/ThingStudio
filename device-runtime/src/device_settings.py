# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/device_settings.py
#
# Persistent application values, device-wide, namespaced by flow name
# (docs/working-notes/device-settings-store-scoping.md). An app running on
# the board (a GUI settings page, a sensor config) can keep a value across
# reboots without inventing its own flash format.
#
# Not the volatile context model (runtime state per node/flow, in RAM) and
# not board_settings.py (fixed board-owned fields: hostname, WiFi password
# hash). This is a general key/value store for values the *flow author*
# chooses, persisted in one small JSON file next to _board.json.
#
# Shape: {"<flowName>": {"<key>": <value>, ...}}. The listener sets the
# current namespace on DEPLOY and on boot-time flow resume -- the same two
# places it already updates HELLO's flowName. A different flow therefore
# cannot read or overwrite another flow's values; the same flow redeployed
# keeps them. Renaming a flow starts a fresh namespace (the old one stays
# on disk, orphaned, until cleared deliberately).
#
# Fault handling, deliberately fail-safe: a missing file means "no values
# yet"; a corrupt/unreadable one is moved aside to _settings.json.corrupt
# and the store starts empty, logged. Bad settings must never be the reason
# a board cannot boot or run. Values are JSON-native only; an unencodable
# value is rejected before anything is written, with the key named.
#
# Storage follows board_settings.py's proven pattern: path built from
# board_fs.under_root() (so /flash and /sd mounts work), temp-file-then-
# rename with a direct-write fallback, cached in RAM after the first load.
#
# Maintenance (namespaces/clear/prune) is separate from the node-facing
# get/set/delete/keys surface: the listener imports this module and shows
# it to the console as `settings`, and the editor's "Clear device
# settings..." action goes through that same EXEC channel. Nothing here is
# cleared automatically on deploy.

import json

try:
    import os
except ImportError:
    os = None

try:
    import board_fs
except ImportError:
    board_fs = None

_PATH = board_fs.under_root("_settings.json") if board_fs is not None else "/_settings.json"
try:
    # Same off-device test override as every other THINGSTUDIO_*_PATH in the
    # runtime: the unix-port build has no device flash, "/" is the real host
    # filesystem root, and a test must never touch it.
    _PATH = os.getenv("THINGSTUDIO_SETTINGS_PATH", _PATH)
except AttributeError:
    pass
_CORRUPT = _PATH + ".corrupt"

_data = None  # the whole file, {namespace: {key: value}}, loaded lazily
_namespace = ""  # the current flow's name; "" is an older/unnamed flow


class SettingsError(Exception):
    """A save that could not be performed (full/read-only flash, an
    unencodable value, a bad key). The message names the key; the generated
    per-node call wrapper tags it with the node id, the same way any other
    node fault is attributed."""


def _reset_cache_for_tests():
    global _data, _namespace
    _data = None
    _namespace = ""


def set_namespace(name):
    """Set the current flow's namespace. Called by the listener on DEPLOY
    and _resume_flow, from the same flowName it reports in HELLO. A falsy
    name means an older/unnamed flow: a real, isolated namespace ("") rather
    than a shared guess at someone else's values."""
    global _namespace
    _namespace = name if isinstance(name, str) and name else ""


def current_namespace():
    return _namespace


def _json_value(value):
    """True for values JSON can represent losslessly. bool before int,
    because bool is an int subclass; NaN/inf rejected (not JSON)."""
    if value is None or isinstance(value, bool):
        return True
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return value == value and value not in (float("inf"), float("-inf"))
    if isinstance(value, str):
        return True
    if isinstance(value, list):
        for item in value:
            if not _json_value(item):
                return False
        return True
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or not _json_value(item):
                return False
        return True
    return False


def _move_aside():
    """Rename the bad file out of the way, keeping one forensic copy.
    Best-effort: a port that can't rename falls back to copy-then-remove,
    and a failure here must never stop the store from starting empty."""
    try:
        os.rename(_PATH, _CORRUPT)
        return
    except (AttributeError, OSError):
        pass
    try:
        with open(_PATH) as src:
            text = src.read()
        with open(_CORRUPT, "w") as dst:
            dst.write(text)
    except (AttributeError, OSError):
        pass
    try:
        os.remove(_PATH)
    except (AttributeError, OSError):
        pass


def _load():
    global _data
    if _data is not None:
        return _data
    data = {}
    try:
        with open(_PATH) as f:
            data = json.loads(f.read())
        if not isinstance(data, dict):
            raise ValueError("not a JSON object")
    except OSError:
        data = {}  # never written, or unreadable: "no values yet"
    except ValueError as e:
        print("SETTINGS_ERR %s is corrupt (%r) -- moved aside, starting empty" % (_PATH, e))
        _move_aside()
        data = {}
    clean = {}
    for name, values in data.items():
        if isinstance(name, str) and isinstance(values, dict):
            clean[name] = values
        else:
            print("SETTINGS_ERR dropping malformed namespace %r" % (name,))
    _data = clean
    return _data


def _save(data):
    global _data
    text = json.dumps(data)
    tmp = _PATH + ".tmp"
    try:
        with open(tmp, "w") as f:
            f.write(text)
        try:
            os.rename(tmp, _PATH)
        except (AttributeError, OSError):
            # Some ports won't rename over an existing file -- board_settings'
            # own fallback. Not atomic; the caller gets what the port offers.
            with open(_PATH, "w") as f:
                f.write(text)
            try:
                os.remove(tmp)
            except (AttributeError, OSError):
                pass
    except OSError:
        try:
            os.remove(tmp)
        except (AttributeError, OSError):
            pass
        raise
    _data = data


def _namespace_values():
    """The current namespace's dict, without mutating the cache on a read."""
    values = _load().get(_namespace)
    return values if isinstance(values, dict) else {}


def get(key, default=None):
    """A missing key is not an error -- it returns `default`. This is the
    same contract as the function node's `_Store` and Node-RED's context."""
    return _namespace_values().get(key, default)


def set(key, value):
    if not isinstance(key, str) or not key:
        raise SettingsError("settings key must be a non-empty string, got %r" % (key,))
    if not _json_value(value):
        raise SettingsError("settings value for %r is not JSON-native: %r" % (key, value))
    values = dict(_namespace_values())
    values[key] = value
    data = dict(_load())
    data[_namespace] = values
    try:
        _save(data)
    except OSError as e:
        raise SettingsError("could not save settings key %r: %r" % (key, e))


def delete(key):
    if key not in _namespace_values():
        return
    values = dict(_namespace_values())
    del values[key]
    data = dict(_load())
    data[_namespace] = values
    try:
        _save(data)
    except OSError as e:
        raise SettingsError("could not delete settings key %r: %r" % (key, e))


def keys():
    return list(_namespace_values().keys())


def namespaces():
    """{name: key_count} for every namespace in the file, so the console can
    show what is stored before clearing or pruning."""
    return {name: len(values) for name, values in _load().items()}


def clear(name=None):
    """Clear one namespace; None means the current flow. A namespace that
    isn't there is a no-op, not an error."""
    target = _namespace if name is None else name
    data = dict(_load())
    if target not in data:
        return
    del data[target]
    try:
        _save(data)
    except OSError as e:
        raise SettingsError("could not clear settings namespace %r: %r" % (target, e))


def clear_all():
    """Remove every namespace and the .corrupt copy: a full reset, from the
    console or the editor's clear action."""
    global _data
    for path in (_PATH, _CORRUPT):
        try:
            os.remove(path)
        except (AttributeError, OSError):
            pass
    _data = {}


def prune(keep):
    """Drop every namespace not in `keep` (an iterable of names). Orphans are
    never pruned automatically -- the device can't tell 'gone for good' from
    'will come back' -- so this is always an explicit act. Returns the names
    removed."""
    # A plain dict, not set(): this MicroPython build's set() rejects a
    # single iterable argument (found by test_prune_...).
    wanted = {}
    for name in keep:
        wanted[name] = True
    data = dict(_load())
    removed = []
    for name in list(data.keys()):
        if name not in wanted:
            del data[name]
            removed.append(name)
    if removed:
        try:
            _save(data)
        except OSError as e:
            raise SettingsError("could not prune settings namespaces: %r" % (e,))
    return removed
