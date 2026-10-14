# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/board_fs.py
#
# The filesystem root every persisted path is built from. ESP32 and RP2 mount their flash at "/",
# but the stm32 port (pyboard) mounts it at "/flash" (or "/sd" when booted from a card) and "/"
# holds only the mount points -- so a hardcoded "/_flow.mpy" fails with ENODEV there. os.getcwd()
# is that root on every port: the runtime installer already relies on it (it copies files by
# relative name, which land at the root, and that works on the pyboard where absolute paths don't).
#
# Taken once, here, so listener.py, deps.py and wifi_provision.py agree on one root instead of each
# guessing. os may be None off-device (a hand-rolled test import); fall back to "/" then, which is
# where the unix port and the ESP32/RP2 ports put things anyway.

try:
    import os
except ImportError:
    os = None

_SLASH = "/"


def _filesystem_root():
    if os is None:
        return _SLASH
    try:
        cwd = os.getcwd()
    except (AttributeError, OSError):
        return _SLASH  # a port without getcwd, or one that fails it -- "/" is the only other guess
    if not cwd:
        return _SLASH
    return cwd if cwd.endswith(_SLASH) else cwd + _SLASH


ROOT = _filesystem_root()


def under_root(name):
    """ROOT + name -- the one way a persisted file path is built. Callers pass a bare file name
    ("_flow.mpy", "lib"), without a leading slash."""
    return ROOT + name
