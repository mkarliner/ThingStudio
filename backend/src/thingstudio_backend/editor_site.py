# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/editor_site.py
#
# Serves the built editor (`npm run build` -> editor/dist/) at /, so one command starts everything:
# run the backend, the editor opens in the browser -- the Node-RED model road-to-mvp.md chose. Mike,
# 2026-09-23: "the backend should start the editor as well."
#
# Replaces a bare add_static("/") (which never served index.html for "/") with the same small
# handler shape docs_site.py uses. Registered last, so /ws, /api/* and /docs/* always win.
#
# Two legible failures instead of silent ones:
#   - editor not built -> / answers with a page saying so and giving the build command.
#   - editor built but older than its sources (a dev checkout) -> a warning at startup naming the
#     newest changed file, AND a banner across the top of the editor page itself. Found necessary on
#     day one: Mike's editor/dist was a month older than editor/src, and the terminal warning alone
#     went unnoticed -- the browser just showed a month-old editor.
#
# Packaging (MVP item 7) bundles a built editor and passes --static-dir; the dev default is the repo's
# editor/dist, same injection pattern as docs_site.py and runtime_installer.py.

from __future__ import annotations

import html
import logging
import mimetypes
from pathlib import Path

from aiohttp import web

logger = logging.getLogger(__name__)

# The editor loads mpy-cross as an ES module + WASM. Browsers refuse a module script or
# WebAssembly.instantiateStreaming() with the wrong Content-Type, and Python's mimetypes table for
# these varies by OS/version (it reads the platform's own mime.types where there is one).
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")


def default_editor_dir() -> Path:
    """backend/src/thingstudio_backend/editor_site.py -> repo root -> editor/dist."""
    return Path(__file__).resolve().parents[3] / "editor" / "dist"


def stale_source(editor_dir: Path) -> Path | None:
    """In a dev checkout (editor/src next to editor/dist), the newest source file changed after the
    last build, else None. Only checks editor/src and editor/index.html -- enough to catch "forgot to
    rebuild", not a full dependency graph."""
    built = editor_dir / "index.html"
    src = editor_dir.parent / "src"
    if not built.is_file() or not src.is_dir():
        return None
    built_at = built.stat().st_mtime
    candidates = [editor_dir.parent / "index.html", *src.rglob("*")]
    newest = max(
        (p for p in candidates if p.is_file() and p.name != ".DS_Store"),
        key=lambda p: p.stat().st_mtime,
        default=None,
    )
    if newest is not None and newest.stat().st_mtime > built_at:
        return newest
    return None


def _stale_banner(newer: Path) -> str:
    return (
        "<div id='ts-stale-build' style='position:fixed;top:0;left:0;right:0;z-index:99999;"
        "background:#b3261e;color:#fff;font:14px/1.4 system-ui;padding:8px 12px'>"
        "This editor build is out of date: "
        f"<code>{html.escape(newer.name)}</code> changed since it was built. "
        "Rebuild with <code>cd editor &amp;&amp; npm run build</code>, then reload this page."
        "</div>"
    )


def _index_with_banner(index: Path, newer: Path) -> web.Response:
    """index.html with the stale-build banner inserted just after <body>. Served uncached so the
    banner goes away on the first reload after a rebuild."""
    page = index.read_text(encoding="utf-8")
    banner = _stale_banner(newer)
    i = page.find("<body")
    j = page.find(">", i) if i != -1 else -1
    page = page[: j + 1] + banner + page[j + 1 :] if j != -1 else banner + page
    return web.Response(text=page, content_type="text/html", headers={"Cache-Control": "no-store"})


def _not_built_page(editor_dir: Path) -> web.Response:
    body = (
        "<!doctype html><meta charset=utf-8><title>Thingstudio editor not built</title>"
        "<body style='font-family:system-ui;max-width:40em;margin:3em auto;line-height:1.5'>"
        "<h1>The editor isn't built on this machine</h1>"
        f"<p>The backend looked for it in <code>{editor_dir}</code>.</p>"
        "<p>Build it with <code>cd editor &amp;&amp; npm ci &amp;&amp; npm run build</code>, then reload "
        "this page. No restart needed.</p>"
        "<p>The <a href='/docs/'>docs</a> are served separately and may still work.</p>"
    )
    return web.Response(status=503, text=body, content_type="text/html")


def make_editor_routes(editor_dir: Path) -> list[web.RouteDef]:
    root = editor_dir.resolve()
    if not (root / "index.html").is_file():
        logger.warning("editor not built at %s -- / will say so. Build: cd editor && npm ci && npm run build", root)
    else:
        newer = stale_source(root)
        if newer is not None:
            logger.warning(
                "editor build at %s is older than its sources (%s changed since) -- you may be running a "
                "stale editor. Rebuild: cd editor && npm run build",
                root,
                newer,
            )

    async def serve(request: web.Request) -> web.StreamResponse:
        rel = request.match_info.get("path", "")
        if not (root / "index.html").is_file():
            return _not_built_page(root)
        target = (root / rel).resolve()
        if not target.is_relative_to(root):
            raise web.HTTPNotFound()
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            raise web.HTTPNotFound()
        if target == root / "index.html":
            # Re-checked on every page load, not once at startup: rebuilding mustn't need a restart,
            # and an edit made while the backend runs should show up too.
            newer = stale_source(root)
            if newer is not None:
                return _index_with_banner(target, newer)
        response = web.FileResponse(target)
        if not target.is_relative_to(root / "assets"):
            # Only Vite's assets/ files have content hashes in their names. Everything else --
            # index.html above all -- keeps its name across builds, so the browser must check back
            # every time. Without this, Chrome heuristically cached the August index.html and kept
            # showing it after a rebuild (Mike, 2026-09-23).
            response.headers["Cache-Control"] = "no-cache"
        return response

    return [web.get("/", serve), web.get("/{path:.*}", serve)]
