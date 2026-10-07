# Q1: does nano-gui accept rects from outside without moving or overflowing them?
import spike_cfg as cfg
cfg.MODE = 'gs4'
import color_setup
from gui.core.writer import CWriter
from gui.widgets.label import Label
from gui.widgets.led import LED
import body16

dev = color_setup.ssd
wri = CWriter(dev, body16, verbose=False)


def case(desc, fn):
    try:
        r = fn()
        print('%-58s -> %s' % (desc, r))
    except Exception as e:
        print('%-58s -> %s: %s' % (desc, type(e).__name__, e))


# 1. widget whose rect touches the bottom edge exactly (y + h == 240)
case('LED 12px at row 228 (bottom edge exactly)', lambda: (LED(wri, 228, 10, height=12).row))
# 2. touching right edge exactly
case('LED 12px at col 308 (right edge exactly)', lambda: (LED(wri, 10, 308, height=12).col))
# 3. label taller than requested: height comes from the font, not the rect
case('Label in an 10px-high rect: height used', lambda: Label(wri, 0, 0, 50).height)
# 4. text longer than the label width: does it clip at the rect?
def overflow():
    dev.fill(0)
    l = Label(wri, 50, 0, 40, bdcolor=False)
    l.value('Much longer than forty pixels')
    lit = [x for x in range(320) if any(dev.pixel(x, y) for y in range(50, 66))]
    return 'drawn up to x=%d (rect ends at x=39)' % max(lit)
case('Label width 40, long text', overflow)
# 5. default border: where is it drawn?
def border():
    dev.fill(0)
    LED(wri, 100, 100, height=12, bdcolor=1).show()
    lit = [(x, y) for x in range(90, 120) for y in range(90, 120) if dev.pixel(x, y)]
    return 'lit x %d..%d y %d..%d for rect x 100..111' % (min(p[0] for p in lit), max(p[0] for p in lit), min(p[1] for p in lit), max(p[1] for p in lit))
case('LED rect (100,100,12,12) with border', border)
