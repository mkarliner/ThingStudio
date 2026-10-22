#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# firmware/classic-esp32/build.sh
#
# Builds a MicroPython image for classic ESP32 (4 MB, no PSRAM) with Thingstudio's runtime and
# every flow library frozen in. Nothing here runs in the agent sandbox: it needs ESP-IDF and the
# Xtensa toolchain, so it runs on a developer machine or .github/workflows/firmware.yml.
#
# Usage:
#   MICROPY_DIR=~/micropython firmware/classic-esp32/build.sh
#
# MICROPY_DIR must be a checkout of MicroPython at the pinned tag (MPY_VERSION below), with
# submodules for ports/esp32 already fetched (`make -C ports/esp32 submodules`). The script builds
# mpy-cross from that same checkout, so frozen bytecode and the editor's own mpy-cross agree.
#
# Output in firmware/classic-esp32/out/:
#   thingstudio-classic-esp32-<version>.bin   merged image, flash at offset 0x0
#   thingstudio-classic-esp32-<version>.sha256
#   _deps.json                                goes to /lib/_deps.json (install.sh does it)
#
# What this does NOT verify: the image on hardware. The five-cycle GUI gate in
# docs/working-notes/classic-esp32-firmware-briefing.md is the acceptance, not this script.

set -euo pipefail

MPY_VERSION="v1.28.0"
BOARD="thingstudio_classic_esp32"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/out"
STAGE="$OUT/stage"
MICROPY_DIR="${MICROPY_DIR:-}"

die() { echo "build: $*" >&2; exit 1; }

[ -n "$MICROPY_DIR" ] || die "set MICROPY_DIR to a MicroPython checkout at $MPY_VERSION"
[ -f "$MICROPY_DIR/tools/manifestfile.py" ] || die "$MICROPY_DIR doesn't look like a MicroPython checkout"
[ -d "$MICROPY_DIR/ports/esp32" ] || die "$MICROPY_DIR has no ports/esp32"
command -v esptool >/dev/null || die "esptool not found on PATH"
command -v node >/dev/null || die "node not found on PATH (gen_deps_index.mjs compiles with the editor's mpy-cross)"
[ -n "${IDF_PATH:-}" ] || die "IDF_PATH is not set -- source the ESP-IDF export script for v5.4 first"
[ -x "$IDF_PATH/tools/idf.py" ] || [ -f "$IDF_PATH/tools/idf.py" ] || die "no idf.py under IDF_PATH=$IDF_PATH"

# A checkout at a different tag is not fatal (CI may build a newer one deliberately), but it is
# always worth seeing: the image must match the MicroPython version the board reports.
CHECKOUT="$(git -C "$MICROPY_DIR" describe --tags --always 2>/dev/null || echo unknown)"
if [ "$CHECKOUT" != "$MPY_VERSION" ]; then
    echo "build: WARNING MicroPython checkout is $CHECKOUT, pinned version is $MPY_VERSION" >&2
fi

# 1. Stage exactly what runtime_manifest.py says a board gets (runtime core, listener, every
#    vendored library and font), under its on-board module names.
python3 "$HERE/stage.py" "$STAGE"

# 2. /lib/_deps.json: the inventory the board reports, so Deploy skips what is already frozen.
node "$HERE/gen_deps_index.mjs" "$STAGE" "$OUT/_deps.json"

# 3. Build MicroPython with the frozen set. mpy-cross from this same tree, or the frozen bytecode
#    version won't match the interpreter.
make -C "$MICROPY_DIR/mpy-cross" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

rm -rf "${MICROPY_DIR:?}/ports/esp32/boards/$BOARD"
cp -r "$HERE/board" "$MICROPY_DIR/ports/esp32/boards/$BOARD"

THINGSTUDIO_FROZEN_STAGE="$STAGE" make -C "$MICROPY_DIR/ports/esp32" \
    BOARD="$BOARD" \
    FROZEN_MANIFEST="$HERE/manifest.py" \
    BUILD="$OUT/build" \
    -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

# 4. One merged image: bootloader + partition table + app, at the offsets ESP-IDF recorded in the
#    build's own flash_args. Flashing one file at 0x0 can't get those offsets wrong.
VERSION="$(python3 - "$REPO/device-runtime/src/listener.py" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
m = re.search(r'_RUNTIME_VERSION\s*=\s*\{"major":\s*(\d+),\s*"minor":\s*(\d+),\s*"patch":\s*(\d+)\}', src)
print("%s.%s.%s" % m.groups())
PY
)"
SHA="$(git -C "$REPO" rev-parse --short=7 HEAD 2>/dev/null || echo unknown)"
IMG="$OUT/thingstudio-classic-esp32-$VERSION-$SHA.bin"

( cd "$OUT/build" && esptool --chip esp32 merge_bin -o "$IMG" @flash_args )

( cd "$OUT" && sha256sum "$(basename "$IMG")" > "$(basename "$IMG").sha256" )

echo
echo "image:  $IMG"
echo "deps:   $OUT/_deps.json"
echo "size:   $(du -h "$IMG" | cut -f1)"
echo "install with: PORT=/dev/ttyUSB0 $HERE/install.sh $IMG"
