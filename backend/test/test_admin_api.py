# SPDX-License-Identifier: Apache-2.0
# backend/test/test_admin_api.py
#
# The HTTP half of the persisted-data protocol (docs/working-notes/
# outstanding-items/backend-persisted-data-protocol.md, [P1]) -- exercised
# against a real aiohttp app/client, same pattern test_middleware.py and
# test_ws_relay.py already use, with a real PersistedStore backed by
# tmp_path rather than a mock (persisted_store.py's own tests cover the
# store's internals; this file is about the routes' request/response shape
# and error mapping).

import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend.admin_api import make_admin_routes
from thingstudio_backend.persisted_store import PersistedStore


def _client(tmp_path) -> TestClient:
    store = PersistedStore(base_dir=tmp_path / ".thingstudio")
    app = web.Application()
    app.router.add_routes(make_admin_routes(store))
    return TestClient(TestServer(app))


# -- flows ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_flows_starts_empty(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/flows")
        assert resp.status == 200
        assert await resp.json() == {"flows": []}


@pytest.mark.asyncio
async def test_put_then_get_flow_round_trips(tmp_path) -> None:
    body = json.dumps({"formatVersion": 1, "flowName": "x", "nodes": [], "edges": [], "layout": {}, "configs": []})
    async with _client(tmp_path) as client:
        put_resp = await client.put("/api/flows/my-flow", data=body)
        assert put_resp.status == 200
        assert (await put_resp.json())["ok"] is True

        get_resp = await client.get("/api/flows/my-flow")
        assert get_resp.status == 200
        assert get_resp.content_type == "application/json"
        assert await get_resp.text() == body

        list_resp = await client.get("/api/flows")
        assert (await list_resp.json())["flows"] == ["my-flow"]


@pytest.mark.asyncio
async def test_get_missing_flow_is_404(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/flows/nope")
        assert resp.status == 404
        assert "NODE_ERROR" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_put_invalid_json_flow_is_400(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.put("/api/flows/bad", data="{not json")
        assert resp.status == 400
        assert "NODE_ERROR" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_put_flow_with_bad_name_is_400_not_500(tmp_path) -> None:
    async with _client(tmp_path) as client:
        # URL-encoded traversal attempt in the {name} path segment.
        resp = await client.put("/api/flows/..%2Fescape", data="{}")
        assert resp.status == 400


@pytest.mark.asyncio
async def test_delete_flow(tmp_path) -> None:
    async with _client(tmp_path) as client:
        await client.put("/api/flows/f", data="{}")
        del_resp = await client.delete("/api/flows/f")
        assert del_resp.status == 200
        get_resp = await client.get("/api/flows/f")
        assert get_resp.status == 404


@pytest.mark.asyncio
async def test_delete_missing_flow_is_404(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.delete("/api/flows/nope")
        assert resp.status == 404


# -- custom node packages -----------------------------------------------------


@pytest.mark.asyncio
async def test_list_custom_nodes_starts_empty(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/custom-nodes")
        assert resp.status == 200
        assert await resp.json() == {"customNodes": []}


@pytest.mark.asyncio
async def test_put_then_get_custom_node_round_trips(tmp_path) -> None:
    payload = {"descriptor": '{"kind": "sink"}', "implementation": "async def run(msg, properties):\n    pass\n"}
    async with _client(tmp_path) as client:
        put_resp = await client.put("/api/custom-nodes/blink", json=payload)
        assert put_resp.status == 200

        get_resp = await client.get("/api/custom-nodes/blink")
        assert get_resp.status == 200
        assert await get_resp.json() == payload

        list_resp = await client.get("/api/custom-nodes")
        assert (await list_resp.json())["customNodes"] == ["blink"]


@pytest.mark.asyncio
async def test_get_missing_custom_node_is_404(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/custom-nodes/nope")
        assert resp.status == 404


@pytest.mark.asyncio
async def test_put_custom_node_missing_fields_is_400(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.put("/api/custom-nodes/bad", json={"descriptor": "{}"})
        assert resp.status == 400
        assert "NODE_ERROR" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_put_custom_node_non_json_body_is_400(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.put(
            "/api/custom-nodes/bad", data="not json", headers={"Content-Type": "application/json"}
        )
        assert resp.status == 400


@pytest.mark.asyncio
async def test_put_custom_node_invalid_descriptor_json_is_400(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.put("/api/custom-nodes/bad", json={"descriptor": "not json", "implementation": "pass"})
        assert resp.status == 400


@pytest.mark.asyncio
async def test_delete_custom_node(tmp_path) -> None:
    async with _client(tmp_path) as client:
        await client.put("/api/custom-nodes/gone", json={"descriptor": "{}", "implementation": "pass"})
        del_resp = await client.delete("/api/custom-nodes/gone")
        assert del_resp.status == 200
        get_resp = await client.get("/api/custom-nodes/gone")
        assert get_resp.status == 404


# -- posture-1 coverage -------------------------------------------------------
# (Confirms these routes inherit the Host allowlist the same way /ws does --
# not re-testing the middleware itself, test_middleware.py already does
# that; this just confirms admin routes don't bypass it when wired into the
# real app via app.py's create_app, which installs the middleware at the
# Application level around every route including these.)


@pytest.mark.asyncio
async def test_admin_routes_covered_by_host_allowlist_when_wired_into_real_app(tmp_path) -> None:
    from thingstudio_backend.app import create_app

    app = create_app(data_dir=tmp_path / ".thingstudio")
    async with TestClient(TestServer(app)) as client:
        resp = await client.get("/api/flows", headers={"Host": "evil.example"})
        assert resp.status == 403
        resp_ok = await client.get("/api/flows", headers={"Host": "localhost"})
        assert resp_ok.status == 200


@pytest.mark.asyncio
async def test_admin_routes_carry_cors_headers_when_wired_into_real_app(tmp_path) -> None:
    # Same shape as the Host-allowlist coverage test above, for the other
    # cross-cutting middleware admin_api.py's routes inherit for free
    # (cors.py -- not re-testing the middleware itself, test_cors.py already
    # does that): confirms a real editor fetch() from a different origin
    # would actually get a readable response from these routes.
    from thingstudio_backend.app import create_app

    app = create_app(data_dir=tmp_path / ".thingstudio")
    async with TestClient(TestServer(app)) as client:
        resp = await client.get("/api/flows", headers={"Origin": "http://localhost:5173"})
        assert resp.status == 200
        assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
