# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/st7796py/st7796py.py
#
# ST7796 / ST7796S SPI colour TFT (320x480): the ST77xx base class from st7789py, plus this controller's own
# start-up sequence. Written for Thingstudio, not copied from a driver: the register values are the ones the
# widely used TFT_eSPI (ST7796_Init.h) and Arduino_GFX ST7796 drivers send. See README.md.
#
# Same use as ST7789 in display_spi's generated code: construct, init(), then display_spi writes MADCTL and
# the inversion setting itself.

import time

from st7789py import ST77xx, ST77XX_DISPON, ST77XX_SLPOUT, ST77XX_SWRESET, ST77XX_COLMOD

_CMD_SET_ENABLE = 0xF0  # command-set control: 0xC3 then 0x96 unlocks the extended registers, 0x3C then 0x69 locks

# (command, data bytes, delay in ms afterwards)
_INIT = (
    (_CMD_SET_ENABLE, b"\xc3", 0),
    (_CMD_SET_ENABLE, b"\x96", 0),
    (0x36, b"\x48", 0),  # MADCTL; display_spi overwrites it after init
    (0xB4, b"\x01", 0),  # display inversion control: 1-dot
    (0xB6, b"\x80\x02\x3b", 0),  # display function control
    (0xE8, b"\x40\x8a\x00\x00\x29\x19\xa5\x33", 0),  # display output control adjust
    (0xC1, b"\x06", 0),  # power control 2
    (0xC2, b"\xa7", 0),  # power control 3
    (0xC5, b"\x18", 120),  # VCOM
    (0xE0, b"\xf0\x09\x0b\x06\x04\x15\x2f\x54\x42\x3c\x17\x14\x18\x1b", 0),  # positive gamma
    (0xE1, b"\xe0\x09\x0b\x06\x04\x03\x2b\x43\x42\x3b\x16\x14\x17\x1b", 120),  # negative gamma
    (_CMD_SET_ENABLE, b"\x3c", 0),
    (_CMD_SET_ENABLE, b"\x69", 120),
)


class ST7796(ST77xx):
    def __init__(self, spi, width, height, reset, dc, cs=None, backlight=None, xstart=-1, ystart=-1):
        # The glass is the controller's own size, with no offset: a negative offset means 0, not a table lookup.
        super().__init__(spi, width, height, reset, dc, cs, backlight, xstart if xstart >= 0 else 0, ystart if ystart >= 0 else 0)

    def init(self):
        if self.reset is not None:
            self.hard_reset()
        self.write(ST77XX_SWRESET)
        time.sleep_ms(120)
        self.write(ST77XX_SLPOUT)
        time.sleep_ms(120)
        for command, data, wait in _INIT:
            self.write(command, data)
            if wait:
                time.sleep_ms(wait)
        self.write(ST77XX_COLMOD, b"\x55")  # 16 bits per pixel
        self.fill(0)
        self.write(ST77XX_DISPON)
        time.sleep_ms(120)
