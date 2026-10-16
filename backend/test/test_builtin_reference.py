# SPDX-License-Identifier: Apache-2.0
# backend/test/test_builtin_reference.py

import json
import logging

from thingstudio_backend.persisted_store import PersistedStore
from thingstudio_backend.builtin_reference import (
    EXAMPLE_NODES_DIR,
    copy_example_custom_nodes,
    copy_missing_builtins,
    default_definitions_dir,
    seed_builtin_definitions,
    seed_example_custom_nodes,
)


def test_copies_the_real_built_ins_into_the_user_folders(tmp_path) -> None:
    copied = copy_missing_builtins(tmp_path)
    src = default_definitions_dir()
    boards = sorted(p.name for p in (src / "boards").glob("*.json"))
    processors = sorted(p.name for p in (src / "processors").glob("*.json"))
    assert boards and processors, "no built-ins found -- wrong source path?"
    assert sorted(p.name for p in (tmp_path / "boards").glob("*.json")) == boards
    assert sorted(p.name for p in (tmp_path / "processors").glob("*.json")) == processors
    assert len(copied) == len(boards) + len(processors)
    assert json.loads((tmp_path / "boards" / "pico.json").read_text())["processor"] == "rp2040"


def test_never_touches_an_existing_file_and_restores_a_deleted_one(tmp_path) -> None:
    src = tmp_path / "src"
    for kind in ("boards", "processors"):
        (src / kind).mkdir(parents=True)
    (src / "boards" / "a.json").write_text('{"v": 2}')
    (src / "boards" / "b.json").write_text('{"b": 1}')
    data = tmp_path / "data"
    (data / "boards").mkdir(parents=True)
    (data / "boards" / "a.json").write_text('{"mine": true}')

    assert copy_missing_builtins(data, src) == ["boards/b.json"]
    assert (data / "boards" / "a.json").read_text() == '{"mine": true}'

    (data / "boards" / "b.json").unlink()
    assert copy_missing_builtins(data, src) == ["boards/b.json"]
    assert (data / "boards" / "b.json").read_text() == '{"b": 1}'
    assert copy_missing_builtins(data, src) == []


def _source(tmp_path, board_a: str):
    src = tmp_path / "src"
    for kind in ("boards", "processors"):
        (src / kind).mkdir(parents=True, exist_ok=True)
    (src / "boards" / "a.json").write_text(board_a)
    return src


def _untouched(data) -> dict[str, bool]:
    return {f.name: f.untouched_copy for f in PersistedStore(data).list_definitions("boards")}


def test_a_copy_stays_untouched_until_edited_and_the_record_is_not_listed(tmp_path) -> None:
    src = _source(tmp_path, '{"v": 1}')
    data = tmp_path / "data"
    copy_missing_builtins(data, src)
    assert _untouched(data) == {"a": True}
    # The built-in changes later: the user's copy is still the untouched old one.
    (src / "boards" / "a.json").write_text('{"v": 2}')
    assert copy_missing_builtins(data, src) == []
    assert _untouched(data) == {"a": True}
    (data / "boards" / "a.json").write_text('{"v": 1, "mine": true}')
    assert _untouched(data) == {"a": False}


def test_an_existing_file_equal_to_the_built_in_is_recorded_but_an_edited_one_is_not(tmp_path) -> None:
    src = _source(tmp_path, '{"v": 1}')
    data = tmp_path / "data"
    (data / "boards").mkdir(parents=True)
    (data / "boards" / "a.json").write_text('{"v": 1}')
    copy_missing_builtins(data, src)
    assert _untouched(data) == {"a": True}

    other = tmp_path / "other"
    (other / "boards").mkdir(parents=True)
    (other / "boards" / "a.json").write_text('{"v": 0}')
    copy_missing_builtins(other, src)
    assert _untouched(other) == {"a": False}


def test_seed_logs_and_carries_on_when_the_source_is_missing(tmp_path, caplog) -> None:
    with caplog.at_level(logging.WARNING):
        seed_builtin_definitions(tmp_path / "data", tmp_path / "nowhere")
    assert "could not copy built-in board/processor definitions" in caplog.text
    assert not (tmp_path / "data").exists()


# -- example custom nodes (2026-09-30) -------------------------------------------


def test_first_run_copies_the_example_packages(tmp_path) -> None:
    copied = copy_example_custom_nodes(tmp_path)
    assert copied == [
        "dht22.node.json",
        "dht22.node.py",
        "doubler.node.json",
        "doubler.node.py",
        "lsm6ds3.node.json",
        "lsm6ds3.node.py",
        "lsm6ds3_int.node.json",
        "lsm6ds3_int.node.py",
    ]
    for name in copied:
        assert (tmp_path / "custom-nodes" / name).read_bytes() == (EXAMPLE_NODES_DIR / name).read_bytes()
    # Every descriptor has its implementation beside it, and parses.
    for descriptor in EXAMPLE_NODES_DIR.glob("*.node.json"):
        json.loads(descriptor.read_text())
        assert descriptor.with_name(descriptor.name.replace(".node.json", ".node.py")).is_file()


def test_an_existing_folder_is_never_touched_so_a_deleted_example_stays_deleted(tmp_path) -> None:
    copy_example_custom_nodes(tmp_path)
    (tmp_path / "custom-nodes" / "doubler.node.json").unlink()
    (tmp_path / "custom-nodes" / "doubler.node.py").unlink()
    assert copy_example_custom_nodes(tmp_path) == []
    assert not (tmp_path / "custom-nodes" / "doubler.node.json").exists()


def test_an_empty_existing_folder_gets_no_examples(tmp_path) -> None:
    (tmp_path / "custom-nodes").mkdir()
    assert copy_example_custom_nodes(tmp_path) == []
    assert list((tmp_path / "custom-nodes").iterdir()) == []


def test_seeding_logs_instead_of_raising(tmp_path, caplog) -> None:
    with caplog.at_level(logging.WARNING):
        seed_example_custom_nodes(tmp_path, source_dir=tmp_path / "missing")
    assert "could not copy the example custom nodes" in caplog.text
    assert not (tmp_path / "custom-nodes").exists()
