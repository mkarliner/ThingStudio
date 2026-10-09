# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_ft6336u.py
#
# The FT6336U touch driver (src/vendor/ft6336u/ft6336u.py) against a fake I2C device, under real MicroPython:
# register decoding, clamping, and the swap/flip rotation.

import minitest

minitest.add_src_to_path()
import sys

sys.path.insert(0, [p for p in sys.path if p.endswith("/src")][0] + "/vendor/ft6336u")

import ft6336u


class FakeI2C:
    def __init__(self):
        self.touch = None  # (x, y) or None

    def readfrom_mem_into(self, addr, reg, buf):
        assert addr == 0x38 and reg == 0x02 and len(buf) == 5
        if self.touch is None:
            buf[:] = bytes([0, 0xC0, 0, 0xF0, 0])
        else:
            x, y = self.touch
            buf[:] = bytes([1, 0x80 | ((x >> 8) & 0x0F), x & 0xFF, ((y >> 8) & 0x0F), y & 0xFF])


def _read(touch, **kw):
    i2c = FakeI2C()
    i2c.touch = touch
    return ft6336u.FT6336U(i2c, **kw).read()


def test_no_touch_is_none():
    assert _read(None) is None


def test_a_touch_is_decoded_to_pixels():
    assert _read((100, 400)) == (100, 400)
    assert _read((0, 0)) == (0, 0)
    assert _read((319, 479)) == (319, 479)


def test_out_of_range_is_clamped_to_the_panel():
    assert _read((900, 2000)) == (319, 479)


def test_flip_and_swap():
    assert _read((10, 20), flip_x=True) == (309, 20)
    assert _read((10, 20), flip_y=True) == (10, 459)
    assert _read((10, 20), swap_xy=True) == (20, 10)
    # swap first, then flip within the swapped (480 wide, 320 tall) frame: landscape
    assert _read((10, 20), swap_xy=True, flip_x=True) == (479 - 20, 10)
    assert _read((10, 20), swap_xy=True, flip_y=True) == (20, 319 - 10)


minitest.run([test_no_touch_is_none, test_a_touch_is_decoded_to_pixels, test_out_of_range_is_clamped_to_the_panel, test_flip_and_swap])
