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


SHOTS = [
    Shot(name="editor", flow="blink.flow.json", select_node="function"),
]


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
        print(f"screenshots: {e}\n--- thingstudio-backend output ---\n{log.read()}", file=sys.stderr)
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
