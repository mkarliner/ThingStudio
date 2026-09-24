# SPDX-License-Identifier: Apache-2.0
# backend/test/test_builtin_reference.py

import json
import logging

from thingstudio_backend.builtin_reference import (
    copy_missing_builtins,
    default_definitions_dir,
    seed_builtin_definitions,
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


def test_seed_logs_and_carries_on_when_the_source_is_missing(tmp_path, caplog) -> None:
    with caplog.at_level(logging.WARNING):
        seed_builtin_definitions(tmp_path / "data", tmp_path / "nowhere")
    assert "could not copy built-in board/processor definitions" in caplog.text
    assert not (tmp_path / "data").exists()
