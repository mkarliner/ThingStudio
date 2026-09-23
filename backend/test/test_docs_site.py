# SPDX-License-Identifier: Apache-2.0
# backend/test/test_docs_site.py -- /docs/ serving of the built user docs (docs_site.py).

from __future__ import annotations

import pytest
from aiohttp.test_utils import TestClient, TestServer
from yarl import URL

from thingstudio_backend.app import create_app
from thingstudio_backend.docs_site import ONLINE_DOCS_URL


def _built_site(tmp_path):
    site = tmp_path / "site"
    (site / "installing-micropython").mkdir(parents=True)
    (site / "index.html").write_text("<h1>home</h1>")
    (site / "installing-micropython" / "index.html").write_text("<h1>install mp</h1>")
    (site / "assets").mkdir()
    (site / "assets" / "app.css").write_text("body{}")
    (tmp_path / "secret.txt").write_text("outside the docs dir")
    return site


def _client(tmp_path, docs_dir) -> TestClient:
    return TestClient(TestServer(create_app(data_dir=tmp_path / "data", docs_dir=docs_dir)))


@pytest.mark.asyncio
async def test_serves_directory_pages_and_assets(tmp_path) -> None:
    async with _client(tmp_path, _built_site(tmp_path)) as client:
        r = await client.get("/docs/installing-micropython/")
        assert r.status == 200
        assert "install mp" in await r.text()
        r = await client.get("/docs/")
        assert "home" in await r.text()
        r = await client.get("/docs/assets/app.css")
        assert r.status == 200


@pytest.mark.asyncio
async def test_redirects_to_trailing_slash_so_relative_links_resolve(tmp_path) -> None:
    async with _client(tmp_path, _built_site(tmp_path)) as client:
        r = await client.get("/docs/installing-micropython", allow_redirects=False)
        assert r.status == 302
        assert r.headers["Location"] == "/docs/installing-micropython/"
        r = await client.get("/docs", allow_redirects=False)
        assert r.headers["Location"] == "/docs/"


@pytest.mark.asyncio
async def test_missing_page_is_404(tmp_path) -> None:
    async with _client(tmp_path, _built_site(tmp_path)) as client:
        r = await client.get("/docs/no-such-page/")
        assert r.status == 404


@pytest.mark.asyncio
async def test_cannot_escape_the_docs_dir(tmp_path) -> None:
    async with _client(tmp_path, _built_site(tmp_path)) as client:
        r = await client.get("/docs/../secret.txt")  # the client normalises this to /secret.txt
        assert r.status != 200
        assert "outside" not in await r.text()
        # Sent un-normalised (encoded=True), so the server itself sees the dot segments.
        raw = URL(f"http://{client.host}:{client.port}/docs/%2e%2e/secret.txt", encoded=True)
        r = await client.session.get(raw)
        assert r.status != 200
        assert "outside" not in await r.text()


@pytest.mark.asyncio
async def test_unbuilt_docs_explain_and_link_online_copy(tmp_path) -> None:
    async with _client(tmp_path, tmp_path / "never-built") as client:
        r = await client.get("/docs/installing-micropython/")
        assert r.status == 503
        body = await r.text()
        assert "aren't built" in body
        assert ONLINE_DOCS_URL + "installing-micropython/" in body
        assert "mkdocs build" in body


@pytest.mark.asyncio
async def test_a_stale_docs_build_shows_a_banner(tmp_path) -> None:
    """Real case, 2026-09-23: the Getting started page was rewritten but the served copy still showed
    the old one -- `mkdocs build` hadn't been rerun, and nothing said so."""
    import os

    site = _built_site(tmp_path)
    (site / "installing-micropython" / "index.html").write_text("<html><body><h1>install mp</h1></body></html>")
    (tmp_path / "mkdocs.yml").write_text("site_name: x")
    guide = tmp_path / "docs" / "user-guide"
    guide.mkdir(parents=True)
    (guide / "getting-started.md").write_text("# new")
    old = (guide / "getting-started.md").stat().st_mtime - 100
    os.utime(site / "index.html", (old, old))
    os.utime(tmp_path / "mkdocs.yml", (old - 1, old - 1))  # only the page changed since the build
    async with _client(tmp_path, site) as client:
        body = await (await client.get("/docs/installing-micropython/")).text()
        assert "docs build is out of date" in body and "getting-started.md" in body and "mkdocs build" in body
        # CSS and other assets are served untouched.
        assert (await (await client.get("/docs/assets/app.css")).text()) == "body{}"
        new = (guide / "getting-started.md").stat().st_mtime + 100
        os.utime(site / "index.html", (new, new))
        assert "out of date" not in await (await client.get("/docs/installing-micropython/")).text()
