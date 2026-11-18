#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Fill firmware/mirror/ with the images the online build's install page serves.

The install page serves every image from its own origin, named by its sha256 (vite.config.ts's firmwareMirror(),
docs/working-notes/online-editor-webserial-briefing.md, section C): a browser can't fetch GitHub release assets, and
the page's CSP allows its own origin only. This downloads the newest version of every build in firmware/builds.json,
checks it against the catalogue's sha256, and keeps it as firmware/mirror/<sha256>.<bin|uf2>. A file already there
with the right hash is left alone; one with the wrong hash is replaced. Nothing that fails the check is kept.

Usage:  python3 tools/fetch_firmware_mirror.py [--check]
        --check   download nothing; list what's missing and exit 1 if anything is.
Needs:  the network (micropython.org and GitHub). Standard library only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CATALOGUE = REPO / "firmware" / "builds.json"
MIRROR = REPO / "firmware" / "mirror"
TIMEOUT_S = 60


def wanted() -> list[tuple[str, str, str, Path]]:
    """(build id, url, sha256, mirror path) for the newest version of every build."""
    out = []
    for build in json.loads(CATALOGUE.read_text())["builds"]:
        if not build["versions"]:
            continue
        newest = build["versions"][0]
        ext = "uf2" if newest["url"].lower().endswith(".uf2") else "bin"
        out.append((build["id"], newest["url"], newest["sha256"], MIRROR / f"{newest['sha256']}.{ext}"))
    return out


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="list missing images and exit 1 if any")
    args = parser.parse_args()
    MIRROR.mkdir(parents=True, exist_ok=True)
    missing, failed = [], []
    for build_id, url, sha, path in wanted():
        if path.exists() and sha256_of(path) == sha:
            continue
        if args.check:
            missing.append(build_id)
            continue
        print(f"{build_id}: {url}")
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT_S) as res:
                data = res.read()
        except OSError as err:
            failed.append(f"{build_id}: download failed ({err})")
            continue
        got = hashlib.sha256(data).hexdigest()
        if got != sha:
            failed.append(f"{build_id}: sha256 {got[:12]}… doesn't match the catalogue's {sha[:12]}… -- not kept")
            continue
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(path)
    if missing:
        print("missing from firmware/mirror/: " + ", ".join(missing), file=sys.stderr)
    for line in failed:
        print(line, file=sys.stderr)
    return 1 if missing or failed else 0


if __name__ == "__main__":
    sys.exit(main())
