# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_board_settings.py
#
# board_settings.py (WiFi transport, 2026-09-24) under the real MicroPython unix port: hostname
# rules, save/load, the password never stored in clear, HMAC against RFC 4231's test vector, and
# the challenge/verify pair the listener's WiFi sessions use. Settings file goes to a temp path via
# THINGSTUDIO_BOARD_SETTINGS_PATH -- set before importing, same hook style as listener.py's own.

import os
import json
import binascii

import minitest

minitest.add_src_to_path()

_PATH = "/tmp/ts_board_settings_test.json"
try:
    os.putenv("THINGSTUDIO_BOARD_SETTINGS_PATH", _PATH)
except AttributeError:
    os.environ["THINGSTUDIO_BOARD_SETTINGS_PATH"] = _PATH

import board_settings as bs  # noqa: E402


def _fresh():
    try:
        os.remove(_PATH)
    except OSError:
        pass
    bs._reset_cache_for_tests()


def test_hmac_rfc4231_case_1():
    got = bs.hmac_sha256(b"\x0b" * 20, b"Hi There")
    want = binascii.unhexlify("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")
    assert got == want, binascii.hexlify(got)


def test_hmac_rfc4231_case_6_long_key():
    got = bs.hmac_sha256(b"\xaa" * 131, b"Test Using Larger Than Block-Size Key - Hash Key First")
    want = binascii.unhexlify("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54")
    assert got == want, binascii.hexlify(got)


def test_hostname_rules():
    for good in ("ts-a1b2c3", "kitchen", "a", "x" * 32, "board-2"):
        assert bs.valid_hostname(good), good
    for bad in ("", "-a", "a-", "Kitchen", "a_b", "a.b", "x" * 33, None, 5):
        assert not bs.valid_hostname(bad), bad


def test_defaults_on_fresh_board():
    _fresh()
    assert bs.hostname().startswith("ts-") and len(bs.hostname()) == 9
    assert not bs.password_set()


def test_corrupt_file_means_defaults():
    _fresh()
    with open(_PATH, "w") as f:
        f.write("{not json")
    assert bs.hostname().startswith("ts-")
    assert not bs.password_set()


def test_apply_saves_and_password_not_in_clear():
    _fresh()
    assert bs.apply(new_hostname="kitchen", new_password="correct horse") is None
    with open(_PATH) as f:
        text = f.read()
    assert "correct horse" not in text
    data = json.loads(text)
    assert data["hostname"] == "kitchen"
    bs._reset_cache_for_tests()
    assert bs.hostname() == "kitchen"
    assert bs.password_set()


def test_apply_rejects_bad_input_without_writing():
    _fresh()
    assert bs.apply(new_hostname="kitchen") is None
    assert bs.apply(new_hostname="Bad Name") is not None
    assert bs.apply(new_password="short") is not None
    assert bs.apply(new_hostname="ok-name", new_password="short") is not None
    bs._reset_cache_for_tests()
    assert bs.hostname() == "kitchen"
    assert not bs.password_set()


def test_clear_password():
    _fresh()
    bs.apply(new_password="correct horse")
    assert bs.password_set()
    assert bs.apply(clear_password=True) is None
    assert not bs.password_set()


def _client_response(password, challenge_line):
    # What the backend does (tcp_relay.py), written independently from the parsed challenge.
    parts = challenge_line.split(" ")
    assert parts[0] == "TSAUTH1" and len(parts) == 5
    nonce = binascii.unhexlify(parts[2])
    salt = binascii.unhexlify(parts[3])
    key = bs.derive_key(salt, password, int(parts[4]))
    mac = bs.hmac_sha256(key, nonce)
    h = binascii.hexlify(mac)
    return "TSAUTH1 " + (h.decode() if isinstance(h, bytes) else h)


def test_challenge_verify_right_and_wrong_password():
    _fresh()
    bs.apply(new_hostname="kitchen", new_password="correct horse")
    nonce, line = bs.new_challenge()
    assert line.split(" ")[1] == "kitchen"
    assert bs.verify(nonce, _client_response("correct horse", line))
    assert not bs.verify(nonce, _client_response("wrong horse!", line))
    nonce2, line2 = bs.new_challenge()
    assert nonce2 != nonce
    # A response for one nonce doesn't answer another (no replay).
    assert not bs.verify(nonce2, _client_response("correct horse", line))


def test_verify_rejects_garbage_and_no_password():
    _fresh()
    assert bs.new_challenge() == (None, None)  # no password set: nothing to challenge against
    assert not bs.verify(b"\x00" * 16, "TSAUTH1 00")
    bs.apply(new_password="correct horse")
    nonce, _ = bs.new_challenge()
    for junk in ("", "TSAUTH1", "TSAUTH1 zz", "HELLO 00", "TSAUTH1 00 00", "TSAUTH1 " + "00" * 32):
        assert not bs.verify(nonce, junk), junk


minitest.run(
    [
        test_hmac_rfc4231_case_1,
        test_hmac_rfc4231_case_6_long_key,
        test_hostname_rules,
        test_defaults_on_fresh_board,
        test_corrupt_file_means_defaults,
        test_apply_saves_and_password_not_in_clear,
        test_apply_rejects_bad_input_without_writing,
        test_clear_password,
        test_challenge_verify_right_and_wrong_password,
        test_verify_rejects_garbage_and_no_password,
    ]
)
