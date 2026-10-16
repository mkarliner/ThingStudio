#!/usr/bin/env bash
#
# install-build-tools.sh
#
# Set up a Debian/Ubuntu machine to build MicroPython firmware with the Thingstudio
# runtime + mqtt_as frozen in.
#
# Installs:
#   - host build tools (gcc/g++, make, cmake, ninja, python3, ccache, ...)
#   - the ARM GNU toolchain  -> RP2040 / RP2350 images (.uf2)
#   - ESP-IDF + xtensa/riscv toolchains -> ESP32 family images (.bin)
#   - mpremote / esptool / pyelftools
#
# Usage (needs root; it self-elevates with sudo if you don't run it as root):
#
#   sudo bash install-build-tools.sh
#
# Flags:
#   --prefix DIR        install root            (default /opt/thingstudio-build)
#   --idf-version VER   ESP-IDF git tag         (default v5.5.2)
#   --owner USER        who owns the install    (default: user who ran sudo)
#   --skip-esp32        skip ESP-IDF            (much smaller/faster; no ESP32 builds)
#   --skip-arm          skip the ARM toolchain  (no Pico builds)
#   -h | --help
#
# The MicroPython version to build against is pinned in this project to commit
# 3a89fc2411d78c63b4092e5c00b7b0e01e68513c (2026-08-10) -- the exact commit the
# editor's WASM mpy-cross was built from, so deployed .mpy bytecode matches.
# Its ESP32 port supports ESP-IDF v5.3 .. v5.5.2.
#
set -euo pipefail

PREFIX="/opt/thingstudio-build"
IDF_VERSION="v5.5.2"
ESP_TARGETS="esp32,esp32s2,esp32s3,esp32c3,esp32c6"
DO_ESP32=1
DO_ARM=1
OWNER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)      PREFIX="${2:?--prefix needs a directory}"; shift 2;;
    --idf-version) IDF_VERSION="${2:?--idf-version needs a tag}"; shift 2;;
    --owner)       OWNER="${2:?--owner needs a user}"; shift 2;;
    --skip-esp32)  DO_ESP32=0; shift;;
    --skip-arm)    DO_ARM=0; shift;;
    -h|--help)     sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- elevate ---------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  if ! have sudo; then
    echo "Run this as root, or install sudo." >&2; exit 1
  fi
  echo "Re-running with sudo (installs into $PREFIX)..."
  exec sudo bash "$0" "$@"
fi

if [ -z "$OWNER" ]; then
  OWNER="${SUDO_USER:-$(stat -c '%U' "$PREFIX" 2>/dev/null || echo root)}"
  [ "$OWNER" = "root" ] && OWNER="${SUDO_USER:-root}"
fi

# --- distro check ----------------------------------------------------------
if [ ! -r /etc/os-release ]; then echo "Cannot read /etc/os-release." >&2; exit 1; fi
. /etc/os-release
case "${ID:-}" in
  debian|ubuntu|raspbian|linuxmint|pop|zorin|kali) ;;
  *) echo "This script targets Debian/Ubuntu (found ID='${ID:-?}')." >&2; exit 1;;
esac

export DEBIAN_FRONTEND=noninteractive

# --- host build tools ------------------------------------------------------
say "Installing host build tools (apt)"
apt-get update
apt-get install -y \
  build-essential git wget curl ca-certificates xz-utils unzip \
  python3 python3-pip python3-venv python3-dev python3-setuptools \
  pkg-config libffi-dev libssl-dev libncurses-dev \
  cmake ninja-build ccache flex bison gperf \
  libusb-1.0-0-dev dfu-util

# --- mpremote / esptool / pyelftools ---------------------------------------
say "Installing mpremote, esptool and pyelftools"
apt-get install -y mpremote esptool python3-pyelftools || true
have mpremote || pip3 install --break-system-packages mpremote
python3 -c 'import esptool'  2>/dev/null || pip3 install --break-system-packages esptool
python3 -c 'import elftools' 2>/dev/null || pip3 install --break-system-packages pyelftools

# --- ARM toolchain (RP2040 / RP2350) ---------------------------------------
if [ "$DO_ARM" -eq 1 ]; then
  say "Installing the ARM GNU toolchain (RP2040 / RP2350)"
  apt-get install -y \
    gcc-arm-none-eabi binutils-arm-none-eabi \
    libnewlib-arm-none-eabi libstdc++-arm-none-eabi-newlib
else
  say "Skipping the ARM toolchain (--skip-arm)"
fi

# --- ESP-IDF + toolchains (ESP32 family) -----------------------------------
mkdir -p "$PREFIX"
if [ "$DO_ESP32" -eq 1 ]; then
  say "Installing ESP-IDF $IDF_VERSION (large: ~1 GB clone + a few GB of toolchains)"
  export IDF_TOOLS_PATH="$PREFIX/esp-tools"
  mkdir -p "$IDF_TOOLS_PATH"
  if [ ! -d "$PREFIX/esp-idf/.git" ]; then
    git clone --depth 1 --branch "$IDF_VERSION" \
      https://github.com/espressif/esp-idf.git "$PREFIX/esp-idf"
  else
    git -C "$PREFIX/esp-idf" fetch --depth 1 origin tag "$IDF_VERSION" || true
    git -C "$PREFIX/esp-idf" checkout "$IDF_VERSION"
  fi
  git -C "$PREFIX/esp-idf" submodule update --init --recursive --filter=tree:0
  "$PREFIX/esp-idf/install.sh" "$ESP_TARGETS"
else
  say "Skipping ESP-IDF (--skip-esp32)"
fi

# --- a source-this env file the build step can use -------------------------
say "Writing $PREFIX/env.sh"
cat > "$PREFIX/env.sh" <<EOF
# Source before building Thingstudio firmware:  . $PREFIX/env.sh
export IDF_PATH="$PREFIX/esp-idf"
export IDF_TOOLS_PATH="$PREFIX/esp-tools"
[ -f "\$IDF_PATH/export.sh" ] && . "\$IDF_PATH/export.sh" >/dev/null 2>&1 || true
EOF

# --- ownership / permissions ----------------------------------------------
# The build runs from another account (the agent's, here), so make the tree
# readable+executable by everyone, and hand it to $OWNER where that account exists.
if id "$OWNER" >/dev/null 2>&1; then
  chown -R "$OWNER":"$OWNER" "$PREFIX"
fi
chmod -R a+rX "$PREFIX"

MPY_COMMIT="3a89fc2411d78c63b4092e5c00b7b0e01e68513c"
say "Done"
cat <<EOF
Installed into: $PREFIX   (owner: $OWNER)

Every later build step should first:
    . $PREFIX/env.sh          # IDF_PATH + IDF_TOOLS_PATH + ESP-IDF export

Quick checks:
    arm-none-eabi-gcc --version
    . $PREFIX/env.sh && idf.py --version

MicroPython source (do this where the build will run, e.g. /tmp or ~/work):
    git clone https://github.com/micropython/micropython
    cd micropython
    git checkout $MPY_COMMIT
    make -C ports/rp2   submodules      # RP2040 / RP2350
    make -C ports/esp32 submodules      # ESP32 family
    make -C ports/unix  submodules      # unix (off-device smoke test)

Firmware is then built with a freeze manifest, e.g.
    make -C ports/rp2 BOARD=RPI_PICO_W FROZEN_MANIFEST=/path/manifest.py
    make -C ports/esp32 BOARD=ESP32_GENERIC FROZEN_MANIFEST=/path/manifest.py

(Images are written to /home/agent/TSImages once built.)
EOF
