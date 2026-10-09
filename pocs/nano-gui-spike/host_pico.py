import sys
class _Pin:
    OUT = 1
    def __init__(self, *a, **k): pass
class _I2C:
    def __init__(self, *a, **k): pass
    def writeto(self, a, b): pass
    def writevto(self, a, l): pass
class _machine:
    Pin = _Pin
    I2C = _I2C
sys.modules['machine'] = _machine
import bench_pico_oled as b
# dump the OLED framebuffer (MONO_VLSB) as PBM-ish for viewing
open('out/oled.raw', 'wb').write(b.oled.buffer)
