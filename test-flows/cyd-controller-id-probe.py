#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/cyd-controller-id-probe.py
#
# One-shot diagnostic for the open "which controller chip is actually on
# this CYD unit" question (docs/working-notes/cyd-touch-gui-flash-budget-
# briefing.md item 1 / framebuffer-display-node-scoping.md's "CYD
# controller-variant story ... unresolved"). NOT vendored driver code, not
# part of display_spi -- a throwaway probe, safe to delete once the
# variant is confirmed and recorded.
#
# Runs directly on the board via `mpremote ... run` (nothing is copied to
# the board's filesystem). Requires the board already running MicroPython
# (not the runtime/listener -- this talks to the panel directly over raw
# SPI, independent of anything in device-runtime/).
#
# Usage:
#   pip install mpremote   # if not already installed
#   mpremote connect /dev/tty.usbserial-XXXX run test-flows/cyd-controller-id-probe.py
#
# (substitute the real port -- `ls /dev/tty.usb* /dev/cu.usb*` or
# `mpremote connect list` to find it)
#
# Pins below are mischianti.org's documented values for the ESP32-2432S028R
# ("CYD") -- UNVERIFIED against Mike's actual unit, but the only sourced
# numbers on hand (framebuffer-st7789-display-briefing.md,
# framebuffer-display-node-scoping.md). MISO=12 is the one that matters
# here: TiDAL's own wiring has no MISO at all, so this read-back approach
# only works because CYD's does.
#
# What this does: sends several standard ILI9341/ST7789-family "read"
# commands over SPI and prints the raw bytes that come back. It does NOT
# try to guess the answer for you -- different real-world modules are
# inconsistent about implementing these registers at all, so the right
# move is to capture what actually comes back and reason from that,
# rather than have this script assert a verdict it can't actually back.
#
# Commands sent, each printed as -> hex bytes:
#   0x04 RDDID  (Read Display ID)      -- ID1/ID2/ID3, manufacturer-defined
#   0x09 RDDST  (Read Display Status)  -- 4 status bytes, mostly not useful
#                                          for ID but cheap to capture
#   0xDA RDID1, 0xDB RDID2, 0xDC RDID3 -- ILI9341-specific manufacturer/
#                                          version/module ID registers,
#                                          1 byte each
#   0xD3 RDID4  ("IC version")         -- ILI9341/ILI9342-specific; the
#                                          well-known case is the response
#                                          spelling out 0x00 0x93 0x41 for
#                                          the "9341" family. If ST7789,
#                                          this command is not meaningful
#                                          and the response is unpredictable
#                                          -- record it either way.
#
# Interpretation guide (not gospel -- real modules lie about this stuff):
#   - 0xD3 returns 00 93 41            -> strong signal: ILI9341 family
#     (ILI9341 vs ILI9342 doesn't reliably split on this alone -- may need
#     RDID1/2/3 or datasheet cross-check once we're down to those two)
#   - 0xD3 returns something else / all zeros / all 0xFF
#     -> either ST7789, or the read genuinely didn't work (bus float,
#        wrong pins, wrong polarity) -- can't tell those apart from this
#        alone. All-0x00 or all-0xFF across every command below is the
#        "read isn't working" pattern, not "chip identified as X".
#   - 0x04 RDDID's manufacturer byte (ID1, second byte returned): commonly
#     cited as 0x54 for ILI9341-family, 0x85 for ST7789 -- treat as a
#     corroborating signal, not the sole answer, since framing (whether a
#     dummy clock precedes the real data) varies by controller and this
#     script can't know which is correct in advance -- hence it tries both.
#
# Paste the full printed output back rather than summarizing it -- the
# raw bytes are what settles this, not this script's own guesses.

from machine import Pin, SPI
import time

SCK_PIN = 14
MOSI_PIN = 13
MISO_PIN = 12
CS_PIN = 15
DC_PIN = 2

# Deliberately slow -- ID/status reads over SPI on these panels are commonly
# unreliable at the ~55MHz write-only clock mischianti documents for normal
# framebuffer pushes. 1MHz trades speed for read reliability; this script
# only ever sends a handful of bytes so the cost is negligible.
READ_BAUDRATE = 1_000_000

cs = Pin(CS_PIN, Pin.OUT, value=1)
dc = Pin(DC_PIN, Pin.OUT, value=0)
spi = SPI(2, baudrate=READ_BAUDRATE, polarity=0, phase=0,
          sck=Pin(SCK_PIN), mosi=Pin(MOSI_PIN), miso=Pin(MISO_PIN))


def read_reg(cmd, nbytes, dummy_bytes=0):
    """Send a 1-byte command, then read nbytes back, optionally discarding
    dummy_bytes of junk first (some controllers clock out a don't-care byte
    before the real response on a read command)."""
    cs(0)
    dc(0)
    spi.write(bytes([cmd]))
    dc(1)
    if dummy_bytes:
        spi.read(dummy_bytes)
    buf = spi.read(nbytes)
    cs(1)
    time.sleep_ms(2)
    return buf


def show(label, buf):
    hexstr = " ".join("%02X" % b for b in buf)
    print("%-40s -> %s" % (label, hexstr))


print("=== CYD controller-ID probe ===")
print("pins: sck=%d mosi=%d miso=%d cs=%d dc=%d  baudrate=%d" %
      (SCK_PIN, MOSI_PIN, MISO_PIN, CS_PIN, DC_PIN, READ_BAUDRATE))
print()

# Try each read both with and without a leading dummy byte -- framing
# convention isn't something this script can know in advance.
show("0x04 RDDID (no dummy)", read_reg(0x04, 3, dummy_bytes=0))
show("0x04 RDDID (1 dummy)", read_reg(0x04, 3, dummy_bytes=1))
show("0x09 RDDST (no dummy)", read_reg(0x09, 4, dummy_bytes=0))
show("0x09 RDDST (1 dummy)", read_reg(0x09, 4, dummy_bytes=1))
show("0xDA RDID1", read_reg(0xDA, 1, dummy_bytes=0))
show("0xDB RDID2", read_reg(0xDB, 1, dummy_bytes=0))
show("0xDC RDID3", read_reg(0xDC, 1, dummy_bytes=0))
show("0xD3 RDID4 (no dummy)", read_reg(0xD3, 3, dummy_bytes=0))
show("0xD3 RDID4 (1 dummy)", read_reg(0xD3, 4, dummy_bytes=1))

print()
print("=== done -- paste this whole block back ===")
