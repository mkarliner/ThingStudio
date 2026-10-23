#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# firmware/classic-esp32/publish.sh
#
# Attaches the custom-ESP32 image to a release, and refuses more than it does. The image is built
# locally and run on a board before it ships (decisions/classic-esp32-firmware.md, 2026-10-23), so
# this script's job is to make sure only a tested, current image can reach a release, and that what
# GitHub serves afterwards is byte-for-byte what was tested.
#
# Usage:
#   firmware/classic-esp32/publish.sh <tag>              # attach, verify
#   firmware/classic-esp32/publish.sh <tag> --publish    # ... and publish the draft
#
# Refuses when: gh is missing or not logged in; the tag is not a draft release; the newest image's
# hash is not in tested.json (record-tested.sh); the image's build commit is not an ancestor of the
# tag; the .sha256 beside it disagrees; _deps.json or main.py is missing; an upload does not read
# back with the same hash.
#
# Needs: gh (brew install gh / apt install gh), python3, git, the repository's own history.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/out"
RECORD="$HERE/tested.json"
TAG="${1:-}"
PUBLISH="${2:-}"

die() { echo "publish: $*" >&2; exit 1; }
note() { echo "publish: $*"; }

[ -n "$TAG" ] || die "usage: $0 <tag> [--publish]"
case "$PUBLISH" in ""|"--publish") ;; *) die "unknown option $PUBLISH (only --publish)" ;; esac

# --- the tool that uploads ---------------------------------------------------------------------
command -v gh >/dev/null || die "gh not found (brew install gh, or apt install gh)"
gh auth status >/dev/null 2>&1 || die "gh is not logged in (gh auth login)"
command -v python3 >/dev/null || die "python3 not found"

sha_cmd() {
    if command -v sha256sum >/dev/null; then sha256sum "$@"
    elif command -v shasum >/dev/null; then shasum -a 256 "$@"
    else die "no sha256sum or shasum on PATH"
    fi
}

# --- the release we are attaching to ----------------------------------------------------------
mkdir -p "$OUT"
note "release $TAG"
gh release view "$TAG" --json isDraft,tagName,assets > "$OUT/.release.json" 2>/dev/null \
    || die "no release $TAG on GitHub (the Release workflow creates the draft when the tag is pushed)"
python3 - "$OUT/.release.json" "$TAG" <<'PY' || exit 1
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
rm -f "$OUT/.release.json"

# --- the image: newest in out/, tested, current, intact ---------------------------------------
set -- "$OUT"/thingstudio-classic-esp32-*.bin
IMG=""
for candidate in "$@"; do
    [ -f "$candidate" ] || continue
    if [ -z "$IMG" ] || [ "$candidate" -nt "$IMG" ]; then IMG="$candidate"; fi
done
[ -n "$IMG" ] || die "no image in $OUT -- run build.sh first"
NAME="$(basename "$IMG")"
HASH="$(sha_cmd "$IMG" | cut -d' ' -f1)"
note "image $NAME"
note "sha256 $HASH"

# Tested: the whole point. A hash is in tested.json only when someone flashed and ran that binary.
python3 - "$RECORD" "$HASH" "$NAME" <<'PY' || exit 1
import json, sys
path, digest, name = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    record = json.load(open(path))
except FileNotFoundError:
    raise SystemExit("publish: no %s -- nothing is recorded as tested" % path)
entry = record.get(digest)
if entry is None:
    raise SystemExit(
        "publish: %s is not in tested.json. Flash it, run it, then:\n"
        "  firmware/classic-esp32/record-tested.sh %s \"<board>\" \"<what you ran>\""
        % (name, name)
    )
if entry.get("image") and entry["image"] != name:
    raise SystemExit("publish: tested.json has this hash as %r, the file is %r" % (entry["image"], name))
print("publish: tested on %s, %s -- %s" % (entry.get("board"), entry.get("date"), entry.get("tested")))
PY

# Current: the build stamp in the filename must be a commit the tag contains, or the release would
# ship a build that predates the release it is attached to (or, worse, one from another branch).
STAMP="$(printf '%s' "$NAME" | sed -n 's/^thingstudio-classic-esp32-[0-9.]*-\([0-9a-f]*\)\.bin$/\1/p')"
[ -n "$STAMP" ] || die "cannot read a build stamp from $NAME (expected ...-<version>-<sha>.bin)"
git -C "$REPO" rev-parse --verify --quiet "$STAMP^{commit}" >/dev/null \
    || die "build stamp $STAMP is not a commit in this repository"
git -C "$REPO" merge-base --is-ancestor "$STAMP" "$TAG" \
    || die "$NAME was built from $STAMP, which is not an ancestor of $TAG -- rebuild at the tag"
note "build $STAMP is an ancestor of $TAG"

# Intact: the checksum file beside the image, and the two files that live on the filesystem.
[ -f "$IMG.sha256" ] || die "no $NAME.sha256 -- build.sh writes it beside the image"
[ "$(cut -d' ' -f1 < "$IMG.sha256")" = "$HASH" ] \
    || die "$NAME.sha256 disagrees with the image -- rebuild, do not publish"
[ -f "$OUT/_deps.json" ] || die "no $OUT/_deps.json -- build.sh writes it"
[ -f "$HERE/main.py" ] || die "no $HERE/main.py (the board's boot script)"

# --- upload, then read it back ----------------------------------------------------------------
note "uploading 4 files to the $TAG draft"
gh release upload "$TAG" "$IMG" "$IMG.sha256" "$OUT/_deps.json" "$HERE/main.py" --clobber

VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT
note "reading the assets back from GitHub"
for asset in "$NAME" "$NAME.sha256" "_deps.json" "main.py"; do
    gh release download "$TAG" --pattern "$asset" --dir "$VERIFY_DIR" --clobber >/dev/null \
        || die "could not download $asset back for verification"
done
for pair in "$IMG:$NAME" "$OUT/_deps.json:_deps.json" "$HERE/main.py:main.py"; do
    local_file="${pair%:*}"
    asset="${pair##*:}"
    want="$(sha_cmd "$local_file" | cut -d' ' -f1)"
    got="$(sha_cmd "$VERIFY_DIR/$asset" | cut -d' ' -f1)"
    [ "$want" = "$got" ] || die "$asset reads back as $got, expected $want -- do not publish this release"
    note "verified $asset  $want"
done

# --- the notes say what the image is ---------------------------------------------------------
NOTE_BLOCK="$(python3 - "$RECORD" "$HASH" <<'PY'
import json, sys
record, digest = sys.argv[1], sys.argv[2]
entry = json.load(open(record))[digest]
print(
    "\n## Custom firmware for classic ESP32\n\n"
    "- Image: `%s`\n- sha256: `%s`\n- Tested on: %s (%s) -- %s\n"
    "- Install and what it changes: https://docs.thingstudio.net/custom-firmware/\n"
    "- The `.sha256`, `_deps.json` and `main.py` assets belong with the image; all four are needed.\n"
    % (entry["image"], digest, entry.get("board"), entry.get("date"), entry.get("tested"))
)
PY
)"
BODY="$(gh release view "$TAG" --json body --jq .body)"
# Idempotent: drop a block from an earlier run, then append the current one.
CLEAN="$(printf '%s' "$BODY" | python3 -c 'import sys; body=sys.stdin.read(); print(body.split("\n## Custom firmware for classic ESP32")[0].rstrip())')"
printf '%s%s\n' "$CLEAN" "$NOTE_BLOCK" > "$VERIFY_DIR/notes.md"
gh release edit "$TAG" --notes-file "$VERIFY_DIR/notes.md" >/dev/null
note "release notes name the image and its hash"

if [ "$PUBLISH" = "--publish" ]; then
    gh release edit "$TAG" --draft=false >/dev/null
    note "published $TAG"
else
    note "still a draft. Look at it, then publish:"
    note "  gh release edit $TAG --draft=false"
fi
