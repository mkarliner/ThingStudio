# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_wifi_provision.py
#
# Off-device tests for wifi_provision.py (wifi-provisioning-captive-portal.md, 2026-09-14). Two
# tiers, same split test_runtime.py's own header names for its own uasyncio-scheduling gap: the DNS
# wire-format/form-parsing/credential-persistence functions are tested for real (pure functions, or
# file I/O against a THINGSTUDIO_WIFI_PROVISION_PATH-overridden tmp path, same convention
# test_listener_integration.py's own THINGSTUDIO_FLOW_META_PATH override uses); the boot-time
# orchestration policy (provision_if_needed -- Mike's confirmed trigger semantics, the actual thing
# worth getting right here) is tested by monkeypatching this module's own `network`/`_try_connect`/
# `run_portal` names, the same in-process technique test_runtime.py already uses for runtime.py's own
# module-level state. No real radio/socket hardware to exercise the AP/DNS/HTTP mechanics end-to-end
# in this off-device suite -- same gap every hardware-adjacent test file in this project already
# names, not a new one: closest thing achievable without a board, not a substitute for a real pass.

# THINGSTUDIO_WIFI_PROVISION_PATH must be set in the shell BEFORE this script is invoked, not from
# inside it -- MicroPython's unix-port `os` module has no `os.environ`/`os.putenv` to set an env var
# from within a running script (CPython-only), only `os.getenv()` to read one, same reason
# test_listener_integration.py sets env vars on the subprocess it spawns rather than inside the
# spawned script. Point it at a real tmp path here so this file is runnable standalone too (`micropython
# test_wifi_provision.py` with no env var set), falling back to a fixed name rather than failing.

import os

if os.getenv("THINGSTUDIO_WIFI_PROVISION_PATH") is None:
    try:
        os.environ["THINGSTUDIO_WIFI_PROVISION_PATH"] = "/tmp/thingstudio_test_wifi_provision.json"
    except AttributeError:
        pass  # MicroPython (no os.environ) -- run this file with the env var pre-set in the shell instead

import minitest

minitest.add_src_to_path()

import wifi_provision


def _reset_state():
    try:
        os.remove(wifi_provision._CRED_PATH)
    except OSError:
        pass


# --- DNS catch-all responder --------------------------------------------------------------------


def test_dns_reply_answers_the_same_question_with_the_given_ip():
    # 12-byte header (txn id 0x1234, standard query flags/counts, QDCOUNT=1) + a minimal one-question
    # section (a bare root-label terminator + QTYPE + QCLASS -- the responder never parses the name
    # itself, just echoes it back, so a real hostname isn't needed to exercise this).
    query = b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00" + b"\x00" + b"\x00\x01" + b"\x00\x01"
    reply = wifi_provision._build_dns_reply(query, b"\xc0\xa8\x04\x01")  # 192.168.4.1
    assert reply is not None
    assert reply[0:2] == b"\x12\x34"  # txn id echoed back unchanged
    assert reply[2:4] == b"\x81\x80"  # standard response, recursion available, no error
    assert reply[6:8] == b"\x00\x01"  # ANCOUNT == 1
    assert reply.endswith(b"\xc0\xa8\x04\x01")  # RDATA is the given IP, verbatim


def test_dns_reply_none_on_too_short_query():
    assert wifi_provision._build_dns_reply(b"\x00\x01", b"\xc0\xa8\x04\x01") is None


def test_dns_reply_none_on_missing_question_section():
    header_only = b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00"
    assert wifi_provision._build_dns_reply(header_only, b"\xc0\xa8\x04\x01") is None


# --- form parsing / rendering -------------------------------------------------------------------


def test_parse_form_decodes_percent_and_plus_encoding():
    form = wifi_provision._parse_form("ssid=My+Network&password=p%40ss%20word")
    assert form["ssid"] == "My Network"
    assert form["password"] == "p@ss word"


def test_parse_form_skips_malformed_pairs():
    form = wifi_provision._parse_form("ssid=home&garbage&password=x")
    assert form == {"ssid": "home", "password": "x"}


def test_render_portal_page_escapes_network_names():
    html = wifi_provision._render_portal_page(["<script>evil</script>"])
    assert "<script>evil" not in html
    assert "&lt;script&gt;" in html


def test_render_portal_page_includes_a_manual_entry_field():
    # 2026-09-14: scan can't be trusted to list every nearby network on every board (real-hardware
    # finding, wifi-provisioning-captive-portal.md) -- the form must offer a way in regardless.
    html = wifi_provision._render_portal_page(["mihome"])
    assert "name='ssid_manual'" in html


def test_chosen_ssid_prefers_manual_entry_over_dropdown():
    assert wifi_provision._chosen_ssid({"ssid": "mihome", "ssid_manual": "BT-1234"}) == "BT-1234"


def test_chosen_ssid_falls_back_to_dropdown_when_manual_empty():
    assert wifi_provision._chosen_ssid({"ssid": "mihome", "ssid_manual": ""}) == "mihome"
    assert wifi_provision._chosen_ssid({"ssid": "mihome"}) == "mihome"


def test_chosen_ssid_strips_whitespace_from_manual_entry():
    assert wifi_provision._chosen_ssid({"ssid": "mihome", "ssid_manual": "  BT-1234  "}) == "BT-1234"


# --- credential persistence ---------------------------------------------------------------------


def test_get_sta_credential_none_when_never_provisioned():
    _reset_state()
    assert wifi_provision.get_sta_credential() is None


def test_save_and_get_sta_credential_round_trips():
    _reset_state()
    wifi_provision.save_credential("home-wifi", "s3cret123")
    assert wifi_provision.get_sta_credential() == ("home-wifi", "s3cret123")


def test_get_ap_password_defaults_when_not_overridden():
    _reset_state()
    assert wifi_provision.get_ap_password() == wifi_provision.DEFAULT_AP_PASSWORD


def test_set_ap_password_overrides_the_default():
    _reset_state()
    wifi_provision.set_ap_password("a-different-password")
    assert wifi_provision.get_ap_password() == "a-different-password"


def test_save_credential_preserves_an_existing_ap_password_override():
    _reset_state()
    wifi_provision.set_ap_password("custom-pass")
    wifi_provision.save_credential("home-wifi", "s3cret123")
    assert wifi_provision.get_ap_password() == "custom-pass"
    assert wifi_provision.get_sta_credential() == ("home-wifi", "s3cret123")


def test_credential_file_corrupt_json_degrades_to_none_not_a_crash():
    _reset_state()
    with open(wifi_provision._CRED_PATH, "w") as f:
        f.write("not valid json{{{")
    assert wifi_provision.get_sta_credential() is None
    assert wifi_provision.get_ap_password() == wifi_provision.DEFAULT_AP_PASSWORD


# --- provision_if_needed() orchestration (Mike's confirmed trigger semantics) -------------------


class _FakeSta:
    def __init__(self):
        self.active_called_with = None

    def active(self, v):
        self.active_called_with = v


class _FakeNetwork:
    STA_IF = "STA_IF"

    def __init__(self, sta):
        self._sta = sta

    def WLAN(self, which):
        assert which == self.STA_IF
        return self._sta


def _patch_hardware(sta):
    saved = (wifi_provision.network, wifi_provision.socket, wifi_provision.select)
    wifi_provision.network = _FakeNetwork(sta)
    wifi_provision.socket = object()  # only needs to be non-None to clear provision_if_needed's own guard
    wifi_provision.select = object()
    return saved


def _unpatch_hardware(saved):
    wifi_provision.network, wifi_provision.socket, wifi_provision.select = saved


def test_provision_skipped_off_device_when_flow_does_not_self_provision():
    saved = (wifi_provision.network, wifi_provision.socket, wifi_provision.select)
    wifi_provision.network = wifi_provision.socket = wifi_provision.select = None
    try:
        assert wifi_provision.provision_if_needed(False, False) is True
    finally:
        _unpatch_hardware(saved)


def test_provision_off_device_returns_false_when_flow_does_self_provision():
    # Off-device (no radio at all) can't fulfil a flow that genuinely asked for self-provisioning --
    # this must come back visibly "not ready", not a silent True, so it's never confused with the
    # ordinary "this flow doesn't use the feature" case above.
    saved = (wifi_provision.network, wifi_provision.socket, wifi_provision.select)
    wifi_provision.network = wifi_provision.socket = wifi_provision.select = None
    try:
        assert wifi_provision.provision_if_needed(True, False) is False
    finally:
        _unpatch_hardware(saved)


def test_provision_noop_when_flow_does_not_self_provision():
    _reset_state()
    sta = _FakeSta()
    saved = _patch_hardware(sta)
    try:
        assert wifi_provision.provision_if_needed(False, False) is True
        assert sta.active_called_with is None  # never touched -- this flow doesn't use the feature at all
    finally:
        _unpatch_hardware(saved)


def test_provision_first_run_calls_run_portal():
    _reset_state()
    sta = _FakeSta()
    saved = _patch_hardware(sta)
    orig_run_portal = wifi_provision.run_portal
    calls = []
    wifi_provision.run_portal = lambda s, pw: (calls.append((s, pw)), ("home-wifi", "pw"))[1]
    try:
        assert wifi_provision.provision_if_needed(True, False) is True
        assert len(calls) == 1  # no stored credential -- the portal must be offered
        assert sta.active_called_with is True  # station interface brought up before the portal ran
    finally:
        wifi_provision.run_portal = orig_run_portal
        _unpatch_hardware(saved)


def test_provision_stored_credential_that_still_works_skips_the_portal():
    _reset_state()
    wifi_provision.save_credential("home-wifi", "s3cret123")
    sta = _FakeSta()
    saved = _patch_hardware(sta)
    orig_try_connect = wifi_provision._try_connect
    orig_run_portal = wifi_provision.run_portal
    portal_calls = []
    wifi_provision._try_connect = lambda s, ssid, password, timeout_s=15: True
    wifi_provision.run_portal = lambda s, pw: portal_calls.append(1)
    try:
        assert wifi_provision.provision_if_needed(True, False) is True
        assert portal_calls == []  # stored credential worked -- portal never offered
    finally:
        wifi_provision._try_connect = orig_try_connect
        wifi_provision.run_portal = orig_run_portal
        _unpatch_hardware(saved)


def test_provision_stored_credential_fails_and_reprovision_disabled_gives_up():
    # Mike's explicit trigger decision: first-run only BY DEFAULT -- a stored credential that stops
    # working must NOT reopen the portal unless the flow author explicitly opted in, since reopening
    # an unauthenticated-by-default AP any time WiFi drops is only safe on a trusted network.
    _reset_state()
    wifi_provision.save_credential("home-wifi", "s3cret123")
    sta = _FakeSta()
    saved = _patch_hardware(sta)
    orig_try_connect = wifi_provision._try_connect
    orig_run_portal = wifi_provision.run_portal
    portal_calls = []
    wifi_provision._try_connect = lambda s, ssid, password, timeout_s=15: False
    wifi_provision.run_portal = lambda s, pw: portal_calls.append(1)
    try:
        assert wifi_provision.provision_if_needed(True, False) is False
        assert portal_calls == []  # allow_reprovision is False -- portal must NOT reopen
    finally:
        wifi_provision._try_connect = orig_try_connect
        wifi_provision.run_portal = orig_run_portal
        _unpatch_hardware(saved)


def test_provision_stored_credential_fails_and_reprovision_enabled_reopens_portal():
    _reset_state()
    wifi_provision.save_credential("home-wifi", "s3cret123")
    sta = _FakeSta()
    saved = _patch_hardware(sta)
    orig_try_connect = wifi_provision._try_connect
    orig_run_portal = wifi_provision.run_portal
    portal_calls = []
    wifi_provision._try_connect = lambda s, ssid, password, timeout_s=15: False
    wifi_provision.run_portal = lambda s, pw: (portal_calls.append(1), ("new-wifi", "pw2"))[1]
    try:
        assert wifi_provision.provision_if_needed(True, True) is True
        assert portal_calls == [1]  # allow_reprovision True -- portal DOES reopen after a failed reconnect
    finally:
        wifi_provision._try_connect = orig_try_connect
        wifi_provision.run_portal = orig_run_portal
        _unpatch_hardware(saved)


minitest.run(
    [
        test_dns_reply_answers_the_same_question_with_the_given_ip,
        test_dns_reply_none_on_too_short_query,
        test_dns_reply_none_on_missing_question_section,
        test_parse_form_decodes_percent_and_plus_encoding,
        test_parse_form_skips_malformed_pairs,
        test_render_portal_page_escapes_network_names,
        test_render_portal_page_includes_a_manual_entry_field,
        test_chosen_ssid_prefers_manual_entry_over_dropdown,
        test_chosen_ssid_falls_back_to_dropdown_when_manual_empty,
        test_chosen_ssid_strips_whitespace_from_manual_entry,
        test_get_sta_credential_none_when_never_provisioned,
        test_save_and_get_sta_credential_round_trips,
        test_get_ap_password_defaults_when_not_overridden,
        test_set_ap_password_overrides_the_default,
        test_save_credential_preserves_an_existing_ap_password_override,
        test_credential_file_corrupt_json_degrades_to_none_not_a_crash,
        test_provision_skipped_off_device_when_flow_does_not_self_provision,
        test_provision_off_device_returns_false_when_flow_does_self_provision,
        test_provision_noop_when_flow_does_not_self_provision,
        test_provision_first_run_calls_run_portal,
        test_provision_stored_credential_that_still_works_skips_the_portal,
        test_provision_stored_credential_fails_and_reprovision_disabled_gives_up,
        test_provision_stored_credential_fails_and_reprovision_enabled_reopens_portal,
    ]
)
