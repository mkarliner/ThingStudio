# Q4: render the same page in 40-row bands and compare with the full frame.
import sys, gc
import spike_cfg as cfg
MODE = sys.argv[1] if len(sys.argv) > 1 else 'gs4'
cfg.MODE = MODE
import color_setup
from band import Band
import page, state_widgets as sw
import digits48, body16, body20
F = (digits48, body16, body20)

ROWS = 40
full = color_setup.ssd
wf, t = page.build(full, MODE, F)
band = Band(MODE, 320, 240, ROWS)
wb, _ = page.build(band, MODE, F)   # same widgets, bound to the band device

for name, st in (('known', sw.KNOWN), ('unknown', sw.UNKNOWN), ('stale', sw.STALE)):
    full.fill(t['bg'])
    page.draw(full, wf, t, st)
    assembled = bytearray()
    for yoff in range(0, 240, ROWS):
        band.set_band(yoff)
        band.fill(t['bg'])
        page.draw(band, wb, t, st, band=band)
        assembled += band.buf
    same = assembled == full.buf
    ndiff = sum(1 for a, b in zip(assembled, full.buf) if a != b)
    print('%s %s banded == full: %s (%d differing bytes), band buffer %d bytes vs full %d' % (
        MODE, name, same, ndiff, len(band.buf), len(full.buf)))
    if not same:
        cfg.DUMP = 'out/%s_band_%s.raw' % (MODE, name)
        open(cfg.DUMP, 'wb').write(assembled)
