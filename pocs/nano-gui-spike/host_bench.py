# Host check of bench_cyd.py: stub machine + st7789py, capture the RGB565 the
# panel would receive, dump it so render can show what the glass would show.
import sys, time
import spike_cfg as cfg
cfg.BENCH_MODE = sys.argv[1] if len(sys.argv) > 1 else 'gs4'


class _Pin:
    OUT = 1
    def __init__(self, *a, **k): pass
    def value(self, *a): pass


class _SPI:
    def __init__(self, *a, **k): pass


class _machine:
    Pin = _Pin
    SPI = _SPI


sys.modules['machine'] = _machine

GLASS = bytearray(320 * 240 * 2)


class _ST7789:
    def __init__(self, *a, **k): self.win = None; self.pos = 0
    def init(self): pass
    def inversion_mode(self, v): pass
    def set_window(self, x0, y0, x1, y1): self.win = (x0, y0, x1, y1); self.pos = 0
    def write(self, cmd, data):
        if cmd is not None:
            return
        x0, y0, x1, y1 = self.win
        ww = x1 - x0 + 1
        for i in range(0, len(data), 2):
            p = self.pos + i // 2
            x, y = x0 + p % ww, y0 + p // ww
            o = (y * 320 + x) * 2
            GLASS[o] = data[i]; GLASS[o + 1] = data[i + 1]
        self.pos += len(data) // 2


class _st7789py:
    ST7789 = _ST7789
    ST7789_MADCTL = 0x36


sys.modules['st7789py'] = _st7789py
import bench_cyd
open('out/glass_%s.rgb565' % cfg.BENCH_MODE, 'wb').write(GLASS)
