#!/usr/bin/env bash
#
# build-thingstudio-firmware.sh
#
# Build a MicroPython firmware image with the Thingstudio runtime + mqtt_as frozen in.
#
# The board boots straight into the listener: MicroPython's boot runs
# pyexec_file_if_exists("main.py"), which checks frozen modules first
# (shared/runtime/pyexec.c), so the frozen main.py below is executed even with
# nothing on the device filesystem.
#
# Prereqs: tools/install-build-tools.sh has been run and its env.sh sourced for
# ESP32 builds. Run this as the account that owns the MicroPython checkout.
#
# Usage:
#   build-thingstudio-firmware.sh --board BOARD [--port rp2|esp32|unix] [--out DIR]
#
# Board names are MicroPython's, e.g.
#   RPI_PICO RPI_PICO_W RPI_PICO2 RPI_PICO2_W        (port rp2,  .uf2)
#   ESP32_GENERIC ESP32_GENERIC_S3 ESP32_GENERIC_C3  (port esp32, .bin)
#
set -euo pipefail

MICROPY_COMMIT="3a89fc2411d78c63b4092e5c00b7b0e01e68513c"
REPO="${REPO:-/home/agent/ThingStudio}"
WORK="${WORK:-/home/agent/work/micropython}"
OUT="${OUT:-/home/agent/TSImages}"
ENVSH="${ENVSH:-/opt/thingstudio-build/env.sh}"
BOARD=""
PORT=""
VARIANT=""
EXTRA_MAKE_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --board)   BOARD="${2:?}"; shift 2;;
    --port)    PORT="${2:?}"; shift 2;;
    --variant) VARIANT="${2:?}"; shift 2;;
    --out)     OUT="${2:?}"; shift 2;;
    --work)    WORK="${2:?}"; shift 2;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
done

if [ -z "$BOARD" ]; then echo "need --board (e.g. ESP32_GENERIC or RPI_PICO_W)" >&2; exit 2; fi
if [ -z "$PORT" ]; then
  case "$BOARD" in
    RPI_PICO*|PICO*)  PORT=rp2;;
    ESP32*)           PORT=esp32;;
    ESP8266*)         PORT=esp8266;;
    *) echo "Cannot infer port from board '$BOARD'; pass --port." >&2; exit 2;;
  esac
fi
[ -n "$VARIANT" ] && EXTRA_MAKE_ARGS+=("BOARD_VARIANT=$VARIANT")

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

# --- MicroPython checkout at the pinned commit ----------------------------
if [ ! -d "$WORK/.git" ]; then
  say "Cloning MicroPython at $MICROPY_COMMIT into $WORK"
  mkdir -p "$(dirname "$WORK")"
  git init -q "$WORK"
  git -C "$WORK" remote add origin https://github.com/micropython/micropython
  git -C "$WORK" fetch --depth 1 origin "$MICROPY_COMMIT"
  git -C "$WORK" checkout -q FETCH_HEAD
else
  say "Using existing MicroPython checkout at $WORK"
  git -C "$WORK" rev-parse --verify -q FETCH_HEAD >/dev/null 2>&1 || true
  if [ "$(git -C "$WORK" rev-parse HEAD)" != "$MICROPY_COMMIT" ]; then
    git -C "$WORK" fetch --depth 1 origin "$MICROPY_COMMIT"
    git -C "$WORK" checkout -q FETCH_HEAD
  fi
fi

# --- mpy-cross -------------------------------------------------------------
say "Building mpy-cross"
make -C "$WORK/mpy-cross" -j"$(nproc)" >/dev/null
MPY_CROSS="$WORK/mpy-cross/build/mpy-cross"
[ -x "$MPY_CROSS" ] || { echo "mpy-cross build failed" >&2; exit 1; }

# --- assemble the freeze set from runtime_manifest.py ----------------------
FRZ="$(dirname "$WORK")/thingstudio-frozen-$BOARD"
MANIFEST="$FRZ.manifest.py"
say "Assembling frozen modules in $FRZ"
rm -rf "$FRZ"; mkdir -p "$FRZ"
REPO="$REPO" FRZ="$FRZ" python3 - <<'PY'
import importlib.util, os, shutil
repo, frz = os.environ["REPO"], os.environ["FRZ"]
src = os.path.join(repo, "device-runtime", "src")
spec = importlib.util.spec_from_file_location(
    "runtime_manifest", os.path.join(repo, "device-runtime", "runtime_manifest.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for f in list(m.CORE_FILES) + [m.LISTENER_FILE]:
    shutil.copy(os.path.join(src, f), os.path.join(frz, os.path.basename(f)))
for dep in getattr(m, "DEPENDENCIES", []):
    if dep["name"] == "mqtt_as":
        for rel, flat in dep["files"]:
            shutil.copy(os.path.join(src, "vendor", rel), os.path.join(frz, flat))
with open(os.path.join(frz, "main.py"), "w") as f:
    f.write("import listener\nlistener.main()\n")
print("frozen:", sorted(os.listdir(frz)))
PY

# --- manifest: keep the port's own frozen modules, add ours ----------------
case "$PORT" in
  rp2|esp32|esp8266) PORT_MANIFEST='$(PORT_DIR)/boards/manifest.py';;
  unix)              PORT_MANIFEST='$(PORT_DIR)/variants/standard/manifest.py';;
  *) echo "unknown port $PORT" >&2; exit 2;;
esac
cat > "$MANIFEST" <<EOF
include("$PORT_MANIFEST")
include("\$(MPY_DIR)/extmod/asyncio")
freeze("$FRZ")
EOF

# --- port submodules -------------------------------------------------------
if [ "$PORT" = esp32 ]; then
  # shellcheck disable=SC1090
  [ -f "$ENVSH" ] && . "$ENVSH"
  command -v idf.py >/dev/null || { echo "ESP-IDF not in env (source $ENVSH)" >&2; exit 1; }
fi
if [ "$PORT" = esp8266 ]; then
  # The ESP8266 port needs its own xtensa-lx106 toolchain (not part of ESP-IDF).
  LX106_BIN="${LX106_BIN:-/home/agent/work/xtensa-lx106-elf/xtensa-lx106-elf/bin}"
  case ":$PATH:" in *":$LX106_BIN:"*) ;; *) PATH="$LX106_BIN:$PATH";; esac
  export PATH
  command -v xtensa-lx106-elf-gcc >/dev/null || {
    echo "xtensa-lx106-elf-gcc not found (expected in $LX106_BIN)." >&2
    echo "Fetch it: curl -fsSL https://micropython.org/resources/xtensa-lx106-elf-standalone.tar.gz | tar xz" >&2
    exit 1
  }
fi
say "Fetching $PORT submodules"
make -C "$WORK/ports/$PORT" submodules >/dev/null

# --- build -----------------------------------------------------------------
say "Building $BOARD ($PORT)"
make -C "$WORK/ports/$PORT" "BOARD=$BOARD" "${EXTRA_MAKE_ARGS[@]+"${EXTRA_MAKE_ARGS[@]}"}" \
     FROZEN_MANIFEST="$MANIFEST" -j"$(nproc)"

# --- collect the image -----------------------------------------------------
case "$PORT" in
  rp2)     IMG="$WORK/ports/rp2/build-$BOARD/firmware.uf2";;
  esp32)   IMG="$WORK/ports/esp32/build-$BOARD/micropython.bin";;
  esp8266) IMG="$WORK/ports/esp8266/build-$BOARD/firmware.bin";;
  unix)    IMG="$WORK/ports/unix/build-standard/micropython";;
esac
mkdir -p "$OUT"
if [ -f "$IMG" ]; then
  DEST="$OUT/thingstudio-$BOARD-$(date +%Y%m%d).$( [ "$PORT" = rp2 ] && echo uf2 || echo bin )"
  cp "$IMG" "$DEST"
  say "Image: $DEST"
  ls -l "$DEST"
else
  echo "Build finished but expected image not found at $IMG" >&2
  exit 1
fi
