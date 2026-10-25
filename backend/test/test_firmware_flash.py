# SPDX-License-Identifier: Apache-2.0
# backend/test/test_firmware_flash.py
#
# Flashing a blank board from the editor (decisions/firmware-catalogue.md, 2026-10-25): the chip family owns the
# tool, the chip id and the address; a build is a catalogue variant with a pinned sha256; the user picks a target
# and the backend writes it in one job. A fake esptool and a temp directory standing in for a mounted drive cover
# both tools, so the command, the progress and each refusal are checked without hardware.

from __future__ import annotations

import hashlib
import json
import stat
import sys
import time
from pathlib import Path

import pytest

from thingstudio_backend import firmware_flash
from thingstudio_backend.firmware_flash import (
    FirmwareError,
    FirmwareJobs,
    catalogue,
    families,
    family_for_image_name,
    image_path,
    inspect_image,
    list_targets,
    save_upload,
)
from thingstudio_backend.persisted_store import PersistedStore

FAKE = '''#!/usr/bin/env python3
import json, os, sys
argv = sys.argv[1:]
with open(os.environ["FAKE_ESPTOOL_LOG"], "a") as f:
    f.write(json.dumps(argv) + "\\n")
if argv and argv[0] == "image_info":
    print("Image header, 16 bytes:")
    print("Detected image type: " + os.environ.get("FAKE_IMAGE_TYPE", "ESP32-S3"))
    sys.exit(0)
print("Writing at 0x00000000... (50 %)")
print("Writing at 0x00001000... (100 %)")
print("Hash of data verified.")
sys.exit(int(os.environ.get("FAKE_ESPTOOL_EXIT", "0")))
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


def add_processor(store: PersistedStore, name: str, flash: dict | None = None) -> None:
    directory = store.base_dir / "processors"
    directory.mkdir(parents=True, exist_ok=True)
    data = {"name": name.upper(), "match": [name.upper()], "gpio": ["0-10"]}
    if flash is not None:
        data["flash"] = flash
    (directory / f"{name}.json").write_text(json.dumps(data))


@pytest.fixture
def store(tmp_path: Path) -> PersistedStore:
    s = PersistedStore(base_dir=tmp_path / "ts")
    (s.base_dir / "boards").mkdir(parents=True)
    add_processor(s, "esp32", {"tool": "esptool", "chip": "esp32", "address": 4096})
    add_processor(s, "rp2040", {"tool": "uf2"})
    add_processor(s, "stm32f405")  # no flash block: not flashable from here
    return s


def write_catalogue(tmp_path: Path, builds: list[dict], monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "builds.json"
    path.write_text(json.dumps({"schema": 1, "builds": builds}))
    monkeypatch.setattr(firmware_flash, "catalogue_sources", lambda: [path])
    return path


def a_build(tmp_path: Path, build_id: str = "esp32-generic", family: str = "esp32", **over) -> dict:
    image = tmp_path / "image.bin"
    image.write_bytes(b"not a real firmware image")
    build = {
        "id": build_id,
        "family": family,
        "supplier": "micropython",
        "label": "ESP32 / WROOM (generic)",
        "infoUrl": "https://micropython.org/download/ESP32_GENERIC/",
        "runtime": "install",
        "versions": [
            {
                "version": "1.29.0",
                "date": "2026-08-24",
                "url": image.as_uri(),
                "sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
            }
        ],
    }
    build.update(over)
    return build


def settled(job) -> None:
    for _ in range(200):
        if job.state != "running":
            return
        time.sleep(0.01)
    raise AssertionError("job did not finish")


def command(fake_tool: Path, index: int = 0) -> list[str]:
    return json.loads(fake_tool.read_text().splitlines()[index])


# -- the tool itself -------------------------------------------------------------------------------


def test_esptool_falls_back_to_this_pythons_module(monkeypatch):
    """A packaged Thingstudio installs esptool into its own Python but never puts that scripts directory
    on PATH, so the console-script names are both absent there."""
    monkeypatch.delenv("THINGSTUDIO_ESPTOOL", raising=False)
    monkeypatch.setattr(firmware_flash.shutil, "which", lambda name: None)
    assert firmware_flash.esptool_command() == [sys.executable, "-m", "esptool"]


def test_esptool_prefers_a_script_on_path_and_the_override(monkeypatch):
    monkeypatch.delenv("THINGSTUDIO_ESPTOOL", raising=False)
    monkeypatch.setattr(firmware_flash.shutil, "which", lambda name: f"/usr/local/bin/{name}" if name == "esptool" else None)
    assert firmware_flash.esptool_command() == ["/usr/local/bin/esptool"]
    monkeypatch.setenv("THINGSTUDIO_ESTOOL", "/tmp/fake")
    monkeypatch.setenv("THINGSTUDIO_ESPTOOL", "/tmp/fake-esptool")
    assert firmware_flash.esptool_command() == ["/tmp/fake-esptool"]


# -- families come from the processors --------------------------------------------------------------


def test_a_family_is_a_processor_that_says_how_it_is_flashed(store):
    known = families(store)
    assert set(known) == {"esp32", "rp2040"}
    assert known["esp32"].tool == "esptool" and known["esp32"].chip == "esp32" and known["esp32"].address == 4096
    assert known["rp2040"].tool == "uf2"


def test_a_processor_with_an_unknown_flash_tool_is_not_offered(store, caplog):
    add_processor(store, "odd", {"tool": "telepathy"})
    assert "odd" not in families(store)
    assert "telepathy" in caplog.text


def test_an_image_names_its_family_by_id_chip_or_label(store):
    known = families(store)
    assert family_for_image_name("ESP32-S3", known) is None  # no S3 processor in this fixture
    assert family_for_image_name("ESP32", known) == "esp32"
    assert family_for_image_name("esp32", known) == "esp32"
    assert family_for_image_name(None, known) is None


def test_a_uf2_image_is_not_inspected_at_all(tmp_path, fake_tool):
    image = tmp_path / "board.uf2"
    image.write_bytes(b"uf2")
    assert inspect_image(image) is None
    assert not fake_tool.exists()


def test_the_family_of_a_local_bin_is_read_from_the_image(tmp_path, fake_tool, monkeypatch):
    image = tmp_path / "ESP32_GENERIC-20260824-v1.29.0.bin"
    image.write_bytes(b"header")
    monkeypatch.setenv("FAKE_IMAGE_TYPE", "ESP32-S3")
    assert inspect_image(image) == "ESP32-S3"
    assert command(fake_tool) == ["image_info", "--version", "2", str(image)]


def test_an_image_esptool_cannot_read_is_simply_unknown(tmp_path, fake_tool, monkeypatch):
    monkeypatch.setenv("FAKE_ESPTOOL_EXIT", "2")  # not what the fake does for image_info; force the missing line
    monkeypatch.setenv("FAKE_IMAGE_TYPE", "")
    image = tmp_path / "junk.bin"
    image.write_bytes(b"?")
    assert inspect_image(image) is None


# -- the catalogue ---------------------------------------------------------------------------------


def test_the_catalogue_lists_every_build_with_its_versions(tmp_path, store, monkeypatch):
    monkeypatch.setattr(firmware_flash, "catalogue_sources", lambda: [write_catalogue(tmp_path, [a_build(tmp_path)], monkeypatch)])
    listed = catalogue(store)
    assert [f["id"] for f in listed["families"]] == ["esp32", "rp2040"]
    build = listed["builds"][0]
    assert build["id"] == "esp32-generic" and build["family"] == "esp32" and build["tool"] == "esptool"
    assert build["versions"][0]["version"] == "1.29.0" and build["versions"][0]["cached"] is False


def test_a_cached_version_is_marked_so_it_needs_no_network(tmp_path, store, monkeypatch):
    build = a_build(tmp_path)
    write_catalogue(tmp_path, [build], monkeypatch)
    sha = build["versions"][0]["sha256"]
    cache = store.base_dir / "firmware"
    cache.mkdir(parents=True)
    (cache / f"{sha}.bin").write_bytes((tmp_path / "image.bin").read_bytes())
    assert catalogue(store)["builds"][0]["versions"][0]["cached"] is True


def test_a_build_of_a_family_we_cannot_flash_is_left_out(tmp_path, store, monkeypatch):
    write_catalogue(tmp_path, [a_build(tmp_path, "stm32-thing", family="stm32f405")], monkeypatch)
    assert catalogue(store)["builds"] == []


def test_a_missing_catalogue_is_a_refusal_not_an_empty_list(tmp_path, monkeypatch):
    monkeypatch.setattr(firmware_flash, "catalogue_sources", lambda: [tmp_path / "nope.json"])
    with pytest.raises(FirmwareError) as exc:
        firmware_flash.load_catalogue()
    assert exc.value.step == "catalogue" and "no firmware catalogue" in exc.value.message


def test_a_bad_catalogue_entry_is_refused_by_name(tmp_path, monkeypatch):
    good = a_build(tmp_path)
    bad = {**good, "versions": [{**good["versions"][0], "sha256": "abc"}]}
    monkeypatch.setattr(firmware_flash, "catalogue_sources", lambda: [write_catalogue(tmp_path, [bad], monkeypatch)])
    with pytest.raises(FirmwareError) as exc:
        firmware_flash.load_catalogue()
    assert "sha256 must be 64 hex characters" in exc.value.message

    monkeypatch.setattr(
        firmware_flash, "catalogue_sources", lambda: [write_catalogue(tmp_path, [good, good], monkeypatch)]
    )
    with pytest.raises(FirmwareError) as exc:
        firmware_flash.load_catalogue()
    assert "listed twice" in exc.value.message


# -- targets: enumeration only ---------------------------------------------------------------------


def test_targets_lists_the_serial_ports_usb_first_and_by_device_path(monkeypatch):
    class Port:
        def __init__(self, device, description, vid=None):
            self.device = device
            self.description = description
            self.vid = vid

    # pyserial's own placeholders for "the OS named this port nothing": a label of "n/a" hides the one part of
    # the line the user can match against esptool's output (2026-10-25).
    monkeypatch.setattr(
        firmware_flash.list_ports,
        "comports",
        lambda: [
            Port("/dev/ttyS0", "n/a"),
            Port("/dev/ttyUSB0", "CH340", vid=0x1A86),
            Port("/dev/ttyACM0", ""),
            Port("/dev/ttyACM1", "USB Serial", vid=0x2E8A),
        ],
    )
    assert list_targets("serial") == [
        {"kind": "serial", "value": "/dev/ttyUSB0", "label": "/dev/ttyUSB0 -- CH340"},
        {"kind": "serial", "value": "/dev/ttyACM1", "label": "/dev/ttyACM1 -- USB Serial"},
        {"kind": "serial", "value": "/dev/ttyS0", "label": "/dev/ttyS0"},
        {"kind": "serial", "value": "/dev/ttyACM0", "label": "/dev/ttyACM0"},
    ]


def test_targets_lists_mounted_volumes(monkeypatch, tmp_path):
    root = tmp_path / "media"
    (root / "RPI-RP2").mkdir(parents=True)
    (root / "other").mkdir()
    monkeypatch.setattr(firmware_flash, "_volume_roots", lambda: [root])
    assert list_targets("volume") == [
        {"kind": "volume", "value": str(root / "RPI-RP2"), "label": "RPI-RP2", "model": None},
        {"kind": "volume", "value": str(root / "other"), "label": "other", "model": None},
    ]


def test_a_uf2_volume_states_its_own_board(monkeypatch, tmp_path):
    root = tmp_path / "media"
    pico = root / "RPI-RP2"
    pico.mkdir(parents=True)
    (pico / "INFO_UF2.TXT").write_text("UF2 Bootloader v3.0\nModel: Raspberry Pi RP2\nBoard-ID: RPI-RP2\n")
    monkeypatch.setattr(firmware_flash, "_volume_roots", lambda: [root])
    assert list_targets("volume")[0]["model"] == "RPI-RP2"


def test_on_linux_the_user_directory_between_the_root_and_the_drive_is_skipped(monkeypatch, tmp_path):
    root = tmp_path / "media"
    user = root / "mike"
    (user / "RPI-RP2").mkdir(parents=True)
    monkeypatch.setattr(firmware_flash, "_volume_roots", lambda: [root])
    assert [t["value"] for t in list_targets("volume")] == [str(user / "RPI-RP2")]


def test_on_macos_the_volumes_are_the_children_of_volumes_and_never_drilled_into(monkeypatch, tmp_path):
    # The regression this pins (2026-10-25): Linux's extra level applied to /Volumes listed the boot disk's own
    # folders -- an ls of / -- because a mounted volume contains directories of its own.
    monkeypatch.setattr(sys, "platform", "darwin")
    root = tmp_path / "Volumes"
    pico = root / "RPI-RP2"
    (pico / "subdir").mkdir(parents=True)
    (root / "Macintosh HD").symlink_to("/")
    monkeypatch.setattr(firmware_flash, "_volume_roots", lambda: [root])
    assert [t["value"] for t in list_targets("volume")] == [str(pico)]


def test_an_unknown_transport_is_refused_by_name():
    with pytest.raises(FirmwareError) as exc:
        list_targets("telepathy")
    assert exc.value.step == "target"
    assert "telepathy" in exc.value.message and "serial" in exc.value.message


# -- images ----------------------------------------------------------------------------------------


def test_a_catalogue_image_is_fetched_verified_and_cached_by_hash(store, tmp_path):
    image = tmp_path / "image.bin"
    image.write_bytes(b"bytes")
    sha = hashlib.sha256(b"bytes").hexdigest()
    path = image_path(store, "esptool", sha, image.as_uri())
    assert path.read_bytes() == b"bytes"
    assert path.name == f"{sha}.bin"
    image.unlink()
    assert image_path(store, "esptool", sha, image.as_uri()) == path  # served from the cache


def test_a_wrong_hash_refuses_and_leaves_no_cached_file(store, tmp_path):
    image = tmp_path / "image.bin"
    image.write_bytes(b"bytes")
    with pytest.raises(FirmwareError) as exc:
        image_path(store, "esptool", "0" * 64, image.as_uri())
    assert exc.value.step == "download" and "not the expected image" in exc.value.message
    assert not (store.base_dir / "firmware" / f"{'0' * 64}.bin").exists()


def test_an_uploaded_file_is_kept_under_its_hash_with_a_safe_name(store):
    saved = save_upload(store, "../../evil name.uf2", b"uf2 bytes")
    assert saved["name"] == "evil_name.uf2"
    assert Path(saved["path"]).is_file() and Path(saved["path"]).parent.name == "uploads"
    assert saved["sha256"] == hashlib.sha256(b"uf2 bytes").hexdigest()


def test_an_empty_or_oversized_upload_is_refused(store, monkeypatch):
    with pytest.raises(FirmwareError) as exc:
        save_upload(store, "x.bin", b"")
    assert "empty" in exc.value.message
    monkeypatch.setattr(firmware_flash, "MAX_UPLOAD_BYTES", 4)
    with pytest.raises(FirmwareError) as exc:
        save_upload(store, "x.bin", b"12345")
    assert "limit is 4" in exc.value.message


# -- one flash job ---------------------------------------------------------------------------------


def test_an_esptool_flash_runs_one_command_with_the_address_erase_and_keep_options(store, tmp_path, fake_tool, monkeypatch):
    build = a_build(tmp_path)
    write_catalogue(tmp_path, [build], monkeypatch)
    job = FirmwareJobs(store).start(
        {
            "target": {"kind": "serial", "value": "/dev/fake"},
            "family": "esp32",
            "build": "esp32-generic",
            "version": "1.29.0",
        }
    )
    settled(job)
    assert job.state == "done", job.error
    argv = command(fake_tool)
    assert argv[:6] == ["--chip", "esp32", "--port", "/dev/fake", "--baud", "460800"]
    assert argv[6:11] == ["write-flash", "--flash_mode", "keep", "--flash_size", "keep"]
    assert argv[11] == "--erase-all"
    assert argv[12] == "0x1000" and argv[13].endswith(".bin")
    assert job.progress == 100 and job.version == "1.29.0"


def test_erase_can_be_turned_off_and_no_stub_and_baud_passed(store, tmp_path, fake_tool, monkeypatch):
    build = a_build(tmp_path)
    write_catalogue(tmp_path, [build], monkeypatch)
    job = FirmwareJobs(store).start(
        {
            "target": {"kind": "serial", "value": "/dev/fake"},
            "family": "esp32",
            "build": "esp32-generic",
            "version": "1.29.0",
            "erase": False,
            "noStub": True,
            "baud": 115200,
        }
    )
    settled(job)
    argv = command(fake_tool)
    assert "--no-stub" in argv and "--erase-all" not in argv
    assert argv[argv.index("--baud") + 1] == "115200"


def test_a_local_file_is_written_at_the_family_address_after_an_override(store, tmp_path, fake_tool):
    image = tmp_path / "s3.bin"
    image.write_bytes(b"bytes")
    jobs = FirmwareJobs(store)
    settled(jobs.start({"target": {"kind": "serial", "value": "/dev/fake"}, "family": "esp32", "imagePath": str(image)}))
    assert command(fake_tool)[-2] == "0x1000"
    assert command(fake_tool)[1] == "esp32"
    settled(
        jobs.start(
            {"target": {"kind": "serial", "value": "/dev/fake"}, "family": "esp32", "imagePath": str(image), "address": 0}
        )
    )
    assert command(fake_tool, 1)[-2] == "0x0"


def test_a_uf2_flash_copies_the_file_to_the_volume(store, tmp_path, monkeypatch):
    monkeypatch.setattr(firmware_flash, "catalogue_sources", lambda: [])
    volume = tmp_path / "RPI-RP2"
    volume.mkdir()
    image = tmp_path / "board.uf2"
    image.write_bytes(b"uf2 bytes")
    job = FirmwareJobs(store).start(
        {"target": {"kind": "volume", "value": str(volume)}, "family": "rp2040", "imagePath": str(image)}
    )
    settled(job)
    assert job.state == "done", job.error
    assert (volume / "board.uf2").read_bytes() == b"uf2 bytes"


# -- refusals --------------------------------------------------------------------------------------


def test_a_request_gives_a_build_or_a_file_and_never_both(store, tmp_path, monkeypatch):
    write_catalogue(tmp_path, [a_build(tmp_path)], monkeypatch)
    jobs = FirmwareJobs(store)
    target = {"kind": "serial", "value": "/dev/fake"}
    with pytest.raises(FirmwareError) as exc:
        jobs.start({"target": target, "family": "esp32"})
    assert "not both and not neither" in exc.value.message
    with pytest.raises(FirmwareError) as exc:
        jobs.start({"target": target, "family": "esp32", "build": "esp32-generic", "version": "1.29.0", "imagePath": "/tmp/x.bin"})
    assert "not both and not neither" in exc.value.message


def test_an_unknown_build_or_version_is_refused_by_name(store, tmp_path, monkeypatch):
    write_catalogue(tmp_path, [a_build(tmp_path)], monkeypatch)
    jobs = FirmwareJobs(store)
    target = {"kind": "serial", "value": "/dev/fake"}
    with pytest.raises(FirmwareError) as exc:
        jobs.start({"target": target, "family": "esp32", "build": "nope", "version": "1.29.0"})
    assert "'nope'" in exc.value.message
    with pytest.raises(FirmwareError) as exc:
        jobs.start({"target": target, "family": "esp32", "build": "esp32-generic", "version": "9.9.9"})
    assert "no version '9.9.9'" in exc.value.message and "1.29.0" in exc.value.message


def test_a_serial_flash_without_a_family_is_refused_because_the_chip_is_written_there(store, tmp_path):
    image = tmp_path / "any.bin"
    image.write_bytes(b"bytes")
    with pytest.raises(FirmwareError) as exc:
        FirmwareJobs(store).start({"target": {"kind": "serial", "value": "/dev/fake"}, "imagePath": str(image)})
    assert "chip family" in exc.value.message


def test_a_family_whose_tool_does_not_match_the_transport_is_refused(store, tmp_path):
    image = tmp_path / "any.bin"
    image.write_bytes(b"bytes")
    with pytest.raises(FirmwareError) as exc:
        FirmwareJobs(store).start(
            {"target": {"kind": "volume", "value": str(tmp_path)}, "family": "esp32", "imagePath": str(image)}
        )
    assert "written with esptool" in exc.value.message


def test_a_uf2_flash_takes_no_address(store, tmp_path):
    image = tmp_path / "board.uf2"
    image.write_bytes(b"uf2")
    with pytest.raises(FirmwareError) as exc:
        FirmwareJobs(store).start(
            {"target": {"kind": "volume", "value": str(tmp_path)}, "family": "rp2040", "imagePath": str(image), "address": 0}
        )
    assert "takes no address" in exc.value.message


def test_a_volume_that_is_gone_is_refused_with_the_next_step(store, tmp_path):
    image = tmp_path / "board.uf2"
    image.write_bytes(b"uf2")
    gone = tmp_path / "RPI-RP2"
    job = FirmwareJobs(store).start(
        {"target": {"kind": "volume", "value": str(gone)}, "family": "rp2040", "imagePath": str(image)}
    )
    settled(job)
    assert job.state == "failed"
    assert "not there any more" in job.error and "BOOTSEL" in job.error


def test_a_missing_local_file_fails_the_job_with_the_path(store, tmp_path):
    job = FirmwareJobs(store).start(
        {"target": {"kind": "serial", "value": "/dev/fake"}, "family": "esp32", "imagePath": str(tmp_path / "gone.bin")}
    )
    settled(job)
    assert job.state == "failed" and "gone.bin" in job.error


def test_an_esptool_failure_names_the_exit_code_and_the_port(store, tmp_path, fake_tool, monkeypatch):
    monkeypatch.setenv("FAKE_ESPTOOL_EXIT", "2")
    image = tmp_path / "any.bin"
    image.write_bytes(b"bytes")
    job = FirmwareJobs(store).start(
        {"target": {"kind": "serial", "value": "/dev/fake"}, "family": "esp32", "imagePath": str(image)}
    )
    settled(job)
    assert job.state == "failed"
    assert "esptool exited 2" in job.error and "/dev/fake" in job.error


def test_a_second_flash_while_one_runs_is_refused(store, tmp_path, monkeypatch):
    # A slow tool keeps the first job running while the second arrives.
    monkeypatch.setattr(firmware_flash.Esptool, "run", lambda self, job, options, target, image: time.sleep(0.3))
    image = tmp_path / "any.bin"
    image.write_bytes(b"bytes")
    jobs = FirmwareJobs(store)
    request = {"target": {"kind": "serial", "value": "/dev/fake"}, "family": "esp32", "imagePath": str(image)}
    first = jobs.start(request)
    with pytest.raises(FirmwareError) as exc:
        jobs.start(request)
    assert "already running" in exc.value.message
    settled(first)
