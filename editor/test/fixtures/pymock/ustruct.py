# Minimal stand-in for MicroPython's `ustruct` module -- a straight
# passthrough to CPython's real stdlib `struct` module, which is what
# `ustruct` actually is on real MicroPython too (a size-reduced port of
# the same functionality, same public API for everything this project's
# vendored drivers actually use). Added 2026-09-17 alongside
# micropython.py, for st7789py.py's `import ustruct as struct`
# (outstanding-items.md's "[P4] SSD1306 display node").
from struct import *  # noqa: F401,F403
