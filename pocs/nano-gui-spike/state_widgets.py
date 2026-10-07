# state_widgets.py -- unknown / known / stale on top of nano-gui widgets (Q3).
# Each class records how much of nano-gui it reuses and what it had to replace.
import math
from gui.core.nanogui import DObject
from gui.widgets.label import Label, ALIGN_RIGHT, ALIGN_LEFT
from gui.widgets.meter import Meter
from gui.widgets.led import LED

UNKNOWN, KNOWN, STALE = 0, 1, 2

# Palette indices per frame format. gs4 has 16 slots, gs2 4, mono 2.
# 'dim' is None where the format has no spare tone: stale then uses a pattern.
THEMES = {
    'gs4': dict(bg=0, fg=1, dim=2, accent=3, ok=4, alarm=5, track=6, title_fg=1),
    'gs2': dict(bg=0, fg=1, dim=2, accent=3, ok=1, alarm=1, track=2, title_fg=1),
    'mono': dict(bg=0, fg=1, dim=None, accent=1, ok=1, alarm=1, track=1, title_fg=0),
}


def dashed_hline(dev, x, y, w, c, on=2, off=2):
    i = 0
    while i < w:
        dev.hline(x + i, y, min(on, w - i), c)
        i += on + off


def dashed_vline(dev, x, y, h, c, on=2, off=2):
    i = 0
    while i < h:
        dev.vline(x, y + i, min(on, h - i), c)
        i += on + off


def dashed_rect(dev, x, y, w, h, c):
    dashed_hline(dev, x, y, w, c)
    dashed_hline(dev, x, y + h - 1, w, c)
    dashed_vline(dev, x, y, h, c)
    dashed_vline(dev, x + w - 1, y, h, c)


def dashed_circle(dev, cx, cy, r, c, step=20):
    # plot alternate arcs: 'step' degrees on, 'step' off
    a = 0
    while a < 360:
        for d in range(0, step, 3):
            t = math.radians(a + d)
            dev.pixel(int(cx + r * math.cos(t)), int(cy + r * math.sin(t)), c)
        a += 2 * step


def dotted_underline(dev, x, y, w, c):
    dashed_hline(dev, x, y, w, c, on=1, off=2)


class Readout:
    """Big number + units. Pure composition of two nano-gui Labels; no subclassing.

    Rect (x, y, w, h) comes from the layout compiler. The value Label is
    right-aligned in the space left of the units, top-aligned in the rect.
    """
    def __init__(self, big_wri, units_wri, rect, units, theme, fmt='{:.1f}'):
        x, y, w, h = rect
        self.rect = rect
        self.theme = theme
        self.fmt = fmt
        uw = units_wri.stringlen(units) + 4
        self.value_lbl = Label(big_wri, y, x, w - uw, bdcolor=False, align=ALIGN_RIGHT,
                               fgcolor=theme['fg'], bgcolor=theme['bg'])
        self.units_lbl = Label(units_wri, y + 4, x + w - uw + 4, units, bdcolor=False,
                               fgcolor=theme['fg'], bgcolor=theme['bg'])
        self.dev = big_wri.device
        self.state = UNKNOWN
        self.v = None

    def set(self, v, state):
        self.v, self.state = v, state

    def show(self):
        t = self.theme
        x, y, w, h = self.rect
        self.dev.fill_rect(x, y, w, h, t['bg'])  # clear whole rect, incl. underline row
        if self.state == UNKNOWN:
            self.value_lbl.value('--', fgcolor=t['fg'])
            self.units_lbl.value(fgcolor=t['fg'])
            return
        txt = self.fmt.format(self.v)
        if self.state == STALE and t['dim'] is not None:
            self.value_lbl.value(txt, fgcolor=t['dim'])
            self.units_lbl.value(fgcolor=t['dim'])
        else:
            self.value_lbl.value(txt, fgcolor=t['fg'])
            self.units_lbl.value(fgcolor=t['fg'])
            if self.state == STALE:  # mono: pattern, not tone
                dotted_underline(self.dev, x, y + h - 2, w, t['fg'])


class TextValue:
    """Bound label (e.g. '1013 hPa'). Composition over one Label."""
    def __init__(self, wri, rect, theme, fmt, align=ALIGN_LEFT):
        x, y, w, h = rect
        self.rect, self.theme, self.fmt = rect, theme, fmt
        self.lbl = Label(wri, y, x, w, bdcolor=False, align=align, fgcolor=theme['fg'], bgcolor=theme['bg'])
        self.dev = wri.device
        self.state, self.v = UNKNOWN, None

    def set(self, v, state):
        self.v, self.state = v, state

    def show(self):
        t = self.theme
        x, y, w, h = self.rect
        self.dev.fill_rect(x, y, w, h, t['bg'])
        if self.state == UNKNOWN:
            self.lbl.value(self.fmt.replace('{}', '--').replace('{:.0f}', '--'), fgcolor=t['fg'])
            return
        stale_dim = self.state == STALE and t['dim'] is not None
        self.lbl.value(self.fmt.format(self.v), fgcolor=t['dim'] if stale_dim else t['fg'])
        if self.state == STALE and t['dim'] is None:
            dotted_underline(self.dev, x, y + h - 1, w, t['fg'])


class Bar(Meter):
    """Vertical bar. Subclasses nano-gui Meter but replaces show() entirely:
    Meter's BAR style is a fixed 4px stripe, and show() crashes on a None value.
    What survives from Meter: __init__ (rect, colours, DObject border logic)."""
    def __init__(self, wri, rect, theme, lo, hi):
        x, y, w, h = rect
        # Set before super(): Meter.__init__ calls value() -> show(), i.e. it draws on construction.
        self.theme, self.lo, self.hi = theme, lo, hi
        self.state, self.v = UNKNOWN, None
        # DObject draws borders 2px OUTSIDE the rect, so inset by 2 to stay inside our rect.
        super().__init__(wri, y + 2, x + 2, height=h - 4, width=w - 4, fgcolor=theme['fg'],
                         bgcolor=theme['bg'], bdcolor=theme['fg'], ptcolor=theme['fg'], divisions=4,
                         style=Meter.BAR, value=0)
        self.theme, self.lo, self.hi = theme, lo, hi
        self.state, self.v = UNKNOWN, None

    def set(self, v, state):
        self.v, self.state = v, state

    def show(self):
        t = self.theme
        dev = self.device
        x, y, w, h = self.col, self.row, self.width, self.height
        dev.fill_rect(x - 2, y - 2, w + 4, h + 4, t['bg'])
        if self.state == UNKNOWN:
            dashed_rect(dev, x - 2, y - 2, w + 4, h + 4, t['fg'])
            return
        DObject.show(self)  # bg + solid border, reused from nano-gui
        frac = min(1, max(0, (self.v - self.lo) / (self.hi - self.lo)))
        bh = int(frac * (h - 2))
        top = y + h - 1 - bh
        if self.state == STALE and t['dim'] is not None:
            dev.fill_rect(x + 1, top, w - 2, bh, t['dim'])
        elif self.state == STALE:  # mono: hatch the bar
            for yy in range(top, top + bh):
                if yy % 2 == 0:
                    dev.hline(x + 1, yy, w - 2, t['fg'])
        else:
            dev.fill_rect(x + 1, top, w - 2, bh, t['fg'])
        for k in range(1, 4):  # ticks on the left edge
            dev.hline(x - 6, y + (h * k) // 4, 4, t['fg'])


class StatusLED(LED):
    """Reuses nano-gui LED for known; overrides show() for unknown and stale."""
    def __init__(self, wri, rect, theme):
        x, y, w, h = rect
        super().__init__(wri, y, x, height=h, fgcolor=theme['ok'], bgcolor=theme['bg'], bdcolor=False)
        self.theme = theme
        self.state, self.v = UNKNOWN, None

    def set(self, v, state):
        self.v, self.state = v, state

    def show(self):
        t = self.theme
        r = self.radius
        cx, cy = self.col + r, self.row + r
        self.device.fill_rect(self.col, self.row, self.height, self.height, t['bg'])
        if self.state == UNKNOWN:
            dashed_circle(self.device, cx, cy, r - 1, t['fg'])
            return
        on = t['ok'] if self.v else t['alarm']
        if self.state == STALE and t['dim'] is not None:
            on = t['dim']
        self.fgcolor = on
        LED.show(self)  # nano-gui draws the filled disc
        if self.state == STALE and t['dim'] is None:  # mono: hollow ring = stale
            self.device.ellipse(cx, cy, r - 3, r - 3, t['bg'], True)


class PageDots:
    """No nano-gui equivalent: plain framebuf."""
    def __init__(self, dev, rect, theme, n, cur):
        self.dev, self.rect, self.theme, self.n, self.cur = dev, rect, theme, n, cur

    def show(self):
        x, y, w, h = self.rect
        t = self.theme
        self.dev.fill_rect(x, y, w, h, t['bg'])
        r = h // 2 - 1
        gap = w // self.n
        for i in range(self.n):
            cx = x + gap // 2 + i * gap
            self.dev.ellipse(cx, y + h // 2, r, r, t['fg'], i == self.cur)


class Trend:
    """Moving histogram. Pure view over a journal (journal.py): one column per entry,
    newest on the right. No nano-gui code. Gaps (NaN) draw as a baseline tick only.
    Widget-level states: unknown = no history yet (dashed outline); stale = the journal
    has stopped receiving (dimmed columns, or hatched in mono)."""
    def __init__(self, dev, rect, theme, lo, hi, col_w=4):
        self.dev, self.rect, self.theme, self.lo, self.hi = dev, rect, theme, lo, hi
        self.col_w = col_w
        self.ncols = rect[2] // col_w
        self.state, self.j = UNKNOWN, None

    def set(self, journal, state):
        self.j, self.state = journal, state

    def show(self):
        t = self.theme
        x, y, w, h = self.rect
        dev = self.dev
        dev.fill_rect(x, y, w, h, t['bg'])
        j = self.j
        if self.state == UNKNOWN or j is None or j.count == 0:
            dashed_rect(dev, x, y, w, h, t['fg'])
            return
        base = y + h - 1
        dev.hline(x, base, w, t['track'])
        dim = self.state == STALE and t['dim'] is not None
        hatch = self.state == STALE and t['dim'] is None
        colour = t['dim'] if dim else t['fg']
        n = min(j.count, self.ncols)
        first = j.count - n
        x0 = x + w - n * self.col_w      # right-align: newest column at the right edge
        span = self.hi - self.lo
        cw = self.col_w - 1              # 1px gap between columns
        for i in range(n):
            v = j.get(first + i)
            cx = x0 + i * self.col_w
            if v != v:                   # NaN: a gap in the record
                dev.hline(cx, base - 2, cw, t['fg'])
                continue
            bh = int((min(self.hi, max(self.lo, v)) - self.lo) / span * (h - 2))
            if bh < 1:
                bh = 1
            if hatch:
                for yy in range(base - bh, base):
                    if yy % 2 == 0:
                        dev.hline(cx, yy, cw, t['fg'])
            else:
                dev.fill_rect(cx, base - bh, cw, bh, colour)
