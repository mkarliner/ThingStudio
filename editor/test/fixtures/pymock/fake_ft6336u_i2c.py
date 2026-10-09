# A fake I2C bus with an FT6336U touch controller at 0x38, for node-touch-i2c.test.ts. Set `touch = (x, y)` for
# a finger down at panel coordinates, `touch = None` for none, `present = False` for an unplugged panel.
class FakeI2C:
    def __init__(self, address=0x38):
        self.address = address
        self.present = True
        self.touch = None

    def readfrom_mem_into(self, addr, reg, buf):
        if not self.present or addr != self.address:
            raise OSError(19)
        assert reg == 0x02 and len(buf) == 5
        if self.touch is None:
            buf[:] = bytes([0, 0xC0, 0, 0xF0, 0])  # no touches; event flag "none"
        else:
            x, y = self.touch
            buf[:] = bytes([1, (x >> 8) & 0x0F, x & 0xFF, (y >> 8) & 0x0F, y & 0xFF])
