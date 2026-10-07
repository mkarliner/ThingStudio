#!/bin/sh
# Host-side checks on the MicroPython unix port (Linux or macOS build).
#   MICROPYTHON=/path/to/micropython NANO_GUI=/path/to/micropython-nano-gui ./run_host.sh
# Writes raw frames + PNGs into out/ (render.py needs CPython with Pillow).
set -e
: "${MICROPYTHON:?set MICROPYTHON to a unix-port micropython binary}"; : "${NANO_GUI:?set NANO_GUI to a nano-gui checkout at ff2aad5}"
mkdir -p out board_vendor
cp ../../device-runtime/src/vendor/ssd1306/ssd1306.py board_vendor/
export MICROPYPATH=.:fonts:board_vendor:$NANO_GUI
for m in gs4 gs2 mono; do
  "$MICROPYTHON" -X heapsize=2M page.py $m out
  "$MICROPYTHON" -X heapsize=2M band_test.py $m
  "$MICROPYTHON" -X heapsize=2M host_bench.py $m | grep -v '^RAM'
done
"$MICROPYTHON" place_test.py
"$MICROPYTHON" fontram.py
"$MICROPYTHON" host_pico.py >/dev/null
python3 render.py out
