#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# firmware/install.sh
#
# Usage: PORT=/dev/ttyUSB0 firmware/install.sh <target> [image]
#
# Flashes a built image and writes the one file that lives on the filesystem rather than in the
# image: /main.py (the boot script, which imports the frozen listener). The library inventory is
# frozen into the image as deps_frozen.py (2026-10-25), so nothing else is written.
#
# Flashing erases the board: flows, WiFi credentials and board settings are gone afterwards. That is
# the same as any firmware flash and is stated in the docs page.
#
# Two things about the USB link that cost real time to find (CYD's CH340 on a VM, 2026-10-22):
#   - esptool's own reset at the end of a command can make the bridge re-enumerate, and the port then
#     fails every open with EIO until it is replugged. So: `--after no_reset` everywhere, and one
#     explicit reset of our own once the flashing is done.
#   - The port also drops between commands for no reason we control. Every step therefore retries
#     the open instead of failing the whole install.
#   - esptool's spellings differ by version: 4.x/5.x accept `--after no-reset` and `erase-region`,
#     3.x only the underscore forms. The underscore forms (`no_reset`, `erase_region`, `write_flash`)
#     are the ones every version accepts, so they are what this script uses -- 5.x prints a
#     deprecation warning for them and works (macOS's default esptool.py is a 3.x, 2026-10-22).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PORT="${PORT:-}"
TARGET="${1:-}"
IMG="${2:-}"
TRIES="${TRIES:-20}"

die() { echo "install: $*" >&2; exit 1; }

[ -n "$TARGET" ] || die "usage: PORT=/dev/ttyUSB0 $0 <target> [image]  (targets: $(python3 "$REPO/tools/firmware_targets.py" list | tr '\n' ' '))"
[ -n "$PORT" ] || die "set PORT, e.g. PORT=/dev/ttyUSB0 $0 $TARGET [image]"
ENV="$(python3 "$REPO/tools/firmware_targets.py" env "$TARGET")" || exit 1
eval "$ENV"
OUT="$HERE/out/$TARGET_ID"

if [ -z "$IMG" ]; then
    IMG="$(ls -t "$OUT/$TARGET_BUILD_ID"-*.bin 2>/dev/null | head -1 || true)"
    [ -n "$IMG" ] || die "no image given and none in $OUT -- run build.sh $TARGET_ID first"
fi
[ -f "$IMG" ] || die "no such image: $IMG"
case "$(basename "$IMG")" in "$TARGET_BUILD_ID"-*) ;; *) die "$(basename "$IMG") is not a $TARGET_ID image ($TARGET_BUILD_ID-*.bin)" ;; esac
[ -f "$OUT/main.py" ] || die "missing $OUT/main.py -- build.sh writes it next to the image"
# `esptool.py` is the name pip gives the 3.x/4.x console script, and what macOS and most
# developer machines have; esptool 5 installs `esptool` instead with no `esptool.py` alias. Use
# whichever exists rather than making the user care which version they installed.
ESPTOOL="$(command -v esptool.py || command -v esptool || true)"
[ -n "$ESPTOOL" ] || die "esptool not found on PATH (pip install esptool)"
command -v mpremote >/dev/null || die "mpremote not found on PATH (pip install mpremote)"
# An older esptool does not know the newer chips (macOS's default esptool.py 3.x has no esp32c5); asking for the
# version with --chip fails at argument parsing for an unknown chip, before touching the port.
"$ESPTOOL" --chip "$TARGET_CHIP" version >/dev/null 2>&1 \
    || die "$ESPTOOL does not know chip $TARGET_CHIP -- pip install -U esptool (5.x knows every target here)"

if [ -f "$IMG.sha256" ]; then
    # macOS ships `shasum`, not `sha256sum` (the build's file format works with both).
    ( cd "$(dirname "$IMG")" && {
        if command -v sha256sum >/dev/null; then sha256sum --check "$(basename "$IMG").sha256"
        elif command -v shasum >/dev/null; then shasum -a 256 -c "$(basename "$IMG").sha256"
        else echo "install: no sha256sum/shasum -- skipping the checksum check" >&2
        fi
    } ) || die "checksum mismatch for $IMG"
fi

# The port comes and goes; wait for it rather than failing an install halfway through.
wait_port() {
    local i
    for i in $(seq 1 "$TRIES"); do
        if python3 -c "
import os, sys
try:
    os.close(os.open('$PORT', os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK))
except OSError as e:
    sys.exit(1)
" 2>/dev/null; then
            return 0
        fi
        sleep 2
    done
    return 1
}

# One hard reset of our own, done after flashing so the board leaves the bootloader (see the header
# for why esptool isn't asked to do it in the flash command itself). esptool's `run` exits the
# bootloader and starts the application -- the same RTS/DTR pulse, without needing pyserial in the
# system python3 (macOS: pipx installs a tool's dependencies into its own venv, so `import serial`
# there fails even when mpremote works; both esptool and mpremote are already required).
reset_board() {
    "$ESPTOOL" --chip "$TARGET_CHIP" --port "$PORT" run >/dev/null 2>&1
}

echo "install: flashing $IMG to $PORT at $TARGET_ADDRESS (this erases the board's flows and settings)"
wait_port || die "port $PORT never opened -- unplug and replug the board, then run this again"

# Erase the filesystem partition before writing. The merged image ends at the app partition, so a plain
# write_flash leaves whatever filesystem the old firmware had untouched -- in a different format, or with a boot
# sector that isn't blank. MicroPython then treats it as corrupt, loops printing "The filesystem appears to be
# corrupted", and `os.mkdir('/lib')` answers ENODEV. Offset and size come from the target's partitions.csv.
"$ESPTOOL" --chip "$TARGET_CHIP" --port "$PORT" --after no_reset erase_region "$TARGET_FS_OFFSET" "$TARGET_FS_SIZE"
"$ESPTOOL" --chip "$TARGET_CHIP" --port "$PORT" --after no_reset write_flash "$TARGET_ADDRESS" "$IMG"

echo "install: waiting for the board to restart and settle"
wait_port || die "port $PORT did not come back after flashing -- unplug and replug the board"
reset_board || die "could not restart the board over $PORT -- unplug and replug it, then write /main.py by hand (README, Install)"
sleep 2

echo "install: writing the boot script"
wait_port || die "port $PORT did not come back after reset -- unplug and replug the board"
# A board whose USB-serial chip has no auto-reset wiring (the ESP32-C5-340X's CH340E) cannot be restarted from
# here, so after flashing it is still in the ROM bootloader and mpremote finds no REPL. The image is written by
# then; say so, and give the two manual steps, instead of mpremote's traceback.
if ! mpremote connect "$PORT" fs cp "$OUT/main.py" :/main.py >/dev/null 2>&1; then
    die "image written, but the board is still in its bootloader (no auto-reset). Press RESET (not BOOT; if that
doesn't do it, unplug and replug), then:
  mpremote connect $PORT fs cp $OUT/main.py :/main.py
and reset it again."
fi

echo "install: done -- reset the board if it is still sitting in the REPL; it boots into the listener"
