# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/deps.py
#
# Flow dependencies (docs/working-notes/flow-dependencies-scoping.md, 2026-10-07): the libraries a
# deployed flow imports (mqtt_as, display drivers, sensor drivers...) live in LIB_DIR ("/lib", on
# MicroPython's default sys.path for ESP32 and RP2), installed by DEP_PUT and recorded in an index
# file, instead of every vendored library going onto every board at runtime install.
#
# This module only manages files; listener.py wires it to DEP_PUT, DEPLOY and HELLO. Kept separate
# so it can be tested on the unix port without a listener.
#
# Fault handling, in order of what matters:
# - A write never leaves half a library under its real name: every file goes to "<name>.tmp" first,
#   and only once all of a dependency's files are written are they renamed into place. The index
#   is updated last, so after a crash or a full flash the index still describes the old version
#   (or nothing), and the editor resends.
# - Every failure is a DepError naming the dependency and what went wrong, never a bare OSError.
# - Names come from the editor but are still checked: plain module-style names only, no paths, and
#   never one of the runtime's own module names.

import sys
import json

try:
    import os
except ImportError:
    os = None

LIB_DIR = "/lib"
try:
    LIB_DIR = os.getenv("THINGSTUDIO_LIB_DIR", LIB_DIR)  # off-device tests only, like THINGSTUDIO_FLOW_PATH
except AttributeError:
    pass

INDEX_NAME = "_deps.json"

# The runtime's own modules (runtime_manifest.py's CORE_FILES, plus the listener, this file and the
# flow). A dependency file with one of these names would be confusing at best: the root copy wins
# on sys.path, so it would never load.
_RESERVED = (
    "errors", "cbor", "framing", "messages", "protocol", "runtime", "wifi_provision",
    "board_settings", "net_transport", "listener", "deps", "main", "boot", "_flow",
)

_SPACE_MARGIN = 4096  # filesystem block overhead and the index rewrite; better to refuse early


class DepError(Exception):
    """code: a short machine-readable reason (NoSpace, BadName, WriteFailed); message: for people."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _path(name):
    return LIB_DIR + "/" + name


def _is_identifier(s):
    if not s or not (s[0].isalpha() or s[0] == "_"):
        return False
    for ch in s:
        if not (ch.isalpha() or ch.isdigit() or ch == "_"):
            return False
    return True


def _module_of(file_name):
    """"mqtt_as.mpy" -> "mqtt_as"; None if not a .py/.mpy file name."""
    for ext in (".mpy", ".py"):
        if file_name.endswith(ext):
            return file_name[: -len(ext)]
    return None


def check_name(dep_name):
    if not _is_identifier(dep_name):
        raise DepError("BadName", "dependency name %r must be a plain module-style name" % (dep_name,))


def check_file_name(dep_name, file_name):
    mod = _module_of(file_name)
    if mod is None or not _is_identifier(mod):
        raise DepError("BadName", "%s: file name %r must be a plain name ending .py or .mpy" % (dep_name, file_name))
    if mod in _RESERVED:
        raise DepError("BadName", "%s: file name %r is one of the runtime's own modules" % (dep_name, file_name))


def ensure_on_path():
    """Most ports put /lib on sys.path already; a port that doesn't still finds dependencies."""
    if LIB_DIR not in sys.path:
        sys.path.append(LIB_DIR)


def _ensure_dir():
    try:
        os.mkdir(LIB_DIR)
    except OSError:
        pass  # already there (the ordinary case); a real failure shows up on the first write


def read_index():
    """{name: {"hash": str, "files": [str]}}. A missing or unreadable index means "nothing
    installed": the editor then resends what the flow needs, which repairs it."""
    try:
        with open(_path(INDEX_NAME)) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    out = {}
    for name, entry in data.items():
        if isinstance(entry, dict) and isinstance(entry.get("hash"), str) and isinstance(entry.get("files"), list):
            out[name] = {"hash": entry["hash"], "files": [f for f in entry["files"] if isinstance(f, str)]}
    return out


def inventory():
    """{name: hash}, for HELLO."""
    return {name: entry["hash"] for name, entry in read_index().items()}


def _write_index(index):
    tmp = _path(INDEX_NAME + ".tmp")
    with open(tmp, "w") as f:
        json.dump(index, f)
    _replace(tmp, _path(INDEX_NAME))


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


def _replace(src, dst):
    # Not every MicroPython filesystem lets rename() overwrite an existing file.
    _remove(dst)
    os.rename(src, dst)


def _free_bytes():
    try:
        st = os.statvfs(LIB_DIR)
        return st[0] * st[3]
    except (AttributeError, OSError):
        return None  # unknown (unix port): don't pre-check, rely on the write itself failing


def put(dep_name, dep_hash, files):
    """Installs one dependency: files is [(file_name, bytes)]. Replaces any earlier version.
    Raises DepError; on failure nothing under a real name has changed."""
    check_name(dep_name)
    if not isinstance(dep_hash, str) or not dep_hash:
        raise DepError("BadName", "%s: missing hash" % (dep_name,))
    if not files:
        raise DepError("BadName", "%s: no files" % (dep_name,))
    for file_name, _data in files:
        check_file_name(dep_name, file_name)

    _ensure_dir()
    needed = 0
    for _file_name, data in files:
        needed += len(data)
    free = _free_bytes()
    if free is not None and needed + _SPACE_MARGIN > free:
        raise DepError("NoSpace", "no space for %s: needs %d bytes, %d free" % (dep_name, needed, free))

    written = []
    try:
        for file_name, data in files:
            tmp = _path(file_name + ".tmp")
            written.append(tmp)
            with open(tmp, "wb") as f:
                f.write(data)
    except OSError as e:
        for tmp in written:
            _remove(tmp)
        if e.args and e.args[0] == 28:  # ENOSPC
            raise DepError("NoSpace", "no space for %s: needs %d bytes" % (dep_name, needed))
        raise DepError("WriteFailed", "writing %s failed: %r" % (dep_name, e))

    index = read_index()
    old = index.get(dep_name)
    try:
        for file_name, _data in files:
            mod = _module_of(file_name)
            # MicroPython imports x.py before x.mpy, so a stale copy in the other format would win.
            other = mod + (".py" if file_name.endswith(".mpy") else ".mpy")
            _remove(_path(other))
            _replace(_path(file_name + ".tmp"), _path(file_name))
        new_names = [f for f, _d in files]
        if old is not None:
            for stale in old["files"]:
                if stale not in new_names:
                    _remove(_path(stale))
        index[dep_name] = {"hash": dep_hash, "files": new_names}
        _write_index(index)
    except OSError as e:
        for tmp in written:
            _remove(tmp)
        # Whatever was renamed may now be newer than the index says; drop the entry so the editor
        # resends instead of trusting a half-updated library.
        index.pop(dep_name, None)
        try:
            _write_index(index)
        except OSError:
            pass
        raise DepError("WriteFailed", "installing %s failed: %r" % (dep_name, e))


def missing(required):
    """required: {name: hash}. Returns a list of human-readable problems, empty when all are there."""
    index = read_index()
    problems = []
    for name in sorted(required):
        entry = index.get(name)
        if entry is None:
            problems.append("%s is not on the board" % (name,))
        elif entry["hash"] != required[name]:
            problems.append("%s on the board is a different version" % (name,))
        else:
            for file_name in entry["files"]:
                try:
                    with open(_path(file_name), "rb"):
                        pass
                except OSError:
                    problems.append("%s is incomplete (%s missing)" % (name, file_name))
                    break
    return problems


def forget_modules():
    """Drops every installed dependency's modules from sys.modules, so the next flow import loads
    the versions now on flash, not ones a previous flow already imported."""
    for entry in read_index().values():
        for file_name in entry["files"]:
            mod = _module_of(file_name)
            if mod is not None and mod in sys.modules:
                del sys.modules[mod]


def remove_unused(required):
    """Removes installed dependencies not in `required` ({name: hash}). Best-effort: a failure to
    delete leaves the file and its index entry, and is reported, never raised. Returns the names
    removed."""
    index = read_index()
    keep_files = set()
    for name in required:
        if name in index:
            for f in index[name]["files"]:
                keep_files.add(f)
    removed = []
    for name in list(index):
        if name in required:
            continue
        ok = True
        for file_name in index[name]["files"]:
            if file_name in keep_files:
                continue
            try:
                os.remove(_path(file_name))
            except OSError as e:
                if not (e.args and e.args[0] == 2):  # ENOENT: already gone, fine
                    ok = False
                    print("DEPS_WARN could not remove %s: %r" % (file_name, e))
        if ok:
            del index[name]
            removed.append(name)
    if removed:
        try:
            _write_index(index)
        except OSError as e:
            print("DEPS_WARN could not update the dependency index: %r" % (e,))
    return removed
