# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/vendor/ft6336u/ft6336u.py
#
# FocalTech FT6336U (and FT6236/FT6206-compatible) capacitive touch controller, over I2C, address 0x38.
# Thingstudio's own small driver: it reports ONE touch point, as screen pixels, and nothing else (no gestures,
# no second finger). The controller reports panel coordinates directly, so there is no calibration step;
# swap_xy / flip_x / flip_y turn them into the display's orientation.
#
# read() -> None when nothing touches the panel, else (x, y).
# Register map (datasheet): 0x02 TD_STATUS (low nibble = touch count), 0x03..0x06 = XH, XL, YH, YL where the
# top two bits of XH are an event flag and the low nibble is the high part of the 12-bit coordinate.

_REG_POINTS = 0x02


class FT6336U:
    def __init__(self, i2c, address=0x38, rst=None, width=320, height=480, swap_xy=False, flip_x=False, flip_y=False):
        self.i2c = i2c
        self.address = address
        self.width = width  # the panel's own size, before swap_xy
        self.height = height
        self.swap_xy = swap_xy
        self.flip_x = flip_x
        self.flip_y = flip_y
        self._buf = bytearray(5)
        if rst is not None:
            import time
            rst.value(0)
            time.sleep_ms(10)
            rst.value(1)
            time.sleep_ms(120)

    def read(self):
        b = self._buf
        self.i2c.readfrom_mem_into(self.address, _REG_POINTS, b)
        if (b[0] & 0x0F) == 0:
            return None
        x = ((b[1] & 0x0F) << 8) | b[2]
        y = ((b[3] & 0x0F) << 8) | b[4]
        w, h = self.width, self.height
        if x >= w:
            x = w - 1
        if y >= h:
            y = h - 1
        if self.swap_xy:
            x, y = y, x
            w, h = h, w
        if self.flip_x:
            x = w - 1 - x
        if self.flip_y:
            y = h - 1 - y
        return x, y
