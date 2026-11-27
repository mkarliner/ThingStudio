#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Fill firmware/mirror/ with the images the online build's install page serves.

The install page serves every image from its own origin, named by its sha256 (vite.config.ts's firmwareMirror(),
docs/working-notes/online-editor-webserial-briefing.md, section C): a browser can't fetch GitHub release assets, and
the page's CSP allows its own origin only. This downloads the newest version of every build in firmware/builds.json,
checks it against the catalogue's sha256, and keeps it as firmware/mirror/<sha256>.<bin|uf2>. A file already there
with the right hash is left alone; one with the wrong hash is replaced. Nothing that fails the check is kept.

A release that bumps the runtime catalogues its own images at its own release URLs, which exist only once
firmware/publish.sh attaches them to the draft -- and the draft waits for the demo build. So the Release workflow
passes --ci-for-tag: an image whose URL is that tag's release download comes from the Firmware images run that built
it (the artifact firmware/bench.py tested), and gets the same sha256 check.

Usage:  python3 tools/fetch_firmware_mirror.py [--check] [--ci-for-tag vX.Y.Z]
        --check        download nothing; list what's missing and exit 1 if anything is.
        --ci-for-tag   take that tag's own images from their Firmware images run (needs gh and GH_TOKEN).
Needs:  the network (micropython.org and GitHub). Standard library only, plus gh for --ci-for-tag.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CATALOGUE = REPO / "firmware" / "builds.json"
MIRROR = REPO / "firmware" / "mirror"
TIMEOUT_S = 60
IMAGES_WORKFLOW = "firmware-images.yml"

sys.path.insert(0, str(Path(__file__).resolve().parent))
import firmware_targets  # noqa: E402  (tools/, beside this file)


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


def for_tag(url: str, tag: str | None) -> bool:
    """Whether `url` is a download from release `tag` itself (any repository's)."""
    return bool(tag) and url.startswith("https://github.com/") and f"/releases/download/{tag}/" in url


def ci_image_bytes(url: str) -> bytes:
    """The image at `url` (a not-yet-published release asset) from the Firmware images run that built it."""
    name = url.rsplit("/", 1)[-1]
    parsed = firmware_targets.parse_image_name(name)
    if parsed is None:
        raise OSError(f"{name} is not a ThingStudio image name")
    target, _version, sha7 = parsed
    full = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--verify", "--quiet", sha7 + "^{commit}"],
                          capture_output=True, text=True, check=False)
    if full.returncode != 0:
        raise OSError(f"commit {sha7} is not in this checkout")
    commit = full.stdout.strip()
    runs = subprocess.run(["gh", "run", "list", "--workflow", IMAGES_WORKFLOW, "--commit", commit, "--status",
                           "success", "--json", "databaseId", "--limit", "1"],
                          capture_output=True, text=True, check=False, cwd=REPO)
    found = json.loads(runs.stdout or "[]") if runs.returncode == 0 else []
    if not found:
        raise OSError(f"no successful {IMAGES_WORKFLOW} run for {sha7} ({runs.stderr.strip() or 'none listed'})")
    artifact = f"firmware-{target}-{commit}"
    with tempfile.TemporaryDirectory() as tmp:
        got = subprocess.run(["gh", "run", "download", str(found[0]["databaseId"]), "--name", artifact,
                              "--dir", tmp], capture_output=True, text=True, check=False, cwd=REPO)
        if got.returncode != 0:
            raise OSError(f"could not download artifact {artifact} ({got.stderr.strip()})")
        image = Path(tmp) / name
        if not image.is_file():
            raise OSError(f"artifact {artifact} has no {name}")
        return image.read_bytes()


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="list missing images and exit 1 if any")
    parser.add_argument("--ci-for-tag", metavar="TAG", help="take TAG's own release images from their CI run")
    args = parser.parse_args()
    MIRROR.mkdir(parents=True, exist_ok=True)
    missing, failed = [], []
    for build_id, url, sha, path in wanted():
        if path.exists() and sha256_of(path) == sha:
            continue
        if args.check:
            missing.append(build_id)
            continue
        from_ci = for_tag(url, args.ci_for_tag)
        print(f"{build_id}: {url}" + (" (from its Firmware images run)" if from_ci else ""))
        try:
            if from_ci:
                data = ci_image_bytes(url)
            else:
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
