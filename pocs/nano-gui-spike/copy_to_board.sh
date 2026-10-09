#!/bin/sh
# Copy the spike to a board. Run from this folder, on the Mac, with mpremote installed.
#   ./copy_to_board.sh /dev/tty.usbserial-XXXX cyd     # CYD
#   ./copy_to_board.sh /dev/tty.usbmodemXXXX pico      # Pico W + SSD1306
# Fetches nano-gui at the spike's pinned commit into /tmp (override with NANO_GUI=...).
# Overwrites same-named files on the board; does not delete anything there.
set -e
PORT=$1; BOARD=$2
[ -n "$PORT" ] && [ -n "$BOARD" ] || { echo "usage: $0 PORT cyd|pico"; exit 1; }
SHA=ff2aad51c3aa3d264f16efa324d935206171693a
NANO=${NANO_GUI:-/tmp/nano-gui-spike-src}
[ -d "$NANO/.git" ] || git clone -q https://github.com/peterhinch/micropython-nano-gui "$NANO"
git -C "$NANO" checkout -q "$SHA"
VENDOR=../../device-runtime/src/vendor
M="mpremote connect $PORT"
for d in gui gui/core gui/widgets drivers; do $M fs mkdir ":$d" 2>/dev/null || true; done
for f in core/nanogui.py core/writer.py core/colors.py core/__init__.py widgets/label.py widgets/meter.py widgets/led.py widgets/__init__.py; do
  $M fs cp "$NANO/gui/$f" ":gui/$f"
done
$M fs cp "$NANO/drivers/boolpalette.py" :drivers/boolpalette.py
for f in spike_cfg.py color_setup.py band.py state_widgets.py page.py journal.py; do $M fs cp "$f" ":$f"; done
if [ "$BOARD" = cyd ]; then
  $M fs cp "$VENDOR/st7789py_mpy/st7789py.py" :st7789py.py
  $M fs cp bench_cyd.py :bench_cyd.py
  for f in digits48 body16 body20; do $M fs cp "fonts/$f.mpy" ":$f.mpy"; done
else
  $M fs cp "$VENDOR/ssd1306/ssd1306.py" :ssd1306.py
  for f in digits24 body10; do $M fs cp "fonts/$f.mpy" ":$f.mpy"; done
fi
echo "copied. Now: mpremote connect $PORT soft-reset run bench_${BOARD}*.py  (see README.md)"
