# SPDX-License-Identifier: Apache-2.0
# firmware/bench.py's checks that need no board: what a HELLO must say for an image to be recorded, which image in
# a folder is the one tested, and that every real target has bench facts (docs/working-notes/
# firmware-pipeline-scoping.md, 2026-11-10). The flashing and deploying need hardware and stay a bench step.

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))
_spec = importlib.util.spec_from_file_location("bench", REPO / "firmware" / "bench.py")
bench = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bench)

FROZEN = {"mqtt_as": {"hash": "aa", "files": []}, "ts_ble": {"hash": "bb", "files": []}}


def hello(version=(15, 1, 0), deps=None):
    return {"runtimeVersion": dict(zip(("major", "minor", "patch"), version)),
            "dependencies": {"mqtt_as": "aa", "ts_ble": "bb"} if deps is None else deps,
            "freeRamBytes": 120 * 1024, "freeIdfHeapBytes": 64 * 1024, "largestIdfHeapBlockBytes": 31 * 1024}


def test_a_board_at_the_runtime_with_every_library_frozen_passes():
    assert bench.check_hello(hello(), "15.1.0", FROZEN) == 2


def test_another_runtime_version_is_refused():
    with pytest.raises(bench.BenchError, match="runtime 15.0.0, expected 15.1.0"):
        bench.check_hello(hello(version=(15, 0, 0)), "15.1.0", FROZEN)


def test_a_library_missing_or_at_another_hash_is_named():
    with pytest.raises(bench.BenchError, match="mqtt_as, ts_ble"):
        bench.check_hello(hello(deps={"mqtt_as": "zz"}), "15.1.0", FROZEN)


def test_memory_reads_the_idf_figures_when_the_board_sends_them():
    assert bench.memory(hello()) == "free 120 KB, IDF 64 KB free, largest 31 KB"
    assert bench.memory({"freeRamBytes": 2048}) == "free 2 KB"


def test_the_image_tested_is_the_newest_clean_one_with_its_files(tmp_path):
    t = bench.firmware_targets.target("esp32-c5")
    (tmp_path / "main.py").write_text("")
    (tmp_path / "_deps.json").write_text(json.dumps(FROZEN))
    image = tmp_path / "thingstudio-esp32-c5-15.1.0-abc1234.bin"
    image.write_bytes(b"x")
    assert bench.image_in(tmp_path, t) == image
    image.unlink()
    (tmp_path / "thingstudio-esp32-c5-15.1.0-abc1234-dirty.bin").write_bytes(b"x")
    with pytest.raises(bench.BenchError, match="dirty"):
        bench.image_in(tmp_path, t)


def test_every_target_has_bench_facts_whose_flow_exists():
    for t in bench.firmware_targets.targets():
        facts = bench.firmware_targets.bench(t)
        assert (REPO / facts["flow"]).is_file(), t.id
