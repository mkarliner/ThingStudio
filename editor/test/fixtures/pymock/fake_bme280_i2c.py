# A fake I2C bus with a BME280 (or BMP280, or wrong chip) on it, for node-bme280.test.ts. Register contents are
# the Bosch datasheet's worked example (adc_T 519888 -> 25.08 C, adc_P 415148 -> 100653.27 Pa); same fixture
# shape as device-runtime/test/test_bme280.py. Set `present = False` to simulate an unplugged sensor.
import struct

T = (27504, 26435, -1000)
P = (36477, -10685, 3024, 2855, 140, -7, 15500, -14600, 6000)
H1, H2, H3, H4, H5, H6 = 75, 362, 0, 324, 0, 30
ADC_T, ADC_P, ADC_H = 519888, 415148, 30000


class FakeI2C:
    def __init__(self, chip_id=0x60, address=0x76):
        self.address = address
        self.present = True
        self.mem = bytearray(256)
        self.mem[0xD0] = chip_id
        self.mem[0x88:0x88 + 26] = struct.pack("<HhhHhhhhhhhhBB", *(T + P + (0, H1)))
        self.mem[0xE1:0xE1 + 7] = struct.pack("<hBbhb", H2, H3, H4 >> 4, (H5 << 4) | (H4 & 0xF), H6)
        p, t = ADC_P << 4, ADC_T << 4
        self.mem[0xF7:0xFF] = bytes([(p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF, (t >> 16) & 0xFF, (t >> 8) & 0xFF, t & 0xFF, ADC_H >> 8, ADC_H & 0xFF])

    def _check(self, addr):
        if not self.present or addr != self.address:
            raise OSError(19)

    def readfrom_mem(self, addr, reg, n):
        self._check(addr)
        return b"\x00" if reg == 0xF3 else bytes(self.mem[reg:reg + n])

    def readfrom_mem_into(self, addr, reg, buf):
        self._check(addr)
        buf[:] = self.mem[reg:reg + len(buf)]

    def writeto_mem(self, addr, reg, buf):
        self._check(addr)
