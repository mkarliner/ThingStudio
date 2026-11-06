# SPDX-License-Identifier: Apache-2.0
# backend/test/test_catalogue_source.py
#
# catalogue_source.choose(): the docs site's catalogue is used only when its signature verifies against a shipped
# key and its serial is not older than one already accepted; otherwise the saved or bundled copy, with a note
# saying why (decisions/firmware-catalogue.md, 2026-11-06). The refusals are the point of these tests.

import base64
import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

from thingstudio_backend import catalogue_source as cs
from thingstudio_backend import firmware_flash
from thingstudio_backend.persisted_store import PersistedStore

URL = "https://docs.example/catalogue/builds.json"


def raw_public(key):
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def catalogue(serial, build_id="stock"):
    return {
        "schema": 1,
        "serial": serial,
        "builds": [{
            "id": build_id, "family": "esp32", "supplier": "micropython", "label": "x", "runtime": "install",
            "versions": [{"version": "1.0", "url": "https://example.invalid/a.bin", "sha256": "a" * 64}],
        }],
    }


def signed(data, key, key_id="main"):
    body = (json.dumps(data, indent=2) + "\n").encode()
    sig = json.dumps({"keyId": key_id, "signature": base64.b64encode(key.sign(body)).decode()}).encode()
    return body, sig


@pytest.fixture
def env(tmp_path):
    key = Ed25519PrivateKey.generate()
    bundled = tmp_path / "install" / "builds.json"
    bundled.parent.mkdir()
    bundled.write_text(json.dumps(catalogue(3, "bundled")))
    store = PersistedStore(base_dir=tmp_path / "home")
    return {"key": key, "keys": {"main": raw_public(key)}, "bundled": bundled, "store": store}


def site(files):
    def fetcher(url):
        if url not in files:
            raise OSError(f"404 {url}")
        return files[url]
    return fetcher


def choose(env, files, **kw):
    return cs.choose(env["store"], bundled_path=env["bundled"], keys=kw.pop("keys", env["keys"]),
                     fetcher=site(files), url=URL, validate=lambda d, w: firmware_flash._builds_from(d, w), **kw)


def ids(chosen):
    return [b["id"] for b in chosen.data["builds"]]


def test_a_newer_signed_site_catalogue_is_used_and_saved(env):
    body, sig = signed(catalogue(5, "site"), env["key"])
    chosen = choose(env, {URL: body, URL + ".sig": sig})
    assert (chosen.source, chosen.serial, chosen.note, ids(chosen)) == ("site", 5, "", ["site"])
    saved = env["store"].base_dir / "firmware" / "catalogue"
    assert (saved / "builds.json").read_bytes() == body and (saved / "builds.json.sig").read_bytes() == sig


def test_offline_uses_the_saved_copy_then_the_bundled_one(env):
    body, sig = signed(catalogue(5, "site"), env["key"])
    choose(env, {URL: body, URL + ".sig": sig})
    chosen = choose(env, {})
    assert (chosen.source, ids(chosen)) == ("saved", ["site"]) and "not reachable" in chosen.note
    fresh = cs.choose(PersistedStore(base_dir=env["store"].base_dir.parent / "other"), bundled_path=env["bundled"],
                      keys=env["keys"], fetcher=site({}), url=URL)
    assert (fresh.source, ids(fresh)) == ("bundled", ["bundled"])


def test_a_tampered_catalogue_is_refused(env):
    body, sig = signed(catalogue(5, "site"), env["key"])
    chosen = choose(env, {URL: body.replace(b"example.invalid", b"evil.example"), URL + ".sig": sig})
    assert chosen.source == "bundled" and "signature does not match" in chosen.note


def test_a_catalogue_signed_by_an_unknown_key_is_refused(env):
    other = Ed25519PrivateKey.generate()
    body, sig = signed(catalogue(5, "site"), other, key_id="intruder")
    chosen = choose(env, {URL: body, URL + ".sig": sig})
    assert chosen.source == "bundled" and "'intruder'" in chosen.note
    body, sig = signed(catalogue(5, "site"), other, key_id="main")  # right id, wrong key
    assert "signature does not match" in choose(env, {URL: body, URL + ".sig": sig}).note


def test_an_older_serial_is_refused_after_a_newer_one_was_accepted(env):
    new_body, new_sig = signed(catalogue(7, "new"), env["key"])
    choose(env, {URL: new_body, URL + ".sig": new_sig})
    old_body, old_sig = signed(catalogue(5, "old"), env["key"])
    chosen = choose(env, {URL: old_body, URL + ".sig": old_sig})
    assert (chosen.source, ids(chosen)) == ("saved", ["new"]) and "older than 7" in chosen.note


def test_a_site_catalogue_older_than_the_bundled_one_is_refused(env):
    body, sig = signed(catalogue(2, "site"), env["key"])
    chosen = choose(env, {URL: body, URL + ".sig": sig})
    assert chosen.source == "bundled" and "older than 3" in chosen.note


def test_a_signed_but_broken_catalogue_is_refused(env):
    broken = catalogue(9, "site")
    broken["builds"][0]["versions"][0]["sha256"] = "nope"
    body, sig = signed(broken, env["key"])
    chosen = choose(env, {URL: body, URL + ".sig": sig})
    assert chosen.source == "bundled" and "not a valid catalogue" in chosen.note
    assert not (env["store"].base_dir / "firmware" / "catalogue" / "builds.json").exists()


def test_a_saved_copy_altered_on_disk_is_dropped(env):
    body, sig = signed(catalogue(5, "site"), env["key"])
    choose(env, {URL: body, URL + ".sig": sig})
    saved = env["store"].base_dir / "firmware" / "catalogue" / "builds.json"
    saved.write_bytes(body.replace(b"example.invalid", b"evil.example"))
    assert choose(env, {}).source == "bundled"


def test_without_shipped_keys_the_site_is_not_asked(env):
    asked = []
    chosen = cs.choose(env["store"], bundled_path=env["bundled"], keys={}, fetcher=lambda u: asked.append(u) or b"",
                       url=URL)
    assert chosen.source == "bundled" and asked == [] and chosen.note == ""


def test_load_keys_ignores_malformed_entries(tmp_path):
    good = base64.b64encode(raw_public(Ed25519PrivateKey.generate())).decode()
    path = tmp_path / "catalogue-keys.json"
    path.write_text(json.dumps({"keys": {"main": good, "short": base64.b64encode(b"x").decode(), "bad": "@@"}}))
    assert list(cs.load_keys(path)) == ["main"]
    assert cs.load_keys(tmp_path / "missing.json") == {}


def test_the_dialog_is_told_where_its_catalogue_came_from(env, monkeypatch, tmp_path):
    (env["bundled"].parent / "catalogue-keys.json").write_text(
        json.dumps({"keys": {"main": base64.b64encode(env["keys"]["main"]).decode()}}))
    body, sig = signed(catalogue(5, "stock-from-site"), env["key"])
    monkeypatch.setattr(firmware_flash, "catalogue_sources", lambda: [env["bundled"]])
    monkeypatch.setattr(cs, "fetch", site({cs.SITE_URL: body, cs.SITE_URL + ".sig": sig}))
    monkeypatch.setattr(firmware_flash, "families", lambda store: {"esp32": firmware_flash.Family(
        id="esp32", label="ESP32", tool="esptool", chip="esp32", address=4096)})
    cs.forget()
    result = firmware_flash.catalogue(env["store"])
    cs.forget()
    assert result["catalogue"] == {"source": "site", "serial": 5, "note": ""}
    assert [b["id"] for b in result["builds"]] == ["stock-from-site"]
