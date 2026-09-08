# SPDX-License-Identifier: Apache-2.0
# backend/test/test_cors.py
#
# cors_middleware (cors.py) is the only thing standing between the editor's
# fetch()-based admin-API client and a browser silently discarding every
# response as a failed CORS check -- worth testing directly against a real
# aiohttp app/client, same posture test_middleware.py already takes for the
# Host allowlist.

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend.cors import cors_middleware


async def _ok(request: web.Request) -> web.Response:
    return web.Response(text="ok")


async def _err(request: web.Request) -> web.Response:
    return web.json_response({"error": "NODE_ERROR: something failed"}, status=400)


def _make_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/ok", _ok)
    app.router.add_put("/ok", _ok)
    app.router.add_get("/err", _err)
    return app


@pytest.mark.asyncio
async def test_reflects_request_origin_on_a_normal_response() -> None:
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.get("/ok", headers={"Origin": "http://localhost:5173"})
        assert resp.status == 200
        assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
        assert resp.headers["Vary"] == "Origin"


@pytest.mark.asyncio
async def test_a_different_origin_is_reflected_back_too() -> None:
    # Not a fixed allowlisted value -- whatever Origin the request carries,
    # per this module's documented reflect-any-Origin policy.
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.get("/ok", headers={"Origin": "https://some-other-host:9999"})
        assert resp.headers["Access-Control-Allow-Origin"] == "https://some-other-host:9999"


@pytest.mark.asyncio
async def test_no_origin_header_means_no_cors_headers_added() -> None:
    # A same-origin request (or a non-browser client) never sends Origin --
    # nothing for this middleware to reflect, and no header is fabricated.
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.get("/ok")
        assert "Access-Control-Allow-Origin" not in resp.headers


@pytest.mark.asyncio
async def test_error_response_body_still_carries_cors_headers() -> None:
    # The whole point of wrapping every response, not just successful ones --
    # an admin-API error the editor can't read because the browser blocked
    # it as a failed CORS check would be strictly worse than the error.
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.get("/err", headers={"Origin": "http://localhost:5173"})
        assert resp.status == 400
        assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
        body = await resp.json()
        assert "NODE_ERROR" in body["error"]


@pytest.mark.asyncio
async def test_preflight_options_is_answered_directly_with_no_route() -> None:
    # No OPTIONS route is registered anywhere in this app (mirrors
    # admin_api.py's real routes, which only register GET/PUT/DELETE) --
    # this confirms the middleware itself answers the preflight rather than
    # it 404ing before ever reaching a route.
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.options(
            "/ok",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "PUT",
            },
        )
        assert resp.status == 204
        assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
        assert "PUT" in resp.headers["Access-Control-Allow-Methods"]
        assert "Content-Type" in resp.headers["Access-Control-Allow-Headers"]


@pytest.mark.asyncio
async def test_plain_options_without_preflight_header_is_not_treated_as_preflight() -> None:
    # A bare OPTIONS with no Access-Control-Request-Method isn't a real CORS
    # preflight (browsers always send that header on one) -- falls through
    # to the router like any other method, and 405s the same as it would
    # with no CORS middleware installed at all, rather than being silently
    # swallowed into a 204 that never actually reaches the app.
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.options("/ok", headers={"Origin": "http://localhost:5173"})
        assert resp.status != 204


@pytest.mark.asyncio
async def test_real_put_request_after_preflight_still_gets_cors_header() -> None:
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.put("/ok", headers={"Origin": "http://localhost:5173"})
        assert resp.status == 200
        assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
