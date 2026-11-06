# SPDX-License-Identifier: Apache-2.0
# backend/test/test_catalogue_sign.py
#
# tools/catalogue_sign.py: keygen writes an encrypted private key outside the repo and the public key into
# catalogue-keys.json; sign raises the serial and signs the exact bytes; verify catches a catalogue changed after
# signing. The backend's catalogue_source.verify accepts what the tool signs -- the two ends agree.

import importlib.util
import json
import stat
from pathlib import Path

import pytest

from thingstudio_backend import catalogue_source as cs

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("catalogue_sign", REPO / "tools" / "catalogue_sign.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)

PASS = "correct horse battery"


@pytest.fixture
def repo(tmp_path, monkeypatch):
    fw = tmp_path / "firmware"
    fw.mkdir()
    (fw / "builds.json").write_text(json.dumps({"schema": 1, "serial": 4, "builds": []}, indent=2) + "\n")
    monkeypatch.setattr(tool, "CATALOGUE", fw / "builds.json")
    monkeypatch.setattr(tool, "SIGNATURE", fw / "builds.json.sig")
    monkeypatch.setattr(tool, "KEYS", fw / "catalogue-keys.json")
    monkeypatch.setattr(tool, "KEY_DIR", tmp_path / "signing")
    return fw


def test_keygen_keeps_the_private_key_out_of_the_repo_and_encrypted(repo):
    path = tool.keygen("main", PASS)
    assert path.parent.name == "signing" and stat.S_IMODE(path.stat().st_mode) == 0o600
    assert b"ENCRYPTED" in path.read_bytes()
    assert list(tool.load_keys()) == ["main"]
    with pytest.raises(tool.SignError):
        tool.keygen("main", PASS)
    with pytest.raises(tool.SignError):
        tool.keygen("spare", "short")


def test_sign_raises_the_serial_and_the_backend_accepts_it(repo):
    tool.keygen("main", PASS)
    assert tool.sign("main", PASS) == 5
    assert tool.verify() == ""
    keys = cs.load_keys(repo / "catalogue-keys.json")
    data = cs.verify((repo / "builds.json").read_bytes(), (repo / "builds.json.sig").read_bytes(), keys)
    assert data["serial"] == 5 and list(data)[:2] == ["schema", "serial"]


def test_verify_catches_a_change_after_signing(repo):
    tool.keygen("main", PASS)
    tool.sign("main", PASS)
    (repo / "builds.json").write_text((repo / "builds.json").read_text().replace('"builds": []', '"builds": [{}]'))
    assert "changed since it was signed" in tool.verify()


def test_the_wrong_passphrase_and_an_unlisted_key_are_refused(repo):
    tool.keygen("main", PASS)
    with pytest.raises(tool.SignError, match="passphrase"):
        tool.sign("main", "not the passphrase")
    with pytest.raises(tool.SignError, match="no key 'spare'"):
        tool.sign("spare", PASS)


def test_verify_without_keys_says_signing_is_not_set_up(repo):
    assert "not set up" in tool.verify()
