#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/firmware_catalogue.py
#
# Adds a built Thingstudio image to the flash catalogue (firmware/builds.json), and checks the entries that are
# already there. The catalogue is what the editor's Install firmware dialog offers, so a version that is in it is
# a version a user can be told to flash: the hash has to be the file that was tested, and the URL has to be the
# asset that release actually serves.
#
# Why a tool rather than four hand-edited fields: the version, the URL's basename and the sha256 all describe the
# same file, and typing them is how they drift. This reads them off the image.
#
# Usage:
#   python3 tools/firmware_catalogue.py --image firmware/classic-esp32/out/thingstudio-classic-esp32-14.1.0-ab12cd3.bin \
#       --url https://github.com/mkarliner/ThingStudio/releases/download/v0.10.0/thingstudio-classic-esp32-14.1.0-ab12cd3.bin
#   python3 tools/firmware_catalogue.py --check
#
# The image must already be recorded in firmware/classic-esp32/tested.json (record-tested.sh), because a build we
# ship under our own name is a build a board ran. That is the same rule editor/test/firmware-assets.test.ts
# enforces, applied where the entry is written rather than after the fact.
#
# Stdlib only, so CI can run it with any Python 3.10+.

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent.parent
CATALOGUE = REPO / "firmware" / "builds.json"
TESTED = REPO / "firmware" / "classic-esp32" / "tested.json"
BUILD_ID = "thingstudio-classic-esp32"
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


class CatalogueError(Exception):
    pass


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def version_from_name(name: str) -> str | None:
    """thingstudio-classic-esp32-14.1.0-ab12cd3.bin -> 14.1.0."""
    match = re.match(r"^thingstudio-classic-esp32-(\d+\.\d+\.\d+)-[0-9a-f]{7,}\.bin$", name)
    return match.group(1) if match else None


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CatalogueError(f"no such file: {path}") from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CatalogueError(f"cannot read {path}: {exc}") from exc


def thingstudio_build(catalogue: dict) -> dict:
    for build in catalogue.get("builds", []):
        if build.get("id") == BUILD_ID:
            return build
    raise CatalogueError(f'firmware/builds.json has no build "{BUILD_ID}" -- is this a catalogue for the editor?')


def add(image: Path, url: str, when: str | None) -> str:
    if not image.is_file():
        raise CatalogueError(f"no such image: {image}")
    digest = sha256_of(image)
    tested = load(TESTED)
    if digest not in tested:
        raise CatalogueError(
            f"{image.name} hashes to {digest[:12]}..., which is not in firmware/classic-esp32/tested.json.\n"
            f"Run it on a board and record it first:\n"
            f'  firmware/classic-esp32/record-tested.sh {image} "<board>" "<what you ran and saw>"'
        )
    version = version_from_name(image.name)
    if version is None or not VERSION_RE.match(version):
        raise CatalogueError(
            f"{image.name} does not carry its version: expected thingstudio-classic-esp32-<major>.<minor>.<patch>-<sha>.bin"
        )
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise CatalogueError(f"the image URL must be https, not {parsed.scheme or 'relative'}")
    if Path(parsed.path).name != image.name:
        raise CatalogueError(f"the URL's file name is {Path(parsed.path).name!r}, not {image.name!r}")

    catalogue = load(CATALOGUE)
    build = thingstudio_build(catalogue)
    entry = {"version": version, "date": when or date.today().isoformat(), "url": url, "sha256": digest}
    versions = [v for v in build.get("versions", []) if v.get("version") != version and v.get("sha256") != digest]
    build["versions"] = [entry, *versions]
    CATALOGUE.write_text(json.dumps(catalogue, indent=2) + "\n", encoding="utf-8")
    return f"catalogue: {BUILD_ID} {version} <- {image.name} ({digest[:12]}...), tested on {tested[digest]['board']}"


def check() -> list[str]:
    """Every problem with the catalogue, as readable lines. Empty when it is consistent."""
    problems: list[str] = []
    try:
        catalogue = load(CATALOGUE)
    except CatalogueError as exc:
        return [str(exc)]
    try:
        tested = load(TESTED)
    except CatalogueError as exc:
        return [str(exc)]
    seen: set[str] = set()
    for build in catalogue.get("builds", []):
        build_id = build.get("id", "?")
        if build_id in seen:
            problems.append(f"{build_id}: listed twice")
        seen.add(build_id)
        versions = build.get("versions") or []
        if not versions:
            problems.append(f"{build_id}: no versions")
        for entry in versions:
            label = f"{build_id} {entry.get('version', '?')}"
            if not VERSION_RE.match(str(entry.get("version", ""))):
                problems.append(f"{label}: version is not major.minor.patch")
            digest = str(entry.get("sha256", ""))
            if not re.fullmatch(r"[0-9a-f]{64}", digest):
                problems.append(f"{label}: sha256 is not 64 hex characters")
                continue
            url = str(entry.get("url", ""))
            if urlparse(url).scheme != "https":
                problems.append(f"{label}: url is not https")
            if build.get("supplier") == "thingstudio" and digest not in tested:
                problems.append(f"{label}: not in tested.json -- an untested image must not be offered")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Add a built Thingstudio image to the flash catalogue, or check it.")
    parser.add_argument("--image", type=Path, help="the built image (firmware/classic-esp32/out/...)")
    parser.add_argument("--url", help="the release asset URL that serves that exact file")
    parser.add_argument("--date", help="the version's date (default: today)")
    parser.add_argument("--check", action="store_true", help="check the catalogue and exit")
    args = parser.parse_args(argv)
    try:
        if args.check:
            problems = check()
            for line in problems:
                print(f"firmware_catalogue: {line}", file=sys.stderr)
            if problems:
                return 1
            print("firmware_catalogue: the catalogue is consistent")
            return 0
        if not args.image or not args.url:
            parser.error("--image and --url are needed (or --check)")
        print(add(args.image, args.url, args.date))
        return 0
    except CatalogueError as exc:
        print(f"firmware_catalogue: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
