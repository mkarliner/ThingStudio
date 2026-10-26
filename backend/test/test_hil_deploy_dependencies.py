# SPDX-License-Identifier: Apache-2.0
# backend/test/test_hil_deploy_dependencies.py
#
# test/hil/hil_common.py's library install: the part of a headless deploy that was silently expensive until
# 2026-10-26, when a CLI deploy of a flow whose libraries were all frozen into the image pushed all thirteen of
# them into /lib anyway. Two things have to hold for the skip to work, so both are pinned here:
#
#   1. the hashes the CLI computes are the ones a board reports, which means compiling with the editor's own
#      mpy-cross (input at /in.py) rather than a native one -- mpy-cross embeds the source name in the bytes;
#   2. a library is skipped only when the hashes agree, and everything is sent when the board reports nothing.
#
# The golden hash below is the value a 14.1.0 image reports in HELLO for font_body12; it comes from
# firmware/classic-esp32/gen_deps_index.mjs, which the image's frozen inventory is built from.

import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
HIL = REPO / "test" / "hil"

pytest.importorskip("serial", reason="test/hil/hil_common.py needs pyserial (esptool pulls it in)")
sys.path.insert(0, str(HIL))


def _load_hil():
    spec = importlib.util.spec_from_file_location("hil_common", HIL / "hil_common.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hil = _load_hil()


needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="compiling libraries needs node")


def test_a_library_the_board_reports_is_not_sent():
    required = {"font_body12": "15c91497a096e7fd", "tsgui_trend": "96e89b325ca430fd"}
    inventory = {"font_body12": "15c91497a096e7fd", "tsgui_trend": "96e89b325ca430fd", "mqtt_as": "075ea737c6d8a3c8"}
    assert hil.libraries_to_send(required, inventory) == []


def test_a_different_hash_is_sent_not_trusted():
    # The board's copy is not the bytecode this flow was compiled against, so it is replaced.
    required = {"font_body12": "15c91497a096e7fd"}
    assert hil.libraries_to_send(required, {"font_body12": "0000000000000000"}) == ["font_body12"]
    assert hil.libraries_to_send(required, {}) == ["font_body12"]


def test_no_inventory_sends_everything():
    # No HELLO, or a board too old to report one: the old behaviour, which is correct but slow.
    required = {"b": "2", "a": "1"}
    assert hil.libraries_to_send(required, None) == ["a", "b"]


@needs_node
def test_the_cli_compiles_libraries_to_the_hash_a_board_reports():
    deps = hil.needed_dependencies("import font_body12")
    with tempfile.TemporaryDirectory() as tmpdir:
        compiled = hil.compile_dependencies(deps, tmpdir)
    # The image's own inventory entry for this font, as HELLO reports it on a 14.1.0 CYD.
    assert compiled["font_body12"]["hash"] == "15c91497a096e7fd"


@needs_node
def test_the_two_hash_implementations_agree():
    # dep_compile.mjs hashes in node, dependency_hash() in Python: same scheme, so a change to either shows up.
    deps = hil.needed_dependencies("import font_body12")
    with tempfile.TemporaryDirectory() as tmpdir:
        compiled = hil.compile_dependencies(deps, tmpdir)
        files = {}
        for entry in compiled["font_body12"]["files"]:
            files[entry["board"]] = Path(entry["path"]).read_bytes()
    assert hil.dependency_hash(files) == compiled["font_body12"]["hash"]


@needs_node
def test_a_flow_with_no_libraries_compiles_nothing():
    assert hil.compile_dependencies([], tempfile.mkdtemp()) == {}
