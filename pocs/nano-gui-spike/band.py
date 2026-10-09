# band.py -- a strip framebuffer that presents itself as the full screen.
# Widgets draw in screen coordinates; every primitive is translated by -yoff
# and framebuf's own C clipping discards whatever falls outside the strip.
# Q4 of the spike: can nano-gui widgets draw into a band without changes?
import framebuf
from color_setup import Surface


class Band(Surface):
    def __init__(self, mode, width, height, band_rows):
        super().__init__(mode, width, height, rows=band_rows)
        self.band_rows = band_rows
        self.yoff = 0

    def set_band(self, yoff):
        self.yoff = yoff

    def fill(self, c):
        super().fill(c)

    def pixel(self, x, y, c=None):
        if c is None:
            return super().pixel(x, y - self.yoff)
        super().pixel(x, y - self.yoff, c)

    def hline(self, x, y, w, c):
        super().hline(x, y - self.yoff, w, c)

    def vline(self, x, y, h, c):
        super().vline(x, y - self.yoff, h, c)

    def line(self, x1, y1, x2, y2, c):
        super().line(x1, y1 - self.yoff, x2, y2 - self.yoff, c)

    def rect(self, x, y, w, h, c, f=False):
        super().rect(x, y - self.yoff, w, h, c, f)

    def fill_rect(self, x, y, w, h, c):
        super().fill_rect(x, y - self.yoff, w, h, c)

    def ellipse(self, x, y, xr, yr, c, f=False, m=15):
        super().ellipse(x, y - self.yoff, xr, yr, c, f, m)

    def poly(self, x, y, coords, c, f=False):
        super().poly(x, y - self.yoff, coords, c, f)

    def text(self, s, x, y, c=1):
        super().text(s, x, y - self.yoff, c)

    def blit(self, src, x, y, key=-1, palette=None):
        super().blit(src, x, y - self.yoff, key, palette)

    def intersects(self, y, h):
        return y < self.yoff + self.band_rows and y + h > self.yoff
