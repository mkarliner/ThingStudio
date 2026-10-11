#!/usr/bin/env python3
"""Take the user guide's editor screenshots from the real, built editor.

Starts thingstudio-backend on a spare port with a throwaway data folder, opens the editor in headless
Chromium (Playwright), loads each shot's fixture flow from docs/screenshots/, and saves a PNG into
docs/user-guide/images/. No board is needed or used: shots show the editor as a newcomer first sees it.

Run by `make screenshots` and by the docs and release workflows before `mkdocs build`, so the published
images always match the code. The PNGs are also committed, so a plain local `make` still builds the docs
without Playwright or Chromium installed.

Usage:  python tools/screenshots.py [--static-dir editor/dist] [--chromium /path/to/chrome]
Needs:  pip install -r docs/screenshots/requirements.txt && playwright install chromium
"""

from __future__ import annotations

import argparse
import base64
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FIXTURES = REPO / "docs" / "screenshots"
OUT = REPO / "docs" / "user-guide" / "images"

VIEWPORT = {"width": 1600, "height": 900}
BACKEND_START_TIMEOUT_S = 20
EDITOR_READY_TIMEOUT_MS = 20_000


@dataclass(frozen=True)
class Shot:
    name: str  # output file: images/<name>.png
    flow: str  # fixture in docs/screenshots/
    select_node: str | None = None  # node label to click, so the properties panel shows it
    # Labelled callouts: (element ids, label, side, position). Each part gets an outline, and its label sits in a margin
    # added around the screenshot on that side ("top", "bottom", "left", "right"), with an arrow to the part. Position
    # is where along that side the label goes, in screenshot pixels (x for top/bottom, y for left/right); None centres
    # it on the part. Side "inside" puts the label in the middle of the part, with no arrow. Side "below" puts the label
    # over the screenshot, `position` pixels below the part, with an arrow up to it. Labels may cover the screenshot:
    # the picture is for finding your way round, and big labels matter more than what they hide. The labels are named in
    # docs/user-guide/editor-tour.md, so keep the two in step. A missing id fails the run, by name.
    annotations: tuple[tuple[tuple[str, ...], str, str, int | None], ...] = ()


# Ids that aren't plain element ids: "menu:File" is the toolbar menu button whose text starts with "File",
# "row:cmdInput" is the row of controls containing #cmdInput, "sel:..." is a CSS selector.
EDITOR_PARTS = (
    (("menu:File",), "New, open, save", "top", None),
    (("flowNameInput",), "This flow's name", "top", None),
    (("backendPortSelect", "btnRefreshPorts", "btnConnect"), "Connect to a board", "top", None),
    (("boardSelect", "btnBoardPins"), "Board type, pin map", "top", None),
    (("btnDeploy",), "Deploy flow to board", "top", None),
    (("menu:Tools", "menu:Help"), "Board tools, user guide", "top", None),
    (("palette-mount",), "Nodes to add", "left", 300),
    (("sel:#pane-tabs-mount > *",), "Sheets of this flow", "below", 60),
    (("rete-canvas",), "Build the flow here", "inside", None),
    (("property-panel-mount",), "Selected node's settings", "right", 620),
    (("notesPanel",), "Notes on this flow", "right", None),
    (("source-preview-panel",), "Generated MicroPython", "right", None),
    (("console",), "Messages from the board", "right", None),
    (("row:cmdInput",), "Run Python on the board", "right", None),
    (("row:btnStopToPrompt",), "Escape to REPL", "right", None),
)

SHOTS = [
    Shot(name="editor", flow="blink.flow.json", select_node="function"),
    Shot(name="editor-parts", flow="blink.flow.json", select_node="function", annotations=EDITOR_PARTS),
]

# Margins added around an annotated screenshot for the labels, in pixels.
MARGIN = {"top": 60, "bottom": 20, "left": 130, "right": 250}

# Returns each part's box [left, top, right, bottom] in the page, or the parts it couldn't find.
RECTS_JS = """
(parts) => {
  const find = (id) => {
    if (id.startsWith('menu:')) {
      const t = id.slice(5);
      return [...document.querySelectorAll('#toolbar .menu-button')].find(b => b.textContent.trim().startsWith(t));
    }
    if (id.startsWith('sel:')) return document.querySelector(id.slice(4));
    if (id.startsWith('row:')) return document.getElementById(id.slice(4))?.closest('.row');
    if (id === 'source-preview-panel') return document.getElementById('source-preview')?.closest('details');
    return document.getElementById(id);
  };
  const missing = [], boxes = [];
  parts.forEach(([ids, label]) => {
    const els = ids.map(id => [id, find(id)]);
    els.filter(([, e]) => !e).forEach(([id]) => missing.push(`${label}: ${id}`));
    const rects = els.filter(([, e]) => e).map(([, e]) => e.getBoundingClientRect()).filter(r => r.width && r.height);
    if (!rects.length) { missing.push(`${label}: not visible`); boxes.push(null); return; }
    boxes.push([Math.min(...rects.map(r => r.left)) - 3, Math.min(...rects.map(r => r.top)) - 3,
                Math.max(...rects.map(r => r.right)) + 3, Math.max(...rects.map(r => r.bottom)) + 3]);
  });
  return { missing, boxes };
}
"""

# Draws the screenshot inside its margins, with an outline on each part and a label and arrow for it.
COMPOSE_JS = """
([png, w, h, m, parts]) => {
  const W = w + m.left + m.right, H = h + m.top + m.bottom, ox = m.left, oy = m.top;
  document.body.style.cssText = 'margin:0;background:#26262b';
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = '<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ' +
    'orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ffb020"/></marker></defs>' +
    `<image href="data:image/png;base64,${png}" x="${ox}" y="${oy}" width="${w}" height="${h}"/>`;
  document.body.append(svg);  // in the page first, so text can be measured
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text) e.textContent = text;
    svg.append(e); return e;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const FONT = 18, BH = 32, GAP = 10;
  const measure = (label) => {
    const text = add('text', { x: 0, y: 0, 'font-family': 'Helvetica, Arial, sans-serif', 'font-size': FONT,
      'font-weight': 'bold' }, label);
    const tw = text.getBBox().width; text.remove();
    return tw + 24;
  };
  // Label centre (cx, cy), size (bw, BH), arrow tip (tx, ty). Labels may overlap the screenshot itself.
  const labels = parts.map(([box, label, side, pos]) => {
    const [l, t, r, b] = [box[0] + ox, box[1] + oy, box[2] + ox, box[3] + oy];
    add('rect', { x: l, y: t, width: r - l, height: b - t, rx: 6, fill: 'none', stroke: '#ffb020', 'stroke-width': 2 });
    const bw = measure(label);
    const L = { label, side, bw, l, t, r, b };
    if (side === 'top') { L.cx = pos === null ? (l + r) / 2 : pos + ox; L.cy = m.top / 2; }
    else if (side === 'bottom') { L.cx = pos === null ? (l + r) / 2 : pos + ox; L.cy = H - m.bottom / 2; }
    else if (side === 'left') { L.cx = 8 + bw / 2; L.cy = pos === null ? (t + b) / 2 : pos + oy; }
    else if (side === 'right') { L.cx = W - 8 - bw / 2; L.cy = pos === null ? (t + b) / 2 : pos + oy; }
    else if (side === 'below') { L.cx = (l + r) / 2; L.cy = b + (pos === null ? 50 : pos); }
    else { L.cx = (l + r) / 2; L.cy = (t + b) / 2; }
    return L;
  });
  // Spread labels that share a side so none overlap: left to right along the top and bottom, top to bottom down the
  // sides, then shift the row back inside the picture if it ran off the end.
  const spread = (row, key, size, lo, hi) => {
    row.sort((p, q) => p[key] - q[key]);
    for (let i = 1; i < row.length; i++) {
      const min = row[i - 1][key] + size(row[i - 1]) / 2 + GAP + size(row[i]) / 2;
      if (row[i][key] < min) row[i][key] = min;
    }
    const last = row[row.length - 1];
    const over = last ? last[key] + size(last) / 2 - hi : 0;
    if (over > 0) row.forEach((p) => { p[key] -= over; });
    const first = row[0];
    const under = first ? lo - (first[key] - size(first) / 2) : 0;
    if (under > 0) row.forEach((p) => { p[key] += under; });
  };
  for (const side of ['top', 'bottom']) spread(labels.filter((p) => p.side === side), 'cx', (p) => p.bw, 8, W - 8);
  for (const side of ['left', 'right']) spread(labels.filter((p) => p.side === side), 'cy', () => BH, 8, H - 8);
  labels.forEach((p) => {
    if (p.side === 'top') { p.tx = clamp(p.cx, p.l + 8, p.r - 8); p.ty = p.t; }
    else if (p.side === 'bottom') { p.tx = clamp(p.cx, p.l + 8, p.r - 8); p.ty = p.b; }
    else if (p.side === 'left') { p.tx = p.l; p.ty = clamp(p.cy, p.t + 8, p.b - 8); }
    else if (p.side === 'right') { p.tx = p.r; p.ty = clamp(p.cy, p.t + 8, p.b - 8); }
    else if (p.side === 'below') { p.tx = clamp(p.cx, p.l + 8, p.r - 8); p.ty = p.b; }
  });
  // Arrows first, then labels on top of them.
  labels.forEach((p) => {
    if (p.side === 'inside') return;
    const sx = p.side === 'left' ? p.cx + p.bw / 2 : p.side === 'right' ? p.cx - p.bw / 2 : p.cx;
    const sy = p.side === 'top' ? p.cy + BH / 2 : p.side === 'bottom' ? p.cy - BH / 2 : p.side === 'below' ? p.cy - BH / 2 : p.cy;
    add('line', { x1: sx, y1: sy, x2: p.tx, y2: p.ty, stroke: '#ffb020', 'stroke-width': 3, 'marker-end': 'url(#head)' });
  });
  labels.forEach((p) => {
    add('rect', { x: p.cx - p.bw / 2, y: p.cy - BH / 2, width: p.bw, height: BH, rx: 7, fill: '#ffb020',
      stroke: '#111', 'stroke-width': 1 });
    add('text', { x: p.cx, y: p.cy + 6, 'text-anchor': 'middle', 'font-family': 'Helvetica, Arial, sans-serif',
      'font-size': FONT, 'font-weight': 'bold', fill: '#111' }, p.label);
  });
  return [W, H];
}
"""


class ScreenshotError(Exception):
    pass


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def backend_command() -> list[str]:
    exe = shutil.which("thingstudio-backend")
    if exe:
        return [exe]
    return [sys.executable, "-m", "thingstudio_backend"]


def wait_for_http(url: str, proc: subprocess.Popen, timeout_s: float) -> None:
    deadline = time.monotonic() + timeout_s
    last_err = "no attempt made"
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise ScreenshotError(f"thingstudio-backend exited with code {proc.returncode} before serving {url}")
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return
                last_err = f"HTTP {r.status}"
        except (urllib.error.URLError, OSError) as e:
            last_err = str(e)
        time.sleep(0.2)
    raise ScreenshotError(f"thingstudio-backend didn't serve {url} within {timeout_s}s (last error: {last_err})")


def take(page, base_url: str, shot: Shot) -> Path:
    from playwright.sync_api import TimeoutError as PwTimeout

    fixture = FIXTURES / shot.flow
    if not fixture.is_file():
        raise ScreenshotError(f"[{shot.name}] fixture flow not found: {fixture}")

    page.goto(base_url)
    try:
        page.wait_for_selector("#btnOpenFlow", state="attached", timeout=EDITOR_READY_TIMEOUT_MS)
        # The editor falls back to a plain <input type=file> without the File System Access API (deleted by the
        # init script), and Playwright can answer that dialog. Clicking via JS works while the File menu is shut.
        with page.expect_file_chooser(timeout=EDITOR_READY_TIMEOUT_MS) as chooser:
            page.evaluate("document.getElementById('btnOpenFlow').click()")
        chooser.value.set_files(str(fixture))
        page.wait_for_function(
            "document.getElementById('console')?.textContent.includes('[flow loaded')",
            timeout=EDITOR_READY_TIMEOUT_MS,
        )
    except PwTimeout as e:
        console = page.evaluate("document.getElementById('console')?.textContent ?? '(no console element)'")
        raise ScreenshotError(f"[{shot.name}] editor didn't load {shot.flow}: {e}\nconsole: {console}") from e

    if "[load failed]" in page.evaluate("document.getElementById('console').textContent"):
        raise ScreenshotError(f"[{shot.name}] the editor rejected {shot.flow}; see its console")

    if shot.select_node:
        node = page.get_by_text(shot.select_node, exact=True).last
        try:
            node.click(timeout=5_000)
        except PwTimeout as e:
            raise ScreenshotError(f"[{shot.name}] no node labelled '{shot.select_node}' to select") from e

    # Let the canvas and panels settle (wire rendering, panel transition) before the shot.
    page.wait_for_timeout(800)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{shot.name}.png"
    if not shot.annotations:
        page.screenshot(path=str(path))
        return path

    found = page.evaluate(RECTS_JS, [[list(ids), label] for ids, label, _side, _pos in shot.annotations])
    if found["missing"]:
        raise ScreenshotError(
            f"[{shot.name}] annotated parts not found in the editor (renamed or removed?): " + "; ".join(found["missing"])
        )
    bad = [label for _ids, label, side, _pos in shot.annotations if side not in ("top", "bottom", "left", "right", "inside", "below")]
    if bad:
        raise ScreenshotError(f"[{shot.name}] unknown label side for: " + ", ".join(bad))
    png = base64.b64encode(page.screenshot()).decode("ascii")
    parts = [[box, label, side, pos] for box, (_ids, label, side, pos) in zip(found["boxes"], shot.annotations)]
    w, h = VIEWPORT["width"], VIEWPORT["height"]
    page.set_viewport_size({"width": w + MARGIN["left"] + MARGIN["right"], "height": h + MARGIN["top"] + MARGIN["bottom"]})
    page.set_content("<!doctype html><html><body></body></html>")
    page.evaluate(COMPOSE_JS, [png, w, h, MARGIN, parts])
    page.wait_for_timeout(200)
    page.screenshot(path=str(path))
    return path

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--static-dir", type=Path, default=REPO / "editor" / "dist", help="the built editor")
    ap.add_argument("--chromium", default=None, help="Chromium binary, if not Playwright's own download")
    args = ap.parse_args()

    if not (args.static_dir / "index.html").is_file():
        print(f"screenshots: no built editor at {args.static_dir}. Build it first (make editor).", file=sys.stderr)
        return 1
    try:
        from playwright.sync_api import Error as PwError
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "screenshots: Playwright isn't installed. Run:\n"
            "  pip install -r docs/screenshots/requirements.txt && playwright install chromium",
            file=sys.stderr,
        )
        return 1

    port = free_port()
    base_url = f"http://127.0.0.1:{port}/"
    data_dir = tempfile.mkdtemp(prefix="thingstudio-screenshots-")
    log = tempfile.TemporaryFile(mode="w+")
    cmd = backend_command() + [
        "--no-browser", "--port", str(port), "--static-dir", str(args.static_dir), "--data-dir", data_dir,
    ]
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=REPO)
    try:
        wait_for_http(base_url, proc, BACKEND_START_TIMEOUT_S)
        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch(executable_path=args.chromium)
            except PwError as e:
                raise ScreenshotError(f"couldn't start Chromium ({e}). Run: playwright install chromium") from e
            try:
                context = browser.new_context(viewport=VIEWPORT, color_scheme="light", device_scale_factor=1)
                context.add_init_script("delete window.showOpenFilePicker")
                for shot in SHOTS:
                    page = context.new_page()
                    print(f"screenshots: {take(page, base_url, shot).relative_to(REPO)}")
                    page.close()
            finally:
                browser.close()
    except ScreenshotError as e:
        log.seek(0)
        tail = "".join(log.readlines()[-15:])
        print(f"screenshots: {e}\n--- thingstudio-backend output (last 15 lines) ---\n{tail}", file=sys.stderr)
        return 1
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(data_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
