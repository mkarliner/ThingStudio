#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/cyd-display-spi-init-probe.py
#
# Diagnostic script, 2026-09-18 -- isolating a real boot-loop (SW_CPU_RESET)
# hit deploying test-flows/display-spi-gs4-cyd-test.flow.json. Not the gs4
# expansion/viper code -- that flow only fires on a manual inject click, so
# neither the viper nor the plain-Python variant of the expand function ever
# actually ran; the crash happens automatically on every boot, which means
# it's in code that runs unconditionally at flow-resume/import time: the
# SPI bus setup + ST7789 construction + init() + inversion_mode() + MADCTL
# write display_spi's own codegen emits as module-level setup statements.
# This is byte-for-byte that same sequence, lifted out of the generated
# flow so it can be run/pasted directly, one line at a time, to see exactly
# where (if anywhere) it dies -- same CYD pins/config as the gs4 test flow
# (test-flows/display-spi-gs4-cyd-test.flow.json), matching this project's
# already-confirmed CYD hardware config (decisions/node-authoring.md's
# 2026-09-18 CYD entries): SPI bus 2, sck=14, mosi=13, dc=2, cs=15,
# reset=None (tied high), backlight=21, 240x320, xstart=0 ystart=0,
# MADCTL=0x4C (BGR|MH|MX), inversion off.
#
# `_resume_flow()` (device-runtime/src/listener.py) wraps the persisted
# flow's `import _flow` in a bare try/except Exception specifically so a
# bad flow can't crash boot -- an ordinary Python-level bug here would be
# caught and printed as LISTENER_BOOT_ERR, not cause a hardware reset. A
# real SW_CPU_RESET getting past that points at a genuine low-level fault
# (illegal instruction, memory fault, or similar), not a catchable bug --
# and this exact init sequence has never actually been exercised through a
# real compiled DEPLOY before now. Every prior CYD display validation
# (cyd-display-test-pattern.py, cyd-display-mh-test.py,
# cyd-display-orientation-test.py) ran via a raw `mpremote run` script,
# never through this project's real wire-protocol DEPLOY + boot-time
# auto-resume path -- so this could be a pre-existing gap unrelated to gs4.
#
# Two ways to use this:
#
# 1. Interactively (recommended for isolating the crash line-by-line):
#      mpremote connect /dev/cu.usbserial-1420
#    then paste each line below in turn at the >>> prompt, one at a time,
#    watching for which one actually crashes the board (vs. any that raise
#    an ordinary catchable Python exception instead).
#
# 2. As a script (faster, but only tells you THAT it crashed, not
#    necessarily mid-line which statement -- the print() calls between
#    steps are there to at least narrow it to a step):
#      mpremote connect /dev/cu.usbserial-1420 run test-flows/cyd-display-spi-init-probe.py
#
# Requires st7789py.py already on the board's filesystem (deploy_runtime.py
# pushes this by default, per test-flows/README.md's "Bootstrapping a new
# board" section -- already done this session to fix the earlier
# never-had-a-runtime issue).

import machine
from st7789py import ST7789, ST7789_MADCTL

print("STEP 1: machine.SPI(...)")
spi = machine.SPI(2, baudrate=40000000, polarity=0, phase=0, sck=machine.Pin(14), mosi=machine.Pin(13))
print("STEP 1 OK")

print("STEP 2: cs/dc/backlight pins")
cs = machine.Pin(15, machine.Pin.OUT)
dc = machine.Pin(2, machine.Pin.OUT)
bl = machine.Pin(21, machine.Pin.OUT)
print("STEP 2 OK")

print("STEP 3: ST7789(...) constructor")
disp = ST7789(spi, 240, 320, None, dc, cs=cs, backlight=bl, xstart=0, ystart=0)
print("STEP 3 OK")

print("STEP 4: disp.init()")
disp.init()
print("STEP 4 OK")

print("STEP 5: disp.inversion_mode(False)")
disp.inversion_mode(False)
print("STEP 5 OK")

print("STEP 6: disp.write(ST7789_MADCTL, bytes([76]))")
disp.write(ST7789_MADCTL, bytes([76]))
print("STEP 6 OK")

print("ALL STEPS COMPLETED -- if you see this, the shared init/driver code is NOT what's crashing.")
