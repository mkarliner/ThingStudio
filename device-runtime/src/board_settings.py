# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/board_settings.py
#
# Per-board settings that belong to the board, not to any flow (MVP item 6, WiFi transport --
# docs/working-notes/wifi-transport-scoping.md): the board's network hostname and the password
# that WiFi sessions must prove they know. Set from the editor over USB serial only
# (SET_BOARD_SETTINGS, listener.py) -- physical access is the trust anchor. Survives deploys and
# resets: one small JSON file, _PATH below, never touched by DEPLOY.
#
# The password itself is never stored. What's stored is a random salt and
#     key = sha256^N(salt + password)          (N = _ITERATIONS, a simple iterated hash)
# The backend derives the same key from the password it holds (tcp_relay.py) using the salt the
# board sends in its challenge, so the password never crosses the network either. A full PBKDF2
# would be stronger against an offline guess of a stolen settings file, but anyone holding this
# file already has the board in hand -- the threat this defends against is a LAN eavesdropper, and
# for that a per-session nonce + HMAC is what matters (session_challenge/verify below).
#
# Fault handling: a missing or corrupt settings file means "defaults" (generated hostname, no
# password -> WiFi transport off), logged, never a boot failure -- same contract as
# listener.py's _read_flow_meta().

import json
import hashlib
import binascii

try:
    import os
except ImportError:
    os = None

_PATH = "/_board.json"
try:
    _PATH = os.getenv("THINGSTUDIO_BOARD_SETTINGS_PATH", _PATH)
except AttributeError:
    pass  # real device: no os.getenv -- the default stands

_ITERATIONS = 2000
SCHEME = "hmac-sha256-nonce"
MAX_HOSTNAME_LEN = 32
MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 64

_settings = None  # cached dict, loaded lazily


def _hex(b):
    h = binascii.hexlify(b)
    return h.decode() if isinstance(h, bytes) else h


def _unhex(s):
    return binascii.unhexlify(s)


def _random_bytes(n):
    if os is not None:
        try:
            return os.urandom(n)
        except (AttributeError, NotImplementedError):
            pass
    import random  # last resort -- only reached on a port without os.urandom

    return bytes(random.getrandbits(8) for _ in range(n))


def default_hostname():
    """`ts-` plus the last 3 bytes of the chip's unique ID, e.g. `ts-a1b2c3`. Falls back to random
    bytes (persisted on first save) where there's no machine.unique_id, e.g. the unix port."""
    uid = None
    try:
        import machine

        uid = machine.unique_id()
    except (ImportError, AttributeError):
        pass
    if not uid:
        uid = _random_bytes(3)
    return "ts-" + _hex(uid[-3:])


def valid_hostname(name):
    """RFC 1123 label: 1-32 chars of a-z, 0-9 and '-', not starting or ending with '-'. Lower-case
    only, so the name typed in the editor is the name mDNS answers to."""
    if not isinstance(name, str) or not 1 <= len(name) <= MAX_HOSTNAME_LEN:
        return False
    if name[0] == "-" or name[-1] == "-":
        return False
    for c in name:
        if not ("a" <= c <= "z" or "0" <= c <= "9" or c == "-"):
            return False
    return True


def derive_key(salt, password, iterations=_ITERATIONS):
    k = salt + password.encode("utf-8")
    for _ in range(iterations):
        k = hashlib.sha256(k).digest()
    return k


def hmac_sha256(key, msg):
    """RFC 2104 HMAC. MicroPython has no `hmac` module on most ports; this is the textbook
    definition over hashlib.sha256 (block size 64)."""
    if len(key) > 64:
        key = hashlib.sha256(key).digest()
    key = key + b"\x00" * (64 - len(key))
    ipad = bytes(b ^ 0x36 for b in key)
    opad = bytes(b ^ 0x5C for b in key)
    return hashlib.sha256(opad + hashlib.sha256(ipad + msg).digest()).digest()


def _equal(a, b):
    """Compares without stopping at the first difference."""
    if len(a) != len(b):
        return False
    diff = 0
    for x, y in zip(a, b):
        diff |= x ^ y
    return diff == 0


def load():
    global _settings
    if _settings is not None:
        return _settings
    data = {}
    try:
        with open(_PATH) as f:
            data = json.loads(f.read())
        if not isinstance(data, dict):
            raise ValueError("not a JSON object")
    except OSError:
        data = {}  # never set -- normal on a fresh board
    except ValueError as e:
        print("BOARD_SETTINGS_ERR %s is corrupt (%r) -- using defaults, WiFi transport off" % (_PATH, e))
        data = {}
    if not valid_hostname(data.get("hostname")):
        data["hostname"] = default_hostname()
    if not (isinstance(data.get("salt"), str) and isinstance(data.get("key"), str)):
        data.pop("salt", None)
        data.pop("key", None)
    _settings = data
    return _settings


def _save(data):
    global _settings
    tmp = _PATH + ".tmp"
    with open(tmp, "w") as f:
        f.write(json.dumps(data))
    try:
        os.rename(tmp, _PATH)
    except (AttributeError, OSError):
        # Some ports won't rename over an existing file; fall back to a direct write.
        with open(_PATH, "w") as f:
            f.write(json.dumps(data))
    _settings = data


def hostname():
    return load()["hostname"]


def password_set():
    return "key" in load()


def apply(new_hostname=None, new_password=None, clear_password=False):
    """Validates and saves. Returns None on success or an error string for the editor. Nothing is
    written unless every requested change is valid."""
    data = dict(load())
    if new_hostname is not None:
        if not valid_hostname(new_hostname):
            return "hostname must be 1-%d characters of a-z, 0-9 and '-', not starting or ending with '-'" % (
                MAX_HOSTNAME_LEN,
            )
        data["hostname"] = new_hostname
    if clear_password:
        data.pop("salt", None)
        data.pop("key", None)
    elif new_password is not None:
        if not isinstance(new_password, str) or not MIN_PASSWORD_LEN <= len(new_password) <= MAX_PASSWORD_LEN:
            return "password must be %d-%d characters" % (MIN_PASSWORD_LEN, MAX_PASSWORD_LEN)
        salt = _random_bytes(16)
        data["salt"] = _hex(salt)
        data["key"] = _hex(derive_key(salt, new_password))
    try:
        _save(data)
    except OSError as e:
        return "could not save board settings: %r" % (e,)
    return None


def new_challenge():
    """Returns (nonce_bytes, challenge_line). The line is what the board sends first on a new
    WiFi session: `TSAUTH1 <hostname> <nonce hex> <salt hex> <iterations>`. (None, None) when no
    password is set -- there is nothing to challenge against, and the caller must refuse."""
    s = load()
    if "salt" not in s:
        return None, None
    nonce = _random_bytes(16)
    line = "TSAUTH1 %s %s %s %d" % (s["hostname"], _hex(nonce), s["salt"], _ITERATIONS)
    return nonce, line


def verify(nonce, response_line):
    """True if `response_line` is `TSAUTH1 <hex HMAC-SHA256(key, nonce)>` for the stored key."""
    s = load()
    if "key" not in s:
        return False
    parts = response_line.strip().split(" ")
    if len(parts) != 2 or parts[0] != "TSAUTH1":
        return False
    try:
        got = _unhex(parts[1])
    except (ValueError, TypeError):
        return False
    want = hmac_sha256(_unhex(s["key"]), nonce)
    return _equal(got, want)


def _reset_cache_for_tests():
    global _settings
    _settings = None
