# color_setup.py -- nano-gui requires a module of this name exporting SSD.
# For the spike, SSD is not a real driver: it is a FrameBuffer over our own
# buffer in display_spi's own frame formats (GS4_HMSB / GS2_HMSB / MONO_HMSB).
# show() dumps the raw buffer -- standing in for "send bytes to display_spi".
import framebuf
import spike_cfg as cfg
from drivers.boolpalette import BoolPalette

_MODES = {'gs4': (framebuf.GS4_HMSB, 2), 'gs2': (framebuf.GS2_HMSB, 4), 'mono': (framebuf.MONO_HMSB, 8)}


class Surface(framebuf.FrameBuffer):
    # nano-gui's colors.py writes a 16-entry RGB565 LUT if the class has `lut`.
    # We keep one so its import works, but the spike uses raw palette indices.
    lut = bytearray(32)

    @staticmethod
    def rgb(r, g, b):  # only used by colors.py; index semantics are ours
        return 0

    def __init__(self, mode, width, height, buf=None, rows=None):
        fmt, ppb = _MODES[mode]
        self.mode = fmt
        self.fmt_name = mode
        self.width = width
        self.height = height
        self.stride = (width + ppb - 1) // ppb
        rows = height if rows is None else rows
        self.buf = bytearray(self.stride * rows) if buf is None else buf
        super().__init__(self.buf, width, rows, fmt)
        self.palette = BoolPalette(fmt)  # CWriter needs device.palette

    def show(self):
        if cfg.DUMP:
            with open(cfg.DUMP, 'wb') as f:
                f.write(self.buf)


SSD = Surface
ssd = Surface(cfg.MODE, cfg.WIDTH, cfg.HEIGHT)
