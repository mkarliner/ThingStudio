# SPDX-License-Identifier: Apache-2.0
# backend/test/test_user_libraries.py
#
# User libraries and custom-node bundles (2026-11-24): the conformance vectors of interfaces/library-format/ and
# interfaces/node-descriptor/vectors/bundles.json run against the real backend (PersistedStore + library_catalog),
# plus the published reserved-names list matching the code, and the HTTP surfaces that carry the results.

from __future__ import annotations

import json
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from thingstudio_backend import user_libraries
from thingstudio_backend.admin_api import make_admin_routes
from thingstudio_backend.library_catalog import library_catalog, library_problems
from thingstudio_backend.persisted_store import PersistedStore, PersistedStoreError

REPO = Path(__file__).resolve().parents[2]
LIBRARY_VECTORS = REPO / "interfaces" / "library-format" / "vectors" / "libraries.json"
BUNDLE_VECTORS = REPO / "interfaces" / "node-descriptor" / "vectors" / "bundles.json"
RESERVED = REPO / "interfaces" / "library-format" / "reserved-names.json"

_NODE_PORTS = {
    "source": {"inputs": [], "outputs": [{"name": "msg", "type": "any"}]},
    "sink": {"inputs": [{"name": "msg", "type": "any"}], "outputs": []},
    "transform": {"inputs": [{"name": "msg", "type": "any"}], "outputs": [{"name": "msg", "type": "any"}]},
}
_NODE_PY = {
    "source": "async def emit(properties):\n    return {'payload': 1}\n",
    "sink": "async def run(msg, properties):\n    pass\n",
    "transform": "async def run(msg, properties):\n    return msg\n",
}


def _expand(rel: str, text: str) -> str:
    """The vectors' tokens (vectors/README.md): a minimal valid package file of a kind."""
    stem = Path(rel).name.split(".")[0]
    if text.startswith("@node:"):
        kind = text[len("@node:"):]
        props = [{"name": "intervalMs", "label": "interval", "kind": "number", "default": 1000}] if kind == "source" else []
        return json.dumps({"type": f"custom/{stem}", "kind": kind, "label": stem, "ports": _NODE_PORTS[kind], "properties": props})
    if text.startswith("@py:"):
        return _NODE_PY[text[len("@py:"):]]
    return text


def _store(tmp_path: Path, tree: dict[str, str]) -> PersistedStore:
    base = tmp_path / ".thingstudio"
    for rel, text in tree.items():
        path = base / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_expand(rel, text), encoding="utf-8")
    return PersistedStore(base_dir=base)


def _cases(path: Path) -> list[dict]:
    return [c for c in json.loads(path.read_text()) if c.get("checkedBy") != "editor"]


def _check_case(tmp_path: Path, case: dict) -> None:
    store = _store(tmp_path, case["tree"])
    catalog, refusals = library_catalog(store)
    expect = case["expect"]

    user = [
        {"name": d.name, "files": [[f.board_name, f.board_name] for f in d.files], "requires": sorted(d.requires), "origin": d.origin}
        for d in catalog
        if d.source == "user"
    ]
    assert user == expect["libraries"], case["name"]

    assert len(refusals) == len(expect["refused"]), (case["name"], [r.message for r in refusals])
    for want in expect["refused"]:
        assert any(
            r.library == want["library"] and r.origin == want["origin"] and want["contains"] in r.message for r in refusals
        ), (case["name"], want, [r.message for r in refusals])

    problems = library_problems(refusals)
    listings, bundles = store.scan_custom_nodes(problems)
    if "packages" in expect:
        assert [p.name for p in listings if p.shadowed_by is None] == expect["packages"], case["name"]
    if "skippedBundles" in expect:
        skipped = [b for b in bundles if b.problems]
        assert len(skipped) == len(expect["skippedBundles"]), (case["name"], skipped)
        for want in expect["skippedBundles"]:
            assert any(
                b.name == want["bundle"] and want["contains"] in " ".join(b.problems) for b in skipped
            ), (case["name"], want, skipped)


@pytest.mark.parametrize("case", _cases(LIBRARY_VECTORS), ids=lambda c: c["name"])
def test_library_vectors(tmp_path: Path, case: dict) -> None:
    _check_case(tmp_path, case)


@pytest.mark.parametrize("case", _cases(BUNDLE_VECTORS), ids=lambda c: c["name"])
def test_bundle_vectors(tmp_path: Path, case: dict) -> None:
    _check_case(tmp_path, case)


def test_reserved_names_match_the_published_list() -> None:
    published = json.loads(RESERVED.read_text())
    assert set(published["firmware"]) == user_libraries.RESERVED_FIRMWARE
    assert set(published["runtime"]) == user_libraries.RESERVED_RUNTIME


def test_runtime_core_modules_are_refused(tmp_path: Path) -> None:
    store = _store(tmp_path, {"libraries/protocol.py": "x = 1\n", "libraries/deps.py": "x = 1\n"})
    _catalog, refusals = library_catalog(store)
    assert sorted(r.library for r in refusals) == ["deps", "protocol"]
    assert all("runtime module" in r.message for r in refusals)


def test_editor_cannot_write_or_delete_a_bundle_package(tmp_path: Path) -> None:
    store = _store(tmp_path, {
        "custom-nodes/home-assistant/ha_sensor.node.json": "@node:sink",
        "custom-nodes/home-assistant/ha_sensor.node.py": "@py:sink",
    })
    with pytest.raises(PersistedStoreError, match="part of the bundle 'home-assistant'"):
        store.write_custom_node("ha_sensor", "{}", "pass\n")
    with pytest.raises(PersistedStoreError, match="part of the bundle 'home-assistant'"):
        store.delete_custom_node("ha_sensor")
    # Reading it works: the editor loads bundle packages by name like any other.
    assert "async def run" in store.read_custom_node("ha_sensor").implementation


def _client(store: PersistedStore) -> TestClient:
    app = web.Application()
    app.router.add_routes(make_admin_routes(store))
    return TestClient(TestServer(app))


@pytest.mark.asyncio
async def test_custom_nodes_route_reports_bundles_and_refusals(tmp_path: Path) -> None:
    store = _store(tmp_path, {
        "custom-nodes/home-assistant/ha_sensor.node.json": "@node:sink",
        "custom-nodes/home-assistant/ha_sensor.node.py": "@py:sink",
        "custom-nodes/home-assistant/lib/ts_ha.py": "import ts_mqtt\n",
        "custom-nodes/broken/half.node.json": "@node:sink",
        "libraries/machine.py": "x = 1\n",
    })
    async with _client(store) as client:
        resp = await client.get("/api/custom-nodes")
        assert resp.status == 200
        body = await resp.json()
    assert body["customNodes"] == ["ha_sensor"]
    assert body["packages"][0]["bundle"] == "home-assistant"
    assert [b["bundle"] for b in body["skippedBundles"]] == ["broken"]
    assert "half.node.py is missing" in body["skippedBundles"][0]["problems"][0]
    assert len(body["libraryRefusals"]) == 1 and "firmware module machine" in body["libraryRefusals"][0]
