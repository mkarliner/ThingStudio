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
    PresetInfo,
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


# -- per-node presets ---------------------------------------------------
# Unlike credentials, `type` here is an open namespace (any string passing
# the same name pattern), not a fixed tuple -- so "invalid type" tests below
# reuse credentials' bad-name cases, not a hardcoded-unknown-type case.


def test_list_presets_starts_empty(tmp_path) -> None:
    store = _store(tmp_path)
    assert store.list_presets("display_spi") == []


def test_write_then_read_preset_round_trips(tmp_path) -> None:
    store = _store(tmp_path)
    text = json.dumps({"controller": "st7789", "spiBus": 2, "sck": 12, "mosi": 11, "dc": 13})
    store.write_preset("display_spi", "cyd", text)
    assert store.read_preset("display_spi", "cyd") == text


def test_list_presets_reports_valid_entries(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_preset("display_spi", "cyd", '{"sck": 12}')
    store.write_preset("display_spi", "tidal", '{"sck": 5}')
    assert store.list_presets("display_spi") == [
        PresetInfo(name="cyd", valid=True),
        PresetInfo(name="tidal", valid=True),
    ]


def test_read_missing_preset_raises_not_found(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreNotFoundError):
        store.read_preset("display_spi", "nope")


def test_write_preset_rejects_invalid_json(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.write_preset("display_spi", "bad", "{not json")
    assert store.list_presets("display_spi") == []


def test_delete_preset_removes_it(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_preset("display_spi", "cyd", '{"sck": 12}')
    store.delete_preset("display_spi", "cyd")
    assert store.list_presets("display_spi") == []
    with pytest.raises(PersistedStoreNotFoundError):
        store.read_preset("display_spi", "cyd")


def test_delete_missing_preset_raises_not_found(tmp_path) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreNotFoundError):
        store.delete_preset("display_spi", "nope")


@pytest.mark.parametrize("bad_type", ["", "a/b", "../escape"])
def test_invalid_preset_type_names_rejected(tmp_path, bad_type) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.list_presets(bad_type)
    with pytest.raises(PersistedStoreError):
        store.write_preset(bad_type, "n", "{}")


@pytest.mark.parametrize("bad_name", ["../escape", "a/b", ""])
def test_invalid_preset_names_rejected(tmp_path, bad_name) -> None:
    store = _store(tmp_path)
    with pytest.raises(PersistedStoreError):
        store.write_preset("display_spi", bad_name, "{}")


def test_preset_name_cannot_escape_type_dir_via_traversal(tmp_path) -> None:
    store = _store(tmp_path)
    outside = tmp_path / "outside.json"
    with pytest.raises(PersistedStoreError):
        store.write_preset("display_spi", "../outside", "{}")
    assert not outside.exists()


def test_preset_types_are_independent_namespaces(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_preset("display_spi", "shared-name", '{"sck": 12}')
    store.write_preset("display_i2c", "shared-name", '{"scl": 22}')
    assert store.list_presets("display_spi") == [PresetInfo(name="shared-name", valid=True)]
    assert store.list_presets("display_i2c") == [PresetInfo(name="shared-name", valid=True)]


# -- hand-edited-file validity flagging (the one real departure from
# credentials' write-time-only validation, per Mike's explicit ask: "if a
# user adds a preset file manually that is invalid there should a very
# obvious syntax error flagged"). Written directly via pathlib rather than
# through write_preset(), which would itself reject the bad JSON -- these
# simulate a file edited by hand outside the app, after Thingstudio wrote
# it (or created fresh by the user).


def test_list_presets_flags_a_hand_edited_broken_file(tmp_path) -> None:
    store = _store(tmp_path)
    d = store.presets_dir / "display_spi"
    d.mkdir(parents=True)
    (d / "broken.json").write_text("{not valid json", encoding="utf-8")
    infos = store.list_presets("display_spi")
    assert len(infos) == 1
    assert infos[0].name == "broken"
    assert infos[0].valid is False
    assert infos[0].error is not None and "not valid JSON" in infos[0].error


def test_list_presets_reports_valid_and_invalid_entries_together(tmp_path) -> None:
    store = _store(tmp_path)
    store.write_preset("display_spi", "good", '{"sck": 12}')
    d = store.presets_dir / "display_spi"
    (d / "broken.json").write_text("{not valid json", encoding="utf-8")
    infos = {info.name: info for info in store.list_presets("display_spi")}
    assert infos["good"].valid is True
    assert infos["broken"].valid is False


def test_read_preset_raises_for_a_hand_edited_broken_file(tmp_path) -> None:
    store = _store(tmp_path)
    d = store.presets_dir / "display_spi"
    d.mkdir(parents=True)
    (d / "broken.json").write_text("{not valid json", encoding="utf-8")
    with pytest.raises(PersistedStoreError):
        store.read_preset("display_spi", "broken")


# -- processor and board definitions -------------------------------------


def test_list_definitions_rejects_an_unknown_kind(tmp_path) -> None:
    store = PersistedStore(base_dir=tmp_path)
    with pytest.raises(PersistedStoreError, match="invalid definition kind"):
        store.list_definitions("chips")


def test_list_definitions_flags_an_unreadable_encoding(tmp_path) -> None:
    (tmp_path / "boards").mkdir()
    (tmp_path / "boards" / "latin.json").write_bytes(b'{"name": "caf\xe9"}')
    store = PersistedStore(base_dir=tmp_path)
    [info] = store.list_definitions("boards")
    assert info.valid is False
    assert "failed reading file" in info.error
