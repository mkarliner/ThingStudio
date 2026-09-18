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

# `viper` added 2026-09-18 for display_spi's new gs4 frameFormat expansion
# helper (display-spi.ts's own header has the full story) -- the first
# @micropython.viper use in this project's off-device tests. On real
# hardware viper is a native-code emitter with typed ptr8/ptr16/int
# parameter annotations recognized specially by the compiler (never
# evaluated as runtime name lookups); under plain CPython those
# annotation names would raise NameError at function-definition time if
# left undefined, so the test harness itself (not this stub, and NOT the
# codegen output, which never imports ptr8/ptr16 -- real MicroPython
# doesn't need or support that) defines `ptr8`/`ptr16`/`ptr32` as plain
# globals before running generated code. This stub only needs to make
# `@micropython.viper` a no-op passthrough decorator -- the function then
# runs as ordinary interpreted Python, which is semantically identical to
# the real viper-compiled version (viper is a typed SUBSET of Python, not
# a different-behavior dialect), so correctness -- not speed -- is what
# this lets the off-device suite actually verify. Real per-device speed
# still needs a real MicroPython unix-port run or real hardware, same as
# `const()` above never claims to reproduce mpy-cross's real constant
# folding, only its observable behavior.
def viper(f):
    return f
