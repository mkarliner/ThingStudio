# SPDX-License-Identifier: Apache-2.0
# backend/test/test_editor_site.py -- serving the built editor at / (editor_site.py).

from __future__ import annotations

import os

import pytest
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend.app import create_app
from thingstudio_backend.editor_site import stale_source


def _built_editor(tmp_path):
    dist = tmp_path / "editor" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "vendor" / "mpy-cross").mkdir(parents=True)
    (dist / "index.html").write_text("<h1>editor</h1>")
    (dist / "assets" / "index.js").write_text("console.log(1)")
    (dist / "vendor" / "mpy-cross" / "mpy-cross.wasm").write_bytes(b"\0asm")
    (dist / "vendor" / "mpy-cross" / "load.mjs").write_text("export {}")
    (tmp_path / "editor" / "secret.txt").write_text("outside dist")
    return dist


def _client(tmp_path, editor_dir, docs_dir=None) -> TestClient:
    return TestClient(
        TestServer(create_app(data_dir=tmp_path / "data", static_dir=editor_dir, docs_dir=docs_dir or tmp_path / "nodocs"))
    )


@pytest.mark.asyncio
async def test_serves_index_at_root_and_assets(tmp_path) -> None:
    async with _client(tmp_path, _built_editor(tmp_path)) as client:
        r = await client.get("/")
        assert r.status == 200
        assert "editor" in await r.text()
        r = await client.get("/assets/index.js")
        assert r.status == 200
        assert r.headers["Content-Type"] in ("text/javascript", "application/javascript")


@pytest.mark.asyncio
async def test_wasm_and_mjs_get_the_content_types_browsers_require(tmp_path) -> None:
    async with _client(tmp_path, _built_editor(tmp_path)) as client:
        r = await client.get("/vendor/mpy-cross/mpy-cross.wasm")
        assert r.headers["Content-Type"] == "application/wasm"
        r = await client.get("/vendor/mpy-cross/load.mjs")
        assert r.headers["Content-Type"] in ("text/javascript", "application/javascript")


@pytest.mark.asyncio
async def test_missing_file_is_404_and_cannot_escape_dist(tmp_path) -> None:
    async with _client(tmp_path, _built_editor(tmp_path)) as client:
        assert (await client.get("/nope.js")).status == 404
        r = await client.get("/%2e%2e/secret.txt")
        assert r.status == 404


@pytest.mark.asyncio
async def test_other_routes_still_win_over_the_editor(tmp_path) -> None:
    async with _client(tmp_path, _built_editor(tmp_path)) as client:
        r = await client.get("/api/flows")
        assert r.status != 404 or "editor" not in await r.text()
        r = await client.get("/docs/")
        assert "aren't built" in await r.text()  # docs_site's page, not the editor's index


@pytest.mark.asyncio
async def test_unbuilt_editor_says_how_to_build_it(tmp_path) -> None:
    async with _client(tmp_path, tmp_path / "editor" / "dist") as client:
        r = await client.get("/")
        assert r.status == 503
        assert "npm run build" in await r.text()


def test_stale_source_names_a_source_file_newer_than_the_build(tmp_path) -> None:
    dist = _built_editor(tmp_path)
    src = tmp_path / "editor" / "src"
    src.mkdir()
    changed = src / "main.ts"
    changed.write_text("x")
    old = dist.joinpath("index.html").stat().st_mtime - 100
    os.utime(dist / "index.html", (old, old))
    assert stale_source(dist) == changed


def test_stale_source_is_none_when_the_build_is_newer(tmp_path) -> None:
    dist = _built_editor(tmp_path)
    src = tmp_path / "editor" / "src"
    src.mkdir()
    (src / "main.ts").write_text("x")
    new = (src / "main.ts").stat().st_mtime + 100
    os.utime(dist / "index.html", (new, new))
    os.utime(tmp_path / "editor" / "secret.txt", (0, 0))
    assert stale_source(dist) is None


@pytest.mark.asyncio
async def test_a_stale_build_shows_a_banner_in_the_page_itself(tmp_path) -> None:
    """Real case, 2026-09-23: the terminal warning went unnoticed and the browser showed a month-old
    editor with nothing to say so."""
    dist = _built_editor(tmp_path)
    (dist / "index.html").write_text("<html><body class='x'><h1>editor</h1></body></html>")
    src = tmp_path / "editor" / "src"
    src.mkdir()
    (src / "main.ts").write_text("x")
    old = (src / "main.ts").stat().st_mtime - 100
    os.utime(dist / "index.html", (old, old))
    async with _client(tmp_path, dist) as client:
        r = await client.get("/")
        body = await r.text()
        assert "out of date" in body and "main.ts" in body and "npm run build" in body
        assert body.index("<body class='x'>") < body.index("ts-stale-build") < body.index("<h1>editor")
        assert r.headers["Cache-Control"] == "no-store"
        # Rebuilt (index newer than sources): banner gone, no restart needed.
        new = (src / "main.ts").stat().st_mtime + 100
        os.utime(dist / "index.html", (new, new))
        assert "out of date" not in await (await client.get("/")).text()


@pytest.mark.asyncio
async def test_index_must_be_revalidated_but_hashed_assets_may_be_cached(tmp_path) -> None:
    """Real case, 2026-09-23: after a rebuild, Chrome kept showing a month-old cached index.html."""
    async with _client(tmp_path, _built_editor(tmp_path)) as client:
        assert (await client.get("/")).headers["Cache-Control"] == "no-cache"
        assert (await client.get("/vendor/mpy-cross/load.mjs")).headers["Cache-Control"] == "no-cache"
        assert "Cache-Control" not in (await client.get("/assets/index.js")).headers
