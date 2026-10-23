#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# firmware/classic-esp32/record-tested.sh
#
# Records that an image was flashed and run on a board, so publish.sh will attach it to a release.
# The record is the only thing standing between "a file exists in out/" and "a release ships it", so
# it asks for the one thing a script cannot know: what you actually did on the board.
#
# Usage:
#   firmware/classic-esp32/record-tested.sh <image> "<board>" "<what you ran and saw>"
#
# Example:
#   firmware/classic-esp32/record-tested.sh out/thingstudio-classic-esp32-12.1.0-8e2f87d.bin \
#       "CYD (ESP32-2432S028)" "install clean, hero GUI flow deployed 3x over a running flow"
#
# Writes firmware/classic-esp32/tested.json (sorted by hash) and prints the git command to commit it.
# Publishing also needs the docs page's image name to be this file's name -- editor/test/
# firmware-assets.test.ts checks that.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORD="$HERE/tested.json"

die() { echo "record-tested: $*" >&2; exit 1; }

IMG="${1:-}"
BOARD="${2:-}"
NOTES="${3:-}"

[ -n "$IMG" ] || die "usage: $0 <image> \"<board>\" \"<what you ran and saw>\""
[ -f "$IMG" ] || die "no such image: $IMG"
[ -n "$BOARD" ] || die "name the board it ran on (a release says which board was tested)"
[ -n "$NOTES" ] || die "say what you ran and saw (it goes on the release, so make it worth reading)"

sha_cmd() {
    if command -v sha256sum >/dev/null; then sha256sum "$@"
    elif command -v shasum >/dev/null; then shasum -a 256 "$@"
    else die "no sha256sum or shasum on PATH"
    fi
}

HASH="$(sha_cmd "$IMG" | cut -d' ' -f1)"
NAME="$(basename "$IMG")"

# A stale .sha256 beside the image is how a wrong hash gets published, so it has to agree.
if [ -f "$IMG.sha256" ]; then
    recorded="$(cut -d' ' -f1 < "$IMG.sha256")"
    [ "$recorded" = "$HASH" ] || die "$IMG.sha256 says $recorded but the file hashes to $HASH -- rebuild, do not record"
fi

python3 - "$RECORD" "$HASH" "$NAME" "$BOARD" "$NOTES" "$(date +%Y-%m-%d)" <<'PY'
import json, sys
path, digest, name, board, notes, day = sys.argv[1:7]
try:
    with open(path) as f:
        record = json.load(f)
except FileNotFoundError:
    record = {}
record[digest] = {"image": name, "board": board, "date": day, "tested": notes}
with open(path, "w") as f:
    json.dump(dict(sorted(record.items())), f, indent=2)
    f.write("\n")
print("record-tested: %s (%s)" % (name, digest[:12]))
PY

cat <<EOF

Commit the record so the release can cite it:

  git add firmware/classic-esp32/tested.json && \\
  git commit -m "firmware: record $NAME as tested on $BOARD"
EOF
