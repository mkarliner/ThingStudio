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


class _FakeDut:
    """Just enough of DutLink for the deploy helpers: records what the host sent and answers HELLO."""

    def __init__(self, hello):
        self.sent = []
        self.hello = hello

    def send_message(self, message):
        self.sent.append(message)

    def wait_for_message(self, predicate, timeout_s=None, description=None):
        if not predicate(self.hello):
            raise TimeoutError(description)
        return self.hello


@needs_node
def test_a_deploy_that_was_not_given_an_inventory_asks_the_board():
    # The HIL drivers and deploy_flow.py call deploy_message with no inventory. Asking is the difference
    # between honouring a custom image's frozen libraries and pushing all thirteen into /lib on top of them.
    dut = _FakeDut({"type": "HELLO", "dependencies": {"font_body12": "15c91497a096e7fd"}})
    lines = []
    with tempfile.TemporaryDirectory() as tmpdir:
        message = hil.deploy_message(dut, tmpdir, "import font_body12", b"", log=lines.append)
    assert {"type": "HELLO_REQUEST"} in dut.sent
    assert message["dependencies"] == {"font_body12": "15c91497a096e7fd"}
    assert not [m for m in dut.sent if m["type"].startswith("DEP_")], "nothing to install, so nothing sent"
    assert any("already on the board: font_body12" in line for line in lines)


@needs_node
def test_an_inventory_the_caller_supplied_is_used_as_is():
    # The device CLI already has HELLO's answer; it must not be asked for it a second time.
    dut = _FakeDut({"type": "HELLO", "dependencies": {}})
    with tempfile.TemporaryDirectory() as tmpdir:
        hil.deploy_message(dut, tmpdir, "import font_body12", b"",
                           inventory={"font_body12": "15c91497a096e7fd"}, log=lambda _line: None)
    assert dut.sent == [], "no HELLO_REQUEST and no DEP_PUT"


@needs_node
def test_a_board_that_does_not_answer_sends_every_library():
    dut = _FakeDut({"type": "NO_HELLO"})
    lines = []
    with tempfile.TemporaryDirectory() as tmpdir:
        with pytest.raises(TimeoutError):
            hil.install_dependencies(dut, tmpdir, "import font_body12", log=lines.append)
    assert any(m["type"] == "DEP_PUT" for m in dut.sent), "no inventory: the library is sent"
    assert any("no library inventory" in line for line in lines)


class _SlowDut(_FakeDut):
    """Misses the first HELLO_REQUEST (the listener was still starting the flow), answers the second."""

    def __init__(self, hello, misses=1):
        super().__init__(hello)
        self.misses = misses
        self.asks = 0

    def send_message(self, message):
        if message["type"] == "HELLO_REQUEST":
            self.asks += 1
            self.sent.append(message)
            return
        self.sent.append(message)

    def wait_for_message(self, predicate, timeout_s=None, description=None):
        if predicate({"type": "HELLO"}) and self.asks <= self.misses:
            raise TimeoutError(description)
        return super().wait_for_message(predicate, timeout_s, description)


@needs_node
def test_a_lost_hello_request_is_asked_again():
    dut = _SlowDut({"type": "HELLO", "dependencies": {"font_body12": "15c91497a096e7fd"}})
    lines = []
    with tempfile.TemporaryDirectory() as tmpdir:
        hil.deploy_message(dut, tmpdir, "import font_body12", b"", log=lines.append)
    assert dut.asks == 2
    assert not [m for m in dut.sent if m["type"].startswith("DEP_")], "the answer arrived, so nothing is sent"
    assert any("board holds 1 libraries" in line for line in lines)
