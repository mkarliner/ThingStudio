# CPython: raw spike frames -> PNG, plus a contact sheet.
import sys, glob, os
from PIL import Image, ImageDraw

W, H = 320, 240
PAL = {
    'gs4': [(0, 0, 0), (255, 255, 255), (110, 110, 110), (20, 90, 160), (40, 200, 80), (220, 40, 40), (60, 60, 60)] + [(255, 0, 255)] * 9,
    'gs2': [(0, 0, 0), (255, 255, 255), (110, 110, 110), (20, 90, 160)],
    'mono': [(0, 0, 0), (255, 255, 255)],
}
PPB = {'gs4': 2, 'gs2': 4, 'mono': 8}


def px(fmt, data, x, y):
    ppb = PPB[fmt]
    stride = (W + ppb - 1) // ppb
    b = data[y * stride + x // ppb]
    if fmt == 'gs4':
        return (b >> 4) if x % 2 == 0 else (b & 0xF)  # high nibble first
    if fmt == 'gs2':
        return (b >> (2 * (x % 4))) & 3              # low bits first
    return (b >> (x % 8)) & 1                         # MONO_HMSB: LSB first


def to_png(path):
    fmt = os.path.basename(path).split('_')[0]
    data = open(path, 'rb').read()
    im = Image.new('RGB', (W, H))
    p = im.load()
    for y in range(H):
        for x in range(W):
            p[x, y] = PAL[fmt][px(fmt, data, x, y)]
    return im


if __name__ == '__main__':
    out = sys.argv[1]
    rows = ['gs4', 'gs2', 'mono']
    cols = ['known', 'unknown', 'stale']
    sheet = Image.new('RGB', (len(cols) * (W * 2 + 20) + 20, len(rows) * (H * 2 + 40) + 20), (230, 230, 230))
    d = ImageDraw.Draw(sheet)
    for r, fmt in enumerate(rows):
        for c, st in enumerate(cols):
            f = '%s/%s_%s.raw' % (out, fmt, st)
            if not os.path.exists(f):
                continue
            im = to_png(f)
            im.save(f.replace('.raw', '.png'))
            x0, y0 = 20 + c * (W * 2 + 20), 20 + r * (H * 2 + 40)
            d.text((x0, y0), '%s / %s' % (fmt, st), fill=(0, 0, 0))
            sheet.paste(im.resize((W * 2, H * 2), Image.NEAREST), (x0, y0 + 14))
    sheet.save('%s/contact_sheet.png' % out)
