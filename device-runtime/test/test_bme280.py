# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_bme280.py
#
# The vendored BME280/BMP280 driver (src/vendor/bme280/bme280_float.py) and its local patches, against a
# fake I2C device, under real MicroPython. Calibration and raw values are the Bosch datasheet's worked
# example (BME280 datasheet, section 8.1/8.2: adc_T 519888 -> 25.08 C, adc_P 415148 -> 100653.27 Pa), so
# the compensation maths is checked against published numbers, not just against itself.

import minitest

minitest.add_src_to_path()
import sys

# add_src_to_path() covers src/ only; the driver lives in src/vendor/bme280/ (flattened onto the board).
sys.path.insert(0, [p for p in sys.path if p.endswith("/src")][0] + "/vendor/bme280")

import struct
import uasyncio as asyncio
import bme280_float

T = (27504, 26435, -1000)
P = (36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000)
H1, H2, H3, H4, H5, H6 = 75, 362, 0, 324, 0, 30
ADC_T, ADC_P, ADC_H = 519888, 415148, 30000


class FakeI2C:
    def __init__(self, chip_id=0x60, address=0x76, measuring_polls=0):
        self.address = address
        self.mem = bytearray(256)
        self.mem[0xD0] = chip_id
        self.mem[0x88:0x88 + 26] = struct.pack("<HhhHhhhhhhhhBB", *(T + P + (0, H1)))
        # H4/H5 share a nibble; the driver unpacks "<hBbhb" and unfolds them.
        self.mem[0xE1:0xE1 + 7] = struct.pack("<hBbhb", H2, H3, H4 >> 4, (H5 << 4) | (H4 & 0xF), H6)
        p, t = ADC_P << 4, ADC_T << 4
        self.mem[0xF7:0xFF] = bytes([(p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF, (t >> 16) & 0xFF, (t >> 8) & 0xFF, t & 0xFF, ADC_H >> 8, ADC_H & 0xFF])
        self.measuring_polls = measuring_polls
        self.writes = []

    def _check(self, addr):
        if addr != self.address:
            raise OSError(19)  # ENODEV, what a missing device gives on ESP32

    def readfrom_mem(self, addr, reg, n):
        self._check(addr)
        if reg == 0xF3:
            if self.measuring_polls > 0:
                self.measuring_polls -= 1
                return b"\x08"
            return b"\x00"
        return bytes(self.mem[reg:reg + n])

    def readfrom_mem_into(self, addr, reg, buf):
        self._check(addr)
        buf[:] = self.mem[reg:reg + len(buf)]

    def writeto_mem(self, addr, reg, buf):
        self._check(addr)
        self.writes.append(reg)


def _near(a, b, tol):
    return abs(a - b) <= tol


def test_bme280_reads_datasheet_example():
    dev = bme280_float.BME280(i2c=FakeI2C())
    assert dev.has_humidity
    t, p, h = asyncio.run(dev.read_async())
    assert _near(t, 25.08, 0.01), t
    assert _near(p, 100653.27, 1.0), p
    assert h is not None and 0 <= h <= 100, h


def test_bmp280_has_no_humidity():
    i2c = FakeI2C(chip_id=0x58)
    dev = bme280_float.BME280(i2c=i2c)
    assert not dev.has_humidity
    t, p, h = asyncio.run(dev.read_async())
    assert _near(t, 25.08, 0.01) and _near(p, 100653.27, 1.0)
    assert h is None
    assert 0xF2 not in i2c.writes  # humidity control register never written on a BMP280
    # The original synchronous method still returns its float array, humidity 0 on a BMP280.
    arr = dev.read_compensated_data()
    assert _near(arr[0], 25.08, 0.01) and arr[2] == 0.0


def test_wrong_chip_is_a_clear_error():
    try:
        bme280_float.BME280(i2c=FakeI2C(chip_id=0x55))
        assert False, "expected ValueError"
    except ValueError as e:
        assert "no BME280/BMP280 at 0x76 (chip id 0x55)" in str(e), e


def test_missing_device_raises_oserror():
    try:
        bme280_float.BME280(i2c=FakeI2C(address=0x77), address=0x76)
        assert False, "expected OSError"
    except OSError:
        pass


def test_async_read_waits_for_a_slow_conversion():
    dev = bme280_float.BME280(i2c=FakeI2C(measuring_polls=3))
    t, _, _ = asyncio.run(dev.read_async())
    assert _near(t, 25.08, 0.01)


def test_async_read_gives_up_when_the_sensor_never_finishes():
    dev = bme280_float.BME280(i2c=FakeI2C(measuring_polls=10000))
    try:
        asyncio.run(dev.read_async())
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        assert "not ready" in str(e)


def test_sync_path_unchanged():
    arr = bme280_float.BME280(i2c=FakeI2C()).read_compensated_data()
    assert _near(arr[0], 25.08, 0.01) and _near(arr[1], 100653.27, 1.0)


minitest.run(
    [
        test_bme280_reads_datasheet_example,
        test_bmp280_has_no_humidity,
        test_wrong_chip_is_a_clear_error,
        test_missing_device_raises_oserror,
        test_async_read_waits_for_a_slow_conversion,
        test_async_read_gives_up_when_the_sensor_never_finishes,
        test_sync_path_unchanged,
    ]
)
