#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# firmware/classic-esp32/install.sh
#
# Flashes a built image and writes the two files that live on the filesystem rather than in the
# image: /main.py (the boot script, which imports the frozen listener) and /lib/_deps.json (the
# library inventory, so Deploy doesn't push copies over the frozen ones).
#
# Flashing erases the board: flows, WiFi credentials and board settings are gone afterwards. That is
# the same as any firmware flash and is stated in the docs page.
#
# Usage: PORT=/dev/ttyUSB0 firmware/classic-esp32/install.sh [image.bin]

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-}"
IMG="${1:-}"

die() { echo "install: $*" >&2; exit 1; }

[ -n "$PORT" ] || die "set PORT, e.g. PORT=/dev/ttyUSB0 $0 [image]"

if [ -z "$IMG" ]; then
    IMG="$(ls -t "$HERE"/out/thingstudio-classic-esp32-*.bin 2>/dev/null | head -1 || true)"
    [ -n "$IMG" ] || die "no image given and none in $HERE/out -- run build.sh first"
fi
[ -f "$IMG" ] || die "no such image: $IMG"
[ -f "$HERE/out/_deps.json" ] || die "missing $HERE/out/_deps.json -- build.sh writes it next to the image"
command -v esptool >/dev/null || die "esptool not found on PATH"
command -v mpremote >/dev/null || die "mpremote not found on PATH (pip install mpremote)"

if [ -f "$IMG.sha256" ]; then
    ( cd "$(dirname "$IMG")" && sha256sum --check "$(basename "$IMG").sha256" ) || die "checksum mismatch for $IMG"
fi

echo "install: flashing $IMG to $PORT (this erases the board's flows and settings)"
esptool --chip esp32 --port "$PORT" write_flash 0x0 "$IMG"

echo "install: writing boot script, library inventory and the empty /lib the board expects"
mpremote connect "$PORT" fs mkdir :/lib || true
mpremote connect "$PORT" fs cp "$HERE/main.py" :/main.py "$HERE/out/_deps.json" :/lib/_deps.json

echo "install: done -- the board restarts into the listener. Connect to it from the editor."
