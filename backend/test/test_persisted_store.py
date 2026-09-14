# SPDX-License-Identifier: Apache-2.0
# backend/test/test_persisted_store.py
#
# persisted_store.py owns ~/.thingstudio's on-disk layout -- exercised
# here against a real filesystem (tmp_path), not mocked, since the thing
# actually worth testing is real file I/O (atomic writes, missing-file
# handling, path-traversal rejection), not that the module calls the
# right stdlib functions.

import json

import pytest

from thingstudio_backend.persisted_store import (
    PersistedStore,
    PersistedStoreError,
    PersistedStoreNotFoundError,
)


def _store(tmp_path) -> PersistedStore:
    return PersistedStore(base_dir=tmp_path / ".thingstudio")


# -- lazy creation ------------------------------------------------------


def test_base_dir_not_created_until_first_write(tmp_path) -> None:
    store = _store(tmp_path)
    assert not store.base_dir.exists()
    assert store.list_flows() == []
    assert store.list_custom_nodes() == []
    assert not store.base_dir.exists()


# -- flows ----------------------------------------------------------------


def test_write_then_read_flow_round_trips(tmp_path) -> None:
    store = _store(tmp_path)
    text = json.dumps({"formatVersion": 1, "flowName": "x", "nodes": [], "edges": [], "layout": {}, "configs": []})
    store.write_flow("my-flow", text)
    assert store.read_flow("my-flow") == text
    assert store.list_flows() == ["my-flow"]


def test_read_missing_flow_raises_not_found(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreNotFoundError):
        store.read_flow("nope")


def test_write_flow_rejects_invalid_json(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.write_flow("bad", "{not json")
    assert store.list_flows() == []


def test_write_flow_overwrites_atomically(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_flow("f", '{"a": 1}')
    store.write_flow("f", '{"a": 2}')
    assert store.read_flow("f") == '{"a": 2}'
    # No leftover temp files from either write.
    leftovers = [p for p in store.flows_dir.iterdir() if p.suffix == ".tmp"]
    assert leftovers == []


def test_delete_flow_removes_it(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_flow("f", "{}")
    store.delete_flow("f")
    assert store.list_flows() == []
    with pytest.raises(PersistedStoreNotFoundError):
        store.read_flow("f")


def test_delete_missing_flow_raises_not_found(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreNotFoundError):
        store.delete_flow("nope")


def test_list_flows_ignores_unrelated_files(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_flow("real", "{}")
    (store.base_dir / "flows").mkdir(parents=True, exist_ok=True)
    (store.base_dir / "flows" / "not-a-flow.txt").write_text("hi")
    assert store.list_flows() == ["real"]


@pytest.mark.parametrize("bad_name", ["../escape", "a/b", "a b", "", "a" * 101, ".hidden", "a.json"])
def test_invalid_flow_names_rejected(tmp_path, bad_name) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.write_flow(bad_name, "{}")
    with pytest.raises(PersistedStoreError):
        store.read_flow(bad_name)


def test_flow_name_cannot_escape_flows_dir_via_traversal(tmp_path) -> None:
    store = _store(tmp_path)
    outside = tmp_path / "outside.json"
    with pytest.raises(PersistedStoreError):
        store.write_flow("../outside", '{"x": 1}')
    assert not outside.exists()


# -- custom node packages ---------------------------------------------------


def test_write_then_read_custom_node_round_trips(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_custom_node("blink", '{"kind": "sink"}', "async def run(msg, properties):\n    pass\n")
    pkg = store.read_custom_node("blink")
    assert pkg.descriptor == '{"kind": "sink"}'
    assert pkg.implementation == "async def run(msg, properties):\n    pass\n"
    assert store.list_custom_nodes() == ["blink"]


def test_read_missing_custom_node_raises_not_found(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreNotFoundError):
        store.read_custom_node("nope")


def test_write_custom_node_rejects_invalid_descriptor_json(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.write_custom_node("bad", "not json", "print('hi')")
    assert store.list_custom_nodes() == []


def test_custom_node_implementation_is_never_executed(tmp_path) -> None:
    # Regression guard for custom-node-authoring-scoping.md Decision 5's
    # "must never execute either file's content" constraint -- if this
    # module ever grew an eval/exec/import of the stored text, this test
    # would hang or raise instead of passing quietly.
    store = _store(tmp_path)
    store.write_custom_node("evil", "{}", "raise SystemExit('should never run')")
    pkg = store.read_custom_node("evil")
    assert "should never run" in pkg.implementation  # stored verbatim, never run


def test_read_custom_node_with_missing_implementation_file_is_a_store_error(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_custom_node("partial", "{}", "pass")
    (store.custom_nodes_dir / "partial.node.py").unlink()
    with pytest.raises(PersistedStoreError) as exc_info:
        store.read_custom_node("partial")
    assert not isinstance(exc_info.value, PersistedStoreNotFoundError)  # incomplete, not absent


def test_delete_custom_node_removes_both_files(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_custom_node("gone", "{}", "pass")
    store.delete_custom_node("gone")
    assert store.list_custom_nodes() == []
    assert not (store.custom_nodes_dir / "gone.node.json").exists()
    assert not (store.custom_nodes_dir / "gone.node.py").exists()


def test_delete_missing_custom_node_raises_not_found(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreNotFoundError):
        store.delete_custom_node("nope")


@pytest.mark.parametrize("bad_name", ["../escape", "a/b", ""])
def test_invalid_custom_node_names_rejected(tmp_path, bad_name) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.write_custom_node(bad_name, "{}", "pass")


# -- WiFi/MQTT-broker credentials --------------------------------------------


def test_list_credentials_starts_empty(tmp_path) -> None:
    store = _store(tmp_path)
    assert store.list_credentials("wifi") == []
    assert store.list_credentials("mqtt-broker") == []


def test_write_then_read_credential_round_trips(tmp_path) -> None:
    store = _store(tmp_path)
    text = json.dumps({"ssid": "home-network", "password": "hunter2"})
    store.write_credential("wifi", "home-wifi", text)
    assert store.read_credential("wifi", "home-wifi") == text
    assert store.list_credentials("wifi") == ["home-wifi"]
    # A "mqtt-broker" credential of the same name lives in a separate
    # namespace -- the two types never collide on disk.
    assert store.list_credentials("mqtt-broker") == []


def test_read_missing_credential_raises_not_found(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreNotFoundError):
        store.read_credential("wifi", "nope")


def test_write_credential_rejects_invalid_json(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.write_credential("wifi", "bad", "{not json")
    assert store.list_credentials("wifi") == []


def test_delete_credential_removes_it(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_credential("mqtt-broker", "b", '{"broker": "x", "port": 1883}')
    store.delete_credential("mqtt-broker", "b")
    assert store.list_credentials("mqtt-broker") == []
    with pytest.raises(PersistedStoreNotFoundError):
        store.read_credential("mqtt-broker", "b")


def test_delete_missing_credential_raises_not_found(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreNotFoundError):
        store.delete_credential("wifi", "nope")


@pytest.mark.parametrize("bad_type", ["", "WIFI", "wifi ", "ssh", "wifi/../escape"])
def test_invalid_credential_types_rejected(tmp_path, bad_type) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.list_credentials(bad_type)
    with pytest.raises(PersistedStoreError):
        store.write_credential(bad_type, "n", "{}")


@pytest.mark.parametrize("bad_name", ["../escape", "a/b", ""])
def test_invalid_credential_names_rejected(tmp_path, bad_name) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.write_credential("wifi", bad_name, "{}")


def test_credential_name_cannot_escape_type_dir_via_traversal(tmp_path) -> None:
    store = _store(tmp_path)
    outside = tmp_path / "outside.json"
    with pytest.raises(PersistedStoreError):
        store.write_credential("wifi", "../outside", '{"ssid": "x"}')
    assert not outside.exists()
