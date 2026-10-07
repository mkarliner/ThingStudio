#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/build_fonts.py
#
# Builds the GUI font set (docs/working-notes/gui-font-pipeline-scoping.md, option A: prebuilt, committed).
# For every font in device-runtime/runtime_manifest.py's FONT_SIZES:
#
#   device-runtime/src/vendor/fonts/font_<id>.py  -- the board module, font_to_py format, drawn by Writer
#   editor/src/gui/fonts/font_<id>.json           -- the editor's copy: height, baseline, each glyph's
#                                                    width and bitmap (layout engine and GUI preview)
#
# Both come from the same font_to_py run, so the editor measures text exactly as the board draws it.
# Outputs are committed: building the editor or the backend never needs this tool or FreeType.
#
# Needs freetype-py (pip install freetype-py). Run from anywhere:
#   python3 tools/build_fonts.py          regenerate
#   python3 tools/build_fonts.py --check  exit 1 if a committed output is missing or stale

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ beside the committed font modules

ROOT = Path(__file__).resolve().parent.parent
FONT_TO_PY = Path("tools/vendor/font_to_py/font_to_py.py")
FONT_DIR = Path("tools/fonts")
BOARD_OUT = Path("device-runtime/src/vendor/fonts")
EDITOR_OUT = Path("editor/src/gui/fonts")
# font_to_py draws a character outside the charset as this glyph; it's always in the module.
ERRCHAR = "?"
SAMPLES = ["-10.5", "21.9", "1013", "Temperature", "Living room", "48%", "°C"]


def load_manifest():
    spec = importlib.util.spec_from_file_location("runtime_manifest", ROOT / "device-runtime/runtime_manifest.py")
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def convert(source: Path, size: int, charset: str, out_py: Path) -> None:
    # Relative paths from the repo root keep font_to_py's "# Cmd:" header the same on every machine.
    cmd = [sys.executable, str(FONT_TO_PY), "-x", "-c", charset, str(source), str(size), str(out_py)]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0 or not (ROOT / out_py).exists():
        sys.exit(f"font_to_py failed for {source} {size}px:\n{r.stdout}{r.stderr}")


def editor_json(font_id: str, charset_name: str, size: int, charset: str, module) -> dict:
    glyphs: dict[str, list] = {}
    for ch in sorted(set(charset) | {ERRCHAR}):
        mv, height, width = module.get_ch(ch)
        stride = (width + 7) // 8
        glyphs[ch] = [width, base64.b64encode(bytes(mv[: stride * height])).decode("ascii")]
    def width_of(s: str) -> int:
        return sum(module.get_ch(c)[2] for c in s)
    return {
        "id": font_id,
        "charset": charset_name,
        "size": size,
        "height": module.height(),
        "baseline": module.baseline(),
        "maxWidth": module.max_width(),
        "errchar": ERRCHAR,
        # Bitmaps: one row after another, each row (width + 7) // 8 bytes, most significant bit = leftmost
        # pixel (font_to_py -x, MONO_HLSB). Base64.
        "glyphs": glyphs,
        # Widths font_to_py's own get_ch() gives for a few strings: the editor's tests check its measuring
        # code against them.
        "samples": {s: width_of(s) for s in SAMPLES},
    }


def build(out_root: Path) -> list[Path]:
    m = load_manifest()
    written: list[Path] = []
    (out_root / BOARD_OUT).mkdir(parents=True, exist_ok=True)
    (out_root / EDITOR_OUT).mkdir(parents=True, exist_ok=True)
    for cs in sorted(m.FONT_SIZES):
        for size in m.FONT_SIZES[cs]:
            font_id = f"font_{cs}{size}"
            rel_py = BOARD_OUT / f"{font_id}.py"
            # font_to_py writes inside the repo (fixed relative path in its header); move it if checking.
            convert(FONT_DIR / m.FONT_SOURCES[cs], size, m.FONT_CHARSETS[cs], rel_py)
            produced = ROOT / rel_py
            target_py = out_root / rel_py
            if target_py != produced:
                target_py.write_bytes(produced.read_bytes())
            module = load_module(target_py)
            target_json = out_root / EDITOR_OUT / f"{font_id}.json"
            target_json.write_text(json.dumps(editor_json(font_id, cs, size, m.FONT_CHARSETS[cs], module), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            written += [target_py, target_json]
    return written


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail if committed outputs are missing or stale")
    args = ap.parse_args()
    try:
        import freetype  # noqa: F401
    except ImportError:
        sys.exit("needs freetype-py: pip install freetype-py")
    if not args.check:
        for p in build(ROOT):
            print(p.relative_to(ROOT))
        return
    # Check: keep the committed board files aside, rebuild, compare, put them back.
    stale: list[str] = []
    m = load_manifest()
    ids = [f"font_{cs}{s}" for cs in sorted(m.FONT_SIZES) for s in m.FONT_SIZES[cs]]
    saved = {i: (ROOT / BOARD_OUT / f"{i}.py").read_bytes() if (ROOT / BOARD_OUT / f"{i}.py").exists() else None for i in ids}
    with tempfile.TemporaryDirectory() as tmp:
        try:
            build(Path(tmp))
            for i in ids:
                for rel in (BOARD_OUT / f"{i}.py", EDITOR_OUT / f"{i}.json"):
                    fresh = (Path(tmp) / rel).read_bytes()
                    committed = saved[i] if rel.suffix == ".py" else ((ROOT / rel).read_bytes() if (ROOT / rel).exists() else None)
                    if committed != fresh:
                        stale.append(str(rel))
        finally:
            for i, data in saved.items():
                path = ROOT / BOARD_OUT / f"{i}.py"
                if data is None:
                    path.unlink(missing_ok=True)
                else:
                    path.write_bytes(data)
    if stale:
        sys.exit("stale or missing font outputs (run python3 tools/build_fonts.py):\n  " + "\n  ".join(stale))
    print(f"{len(ids)} fonts up to date")


if __name__ == "__main__":
    main()
