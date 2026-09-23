# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/docs_site.py
#
# Serves the built user docs (`mkdocs build` -> site/) at /docs/, so an installed copy's help works
# with no internet connection. Mike's call, 2026-09-23: docs are hosted locally by the backend for
# anyone who has installed Thingstudio, and on GitHub Pages only for pre-install reading. The editor
# links console messages here (board-diagnosis.ts), so a user who hits "no MicroPython" gets the
# install page without needing the net.
#
# Not aiohttp's add_static(): mkdocs' default use_directory_urls writes page "foo" as foo/index.html
# and links to it as foo/, which add_static() won't resolve to index.html.
#
# If the docs haven't been built on this machine (a dev checkout that never ran `mkdocs build`),
# /docs/ answers with a short page saying so and linking the online copy -- a legible failure, never
# a bare 404 for a link the editor itself produced. Packaging (MVP item 7) is expected to bundle the
# built site and pass --docs-dir, the same injection pattern runtime_installer.py uses for
# device-runtime/src.

from __future__ import annotations

import html
import logging
from pathlib import Path

from aiohttp import web

logger = logging.getLogger(__name__)

ONLINE_DOCS_URL = "https://mkarliner.github.io/ThingStudio/"


def default_docs_dir() -> Path:
    """backend/src/thingstudio_backend/docs_site.py -> repo root -> site/ (mkdocs.yml's site_dir).
    Dev-checkout default only; see this module's header."""
    return Path(__file__).resolve().parents[3] / "site"


def _not_built_page(docs_dir: Path, path: str) -> web.Response:
    online = ONLINE_DOCS_URL + path
    body = (
        "<!doctype html><meta charset=utf-8><title>Thingstudio docs not built</title>"
        "<body style='font-family:system-ui;max-width:40em;margin:3em auto;line-height:1.5'>"
        "<h1>Docs aren't built on this machine</h1>"
        f"<p>The backend looked for them in <code>{html.escape(str(docs_dir))}</code>.</p>"
        f"<p>Read this page online instead: <a href='{html.escape(online)}'>{html.escape(online)}</a></p>"
        "<p>To build them locally, run <code>pip install mkdocs==1.6.1 mkdocs-material==9.7.7</code> "
        "then <code>mkdocs build</code> in the repo root, and reload.</p>"
    )
    return web.Response(status=503, text=body, content_type="text/html")


def make_docs_routes(docs_dir: Path) -> list[web.RouteDef]:
    root = docs_dir.resolve()
    if not (root / "index.html").is_file():
        logger.warning("user docs not built at %s -- /docs/ will point users at %s", root, ONLINE_DOCS_URL)

    async def redirect_to_slash(_request: web.Request) -> web.StreamResponse:
        raise web.HTTPFound("/docs/")

    async def serve(request: web.Request) -> web.StreamResponse:
        rel = request.match_info["path"]
        if not (root / "index.html").is_file():
            # Checked per request, not once at startup: building the docs shouldn't need a restart.
            return _not_built_page(root, rel)
        target = (root / rel).resolve()
        if not target.is_relative_to(root):
            raise web.HTTPNotFound()
        if target.is_dir():
            if rel and not rel.endswith("/"):
                # Relative links inside a mkdocs page only resolve from the trailing-slash form.
                raise web.HTTPFound(f"/docs/{rel}/")
            target = target / "index.html"
        if not target.is_file():
            raise web.HTTPNotFound()
        # mkdocs page names don't change between builds, so the browser must revalidate (same
        # stale-page trap editor_site.py hit with index.html).
        return web.FileResponse(target, headers={"Cache-Control": "no-cache"})

    return [web.get("/docs", redirect_to_slash), web.get("/docs/{path:.*}", serve)]
