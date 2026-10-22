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
PORT="${PORT:-}"
IMG="${1:-}"
TRIES="${TRIES:-20}"

die() { echo "install: $*" >&2; exit 1; }

[ -n "$PORT" ] || die "set PORT, e.g. PORT=/dev/ttyUSB0 $0 [image]"

if [ -z "$IMG" ]; then
    IMG="$(ls -t "$HERE"/out/thingstudio-classic-esp32-*.bin 2>/dev/null | head -1 || true)"
    [ -n "$IMG" ] || die "no image given and none in $HERE/out -- run build.sh first"
fi
[ -f "$IMG" ] || die "no such image: $IMG"
[ -f "$HERE/out/_deps.json" ] || die "missing $HERE/out/_deps.json -- build.sh writes it next to the image"
# `esptool.py` is the name pip gives the 3.x/4.x console script, and what macOS and most
# developer machines have; esptool 5 installs `esptool` instead with no `esptool.py` alias. Use
# whichever exists rather than making the user care which version they installed.
ESPTOOL="$(command -v esptool.py || command -v esptool || true)"
[ -n "$ESPTOOL" ] || die "esptool not found on PATH (pip install esptool)"
command -v mpremote >/dev/null || die "mpremote not found on PATH (pip install mpremote)"

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
    "$ESPTOOL" --chip esp32 --port "$PORT" run >/dev/null 2>&1
}

echo "install: flashing $IMG to $PORT (this erases the board's flows and settings)"
wait_port || die "port $PORT never opened -- unplug and replug the board, then run this again"

# Erase the filesystem partition before writing. The image's app sits at 0x10000..0x310000, so a
# plain write_flash leaves whatever filesystem the old firmware had at 0x310000 untouched -- in a
# different format, or with a boot sector that isn't blank. MicroPython then treats it as corrupt,
# loops printing "The filesystem appears to be corrupted", and `os.mkdir('/lib')` answers ENODEV.
# The size must match board/partitions.csv's vfs entry.
FS_OFFSET=0x310000
FS_SIZE=0xF0000
"$ESPTOOL" --chip esp32 --port "$PORT" --after no_reset erase_region "$FS_OFFSET" "$FS_SIZE"
"$ESPTOOL" --chip esp32 --port "$PORT" --after no_reset write_flash 0x0 "$IMG"

echo "install: waiting for the board to restart and settle"
wait_port || die "port $PORT did not come back after flashing -- unplug and replug the board"
reset_board || die "could not restart the board over $PORT -- unplug and replug it, then write /main.py and /lib/_deps.json by hand (README, Install)"
sleep 2

echo "install: writing boot script and library inventory"
wait_port || die "port $PORT did not come back after reset -- unplug and replug the board"
mpremote connect "$PORT" fs mkdir :/lib >/dev/null 2>&1 || true
# One destination per command: mpremote's cp takes "src... :dest", not src/dest pairs.
mpremote connect "$PORT" fs cp "$HERE/main.py" :/main.py
mpremote connect "$PORT" fs cp "$HERE/out/_deps.json" :/lib/_deps.json

echo "install: done -- reset the board if it is still sitting in the REPL; it boots into the listener"
