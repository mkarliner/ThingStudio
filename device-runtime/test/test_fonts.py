# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_fonts.py
#
# The GUI font set (tools/build_fonts.py, gui-font-pipeline-scoping.md) under the real MicroPython unix port:
# every board font module imports, and its glyph widths and bitmaps are exactly what the editor's JSON copy
# says. The editor lays out text from that JSON; if the two ever differed, a layout that fits in the editor
# would overflow on the board.

import gc
import json
import os
import sys

import minitest

try:
    import ubinascii as binascii
except ImportError:
    import binascii

_HERE = __file__.rsplit("/", 1)[0] if "/" in __file__ else "."
_FONTS = _HERE + "/../src/vendor/fonts"
_JSON = _HERE + "/../../editor/src/gui/fonts"
sys.path.insert(0, _FONTS)


def _ids():
    return sorted(n[:-5] for n in os.listdir(_JSON) if n.endswith(".json"))


def _load(font_id):
    with open(_JSON + "/" + font_id + ".json") as f:
        return json.load(f)


def test_every_editor_font_has_a_board_module():
    board = sorted(n[:-3] for n in os.listdir(_FONTS) if n.startswith("font_") and n.endswith(".py"))
    assert board == _ids(), (board, _ids())
    assert len(board) > 0


def test_metrics_and_glyphs_match_the_editor_copy():
    for font_id in _ids():
        meta = _load(font_id)
        mod = __import__(font_id)
        assert mod.height() == meta["height"], font_id
        assert mod.baseline() == meta["baseline"], font_id
        assert mod.max_width() == meta["maxWidth"], font_id
        for ch, (width, b64) in meta["glyphs"].items():
            mv, h, w = mod.get_ch(ch)
            assert h == meta["height"] and w == width, (font_id, ch, w, width)
            stride = (w + 7) // 8
            assert bytes(mv[: stride * h]) == binascii.a2b_base64(b64), (font_id, ch)
        del sys.modules[font_id]
        gc.collect()


def test_sample_widths_match():
    for font_id in _ids():
        meta = _load(font_id)
        mod = __import__(font_id)
        for s, expected in meta["samples"].items():
            assert sum(mod.get_ch(c)[2] for c in s) == expected, (font_id, s)
        del sys.modules[font_id]


def test_a_character_outside_the_charset_draws_as_the_error_glyph():
    mod = __import__("font_digits32")
    assert mod.get_ch("A")[2] == mod.get_ch("?")[2]


minitest.run(
    [
        test_every_editor_font_has_a_board_module,
        test_metrics_and_glyphs_match_the_editor_copy,
        test_sample_widths_match,
        test_a_character_outside_the_charset_draws_as_the_error_glyph,
    ]
)
