# bench_cyd.py -- nano-gui spike, on-board numbers for the CYD (Q6, Q7).
# Copy the spike files to the board first (see README.md), then:
#   mpremote connect <port> run bench_cyd.py            # gs4 (default)
#   mpremote connect <port> run bench_cyd_gs2.py        # gs2
#   mpremote connect <port> run bench_cyd_mono.py       # mono
# Prints RAM per stage and timings; shows known / unknown / stale on the glass.
import gc
gc.collect()
_m0 = gc.mem_free()

import time, micropython, array, machine
import spike_cfg as cfg
MODE = getattr(cfg, 'BENCH_MODE', 'gs4')
cfg.MODE = MODE

# ---- display settings: display_spi's confirmed CYD values, landscape ----------
SPI_BUS, BAUD, SCK, MOSI, DC, CS, BL = 2, 27_000_000, 14, 13, 2, 15, 21
W, H = 320, 240
# Confirmed portrait MADCTL is MX|MH|BGR (0x4C). Landscape adds MV; mirror bits
# for landscape are NOT confirmed on this unit. If the page shows mirrored or
# upside down, try the others in this list -- timings and RAM are valid either way.
MADCTL_CANDIDATES = (0x2C, 0x6C, 0xAC, 0xEC)
MADCTL = MADCTL_CANDIDATES[0]


def mem(label, before):
    gc.collect()
    now = gc.mem_free()
    print('RAM  %-34s %7d bytes   (free now %d)' % (label, before - now, now))
    return now


print('--- nano-gui spike bench, mode', MODE, '---')
print('free at start', _m0)
m = mem('bench imports', _m0)

# ---- 1. framebuffer ----------------------------------------------------------
import color_setup               # builds the full-frame Surface for MODE
m = mem('framebuffer + surface class', m)

# ---- 2. nano-gui code + our wrappers -----------------------------------------
import gui.core.nanogui, gui.core.writer, gui.widgets.label, gui.widgets.meter, gui.widgets.led
m = mem('nano-gui core + Label/Meter/LED', m)
import state_widgets as sw, page, band
m = mem('spike wrappers (state widgets, page)', m)

# ---- 3. fonts ------------------------------------------------------------------
import digits48
m = mem('font digits48 (subset .-0..9)', m)
import body16
m = mem('font body16 (ASCII + degree)', m)
import body20
m = mem('font body20 (ASCII + degree)', m)

# ---- 4. widget objects ---------------------------------------------------------
dev = color_setup.ssd
w, t = page.build(dev, MODE, (digits48, body16, body20))
m = mem('widget objects (9 items)', m)

# ---- 5. display + push path (display_spi's own approach) -----------------------
from st7789py import ST7789, ST7789_MADCTL
spi = machine.SPI(SPI_BUS, baudrate=BAUD, polarity=0, phase=0, sck=machine.Pin(SCK), mosi=machine.Pin(MOSI))
disp = ST7789(spi, W, H, None, machine.Pin(DC, machine.Pin.OUT), cs=machine.Pin(CS, machine.Pin.OUT),
              backlight=None, xstart=0, ystart=0)
disp.init()
disp.inversion_mode(False)
disp.write(ST7789_MADCTL, bytes([MADCTL]))
machine.Pin(BL, machine.Pin.OUT).value(1)


def rgb565(r, g, b):
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


PAL = array.array('H', [rgb565(*c) for c in (
    (0, 0, 0), (255, 255, 255), (110, 110, 110), (20, 90, 160),
    (40, 200, 80), (220, 40, 40), (60, 60, 60), (0, 0, 0),
    (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0))])

# Expand loops copied from display_spi's codegen (editor/src/node-library/display-spi.ts).
if MODE == 'gs4':
    @micropython.viper
    def expand(src: ptr8, off: int, stride: int, dst: ptr8, width: int, rows: int, pal: ptr16):
        full = width >> 1
        row_dst_bytes = width * 2
        for r in range(rows):
            s = off + r * stride
            d = r * row_dst_bytes
            for i in range(full):
                b = int(src[s + i])
                c0 = int(pal[b >> 4])
                c1 = int(pal[b & 0x0F])
                j = d + i * 4
                dst[j] = c0 >> 8
                dst[j + 1] = c0 & 0xFF
                dst[j + 2] = c1 >> 8
                dst[j + 3] = c1 & 0xFF
    PPB = 2
elif MODE == 'gs2':
    @micropython.viper
    def expand(src: ptr8, off: int, stride: int, dst: ptr8, width: int, rows: int, pal: ptr16):
        full = width >> 2
        row_dst_bytes = width * 2
        for r in range(rows):
            s = off + r * stride
            d = r * row_dst_bytes
            for i in range(full):
                b = int(src[s + i])
                j = d + i * 8
                for k in range(4):
                    c = int(pal[(b >> (k * 2)) & 0x3])
                    dst[j + k * 2] = c >> 8
                    dst[j + k * 2 + 1] = c & 0xFF
    PPB = 4
else:
    @micropython.viper
    def expand(src: ptr8, off: int, stride: int, dst: ptr8, width: int, rows: int, pal: ptr16):
        full = width >> 3
        row_dst_bytes = width * 2
        for r in range(rows):
            s = off + r * stride
            d = r * row_dst_bytes
            for i in range(full):
                b = int(src[s + i])
                j = d + i * 16
                for k in range(8):
                    c = int(pal[(b >> k) & 0x1])
                    dst[j + k * 2] = c >> 8
                    dst[j + k * 2 + 1] = c & 0xFF
    PPB = 8

ROWS_PER_BATCH = 2
scratch = bytearray(W * 2 * ROWS_PER_BATCH)
m = mem('display driver + push scratch', m)


def push(buf, stride, x, y, w_, h_, yoff=0):
    """Push rect (x, y, w_, h_) of an indexed buffer. x and w_ must be multiples of PPB.
    yoff: screen row of the buffer's row 0 (non-zero for a band)."""
    disp.set_window(x, y, x + w_ - 1, y + h_ - 1)
    row = 0
    while row < h_:
        n = ROWS_PER_BATCH if h_ - row >= ROWS_PER_BATCH else h_ - row
        expand(buf, (y - yoff + row) * stride + x // PPB, stride, scratch, w_, n, PAL)
        disp.write(None, memoryview(scratch)[:w_ * 2 * n])
        row += n


def ms(t0):
    return time.ticks_diff(time.ticks_us(), t0) / 1000


# ---- 6. full page: draw, then push --------------------------------------------
for name, st in (('known', sw.KNOWN), ('unknown', sw.UNKNOWN), ('stale', sw.STALE)):
    dev.fill(t['bg'])
    t0 = time.ticks_us()
    page.draw(dev, w, t, st)
    d_ms = ms(t0)
    t0 = time.ticks_us()
    push(dev.buf, dev.stride, 0, 0, W, H)
    p_ms = ms(t0)
    print('TIME %-8s draw whole page %6.1f ms, push full frame %6.1f ms' % (name, d_ms, p_ms))
    time.sleep(2)

# ---- 7. one readout changes: redraw it, push full vs. its rect only ------------
x, y, rw, rh = page.RECTS['readout']
N = 20
t0 = time.ticks_us()
for i in range(N):
    w['readout'].set(20 + i / 10, sw.KNOWN)
    w['readout'].show()
d_ms = ms(t0) / N
t0 = time.ticks_us()
for i in range(N):
    push(dev.buf, dev.stride, 0, 0, W, H)
full_ms = ms(t0) / N
rx = x - x % PPB
rw2 = ((x + rw + PPB - 1) // PPB) * PPB - rx
t0 = time.ticks_us()
for i in range(N):
    push(dev.buf, dev.stride, rx, y, rw2, rh)
rect_ms = ms(t0) / N
print('TIME readout redraw %.2f ms; push full frame %.1f ms; push readout rect (%dx%d) %.2f ms' % (
    d_ms, full_ms, rw2, rh, rect_ms))

# ---- 7b. trend: one clocked sample in, redraw the trend, push its rect only ------
tx, ty, tw, th = page.RECTS['trend']
j = page._JOURNAL
w['trend'].set(j, sw.KNOWN)
t0 = time.ticks_us()
for i in range(N):
    j.push(20 + (i % 5) / 2)
    w['trend'].show()
d_ms = ms(t0) / N
trx = tx - tx % PPB
trw = ((tx + tw + PPB - 1) // PPB) * PPB - trx
t0 = time.ticks_us()
for i in range(N):
    push(dev.buf, dev.stride, trx, ty, trw, th)
print('TIME trend redraw (%d columns) %.2f ms; push trend rect (%dx%d) %.2f ms' % (
    w['trend'].ncols, d_ms, trw, th, ms(t0) / N))
print('RAM  journal ring, %d entries: ~%d bytes (array of float32)' % (j.n, 4 * j.n))

# ---- 8. banded rendering: 40-row strips, draw + push each ----------------------
del w
gc.collect()
BROWS = 40
before = gc.mem_free()
b = band.Band(MODE, W, H, BROWS)
wb, _ = page.build(b, MODE, (digits48, body16, body20))
mem('band buffer (%d rows) + its widgets' % BROWS, before)
t0 = time.ticks_us()
for yoff in range(0, H, BROWS):
    b.set_band(yoff)
    b.fill(t['bg'])
    page.draw(b, wb, t, sw.KNOWN, band=b)
    push(b.buf, b.stride, 0, yoff, W, BROWS, yoff=yoff)
print('TIME banded draw+push, %d bands of %d rows: %.1f ms' % (H // BROWS, BROWS, ms(t0)))

gc.collect()
print('free at end', gc.mem_free())
print('--- done. Paste everything above into the chat. ---')
