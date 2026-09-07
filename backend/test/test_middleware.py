# SPDX-License-Identifier: Apache-2.0
# backend/test/test_middleware.py
#
# Posture-1's Host allowlist is the entire security surface this backend
# ships with by default (docs/working-notes/backend-editor-auth-and-protocol.md
# §1) -- worth testing directly against a real aiohttp app/client, not just
# reading the middleware and trusting it.

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend.middleware import host_allowlist_middleware


async def _ok(request: web.Request) -> web.Response:
    return web.Response(text="ok")


def _make_app(allowed_hosts=frozenset({"localhost", "127.0.0.1"})) -> web.Application:
    app = web.Application(middlewares=[host_allowlist_middleware(allowed_hosts)])
    app.router.add_get("/", _ok)
    return app


@pytest.mark.asyncio
async def test_allowlisted_host_passes_through() -> None:
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.get("/", headers={"Host": "localhost:8765"})
        assert resp.status == 200
        assert await resp.text() == "ok"


@pytest.mark.asyncio
async def test_non_allowlisted_host_is_rejected() -> None:
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.get("/", headers={"Host": "evil.example:8765"})
        assert resp.status == 403
        assert "NODE_ERROR" in await resp.text()


@pytest.mark.asyncio
async def test_ipv6_loopback_literal_is_allowlisted() -> None:
    async with TestClient(TestServer(_make_app(frozenset({"[::1]"})))) as client:
        resp = await client.get("/", headers={"Host": "[::1]:8765"})
        assert resp.status == 200


@pytest.mark.asyncio
async def test_dns_rebinding_shape_is_rejected() -> None:
    # The actual attack this middleware exists for: a browser resolves an
    # attacker hostname to 127.0.0.1 and connects, but the Host header still
    # reads the attacker's hostname -- the browser can't forge it.
    async with TestClient(TestServer(_make_app())) as client:
        resp = await client.get("/", headers={"Host": "attacker-controlled.example"})
        assert resp.status == 403
