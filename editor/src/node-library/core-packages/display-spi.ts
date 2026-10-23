// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/core-packages/display-spi.ts
//
// display_spi as a core package (2026-10-21). The hook validates the panel settings, computes the MADCTL byte and
// the frame geometry, and trims the palette; the Python builds the shared SPI/pins and the vendored driver, and
// expands gs4/gs2/mono sources with the same hand-written viper loops the built-in generated. rgb565 blits
// directly. Full frames and whole-row strips (msg.y) both supported.

import type { NodeDescriptor } from "../../compiler/node-descriptor.js";

export const DEFAULT_PALETTE_GS4: readonly number[] = [0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0x07ff, 0xf81f, 0x8410, 0x4208, 0xc618, 0xfd20, 0x8000, 0x0400, 0x0010, 0x0410];

// How many entries of the 16-entry palette each indexed format actually reads, for the palette editor
// (PaletteField.vue greys out the rest) and to mirror the hook's own `ENTRIES_USED` below -- keep the
// two in step; the Python trims with it.
export const PALETTE_ENTRIES_USED = { gs4: 16, gs2: 4, mono: 2 } as const;

export const descriptor: NodeDescriptor = {
  type: "thingstudio/display_spi",
  kind: "sink",
  paletteId: "display_spi",
  label: "display spi",
  group: "hardware",
  priority: 40,
  color: "#4a3f8a",
  bgcolor: "#2a1f4a",
  icon: "▤",
  width: 128,
  presetType: "display_spi",
  description:
    "Shows a frame on an SPI colour TFT. msg.payload is a framebuffer in the frame format below, usually from a " +
    "gui screen. Set the pins from your board's pinout.",
  resources: [
    { kind: "spi", bus: "spiBus", sck: "sck", mosi: "mosi", baudrate: "baudrate" },
    { kind: "pin", property: "dc", direction: "output", use: "display DC" },
    { kind: "pin", property: "cs", direction: "output", use: "SPI CS", optional: true },
    { kind: "pin", property: "reset", direction: "output", use: "output", optional: true },
    { kind: "pin", property: "backlight", direction: "output", use: "output", optional: true },
  ],
  ports: {
    inputs: [{ name: "frame", type: "bytes" }],
  },
  properties: [
    {
      name: "orientation",
      label: "orientation",
      kind: "select",
      default: "",
      options: [
        { value: "", label: "off (raw rotation)" },
        { value: "0", label: "0 degrees (the panel's own)" },
        { value: "90", label: "90 degrees clockwise" },
        { value: "180", label: "180 degrees" },
        { value: "270", label: "270 degrees clockwise" },
      ],
      help:
        "Width and height are the panel's own size; rotation is how the panel is mounted (0 to 3). A gui screen " +
        "wired to this display turns its size and touch to match.",
    },
    {
      name: "controller",
      label: "controller",
      kind: "select",
      default: "st7789",
      options: [
        { value: "st7789", label: "ST7789" },
        { value: "st7796", label: "ST7796 (320x480)" },
      ],
    },
    {
      name: "frameFormat",
      label: "frame format",
      kind: "select",
      default: "rgb565",
      options: [
        { value: "rgb565", label: "RGB565 (full color, default)" },
        { value: "gs4", label: "GS4 4-bit indexed (1/4 the memory, 16-color palette)" },
        { value: "gs2", label: "GS2 2-bit indexed (1/8 the memory, 4-color palette)" },
        { value: "mono", label: "Mono 1-bit indexed (1/16 the memory, 2-color palette)" },
      ],
      help: "Byte-swap an RGB565 buffer before sending it, or colours come out wrong. Indexed formats use the palette below.",
    },
    { name: "palette", label: "palette", kind: "palette", default: [...DEFAULT_PALETTE_GS4] },
    { name: "spiBus", label: "SPI bus", kind: "number", default: 2, min: 0 },
    { name: "baudrate", label: "baudrate", kind: "number", default: 40000000, min: 1 },
    { name: "sck", label: "sck pin", kind: "pin", default: 12 },
    { name: "mosi", label: "mosi pin", kind: "pin", default: 11 },
    { name: "dc", label: "dc pin", kind: "pin", default: 13 },
    { name: "cs", label: "cs pin (-1 = not wired)", kind: "pin", default: -1, optional: true },
    { name: "reset", label: "reset pin (-1 = not wired)", kind: "pin", default: -1, optional: true },
    { name: "backlight", label: "backlight pin (-1 = not wired)", kind: "pin", default: -1, optional: true },
    { name: "width", label: "width (px)", kind: "number", default: 135, min: 1 },
    { name: "height", label: "height (px)", kind: "number", default: 240, min: 1 },
    { name: "rotation", label: "rotation (0-7)", kind: "number", default: 1, min: 0, max: 7 },
    {
      name: "colorOrder",
      label: "color order",
      kind: "select",
      default: "bgr",
      options: [
        { value: "bgr", label: "BGR (default)" },
        { value: "rgb", label: "RGB" },
      ],
    },
    { name: "invertColors", label: "invert colors", kind: "boolean", default: false },
    { name: "dataLatchOrder", label: "data latch order (MH bit)", kind: "boolean", default: true },
    { name: "xstart", label: "xstart (-1 = auto)", kind: "number", default: -1, min: -1 },
    { name: "ystart", label: "ystart (-1 = auto)", kind: "number", default: -1, min: -1 },
  ],
};

export const compileHook = `MADCTL_MY = 0x80
MADCTL_MX = 0x40
MADCTL_MV = 0x20
MADCTL_BGR = 0x08
MADCTL_MH = 0x04
ROTATION_BITS = (0, MADCTL_MX, MADCTL_MY, MADCTL_MX | MADCTL_MY,
                 MADCTL_MV, MADCTL_MV | MADCTL_MX, MADCTL_MV | MADCTL_MY, MADCTL_MV | MADCTL_MX | MADCTL_MY)
PIXELS_PER_BYTE = {'gs4': 2, 'gs2': 4, 'mono': 8}
BITS_PER_PIXEL = {'gs4': 4, 'gs2': 2, 'mono': 1}
ENTRIES_USED = {'gs4': 16, 'gs2': 4, 'mono': 2}
FRAMEBUF_ATTR = {'gs4': 'GS4_HMSB', 'gs2': 'GS2_HMSB', 'mono': 'MONO_HMSB'}
DEFAULT_PALETTE = [0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0x07ff, 0xf81f,
                   0x8410, 0x4208, 0xc618, 0xfd20, 0x8000, 0x0400, 0x0010, 0x0410]


def _whole(props, name, dflt, low, what):
    raw = props.get(name)
    if raw is None or raw == '':
        raw = dflt
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None, 'display_spi %s "%s" must be a whole number, %d or more' % (what, raw, low)
    if value < low:
        return None, 'display_spi %s "%s" must be a whole number, %d or more' % (what, raw, low)
    return value, None


def _turned(width, height, angle):
    return (height, width) if angle in (90, 270) else (width, height)


def _from_turned(n, w, h, angle):
    if angle == 0:
        return n
    if angle == 90:
        return (w - 1 - n[1], n[0])
    if angle == 180:
        return (w - 1 - n[0], h - 1 - n[1])
    return (n[1], h - 1 - n[0])


def _madctl_map(bits, l, pw, ph):
    t = (l[1], l[0]) if bits & MADCTL_MV else l
    return ((pw - 1 - t[0]) if bits & MADCTL_MX else t[0], (ph - 1 - t[1]) if bits & MADCTL_MY else t[1])


def _oriented_madctl(base_bits, angle, width, height):
    if base_bits & MADCTL_MV:
        return None
    tw, th = _turned(width, height, angle)
    for bits in range(8):
        axes = bits << 5
        ok = True
        for n in ((0, 0), (tw - 1, 0), (0, th - 1), (1, 2), (tw - 2, 3)):
            old = _from_turned(n, width, height, angle)
            if _madctl_map(axes, n, width, height) != _madctl_map(base_bits, old, width, height):
                ok = False
                break
        if ok:
            return axes
    return None



# A gui screen's theme owns the palette while it is wired to this display (2026-10-23,
# gui-widget-styles-and-colour-scoping.md). The fold has to exist in Python too, because this package decides the
# palette; editor/test/display-spi-theme-palette.test.ts runs the real hook against gui-theme-shared.ts's
# resolveThemeForFormat() so the two cannot drift.
_THEME_ROLES = ('bg', 'card', 'fg', 'muted', 'track', 'accent', 'on_accent', 'ok', 'warn', 'alarm')
_THEME_DEFAULT = {'bg': 0x0000, 'card': 0x0000, 'fg': 0xffff, 'muted': 0x632c, 'track': 0x632c,
                  'accent': 0x3ef1, 'on_accent': 0x0000, 'ok': 0xffff, 'warn': 0xffff, 'alarm': 0xffff}
_THEME_PRESETS = {
    'dark-slate': {'bg': 0x10a2, 'card': 0x2124, 'fg': 0xffff, 'muted': 0x8c71, 'track': 0x4208,
                   'accent': 0x3ef1, 'on_accent': 0x0841, 'ok': 0x3e66, 'warn': 0xfc60, 'alarm': 0xf800},
    'light-paper': {'bg': 0xffff, 'card': 0xef5d, 'fg': 0x0841, 'muted': 0x8c71, 'track': 0xce59,
                    'accent': 0x0250, 'on_accent': 0xffff, 'ok': 0x1c65, 'warn': 0xc400, 'alarm': 0xb000},
}


def _theme_of(ctx, panel_id):
    """(roles, screen id) of the gui screen wired to this display and using a theme, or (None, None)."""
    links = ctx['flow'].get('links') or []
    nodes = ctx['flow'].get('nodes') or []
    for link in links:
        if len(link) < 3 or link[2] != panel_id:
            continue
        source = None
        for n in nodes:
            if n['id'] == link[0]:
                source = n
                break
        if source is None or source['type'] != 'thingstudio/gui_screen':
            continue
        theme_id = str((source.get('properties') or {}).get('themeConfigId') or '')
        if not theme_id:
            continue
        for c in ctx['flow'].get('configs') or []:
            if c['id'] == theme_id and c['type'] == 'thingstudio/config/gui-theme':
                props = c.get('properties') or {}
                preset = _THEME_PRESETS.get(str(props.get('preset') or ''))
                theme = dict(preset) if preset else dict(_THEME_DEFAULT)
                for role in _THEME_ROLES:
                    if role in props and props[role] not in (None, ''):
                        theme[role] = int(props[role])
                return theme, source['id']
    return None, None


def _theme_palette(theme, fmt):
    """The palette this format reads, folded from the roles (the same fold as gui-theme-shared.ts)."""
    if fmt == 'gs4':
        palette = [theme[role] for role in _THEME_ROLES]
        while len(palette) < 16:
            palette.append(0)
        return palette
    if fmt == 'gs2':
        return [theme['bg'], theme['fg'], theme['muted'], theme['accent']]
    return [theme['bg'], theme['fg']]

def compile(ctx, properties):
    controller = str(properties.get('controller') or 'st7789')
    if controller not in ('st7789', 'st7796'):
        return {'errors': ['display_spi controller "%s" must be st7789 or st7796' % controller]}
    fmt = str(properties.get('frameFormat') or 'rgb565')
    if fmt not in ('rgb565', 'gs4', 'gs2', 'mono'):
        return {'errors': ['display_spi frameFormat "%s" must be rgb565, gs4, gs2 or mono' % fmt]}
    indexed = fmt != 'rgb565'
    palette = None
    warnings = []
    if indexed:
        raw_palette = properties.get('palette')
        if raw_palette is None:
            raw_palette = DEFAULT_PALETTE
        if not isinstance(raw_palette, list) or len(raw_palette) != 16:
            return {'errors': ['display_spi palette must be an array of exactly 16 RGB565 values (0-65535)']}
        palette = []
        for i, entry in enumerate(raw_palette):
            try:
                value = int(entry)
            except (TypeError, ValueError):
                return {'errors': ['display_spi palette[%d] "%s" must be an integer 0-65535 (a raw RGB565 value)' % (i, entry)]}
            if value < 0 or value > 0xffff:
                return {'errors': ['display_spi palette[%d] "%s" must be an integer 0-65535 (a raw RGB565 value)' % (i, entry)]}
            palette.append(value)
        palette = palette[:ENTRIES_USED[fmt]]
        theme, screen_id = _theme_of(ctx, ctx['node']['id'])
        if theme is not None:
            if raw_palette is not None and list(palette) != list(_theme_palette(dict(_THEME_DEFAULT), fmt)):
                warnings.append("the theme on the wiring gui screen sets this display's palette; the palette on this "
                                "display is ignored while that screen is wired to it")
            palette = _theme_palette(theme, fmt)[:ENTRIES_USED[fmt]]

    spi_bus, err = _whole(properties, 'spiBus', 2, 0, 'spiBus')
    if err:
        return {'errors': [err]}
    baud, err = _whole(properties, 'baudrate', 40000000, 1, 'baudrate')
    if err:
        return {'errors': [err]}
    panel_width, err = _whole(properties, 'width', 135, 1, 'width')
    if err:
        return {'errors': [err]}
    panel_height, err = _whole(properties, 'height', 240, 1, 'height')
    if err:
        return {'errors': [err]}
    rotation, err = _whole(properties, 'rotation', 1, 0, 'rotation')
    if err:
        return {'errors': [err]}
    if rotation > 7:
        return {'errors': ['display_spi rotation "%s" must be an integer 0-7' % properties.get('rotation')]}
    color_order = str(properties.get('colorOrder') or 'bgr')
    if color_order not in ('rgb', 'bgr'):
        return {'errors': ['display_spi colorOrder "%s" must be rgb or bgr' % color_order]}
    invert = properties.get('invertColors') is True
    latch = properties.get('dataLatchOrder') is not False
    xstart, err = _whole(properties, 'xstart', -1, -1, 'xstart')
    if err:
        return {'errors': [err]}
    ystart, err = _whole(properties, 'ystart', -1, -1, 'ystart')
    if err:
        return {'errors': [err]}

    angle = None
    raw_angle = properties.get('orientation')
    if raw_angle is not None and raw_angle != '':
        try:
            angle = int(raw_angle)
        except (TypeError, ValueError):
            angle = -1
        if angle not in (0, 90, 180, 270):
            return {'errors': ['display_spi orientation "%s" must be 0, 90, 180 or 270' % raw_angle]}
        if rotation > 3:
            return {'errors': ['display_spi rotation %d swaps axes: with an orientation, use 0 to 3 for how the panel is mounted' % rotation]}
        if xstart != -1 or ystart != -1 or (panel_width == 135 and panel_height == 240):
            return {'errors': ["display_spi: an orientation isn't supported with a panel offset (xstart/ystart, or a 135x240 panel) yet. Clear the orientation, or set rotation by hand."]}
        width, height = _turned(panel_width, panel_height, angle)
        axis = _oriented_madctl(ROTATION_BITS[rotation], angle, panel_width, panel_height)
        if axis is None:
            return {'errors': ['display_spi: no display orientation matches a turn of %d degrees' % angle]}
    else:
        width, height = panel_width, panel_height
        axis = ROTATION_BITS[rotation]

    madctl = axis | (MADCTL_MH if latch else 0) | (MADCTL_BGR if color_order == 'bgr' else 0)
    if indexed:
        stride = (width + PIXELS_PER_BYTE[fmt] - 1) // PIXELS_PER_BYTE[fmt]
        expected = stride * height
        row_bytes = stride
        fmt_note = '%dx%d %s/framebuf.%s, %dbpp, %d bytes/row' % (width, height, fmt, FRAMEBUF_ATTR[fmt], BITS_PER_PIXEL[fmt], stride)
    else:
        stride = None
        expected = width * height * 2
        row_bytes = width * 2
        fmt_note = '%dx%d RGB565' % (width, height)

    return {'properties': {
        'controller': controller, 'frameFormat': fmt, 'indexed': indexed,
        'palette': palette, 'spiBus': spi_bus, 'baudrate': baud,
        'sck': int(properties.get('sck', 12)), 'mosi': int(properties.get('mosi', 11)),
        'dc': int(properties.get('dc', 13)),
        'cs': int(properties.get('cs', -1)) if properties.get('cs') not in (None, '') else -1,
        'reset': int(properties.get('reset', -1)) if properties.get('reset') not in (None, '') else -1,
        'backlight': int(properties.get('backlight', -1)) if properties.get('backlight') not in (None, '') else -1,
        'width': width, 'height': height, 'panelWidth': panel_width, 'panelHeight': panel_height,
        'rotation': rotation, 'madctl': madctl, 'invertColors': invert, 'dataLatchOrder': latch,
        'xstart': xstart, 'ystart': ystart, 'stride': stride, 'expected': expected,
        'rowBytes': row_bytes, 'formatNote': fmt_note,
    }, 'warnings': warnings}
`;

export const python = `import array
import machine
import micropython
import st7789py
from st7789py import ST7789, ST7789_MADCTL
from st7796py import ST7796
import runtime

_spi = runtime.shared(
    'spi', properties['spiBus'], (properties['sck'], properties['mosi'], properties['baudrate']),
    lambda: machine.SPI(properties['spiBus'], baudrate=properties['baudrate'], polarity=0, phase=0,
                        sck=machine.Pin(properties['sck']), mosi=machine.Pin(properties['mosi'])))
_dc = runtime.shared('pin', properties['dc'], ('out', 'none'), lambda: machine.Pin(properties['dc'], machine.Pin.OUT))
_cs = None
if properties['cs'] >= 0:
    _cs = runtime.shared('pin', properties['cs'], ('out', 'none'), lambda: machine.Pin(properties['cs'], machine.Pin.OUT))
_rst = None
if properties['reset'] >= 0:
    _rst = runtime.shared('pin', properties['reset'], ('out', 'none'), lambda: machine.Pin(properties['reset'], machine.Pin.OUT))
_bl = None
if properties['backlight'] >= 0:
    _bl = runtime.shared('pin', properties['backlight'], ('out', 'none'), lambda: machine.Pin(properties['backlight'], machine.Pin.OUT))

_Driver = ST7796 if properties['controller'] == 'st7796' else ST7789
_disp = _Driver(_spi, properties['width'], properties['height'], _rst, _dc, cs=_cs, backlight=_bl,
                xstart=properties['xstart'], ystart=properties['ystart'])
_disp.init()
_disp.inversion_mode(properties['invertColors'])
_disp.write(ST7789_MADCTL, bytes([properties['madctl']]))
if _bl is not None:
    _bl.value(1)

_width = properties['width']
_height = properties['height']
_stride = properties['stride']
_row_bytes = properties['rowBytes']
_expected = properties['expected']
_fmt = properties['frameFormat']
_note = properties['formatNote']
_indexed = properties['indexed']
_pal = None
_scratch = None
_expand = None


@micropython.viper
def _expand_gs4(src: ptr8, off: int, stride: int, dst: ptr8, width: int, rows: int, pal: ptr16):
    full = width >> 1
    odd = width & 1
    row_dst_bytes = width * 2
    for r in range(rows):
        s = off + r * stride
        d = r * row_dst_bytes
        for i in range(full):
            b = int(src[s + i])
            hi = b >> 4
            lo = b & 0x0F
            c0 = int(pal[hi])
            c1 = int(pal[lo])
            j = d + i * 4
            dst[j] = c0 >> 8
            dst[j + 1] = c0 & 0xFF
            dst[j + 2] = c1 >> 8
            dst[j + 3] = c1 & 0xFF
        if odd:
            b = int(src[s + full])
            hi = b >> 4
            c0 = int(pal[hi])
            j = d + full * 4
            dst[j] = c0 >> 8
            dst[j + 1] = c0 & 0xFF


@micropython.viper
def _expand_gs2(src: ptr8, off: int, stride: int, dst: ptr8, width: int, rows: int, pal: ptr16):
    full = width >> 2
    rem = width & 3
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
        if rem:
            b = int(src[s + full])
            j = d + full * 8
            for k in range(rem):
                c = int(pal[(b >> (k * 2)) & 0x3])
                dst[j + k * 2] = c >> 8
                dst[j + k * 2 + 1] = c & 0xFF


@micropython.viper
def _expand_mono(src: ptr8, off: int, stride: int, dst: ptr8, width: int, rows: int, pal: ptr16):
    full = width >> 3
    rem = width & 7
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
        if rem:
            b = int(src[s + full])
            j = d + full * 16
            for k in range(rem):
                c = int(pal[(b >> k) & 0x1])
                dst[j + k * 2] = c >> 8
                dst[j + k * 2 + 1] = c & 0xFF


if _indexed:
    _pal = array.array('H', properties['palette'])
    _scratch = bytearray(_width * 2 * 2)
    if _fmt == 'gs4':
        _expand = _expand_gs4
    elif _fmt == 'gs2':
        _expand = _expand_gs2
    else:
        _expand = _expand_mono


async def run(msg, properties):
    _buf = msg.get('payload', b'')
    _y0 = msg.get('y')
    if _y0 is None:
        if len(_buf) != _expected:
            raise ValueError('display_spi: expected %d bytes (%s), got %d' % (_expected, _note, len(_buf)))
        _y0 = 0
        _rows = _height
    else:
        _rows = len(_buf) // _row_bytes
        if _rows < 1 or len(_buf) != _rows * _row_bytes or _y0 < 0 or _y0 + _rows > _height:
            raise ValueError('display_spi: a strip must be whole rows of %d bytes inside the %d-row screen, got %d bytes at row %r' % (_row_bytes, _height, len(_buf), _y0))
    if _indexed:
        _disp.set_window(0, _y0, _width - 1, _y0 + _rows - 1)
        _row = 0
        while _row < _rows:
            _n = 2 if (_rows - _row) >= 2 else (_rows - _row)
            _expand(_buf, _row * _stride, _stride, _scratch, _width, _n, _pal)
            _disp.write(None, memoryview(_scratch)[:_width * 2 * _n])
            _row += _n
    else:
        _disp.blit_buffer(_buf, 0, _y0, _width, _rows)
    return msg
`;
