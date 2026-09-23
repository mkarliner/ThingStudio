# SPDX-License-Identifier: Apache-2.0
# backend/test/test_docs_site.py -- /docs/ serving of the built user docs (docs_site.py).

from __future__ import annotations

import pytest
from aiohttp.test_utils import TestClient, TestServer

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
        r = await client.get("/docs/../secret.txt")
        assert r.status == 404
        r = await client.get("/docs/%2e%2e/secret.txt")
        assert r.status == 404
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
