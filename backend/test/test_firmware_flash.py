# SPDX-License-Identifier: Apache-2.0
# backend/test/test_firmware_flash.py
#
# Flashing a blank board from the editor (editor-firmware-flashing-scoping.md, revised 2026-10-25): the user
# picks a transport and a target, the backend fetches and verifies the image, runs the board's tool with a
# fixed command, and reports one job. A fake esptool and a temp directory standing in for a mounted drive cover
# both tools, so the command, the progress and each refusal are checked without hardware.

from __future__ import annotations

import hashlib
import json
import stat
import time
from pathlib import Path

import pytest

from thingstudio_backend import firmware_flash
from thingstudio_backend.firmware_flash import (
    TOOLS,
    TRANSPORTS,
    FirmwareError,
    FirmwareJobs,
    board_definition,
    image_path,
    list_targets,
)
from thingstudio_backend.persisted_store import PersistedStore

FAKE = '''#!/usr/bin/env python3
import json, os, sys
argv = sys.argv[1:]
with open(os.environ["FAKE_ESPTOOL_LOG"], "a") as f:
    f.write(json.dumps(argv) + "\\n")
print("Writing at 0x00000000... (50 %)")
print("Writing at 0x00001000... (100 %)")
print("Hash of data verified.")
sys.exit(0)
'''


@pytest.fixture
def fake_tool(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "fake-esptool"
    path.write_text(FAKE)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "argv.log"
    monkeypatch.setenv("THINGSTUDIO_ESPTOOL", str(path))
    monkeypatch.setenv("FAKE_ESPTOOL_LOG", str(log))
    return log


@pytest.fixture
def store(tmp_path: Path) -> PersistedStore:
    s = PersistedStore(base_dir=tmp_path / "ts")
    (s.base_dir / "boards").mkdir(parents=True)
    return s


def add_board(store: PersistedStore, board: str, firmware: dict) -> None:
    data = {"id": board, "name": board, "firmware": firmware}
    (store.base_dir / "boards" / f"{board}.json").write_text(json.dumps(data))


def esptool_board(tmp_path: Path, suffix: str = ".bin", **flash) -> dict:
    image = tmp_path / f"image{suffix}"
    image.write_bytes(b"not a real firmware image")
    return {
        "tool": "esptool",
        "transport": "serial",
        "image": {"url": image.as_uri(), "sha256": hashlib.sha256(image.read_bytes()).hexdigest()},
        "flash": {"chip": "esp32", **flash},
    }


def settled(job) -> None:
    for _ in range(200):
        if job.state != "running":
            return
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def test_every_tool_names_a_known_transport():
    assert set(TOOLS) == {"esptool", "uf2"}
    for tool in TOOLS.values():
        assert tool.transport in TRANSPORTS


def test_targets_lists_the_serial_ports_without_probing_them(monkeypatch):
    class Port:
        def __init__(self, device, description):
            self.device = device
            self.description = description

    monkeypatch.setattr(firmware_flash.list_ports, "comports", lambda: [Port("/dev/ttyUSB0", "CH340"), Port("/dev/ttyACM0", "")])
    assert list_targets("serial") == [
        {"kind": "serial", "value": "/dev/ttyUSB0", "label": "CH340"},
        {"kind": "serial", "value": "/dev/ttyACM0", "label": "/dev/ttyACM0"},
    ]


def test_targets_lists_mounted_volumes(monkeypatch, tmp_path):
    root = tmp_path / "media"
    (root / "RPI-RP2").mkdir(parents=True)
    (root / "other").mkdir()
    monkeypatch.setattr(firmware_flash, "_volume_roots", lambda: [root])
    assert list_targets("volume") == [
        {"kind": "volume", "value": str(root / "RPI-RP2"), "label": "RPI-RP2"},
        {"kind": "volume", "value": str(root / "other"), "label": "other"},
    ]


def test_an_unknown_transport_is_refused_by_name():
    with pytest.raises(FirmwareError) as exc:
        list_targets("telepathy")
    assert exc.value.step == "target"
    assert "telepathy" in exc.value.message and "serial" in exc.value.message


def test_a_board_without_a_firmware_block_is_refused_by_name(store):
    (store.base_dir / "boards" / "plain.json").write_text(json.dumps({"id": "plain"}))
    with pytest.raises(FirmwareError) as exc:
        board_definition(store, "plain")
    assert "micropython.org/download" in exc.value.message
    with pytest.raises(FirmwareError):
        board_definition(store, "nonesuch")


def test_the_image_is_downloaded_and_hash_checked(store, tmp_path):
    firmware = esptool_board(tmp_path)
    digest = firmware["image"]["sha256"]
    first = image_path(store, firmware)
    assert first.name == f"{digest}.bin"
    # Second time: served from the cache, no URL needed.
    assert image_path(store, {"tool": "esptool", "image": {"url": "http://example.invalid/x", "sha256": digest}}).read_bytes() == first.read_bytes()


def test_a_wrong_hash_refuses_and_leaves_no_cached_file(store, tmp_path):
    firmware = esptool_board(tmp_path)
    firmware["image"]["sha256"] = "0" * 64
    with pytest.raises(FirmwareError) as exc:
        image_path(store, firmware)
    assert exc.value.step == "download"
    assert "not the expected image" in exc.value.message
    assert not list((store.base_dir / "firmware").glob("*.bin"))


def test_a_local_file_must_match_the_hash_the_board_names(store, tmp_path):
    firmware = esptool_board(tmp_path)
    other = tmp_path / "other.bin"
    other.write_bytes(b"different bytes")
    with pytest.raises(FirmwareError) as exc:
        image_path(store, firmware, str(other))
    assert "not the image this board expects" in exc.value.message
    assert image_path(store, firmware, str(tmp_path / "image.bin")).name == "image.bin"


def test_a_uf2_board_refuses_a_bin_file(store, tmp_path):
    firmware = {"tool": "uf2", "transport": "volume"}
    path = tmp_path / "image.bin"
    path.write_bytes(b"bytes")
    with pytest.raises(FirmwareError) as exc:
        image_path(store, firmware, str(path))
    assert ".uf2" in exc.value.message


def test_an_esptool_flash_runs_a_fixed_command_and_reports_progress(store, tmp_path, fake_tool):
    firmware = esptool_board(tmp_path, baud=460800, offset=0)
    add_board(store, "cyd", firmware)
    job = FirmwareJobs(store).start({"kind": "serial", "value": "/dev/fake"}, "cyd")
    settled(job)
    assert job.state == "done", job.error
    assert job.progress == 100
    assert (job.tool, job.target, job.board) == ("esptool", "/dev/fake", "cyd")
    calls = [json.loads(line) for line in fake_tool.read_text().splitlines()]
    assert calls[0] == [
        "--chip", "esp32", "--port", "/dev/fake", "--baud", "460800",
        "--before", "default_reset", "--after", "no_reset",
        "write_flash", "0x0", str(store.base_dir / "firmware" / f"{firmware['image']['sha256']}.bin"),
    ]


def test_an_esptool_flash_without_a_chip_lets_esptool_identify_it(store, tmp_path, fake_tool):
    firmware = esptool_board(tmp_path)
    firmware["flash"].pop("chip")
    add_board(store, "unknown-esp", firmware)
    job = FirmwareJobs(store).start({"kind": "serial", "value": "/dev/fake"}, "unknown-esp")
    settled(job)
    assert job.state == "done", job.error
    calls = [json.loads(line) for line in fake_tool.read_text().splitlines()]
    assert calls[0][:4] == ["--chip", "auto", "--port", "/dev/fake"]


def test_a_uf2_flash_copies_the_file_to_the_volume(store, tmp_path):
    volume = tmp_path / "RPI-RP2"
    volume.mkdir()
    image = tmp_path / "firmware.uf2"
    image.write_bytes(b"u" * 4096)
    firmware = {
        "tool": "uf2",
        "transport": "volume",
        "image": {"url": image.as_uri(), "sha256": hashlib.sha256(image.read_bytes()).hexdigest()},
        "flash": {},
    }
    add_board(store, "pico", firmware)
    job = FirmwareJobs(store).start({"kind": "volume", "value": str(volume)}, "pico")
    settled(job)
    assert job.state == "done", job.error
    assert job.progress == 100
    assert (volume / f"{firmware['image']['sha256']}.uf2").read_bytes() == image.read_bytes()


def test_a_volume_that_is_gone_is_refused_with_the_next_step(store, tmp_path):
    image = tmp_path / "firmware.uf2"
    image.write_bytes(b"u")
    firmware = {
        "tool": "uf2",
        "transport": "volume",
        "image": {"url": image.as_uri(), "sha256": hashlib.sha256(image.read_bytes()).hexdigest()},
        "flash": {},
    }
    add_board(store, "pico", firmware)
    job = FirmwareJobs(store).start({"kind": "volume", "value": str(tmp_path / "gone")}, "pico")
    settled(job)
    assert job.state == "failed"
    assert "is not there any more" in job.error


def test_an_unknown_tool_is_refused(store, tmp_path):
    firmware = esptool_board(tmp_path)
    firmware["tool"] = "telepathy"
    add_board(store, "odd", firmware)
    with pytest.raises(FirmwareError) as exc:
        FirmwareJobs(store).start({"kind": "serial", "value": "/dev/fake"}, "odd")
    assert "not supported" in exc.value.message
    assert "esptool" in exc.value.message


def test_a_tool_option_it_does_not_take_is_refused(store, tmp_path):
    firmware = esptool_board(tmp_path, baud=115200)
    firmware["flash"]["volume"] = "/Volumes/RPI-RP2"
    add_board(store, "odd", firmware)
    with pytest.raises(FirmwareError) as exc:
        FirmwareJobs(store).start({"kind": "serial", "value": "/dev/fake"}, "odd")
    assert '"volume"' in exc.value.message and "chip, baud, offset" in exc.value.message


def test_a_transport_that_does_not_match_the_tool_is_refused(store, tmp_path):
    firmware = esptool_board(tmp_path)
    add_board(store, "cyd", firmware)
    with pytest.raises(FirmwareError) as exc:
        FirmwareJobs(store).start({"kind": "volume", "value": str(tmp_path)}, "cyd")
    assert "writes over serial" in exc.value.message


def test_the_generic_path_needs_only_a_target_and_a_file(store, tmp_path, fake_tool):
    image = tmp_path / "any.bin"
    image.write_bytes(b"bytes")
    job = FirmwareJobs(store).start({"kind": "serial", "value": "/dev/fake"}, None, str(image))
    settled(job)
    assert job.state == "done", job.error
    assert job.board == "local" and job.tool == "esptool"
    calls = [json.loads(line) for line in fake_tool.read_text().splitlines()]
    assert calls[0][:4] == ["--chip", "auto", "--port", "/dev/fake"]


def test_a_target_and_a_file_are_both_required(store):
    jobs = FirmwareJobs(store)
    with pytest.raises(FirmwareError) as exc:
        jobs.start({"kind": "serial", "value": "/dev/fake"})
    assert "imagePath" in exc.value.message
    with pytest.raises(FirmwareError) as exc:
        jobs.start({"kind": "telepathy", "value": "x"}, None, "/tmp/x.bin")
    assert exc.value.step == "target"


def test_a_second_flash_while_one_runs_is_refused(store, tmp_path):
    firmware = esptool_board(tmp_path)
    add_board(store, "cyd", firmware)
    jobs = FirmwareJobs(store)
    first = jobs.start({"kind": "serial", "value": "/dev/fake"}, "cyd")
    with pytest.raises(FirmwareError) as exc:
        jobs.start({"kind": "serial", "value": "/dev/fake"}, "cyd")
    assert "already running" in exc.value.message
    settled(first)
