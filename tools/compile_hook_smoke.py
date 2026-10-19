#!/usr/bin/env python3
"""Browser smoke test for package compile hooks (interfaces/node-compile-context/).

Starts thingstudio-backend on a spare port with a throwaway data folder holding one test custom node, opens the
built editor in headless Chromium (Playwright), loads fixture flows, and checks what the source preview shows. It
exercises the real browser path -- the hook Worker, the WASI interpreter fetch, the 1 s budget -- that the vitest
suite (Node, no Worker) cannot. No board is needed or used.

Cases (each prints PASS or FAIL; the exit status is 1 if any fail):
  hooked      a flow with wifi_status compiles; the interpreter is fetched
  no-hook     a hook-free flow compiles without creating the Worker or fetching the interpreter
  wasm-404    a missing interpreter is a legible COMPILE ERROR, not a hang
  worker-404  a Worker script that fails to load is a legible COMPILE ERROR, not a hang
  runaway     a hook that loops forever is stopped by the budget, naming its own node
  recovery    after a runaway hook, a good flow in the same tab compiles (no misattributed timeout)

Usage:  python tools/compile_hook_smoke.py [--static-dir editor/dist] [--chromium /path/to/chrome] [--wait 12]
Needs:  a built editor (cd editor && npm run build), the backend installed (pip install ./backend), and
        pip install -r docs/screenshots/requirements.txt && playwright install chromium
Review: docs/working-notes/reviews/2026-10-19-reply-review-and-smoke-test.md
"""

from __future__ import annotations

import argparse
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FIXTURES = REPO / "tools" / "compile_hook_smoke"
NO_HOOK_FLOW = REPO / "docs" / "screenshots" / "blink.flow.json"
READY_TIMEOUT_MS = 20_000
CUSTOM_NODE_SETTLE_MS = 1_500  # the editor loads custom nodes from the backend at start


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def backend_command() -> list[str]:
    exe = shutil.which("thingstudio-backend")
    return [exe] if exe else [sys.executable, "-m", "thingstudio_backend"]


def wait_for_http(url: str, proc: subprocess.Popen, timeout_s: float = 20) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SystemExit(f"thingstudio-backend exited with code {proc.returncode} before serving {url}")
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except OSError:
            time.sleep(0.25)
    raise SystemExit(f"thingstudio-backend didn't serve {url} within {timeout_s}s")


class Smoke:
    def __init__(self, ctx, base_url: str, wait_s: float):
        self.ctx, self.base_url, self.wait_s = ctx, base_url, wait_s
        self.failures = 0

    def new_page(self, route=None):
        page = self.ctx.new_page()
        page.ts_wasm, page.ts_workers = [], []
        page.on("request", lambda r: page.ts_wasm.append(r.url) if "micropython-wasi" in r.url else None)
        page.on("worker", lambda w: page.ts_workers.append(w.url))
        if route:
            page.route(*route)
        page.goto(self.base_url)
        page.wait_for_selector("#btnOpenFlow", state="attached", timeout=READY_TIMEOUT_MS)
        page.wait_for_timeout(CUSTOM_NODE_SETTLE_MS)
        return page

    @staticmethod
    def open_flow(page, path: Path) -> None:
        with page.expect_file_chooser(timeout=READY_TIMEOUT_MS) as chooser:
            page.evaluate("document.getElementById('btnOpenFlow').click()")
        chooser.value.set_files(str(path))
        page.wait_for_function(
            "document.getElementById('console')?.textContent.includes('[flow loaded')", timeout=READY_TIMEOUT_MS
        )

    @staticmethod
    def preview(page) -> str:
        return page.evaluate("document.getElementById('source-preview')?.textContent ?? ''")

    def settle(self, page, done) -> tuple[str, float | None]:
        """Polls the preview until done(text) is truthy. Intermediate states while a flow loads (an empty or
        half-built graph) are ignored by construction: done() only matches a final answer."""
        start = time.time()
        text = ""
        while time.time() - start < self.wait_s:
            text = self.preview(page)
            if done(text):
                return text, time.time() - start
            page.wait_for_timeout(50)
        return text, None

    def report(self, name: str, ok: bool, detail: str) -> None:
        self.failures += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name:<11} {detail}")


def headline(text: str) -> str:
    for line in text.splitlines():
        if "COMPILE ERROR" in line or "ts_wifi.ensure_station" in line:
            return line.strip()[:140]
    return (text.splitlines() or ["(empty preview)"])[0].strip()[:140]


def hook_error(text: str) -> bool:
    return "COMPILE ERROR" in text and ("compile hook" in text or "worker" in text or "interpreter" in text)


def compiled_wifi(text: str) -> bool:
    return "ts_wifi.ensure_station" in text and "COMPILE ERROR" not in text


def run(smoke: Smoke) -> None:
    hooked, spin = FIXTURES / "hooked.flow.json", FIXTURES / "spin.flow.json"

    page = smoke.new_page()
    smoke.open_flow(page, hooked)
    text, secs = smoke.settle(page, lambda t: compiled_wifi(t) or hook_error(t))
    smoke.report("hooked", compiled_wifi(text) and len(page.ts_wasm) > 0,
                 f"{'%.2fs' % secs if secs is not None else 'no result'}; wasm fetches {len(page.ts_wasm)}; "
                 f"{headline(text)}")
    page.close()

    page = smoke.new_page()
    smoke.open_flow(page, NO_HOOK_FLOW)
    text, secs = smoke.settle(page, lambda t: "generated by the Thingstudio compiler" in t and "def " in t)
    ok = secs is not None and not page.ts_workers and not page.ts_wasm
    smoke.report("no-hook", ok, f"workers {len(page.ts_workers)}; wasm fetches {len(page.ts_wasm)}")
    page.close()

    page = smoke.new_page(route=("**/micropython-wasi.wasm", lambda r: r.fulfill(status=404, body="not found")))
    smoke.open_flow(page, hooked)
    text, secs = smoke.settle(page, hook_error)
    smoke.report("wasm-404", secs is not None, f"{'%.2fs' % secs if secs is not None else 'HUNG'}; {headline(text)}")
    page.close()

    page = smoke.new_page(route=("**/hook-worker-*.js", lambda r: r.abort()))
    smoke.open_flow(page, hooked)
    text, secs = smoke.settle(page, hook_error)
    waited = "%.2fs" % secs if secs is not None else "HUNG (no result in %ss)" % smoke.wait_s
    smoke.report("worker-404", secs is not None, f"{waited}; {headline(text)}")
    page.close()

    page = smoke.new_page()
    smoke.open_flow(page, spin)
    text, secs = smoke.settle(page, hook_error)
    smoke.report("runaway", secs is not None and "timed out" in text and "smoke/spin" in text,
                 f"{'%.2fs' % secs if secs is not None else 'no result'}; {headline(text)}")
    smoke.open_flow(page, hooked)
    text, secs = smoke.settle(page, lambda t: compiled_wifi(t) or hook_error(t))
    waited = "%.2fs" % secs if secs is not None else "no result"
    smoke.report("recovery", compiled_wifi(text), f"{waited}; {headline(text)}")
    page.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--static-dir", type=Path, default=REPO / "editor" / "dist")
    parser.add_argument("--chromium", default=None, help="Chromium executable (default: Playwright's own)")
    parser.add_argument("--wait", type=float, default=12, help="seconds to wait for each preview result")
    args = parser.parse_args()
    if not (args.static_dir / "index.html").is_file():
        print(f"no built editor at {args.static_dir} -- run: cd editor && npm run build", file=sys.stderr)
        return 2
    from playwright.sync_api import sync_playwright

    data_dir = Path(tempfile.mkdtemp(prefix="thingstudio-hook-smoke-"))
    shutil.copytree(FIXTURES / "custom-nodes", data_dir / "custom-nodes")
    port = free_port()
    base_url = f"http://127.0.0.1:{port}/"
    log = tempfile.TemporaryFile(mode="w+")
    proc = subprocess.Popen(
        backend_command() + ["--no-browser", "--port", str(port), "--static-dir", str(args.static_dir),
                             "--data-dir", str(data_dir)],
        stdout=log, stderr=subprocess.STDOUT, cwd=REPO,
    )
    try:
        wait_for_http(base_url, proc)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=args.chromium)
            try:
                ctx = browser.new_context()
                ctx.add_init_script("delete window.showOpenFilePicker")  # use the <input type=file> fallback
                print(f"compile-hook smoke test: Chromium {browser.version}, {base_url}")
                smoke = Smoke(ctx, base_url, args.wait)
                run(smoke)
            finally:
                browser.close()
    finally:
        proc.terminate()
        shutil.rmtree(data_dir, ignore_errors=True)
    print(f"{smoke.failures} failed" if smoke.failures else "all passed")
    return 1 if smoke.failures else 0


if __name__ == "__main__":
    sys.exit(main())
