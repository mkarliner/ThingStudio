#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# firmware/publish.sh
#
# Attaches every target's custom image to a release, and refuses more than it does. Images are built locally and
# run on a board before they ship (decisions/classic-esp32-firmware.md, 2026-10-23), and every target is rebuilt
# at each runtime bump (decisions/custom-firmware.md, 2026-11-04). So this script makes sure that each target has
# a tested image at the current runtime version, built from a commit the tag contains, and that what GitHub serves
# afterwards is byte-for-byte what was tested.
#
# Usage:
#   firmware/publish.sh <tag>              # attach, verify
#   firmware/publish.sh <tag> --publish    # ... and publish the draft
#
# For each target (tools/firmware_targets.py list) it takes the newest image in firmware/out/<target>/ and refuses
# when: the image is not at the runtime version; its hash is not in the target's tested.json (record-tested.sh);
# its build commit is not an ancestor of the tag; the .sha256 beside it disagrees. Also refused: gh missing or not
# logged in; the tag is not a draft release; main.py missing; an upload that does not read back with the same hash.
# Nothing is uploaded until every target passes.
#
# Needs: gh, authenticated by `gh auth login` or GH_TOKEN (a fine-grained token needs only Contents: write on this
# repository), python3, git, the repository's own history.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TAG="${1:-}"
PUBLISH="${2:-}"
NOTES_HEADING="## Custom firmware images"

die() { echo "publish: $*" >&2; exit 1; }
note() { echo "publish: $*"; }

[ -n "$TAG" ] || die "usage: $0 <tag> [--publish]"
case "$PUBLISH" in ""|"--publish") ;; *) die "unknown option $PUBLISH (only --publish)" ;; esac

command -v gh >/dev/null || die "gh not found (brew install gh, or apt install gh)"
# One authenticated API call, not `gh auth status`: a fine-grained token cannot enumerate its own scopes, and
# `gh auth status` reports that as a failure even when the token works (2026-10-23).
gh api user --jq .login >/dev/null 2>&1 \
    || die "gh can't authenticate: run 'gh auth login', or set GH_TOKEN to a token with Contents: write on this repo"
command -v python3 >/dev/null || die "python3 not found"
git -C "$REPO" rev-parse --verify --quiet "$TAG^{commit}" >/dev/null || die "no tag $TAG in this repository (git fetch --tags)"

sha_cmd() {
    if command -v sha256sum >/dev/null; then sha256sum "$@"
    elif command -v shasum >/dev/null; then shasum -a 256 "$@"
    else die "no sha256sum or shasum on PATH"
    fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- the release we are attaching to ----------------------------------------------------------------------------
note "release $TAG"
gh release view "$TAG" --json isDraft,tagName,assets > "$WORK/release.json" 2>/dev/null \
    || die "no release $TAG on GitHub (the Release workflow creates the draft when the tag is pushed)"
python3 - "$WORK/release.json" "$TAG" <<'PY' || exit 1
import json, sys
path, tag = sys.argv[1], sys.argv[2]
data = json.load(open(path))
if data.get("tagName") != tag:
    raise SystemExit("publish: release view returned %r, expected %r" % (data.get("tagName"), tag))
if not data.get("isDraft"):
    raise SystemExit("publish: %s is already published -- attach to a draft, not a live release" % tag)
assets = [a["name"] for a in data.get("assets", [])]
if not any(n.startswith("thingstudio-0") for n in assets):
    raise SystemExit("publish: %s has no app archives -- is the Release workflow still running?" % tag)
print("publish: draft has %d app assets" % len(assets))
PY

# --- every target: newest image, at the runtime version, tested, current, intact ---------------------------------
# One Python pass picks and checks them all, so nothing is uploaded unless every target is ready. It prints one
# line per target: <image path>\t<sha256>.
python3 - "$REPO" "$TAG" > "$WORK/images.tsv" <<'PY' || exit 1
import hashlib, subprocess, sys
from pathlib import Path
repo, tag = Path(sys.argv[1]), sys.argv[2]
sys.path.insert(0, str(repo / "tools"))
import firmware_targets as ft

version = ft.runtime_version(tag)  # the runtime the release ships, not the working tree
problems, lines = [], []
for t in ft.targets():
    out = repo / "firmware" / "out" / t.id
    images = sorted(out.glob(f"{t.build_id}-*.bin"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not images:
        problems.append(f"{t.id}: no image in firmware/out/{t.id} -- firmware/build.sh {t.id}")
        continue
    img = images[0]
    parsed = ft.parse_image_name(img.name)
    if parsed is None or parsed[0] != t.id:
        problems.append(f"{t.id}: {img.name} is not {t.build_id}-<version>-<sha>.bin (a -dirty build cannot ship)")
        continue
    if parsed[1] != version:
        problems.append(f"{t.id}: {img.name} is runtime {parsed[1]}, the runtime is {version} -- rebuild it")
        continue
    digest = hashlib.sha256(img.read_bytes()).hexdigest()
    entry = t.tested().get(digest)
    if entry is None:
        problems.append(f"{t.id}: {img.name} is not in firmware/targets/{t.id}/tested.json -- flash it, run it, then "
                        f"firmware/record-tested.sh {img} \"<board>\" \"<what you ran>\"")
        continue
    if entry.get("image") != img.name:
        problems.append(f"{t.id}: tested.json has this hash as {entry.get('image')!r}, the file is {img.name!r}")
        continue
    if subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor", parsed[2], tag]).returncode != 0:
        problems.append(f"{t.id}: {img.name} was built from {parsed[2]}, which is not an ancestor of {tag} -- rebuild")
        continue
    sidecar = img.with_name(img.name + ".sha256")
    if not sidecar.is_file() or sidecar.read_text().split()[0] != digest:
        problems.append(f"{t.id}: {sidecar.name} is missing or disagrees with the image -- rebuild, do not publish")
        continue
    if not (out / "main.py").is_file():
        problems.append(f"{t.id}: no firmware/out/{t.id}/main.py -- build.sh writes it")
        continue
    print(f"publish: {t.id}: {img.name}, tested on {entry['board']} ({entry['date']})", file=sys.stderr)
    lines.append(f"{img}\t{digest}")
for p in problems:
    print(f"publish: {p}", file=sys.stderr)
if problems:
    raise SystemExit(1)
print("\n".join(lines))
PY

# main.py is the same boot script for every target; one copy goes up, and every target's must match it.
MAIN=""
FILES=()
while IFS=$'\t' read -r img _digest; do
    main="$(dirname "$img")/main.py"
    if [ -z "$MAIN" ]; then MAIN="$main"
    else cmp -s "$MAIN" "$main" || die "$main differs from $MAIN -- rebuild both targets from the same commit"
    fi
    FILES+=("$img" "$img.sha256")
done < "$WORK/images.tsv"
FILES+=("$MAIN")

# --- upload, then read it back -----------------------------------------------------------------------------------
note "uploading ${#FILES[@]} files to the $TAG draft"
gh release upload "$TAG" "${FILES[@]}" --clobber

note "reading the assets back from GitHub"
mkdir -p "$WORK/back"
for file in "${FILES[@]}"; do
    asset="$(basename "$file")"
    gh release download "$TAG" --pattern "$asset" --dir "$WORK/back" --clobber >/dev/null \
        || die "could not download $asset back for verification"
    want="$(sha_cmd "$file" | cut -d' ' -f1)"
    got="$(sha_cmd "$WORK/back/$asset" | cut -d' ' -f1)"
    [ "$want" = "$got" ] || die "$asset reads back as $got, expected $want -- do not publish this release"
    note "verified $asset  $want"
done

# --- the notes say what each image is ---------------------------------------------------------------------------
python3 - "$REPO" "$WORK/images.tsv" "$NOTES_HEADING" > "$WORK/block.md" <<'PY'
import sys
from pathlib import Path
repo, tsv, heading = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
sys.path.insert(0, str(repo / "tools"))
import firmware_targets as ft
print("\n%s\n" % heading)
for line in open(tsv).read().splitlines():
    img, digest = line.split("\t")
    t = ft.target(ft.parse_image_name(Path(img).name)[0])
    e = t.tested()[digest]
    print("- **%s**: `%s`, sha256 `%s`. Tested on %s (%s): %s"
          % (t.label, e["image"], digest, e.get("board"), e.get("date"), e.get("tested")))
print("\nInstall and what they change: https://docs.thingstudio.net/custom-firmware/. Each image's `.sha256` and the "
      "one `main.py` belong with it.")
PY
gh release view "$TAG" --json body --jq .body > "$WORK/body.md"
# Idempotent: drop a block from an earlier run (this heading, or the single-image one before 2026-11-04).
python3 - "$WORK/body.md" "$WORK/block.md" "$NOTES_HEADING" > "$WORK/notes.md" <<'PY'
import sys
body, block, heading = open(sys.argv[1]).read(), open(sys.argv[2]).read(), sys.argv[3]
for old in (heading, "## Custom firmware for classic ESP32"):
    body = body.split("\n" + old)[0]
print(body.rstrip() + "\n" + block)
PY
gh release edit "$TAG" --notes-file "$WORK/notes.md" >/dev/null
note "release notes name each image and its hash"

if [ "$PUBLISH" = "--publish" ]; then
    gh release edit "$TAG" --draft=false >/dev/null
    note "published $TAG"
else
    note "still a draft. Look at it, then publish:"
    note "  gh release edit $TAG --draft=false"
fi
