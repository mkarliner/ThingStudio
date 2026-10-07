#!/bin/sh
# Regenerate the spike's fonts. Needs a font_to_py checkout and `pip install freetype-py`,
# plus mpy-cross. DejaVu is a stand-in; the real font is an open question.
#   FONT_TO_PY=~/src/micropython-font-to-py/font_to_py.py MPY_CROSS=mpy-cross FONT_DIR=/path/to/dejavu ./make_fonts.sh
set -e
: "${FONT_TO_PY:?set FONT_TO_PY}"; : "${MPY_CROSS:=mpy-cross}"; : "${FONT_DIR:?set FONT_DIR (folder with DejaVuSans*.ttf)}"
ASCII_DEG=$(python3 -c "print(''.join(chr(c) for c in range(32,127))+'°')")
mkdir -p fonts_src fonts
python3 "$FONT_TO_PY" -x -c '0123456789.-' "$FONT_DIR/DejaVuSans-Bold.ttf" 48 fonts_src/digits48.py
python3 "$FONT_TO_PY" -x -c '0123456789.-' "$FONT_DIR/DejaVuSans-Bold.ttf" 32 fonts_src/digits32.py
python3 "$FONT_TO_PY" -x -c '0123456789.-' "$FONT_DIR/DejaVuSans-Bold.ttf" 24 fonts_src/digits24.py
python3 "$FONT_TO_PY" -x "$FONT_DIR/DejaVuSans-Bold.ttf" 48 fonts_src/full48.py
for s in 10 16 20; do python3 "$FONT_TO_PY" -x -c "$ASCII_DEG" "$FONT_DIR/DejaVuSans.ttf" $s fonts_src/body$s.py; done
for f in fonts_src/*.py; do "$MPY_CROSS" -o "fonts/$(basename "$f" .py).mpy" "$f"; done
