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


# -- WiFi/MQTT-broker credentials --------------------------------------------


@pytest.mark.asyncio
async def test_list_credentials_starts_empty(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/credentials/wifi")
        assert resp.status == 200
        assert await resp.json() == {"credentials": []}


@pytest.mark.asyncio
async def test_put_then_get_credential_round_trips(tmp_path) -> None:
    body = json.dumps({"ssid": "home-network", "password": "hunter2"})
    async with _client(tmp_path) as client:
        put_resp = await client.put("/api/credentials/wifi/home-wifi", data=body)
        assert put_resp.status == 200
        assert (await put_resp.json())["ok"] is True

        get_resp = await client.get("/api/credentials/wifi/home-wifi")
        assert get_resp.status == 200
        assert get_resp.content_type == "application/json"
        assert await get_resp.text() == body

        list_resp = await client.get("/api/credentials/wifi")
        assert (await list_resp.json())["credentials"] == ["home-wifi"]


@pytest.mark.asyncio
async def test_get_missing_credential_is_404(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/credentials/wifi/nope")
        assert resp.status == 404
        assert "NODE_ERROR" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_put_invalid_json_credential_is_400(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.put("/api/credentials/wifi/bad", data="{not json")
        assert resp.status == 400
        assert "NODE_ERROR" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_invalid_credential_type_is_400_not_500(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/credentials/not-a-real-type")
        assert resp.status == 400
        resp2 = await client.put("/api/credentials/not-a-real-type/n", data="{}")
        assert resp2.status == 400


@pytest.mark.asyncio
async def test_credential_types_are_independent_namespaces(tmp_path) -> None:
    async with _client(tmp_path) as client:
        await client.put("/api/credentials/wifi/shared-name", data='{"ssid": "x", "password": "y"}')
        await client.put(
            "/api/credentials/mqtt-broker/shared-name",
            data='{"broker": "b", "port": 1883, "username": "", "password": ""}',
        )
        wifi_list = await client.get("/api/credentials/wifi")
        broker_list = await client.get("/api/credentials/mqtt-broker")
        assert (await wifi_list.json())["credentials"] == ["shared-name"]
        assert (await broker_list.json())["credentials"] == ["shared-name"]


@pytest.mark.asyncio
async def test_delete_credential(tmp_path) -> None:
    async with _client(tmp_path) as client:
        await client.put("/api/credentials/mqtt-broker/b", data='{"broker": "x", "port": 1883}')
        del_resp = await client.delete("/api/credentials/mqtt-broker/b")
        assert del_resp.status == 200
        get_resp = await client.get("/api/credentials/mqtt-broker/b")
        assert get_resp.status == 404


@pytest.mark.asyncio
async def test_delete_missing_credential_is_404(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.delete("/api/credentials/wifi/nope")
        assert resp.status == 404


@pytest.mark.asyncio
async def test_credential_routes_covered_by_host_allowlist_when_wired_into_real_app(tmp_path) -> None:
    from thingstudio_backend.app import create_app

    app = create_app(data_dir=tmp_path / ".thingstudio")
    async with TestClient(TestServer(app)) as client:
        resp = await client.get("/api/credentials/wifi", headers={"Host": "evil.example"})
        assert resp.status == 403
        resp_ok = await client.get("/api/credentials/wifi", headers={"Host": "localhost"})
        assert resp_ok.status == 200


# -- per-node presets ---------------------------------------------------
# docs/working-notes/outstanding-items/presets-design.md. {type} is open
# (any node-kind string), not a fixed tuple -- so there's no "unknown type"
# 400 case to test the way credentials has one; persisted_store.py's own
# name-pattern rejection is exercised in test_persisted_store.py instead.


@pytest.mark.asyncio
async def test_list_presets_starts_empty(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/presets/display_spi")
        assert resp.status == 200
        assert await resp.json() == {"presets": []}


@pytest.mark.asyncio
async def test_put_then_get_preset_round_trips(tmp_path) -> None:
    body = json.dumps({"controller": "st7789", "sck": 12, "mosi": 11, "dc": 13})
    async with _client(tmp_path) as client:
        put_resp = await client.put("/api/presets/display_spi/cyd", data=body)
        assert put_resp.status == 200
        assert (await put_resp.json())["ok"] is True

        get_resp = await client.get("/api/presets/display_spi/cyd")
        assert get_resp.status == 200
        assert get_resp.content_type == "application/json"
        assert await get_resp.text() == body

        list_resp = await client.get("/api/presets/display_spi")
        assert (await list_resp.json())["presets"] == [{"name": "cyd", "valid": True, "error": None}]


@pytest.mark.asyncio
async def test_get_missing_preset_is_404(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.get("/api/presets/display_spi/nope")
        assert resp.status == 404
        assert "NODE_ERROR" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_put_invalid_json_preset_is_400(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.put("/api/presets/display_spi/bad", data="{not json")
        assert resp.status == 400
        assert "NODE_ERROR" in (await resp.json())["error"]


@pytest.mark.asyncio
async def test_preset_types_are_independent_namespaces(tmp_path) -> None:
    async with _client(tmp_path) as client:
        await client.put("/api/presets/display_spi/shared-name", data='{"sck": 12}')
        await client.put("/api/presets/display_i2c/shared-name", data='{"scl": 22}')
        spi_list = await client.get("/api/presets/display_spi")
        i2c_list = await client.get("/api/presets/display_i2c")
        assert (await spi_list.json())["presets"] == [{"name": "shared-name", "valid": True, "error": None}]
        assert (await i2c_list.json())["presets"] == [{"name": "shared-name", "valid": True, "error": None}]


@pytest.mark.asyncio
async def test_delete_preset(tmp_path) -> None:
    async with _client(tmp_path) as client:
        await client.put("/api/presets/display_spi/cyd", data='{"sck": 12}')
        del_resp = await client.delete("/api/presets/display_spi/cyd")
        assert del_resp.status == 200
        get_resp = await client.get("/api/presets/display_spi/cyd")
        assert get_resp.status == 404


@pytest.mark.asyncio
async def test_delete_missing_preset_is_404(tmp_path) -> None:
    async with _client(tmp_path) as client:
        resp = await client.delete("/api/presets/display_spi/nope")
        assert resp.status == 404


@pytest.mark.asyncio
async def test_list_presets_flags_a_hand_edited_broken_file(tmp_path) -> None:
    # Simulates a preset file broken by a hand edit outside the app (Mike's
    # explicit ask: this has to be "a very obvious syntax error flagged"),
    # written directly rather than through PUT, which would itself reject
    # the bad JSON.
    async with _client(tmp_path) as client:
        await client.put("/api/presets/display_spi/good", data='{"sck": 12}')
        d = tmp_path / ".thingstudio" / "presets" / "display_spi"
        (d / "broken.json").write_text("{not valid json", encoding="utf-8")

        list_resp = await client.get("/api/presets/display_spi")
        assert list_resp.status == 200
        presets = {p["name"]: p for p in (await list_resp.json())["presets"]}
        assert presets["good"]["valid"] is True
        assert presets["good"]["error"] is None
        assert presets["broken"]["valid"] is False
        assert presets["broken"]["error"] is not None and "not valid JSON" in presets["broken"]["error"]

        get_resp = await client.get("/api/presets/display_spi/broken")
        assert get_resp.status == 400
        assert "NODE_ERROR" in (await get_resp.json())["error"]


@pytest.mark.asyncio
async def test_preset_routes_covered_by_host_allowlist_when_wired_into_real_app(tmp_path) -> None:
    from thingstudio_backend.app import create_app

    app = create_app(data_dir=tmp_path / ".thingstudio")
    async with TestClient(TestServer(app)) as client:
        resp = await client.get("/api/presets/display_spi", headers={"Host": "evil.example"})
        assert resp.status == 403
        resp_ok = await client.get("/api/presets/display_spi", headers={"Host": "localhost"})
        assert resp_ok.status == 200


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
