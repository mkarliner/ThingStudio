# RM68090 (also ILI9325/ILI9328) 240x320 TFT on an 8-bit parallel bus, for a classic ESP32.
# Built for the common 2.4" Arduino-Uno "MCUFRIEND" shield on a Wemos D1 R32.
#
# Input: the same frames as Thingstudio's display spi node. Without msg['y'], payload is a whole frame; with it,
# payload is whole rows starting at row y (what a gui screen sends). RGB565 frames are big-endian, as for display spi.
#
# The register values are the ones MCUFRIEND_kbv (github.com/prenticedavid/MCUFRIEND_kbv) sends for ID 0x6809;
# only the sequence is shared, no code is copied. The bus is driven through the ESP32's GPIO set/clear registers
# from viper code, so the data, WR, RS and RD pins must all be GPIO 0-31.

import array
import machine
import micropython
import sys
import time

_NAME = 'rm68090'

# Classic ESP32 GPIO registers. Other chips (S2/S3/C3) put these elsewhere.
# (The viper functions below repeat the two OUT addresses as literals: viper can't read enclosing variables.)
# Addresses from ESP-IDF's components/soc/esp32/register/soc/gpio_reg.h (GPIO base 0x3FF44000).
_OUT_W1TS = 0x3FF44008  # GPIO_OUT_W1TS_REG
_OUT_W1TC = 0x3FF4400C  # GPIO_OUT_W1TC_REG
_EN_W1TS = 0x3FF44024  # GPIO_ENABLE_W1TS_REG: start driving these pins
_EN_W1TC = 0x3FF44028  # GPIO_ENABLE_W1TC_REG: stop driving them (0x3FF44020 is GPIO_ENABLE_REG: never write it)
_IN = 0x3FF4403C  # GPIO_IN_REG

_chip = sys.implementation._machine.split(' with ')[-1].upper().replace('-', '')
if _chip != 'ESP32':
    raise OSError('%s: needs a classic ESP32, this is %s' % (_NAME, _chip))

_data = [int(properties['d%d' % i]) for i in range(8)]
_wr = int(properties['wr'])
_rd = int(properties['rd'])
_rs = int(properties['rs'])
_cs = int(properties['cs'])
_rst = int(properties['rst'])
for _p in _data + [_wr, _rd, _rs]:
    if not 0 <= _p <= 31:
        raise ValueError('%s: data, WR, RD and RS must be GPIO 0-31, got %d' % (_NAME, _p))
_all = _data + [_wr, _rd, _rs, _cs] + ([_rst] if _rst >= 0 else [])
if len(set(_all)) != len(_all):
    raise ValueError('%s: every bus pin must be a different GPIO' % _NAME)


def _out(n):
    return runtime.shared('pin', n, ('out', 'none'), lambda: machine.Pin(n, machine.Pin.OUT))


_pins = {n: _out(n) for n in _all}
_pins[_rd].value(1)
_pins[_wr].value(1)
_pins[_cs].value(1)

_DATA_MASK = 0
for _p in _data:
    _DATA_MASK |= 1 << _p
_WR_BIT = 1 << _wr
_RS_BIT = 1 << _rs

# byte value -> the GPIO set mask that puts it on D0-D7
_lut = array.array('I', [0] * 256)
for _v in range(256):
    _m = 0
    for _i in range(8):
        if _v & (1 << _i):
            _m |= 1 << _data[_i]
    _lut[_v] = _m

# [clear mask (data bits and WR, so WR goes low with the new byte), WR bit]
_ctl = array.array('I', [_DATA_MASK | _WR_BIT, _WR_BIT])


@micropython.viper
def _send(buf: ptr8, n: int, lut: ptr32, ctl: ptr32):
    w1ts = ptr32(0x3FF44008)
    w1tc = ptr32(0x3FF4400C)
    clr = ctl[0]
    wr = ctl[1]
    i = 0
    while i < n:
        w1tc[0] = clr
        w1ts[0] = lut[buf[i]]
        w1ts[0] = wr  # rising edge latches the byte
        i += 1


@micropython.viper
def _fill(hi: int, lo: int, count: int, ctl: ptr32):
    w1ts = ptr32(0x3FF44008)
    w1tc = ptr32(0x3FF4400C)
    clr = ctl[0]
    wr = ctl[1]
    i = 0
    while i < count:
        w1tc[0] = clr
        w1ts[0] = hi
        w1ts[0] = wr
        w1tc[0] = clr
        w1ts[0] = lo
        w1ts[0] = wr
        i += 1


_two = bytearray(2)


def _word(v):
    _two[0] = v >> 8
    _two[1] = v & 0xFF
    _send(_two, 2, _lut, _ctl)


def _cmd(reg):
    machine.mem32[_OUT_W1TC] = _RS_BIT
    _word(reg)
    machine.mem32[_OUT_W1TS] = _RS_BIT


def _reg(reg, value):
    _cmd(reg)
    _word(value)


def _read_byte():
    machine.mem32[_OUT_W1TC] = 1 << _rd
    time.sleep_us(1)
    raw = machine.mem32[_IN]
    machine.mem32[_OUT_W1TS] = 1 << _rd
    v = 0
    for i in range(8):
        if raw & (1 << _data[i]):
            v |= 1 << i
    return v


def _read_reg(reg):
    _cmd(reg)
    machine.mem32[_EN_W1TC] = _DATA_MASK  # stop driving D0-D7 so the panel can
    try:
        time.sleep_us(1)
        hi = _read_byte()
        lo = _read_byte()
    finally:
        machine.mem32[_EN_W1TS] = _DATA_MASK
    return (hi << 8) | lo


# (register, value) pairs; a None register is a delay in ms. From MCUFRIEND_kbv's ILI9325 table, used for 0x6809.
_INIT = (
    (0xE5, 0x78F0), (0x01, 0x0100), (0x02, 0x0200), (0x03, 0x1030), (0x04, 0x0000), (0x05, 0x0000),
    (0x08, 0x0207), (0x09, 0x0000), (0x0A, 0x0000), (0x0C, 0x0000), (0x0D, 0x0000), (0x0F, 0x0000),
    (0x10, 0x0000), (0x11, 0x0007), (0x12, 0x0000), (0x13, 0x0000), (0x07, 0x0001), (None, 200),
    (0x10, 0x1690), (0x11, 0x0227), (None, 50), (0x12, 0x000D), (None, 50),
    (0x13, 0x1200), (0x29, 0x000A), (0x2B, 0x000D), (None, 50), (0x20, 0x0000), (0x21, 0x0000),
    (0x30, 0x0000), (0x31, 0x0404), (0x32, 0x0003), (0x35, 0x0405), (0x36, 0x0808), (0x37, 0x0407),
    (0x38, 0x0303), (0x39, 0x0707), (0x3C, 0x0504), (0x3D, 0x0808),
    (0x60, 0x2700), (0x61, 0x0001), (0x6A, 0x0000),
    (0x80, 0x0000), (0x81, 0x0000), (0x82, 0x0000), (0x83, 0x0000), (0x84, 0x0000), (0x85, 0x0000),
    (0x90, 0x0010), (0x92, 0x0000), (0x07, 0x0133),
)
_IDS = (0x6809, 0x9325, 0x9328)

# rotation -> (gate scan GS, source shift SS, address mode AM): MCUFRIEND's setRotation for this controller
_ROT = {'0': (1, 1, 0), '90': (1, 0, 1), '180': (0, 0, 0), '270': (0, 1, 1)}
_rot = str(properties['rotation'])
if _rot not in _ROT:
    raise ValueError('%s: rotation must be 0, 90, 180 or 270, got %r' % (_NAME, _rot))
_gs, _ss, _am = _ROT[_rot]
_W, _H = (320, 240) if _am else (240, 320)

_fmt = str(properties['frameFormat'])
_PPB = {'rgb565': 0, 'gs4': 2, 'gs2': 4, 'mono': 8}
if _fmt not in _PPB:
    raise ValueError('%s: frame format must be rgb565, gs4, gs2 or mono, got %r' % (_NAME, _fmt))
_stride = _W * 2 if _fmt == 'rgb565' else (_W + _PPB[_fmt] - 1) // _PPB[_fmt]

_pal = array.array('H', [0] * 16)
if _fmt != 'rgb565':
    _words = str(properties['palette']).replace(',', ' ').split()
    try:
        _vals = [int(w, 16) for w in _words]
    except ValueError:
        _vals = []
    if len(_vals) != 16 or not all(0 <= v <= 0xFFFF for v in _vals):
        raise ValueError('%s: palette must be 16 RGB565 hex values, like 0000 ffff f800 ...' % _NAME)
    for _i in range(16):
        _pal[_i] = _vals[_i]

# --- start the panel
_pins[_cs].value(0)  # this node is the bus's only user, so CS stays low
if _rst >= 0:
    _pins[_rst].value(1)
    time.sleep_ms(50)
    _pins[_rst].value(0)
    time.sleep_ms(100)
    _pins[_rst].value(1)
    time.sleep_ms(100)
_reg(0xB0, 0x0000)
if properties['checkId']:
    _id = _read_reg(0x00)
    if _id not in _IDS:
        if _id in (0x0000, 0xFFFF):
            raise OSError('%s: no reply from the panel (ID 0x%04X). Check the shield wiring and the RS/CS/RST mods.' % (_NAME, _id))
        raise OSError('%s: panel controller is 0x%04X, not an RM68090 or ILI9325/9328.' % (_NAME, _id))
for _r, _v in _INIT:
    if _r is None:
        time.sleep_ms(_v)
    else:
        _reg(_r, _v)
_reg(0x01, _ss << 8)
_reg(0x60, (_gs << 15) | 0x2700)
_reg(0x03, (0x1000 if properties['colorOrder'] == 'bgr' else 0) | (_am << 3) | 0x0030)
_reg(0x61, 0x0000 if properties['invertColors'] else 0x0001)


def _window(y0, rows):
    y1 = y0 + rows - 1
    if _am:  # landscape: x runs along the panel's vertical address
        _reg(0x52, 0); _reg(0x53, _W - 1); _reg(0x50, y0); _reg(0x51, y1)
        _reg(0x21, 0); _reg(0x20, y0)
    else:
        _reg(0x50, 0); _reg(0x51, _W - 1); _reg(0x52, y0); _reg(0x53, y1)
        _reg(0x20, 0); _reg(0x21, y0)
    _cmd(0x22)  # start writing GRAM


_window(0, _H)
_fill(0, 0, _W * _H, _ctl)  # black


# Indexed expansion into RGB565 rows, the same bit orders display spi uses (gs4 high nibble first; gs2/mono low bits first).
@micropython.viper
def _expand(src: ptr8, off: int, stride: int, dst: ptr8, width: int, bpp: int, pal: ptr16):
    s = off
    j = 0
    x = 0
    while x < width:
        if bpp == 4:
            b = int(src[s + (x >> 1)])
            idx = (b >> 4) if (x & 1) == 0 else (b & 0x0F)
        elif bpp == 2:
            b = int(src[s + (x >> 2)])
            idx = (b >> ((x & 3) * 2)) & 0x3
        else:
            b = int(src[s + (x >> 3)])
            idx = (b >> (x & 7)) & 0x1
        c = int(pal[idx])
        dst[j] = c >> 8
        dst[j + 1] = c & 0xFF
        j += 2
        x += 1


_BPP = {'gs4': 4, 'gs2': 2, 'mono': 1}.get(_fmt, 16)
_row = bytearray(_W * 2)


async def run(msg, properties):
    buf = msg.get('payload', b'')
    y0 = msg.get('y')
    if y0 is None:
        if len(buf) != _stride * _H:
            raise ValueError('%s: expected %d bytes (%dx%d %s), got %d' % (_NAME, _stride * _H, _W, _H, _fmt, len(buf)))
        y0 = 0
        rows = _H
    else:
        rows = len(buf) // _stride
        if rows < 1 or len(buf) != rows * _stride or y0 < 0 or y0 + rows > _H:
            raise ValueError('%s: a strip must be whole rows of %d bytes inside the %d-row screen, got %d bytes at row %r' % (_NAME, _stride, _H, len(buf), y0))
    _window(y0, rows)
    if _BPP == 16:
        _send(buf, len(buf), _lut, _ctl)
    else:
        for r in range(rows):
            _expand(buf, r * _stride, _stride, _row, _W, _BPP, _pal)
            _send(_row, _W * 2, _lut, _ctl)
