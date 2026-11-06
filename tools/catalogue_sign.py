#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/catalogue_sign.py
#
# Signs the firmware catalogue that installs fetch from docs.thingstudio.net (decisions/firmware-catalogue.md,
# 2026-11-06). The signature is detached: firmware/builds.json.sig holds a key id and the Ed25519 signature of
# builds.json's exact bytes. Installs ship the public keys (firmware/catalogue-keys.json) and refuse a fetched
# catalogue that does not verify, or whose serial is older than one they already accepted.
#
#   keygen <key-id>    make a key pair: the private key, passphrase-encrypted, under ~/.thingstudio-signing/, and
#                      the public key added to firmware/catalogue-keys.json. Run twice at setup: "main" to sign
#                      with, and "spare", kept offline and never used unless the main key is lost or leaked.
#   sign [--key-id ID] raise builds.json's serial by one, then sign it. After every catalogue change.
#   verify [--warn]    does builds.json.sig sign builds.json, by a listed key? CI warns; the Docs workflow only
#                      publishes a catalogue that verifies.
#
# The private key never enters the repository or CI: signing happens on the maintainer's machine, after the images
# are tested, like the image builds themselves. Needs `cryptography` (pip install cryptography; the backend's own
# environment already has it).

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CATALOGUE = REPO / "firmware" / "builds.json"
SIGNATURE = REPO / "firmware" / "builds.json.sig"
KEYS = REPO / "firmware" / "catalogue-keys.json"
KEY_DIR = Path(os.environ.get("THINGSTUDIO_SIGNING_DIR", Path.home() / ".thingstudio-signing"))


class SignError(Exception):
    pass


def _crypto():
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
    except ImportError as exc:
        raise SignError("needs the cryptography package: pip install cryptography (or use the backend's venv)") from exc
    return InvalidSignature, serialization, Ed25519PrivateKey, Ed25519PublicKey


def load_keys(path: Path | None = None) -> dict[str, str]:
    path = path if path is not None else KEYS
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return dict((data.get("keys") or {}).items())


def write_keys(keys: dict[str, str], path: Path | None = None) -> None:
    path = path if path is not None else KEYS
    data = {
        "$comment": "Public keys that sign firmware/builds.json (tools/catalogue_sign.py). Installs ship this file "
                    "and use the docs site's catalogue only when one of these keys signed it.",
        "keys": dict(sorted(keys.items())),
    }
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def keygen(key_id: str, passphrase: str | None = None) -> Path:
    _, serialization, Ed25519PrivateKey, _ = _crypto()
    if not key_id.replace("-", "").isalnum():
        raise SignError(f"key id {key_id!r}: letters, digits and '-' only")
    keys = load_keys()
    if key_id in keys:
        raise SignError(f"firmware/catalogue-keys.json already has a key {key_id!r}")
    private_path = KEY_DIR / f"catalogue-{key_id}.pem"
    if private_path.exists():
        raise SignError(f"{private_path} exists; not overwriting a private key")
    if passphrase is None:
        passphrase = getpass.getpass(f"passphrase for {private_path.name}: ")
        if passphrase != getpass.getpass("again: "):
            raise SignError("the passphrases differ")
    if len(passphrase) < 12:
        raise SignError("use a passphrase of 12 characters or more")
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(passphrase.encode()),
    )
    KEY_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(private_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(pem)
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    keys[key_id] = base64.b64encode(public).decode()
    write_keys(keys)
    return private_path


def sign(key_id: str, passphrase: str | None = None) -> int:
    _, serialization, _, _ = _crypto()
    if key_id not in load_keys():
        raise SignError(f"firmware/catalogue-keys.json has no key {key_id!r}: installs could not check it")
    private_path = KEY_DIR / f"catalogue-{key_id}.pem"
    if not private_path.is_file():
        raise SignError(f"no private key at {private_path}")
    if passphrase is None:
        passphrase = getpass.getpass(f"passphrase for {private_path.name}: ")
    try:
        key = serialization.load_pem_private_key(private_path.read_bytes(), passphrase.encode())
    except (ValueError, TypeError) as exc:
        raise SignError(f"cannot open {private_path.name}: wrong passphrase?") from exc
    catalogue = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    serial = catalogue.get("serial", 0)
    if not isinstance(serial, int) or isinstance(serial, bool) or serial < 0:
        raise SignError(f"builds.json serial {serial!r} is not a whole number")
    catalogue = {"schema": catalogue.get("schema", 1), "serial": serial + 1,
                 **{k: v for k, v in catalogue.items() if k not in ("schema", "serial")}}
    body = (json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    CATALOGUE.write_bytes(body)
    signature = key.sign(body)
    envelope = {"keyId": key_id, "signature": base64.b64encode(signature).decode()}
    SIGNATURE.write_text(json.dumps(envelope, indent=2) + "\n", encoding="utf-8")
    return serial + 1


def verify() -> str:
    """'' when builds.json.sig signs builds.json by a listed key; else the reason."""
    InvalidSignature, _, _, Ed25519PublicKey = _crypto()
    keys = load_keys()
    if not keys:
        return "no keys in firmware/catalogue-keys.json (signing not set up yet)"
    if not SIGNATURE.is_file():
        return "no firmware/builds.json.sig"
    try:
        envelope = json.loads(SIGNATURE.read_text(encoding="utf-8"))
        key = base64.b64decode(keys[envelope["keyId"]], validate=True)
        signature = base64.b64decode(envelope["signature"], validate=True)
    except KeyError as exc:
        return f"builds.json.sig names a key not in catalogue-keys.json ({exc})"
    except (ValueError, json.JSONDecodeError) as exc:
        return f"builds.json.sig unreadable ({exc})"
    try:
        Ed25519PublicKey.from_public_bytes(key).verify(signature, CATALOGUE.read_bytes())
    except InvalidSignature:
        return "builds.json changed since it was signed -- run tools/catalogue_sign.py sign"
    return ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sign the firmware catalogue installs fetch from the docs site.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    kg = sub.add_parser("keygen", help="make a signing key pair")
    kg.add_argument("key_id")
    sg = sub.add_parser("sign", help="raise the serial and sign builds.json")
    sg.add_argument("--key-id", default="main")
    vf = sub.add_parser("verify", help="check builds.json.sig")
    vf.add_argument("--warn", action="store_true", help="report, but exit 0")
    args = parser.parse_args(argv)
    try:
        if args.cmd == "keygen":
            path = keygen(args.key_id)
            print(f"catalogue_sign: private key {path} (back it up with its passphrase); public key added to "
                  f"firmware/catalogue-keys.json -- commit that file")
        elif args.cmd == "sign":
            serial = sign(args.key_id)
            print(f"catalogue_sign: builds.json at serial {serial}, signed with {args.key_id!r}. Commit "
                  f"firmware/builds.json and firmware/builds.json.sig; the Docs workflow publishes them.")
        else:
            problem = verify()
            if problem:
                if args.warn:
                    tag = "::warning::" if "GITHUB_ACTIONS" in os.environ else "warning: "
                    print(f"{tag}catalogue_sign: {problem}")
                    return 0
                print(f"catalogue_sign: {problem}", file=sys.stderr)
                return 1
            print("catalogue_sign: builds.json.sig signs builds.json")
        return 0
    except SignError as exc:
        print(f"catalogue_sign: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
