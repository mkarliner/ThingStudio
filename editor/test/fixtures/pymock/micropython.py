# Minimal stand-in for MicroPython's built-in `micropython` module -- only
# `const()` is needed here (st7789py.py/ssd1306.py both use it for register-
# value constant folding at compile time on real hardware; on CPython it's
# a plain no-op passthrough, same as MicroPython's own behavior when a
# module is run without mpy-cross's constant-folding optimization applied
# -- functionally identical either way, just not folded away at "compile"
# time). Added 2026-09-17 for display_spi/display_i2c node tests
# (outstanding-items.md's "[P4] SSD1306 display node") -- the first vendor
# file in this project's off-device tests to import from `micropython`.
def const(x):
    return x
