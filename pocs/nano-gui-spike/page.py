# page.py -- the hero-app page, hand-placed from a rect table (as the layout
# compiler would emit). build() + draw() are shared by the host run and the
# on-board bench; running this file directly is the host run.
import sys
import spike_cfg as _cfg
if __name__ == '__main__' and len(sys.argv) > 1:
    _cfg.MODE = sys.argv[1]   # must be set before nano-gui imports color_setup
import state_widgets as sw
from gui.widgets.label import Label

# rects: (x, y, w, h) -- what the layout compiler would hand us for 320x240
RECTS = {
    'title':    (0, 0, 320, 28),
    'title_t':  (8, 6, 200, 16),
    'readout':  (8, 40, 220, 54),
    'rd_label': (8, 96, 220, 18),
    'bar':      (262, 36, 44, 150),
    'pressure': (214, 192, 100, 18),
    'led':      (10, 122, 18, 18),
    'led_lbl':  (36, 123, 100, 16),
    'trend_l':  (8, 146, 200, 16),
    'trend':    (8, 164, 200, 50),
    'dots':     (130, 222, 60, 12),
}


def build(dev, mode, fonts):
    from gui.core.writer import CWriter, Writer
    digits48, body16, body20 = fonts
    t = sw.THEMES[mode]
    W = CWriter if hasattr(dev, 'palette') else Writer
    big = W(dev, digits48, verbose=False)
    b16 = W(dev, body16, verbose=False)
    b20 = W(dev, body20, verbose=False)
    w = {}
    tx, ty, tw, th = RECTS['title_t']
    w['title_t'] = Label(b16, ty, tx, tw, bdcolor=False, fgcolor=t['title_fg'], bgcolor=t['accent'])
    w['readout'] = sw.Readout(big, b20, RECTS['readout'], '°C', t)
    x, y, ww, h = RECTS['rd_label']
    w['rd_label'] = Label(b16, y, x, ww, bdcolor=False, fgcolor=t['fg'], bgcolor=t['bg'])
    w['bar'] = sw.Bar(b16, RECTS['bar'], t, 950, 1050)
    w['pressure'] = sw.TextValue(b16, RECTS['pressure'], t, '{:.0f} hPa', align=1)
    w['led'] = sw.StatusLED(b16, RECTS['led'], t)
    x, y, ww, h = RECTS['led_lbl']
    w['led_lbl'] = Label(b16, y, x, ww, bdcolor=False, fgcolor=t['fg'], bgcolor=t['bg'])
    w['dots'] = sw.PageDots(dev, RECTS['dots'], t, 3, 0)
    x, y, ww, h = RECTS['trend_l']
    w['trend_l'] = Label(b16, y, x, ww, bdcolor=False, fgcolor=t['fg'], bgcolor=t['bg'])
    w['trend'] = sw.Trend(dev, RECTS['trend'], t, 15, 25)
    return w, t


def sample_journal():
    """50 clocked samples of a warming room, with a 4-sample gap (sensor went quiet)."""
    import math
    from journal import Journal
    j = Journal(50)
    for i in range(50):
        j.push(None if 30 <= i < 34 else 18 + 3.5 * i / 49 + 0.6 * math.sin(i / 3))
    return j


_JOURNAL = None


def draw(dev, w, t, state, band=None):
    global _JOURNAL
    if _JOURNAL is None:
        _JOURNAL = sample_journal()
    vals = {'readout': 21.5, 'bar': 1013, 'pressure': 1013, 'led': True, 'trend': _JOURNAL}
    for k, v in vals.items():
        w[k].set(v, state)
    items = (
        ('title', lambda: dev.fill_rect(0, 0, 320, 28, t['accent'])),
        ('title_t', lambda: w['title_t'].value('Living room')),
        ('readout', w['readout'].show),
        ('rd_label', lambda: w['rd_label'].value('Temperature')),
        ('bar', w['bar'].show),
        ('pressure', w['pressure'].show),
        ('led', w['led'].show),
        ('led_lbl', lambda: w['led_lbl'].value('MQTT')),
        ('dots', w['dots'].show),
        ('trend_l', lambda: w['trend_l'].value('Last 50 min')),
        ('trend', w['trend'].show),
    )
    for name, fn in items:
        x, y, ww, h = RECTS[name]
        if name == 'bar':
            y, h = y - 8, h + 16  # border + ticks sit just outside the inner meter
        if band is None or band.intersects(y, h):
            fn()


if __name__ == '__main__':
    import sys, time, gc
    import spike_cfg as cfg
    MODE = sys.argv[1] if len(sys.argv) > 1 else 'gs4'
    OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp'
    cfg.MODE = MODE
    gc.collect(); m0 = gc.mem_free()
    import color_setup
    gc.collect(); m_fb = gc.mem_free()
    import gui.core.writer, gui.widgets.meter, gui.widgets.led
    gc.collect(); m_code = gc.mem_free()
    import digits48, body16, body20
    gc.collect(); m_fonts = gc.mem_free()
    dev = color_setup.ssd
    w, t = build(dev, MODE, (digits48, body16, body20))
    gc.collect(); m_widgets = gc.mem_free()
    print('RAM %s: framebuffer %d, nano-gui+widgets code %d, fonts %d, widget objects %d' % (
        MODE, m0 - m_fb, m_fb - m_code, m_code - m_fonts, m_fonts - m_widgets))
    for name, st in (('known', sw.KNOWN), ('unknown', sw.UNKNOWN), ('stale', sw.STALE)):
        dev.fill(t['bg'])
        t0 = time.ticks_us()
        draw(dev, w, t, st)
        dt = time.ticks_diff(time.ticks_us(), t0)
        cfg.DUMP = '%s/%s_%s.raw' % (OUT, MODE, name)
        dev.show()
        print('%s %s full-page draw %d us (host, indicative only)' % (MODE, name, dt))
