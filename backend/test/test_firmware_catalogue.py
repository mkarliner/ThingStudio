# SPDX-License-Identifier: Apache-2.0
# backend/test/test_firmware_catalogue.py
#
# tools/firmware_catalogue.py and tools/firmware_targets.py: the step between "an image was tested" and "the
# editor offers it", for every custom-firmware target. The parts worth pinning are the refusals -- an image whose
# hash is not in its target's tested.json must not reach the catalogue, the version, URL basename and hash all
# have to describe the same file -- and that nothing here is specific to one target (decisions/custom-firmware.md,
# "Scope is not shape"): every test runs against two targets with different chips and addresses.

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


def _load(name):
    sys.path.insert(0, str(REPO / "tools"))
    spec = importlib.util.spec_from_file_location(name, REPO / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tool = _load("firmware_catalogue")
targets = tool.firmware_targets  # the instance the tool uses, so patching it reaches the tool

OLD_SHA = "5acd9580170b172551f91310605465379d644689670b1f33d89e4e3724f7afc4"
TARGETS = {
    "classic-esp32": {"family": "esp32", "chip": "esp32", "address": 0},
    "esp32-c5": {"family": "esp32-c5", "chip": "esp32c5", "address": 8192},
}
PARTITIONS = """# Name, Type, SubType, Offset, Size
nvs,      data, nvs,     0x9000,   0x6000,
factory,  app,  factory, 0x10000,  0x300000,
vfs,      data, fat,     0x310000, 0xf0000,
"""


def target_json(tid):
    facts = TARGETS[tid]
    return {
        "label": f"{tid} label",
        "family": facts["family"],
        "chip": facts["chip"],
        "idfTarget": facts["chip"],
        "micropython": "v1.29.0",
        "espIdf": "v5.5.2",
        "address": facts["address"],
        "portSdkconfig": ["boards/sdkconfig.base"],
    }


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A repo of its own -- targets, processors, catalogue, listener -- so the real files are never touched. The
    classic target already has a published version; the C5 has none, so its build entry does not exist yet."""
    root = tmp_path
    for tid, facts in TARGETS.items():
        board = root / "firmware" / "targets" / tid / "board"
        board.mkdir(parents=True)
        (board.parent / "target.json").write_text(json.dumps(target_json(tid)))
        (board / "mpconfigboard.h").write_text("// board\n")
        (board / "sdkconfig.board").write_text("CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y\n")
        (board / "partitions.csv").write_text(PARTITIONS)
        (board.parent / "tested.json").write_text("{}")
        procs = root / "editor" / "src" / "definitions" / "processors"
        procs.mkdir(parents=True, exist_ok=True)
        (procs / f"{facts['family']}.json").write_text(json.dumps({"flash": {"tool": "esptool", "chip": facts["chip"]}}))
    (root / "firmware" / "targets" / "classic-esp32" / "tested.json").write_text(json.dumps({
        OLD_SHA: {"image": "thingstudio-classic-esp32-14.0.1-7e7c73b.bin", "board": "CYD", "date": "2026-10-24",
                  "tested": "ran"}
    }))
    catalogue = {
        "schema": 1,
        "builds": [
            {
                "id": "esp32-generic", "supplier": "micropython", "family": "esp32",
                "label": "ESP32 / WROOM (generic)", "runtime": "install",
                "versions": [{"version": "1.29.0", "date": "2026-08-24", "url": "https://example.invalid/a.bin",
                              "sha256": "a" * 64}],
            },
            {
                "id": "thingstudio-classic-esp32", "supplier": "thingstudio", "family": "esp32",
                "label": "classic-esp32 label", "runtime": "install", "note": "frozen runtime", "address": 0,
                "versions": [{
                    "version": "14.0.1", "date": "2026-10-24",
                    "url": "https://github.com/x/y/releases/download/v0.7.2/thingstudio-classic-esp32-14.0.1-7e7c73b.bin",
                    "sha256": OLD_SHA,
                }],
            },
        ],
    }
    path = root / "firmware" / "builds.json"
    path.write_text(json.dumps(catalogue, indent=2) + "\n")
    listener = root / "device-runtime" / "src" / "listener.py"
    listener.parent.mkdir(parents=True)
    listener.write_text('_RUNTIME_VERSION = {"major": 15, "minor": 0, "patch": 0}\n')
    monkeypatch.setattr(tool, "CATALOGUE", path)
    monkeypatch.setattr(targets, "REPO", root)
    monkeypatch.setattr(targets, "TARGETS_DIR", root / "firmware" / "targets")
    monkeypatch.setattr(targets, "CATALOGUE", path)
    monkeypatch.setattr(targets, "PROCESSORS", root / "editor" / "src" / "definitions" / "processors")
    monkeypatch.setattr(targets, "LISTENER", listener)
    return {"root": root, "catalogue": path}


def image(repo, tid, version="15.0.0", sha="ab12cd3", body=None):
    path = repo["root"] / f"thingstudio-{tid}-{version}-{sha}.bin"
    path.write_bytes(body or f"an image for {tid}".encode())
    return path


def url_for(path):
    return f"https://github.com/mkarliner/ThingStudio/releases/download/v0.11.0/{path.name}"


def record(repo, path, board="a board"):
    tid = targets.parse_image_name(path.name)[0]
    tested = repo["root"] / "firmware" / "targets" / tid / "tested.json"
    data = json.loads(tested.read_text())
    data[tool.sha256_of(path)] = {"image": path.name, "board": board, "date": "2026-11-04", "tested": "flashed, booted"}
    tested.write_text(json.dumps(data))


def builds(repo):
    return {b["id"]: b for b in json.loads(repo["catalogue"].read_text())["builds"]}


@pytest.mark.parametrize("tid", sorted(TARGETS))
def test_a_tested_image_becomes_the_newest_version_of_its_target(repo, tid):
    img = image(repo, tid)
    record(repo, img, board="CYD")
    message = tool.add(img, url_for(img), "2026-11-04")
    assert f"thingstudio-{tid} 15.0.0" in message and "CYD" in message
    build = builds(repo)[f"thingstudio-{tid}"]
    assert build["versions"][0] == {"version": "15.0.0", "date": "2026-11-04", "url": url_for(img),
                                    "sha256": tool.sha256_of(img)}
    assert build["address"] == TARGETS[tid]["address"] and build["family"] == TARGETS[tid]["family"]
    assert tool.check() == []


def test_the_first_image_of_a_target_creates_its_build_from_target_json(repo):
    assert "thingstudio-esp32-c5" not in builds(repo)
    img = image(repo, "esp32-c5")
    record(repo, img)
    tool.add(img, url_for(img), None)
    build = builds(repo)["thingstudio-esp32-c5"]
    assert build["supplier"] == "thingstudio" and build["label"] == "esp32-c5 label" and build["address"] == 8192
    assert [v["version"] for v in build["versions"]] == ["15.0.0"]


def test_an_older_version_stays(repo):
    img = image(repo, "classic-esp32")
    record(repo, img)
    tool.add(img, url_for(img), None)
    build = builds(repo)["thingstudio-classic-esp32"]
    assert [v["version"] for v in build["versions"]] == ["15.0.0", "14.0.1"]
    assert build["note"] == "frozen runtime"


def test_an_untested_image_is_refused_and_says_how_to_test_it(repo):
    img = image(repo, "esp32-c5")
    with pytest.raises(tool.CatalogueError) as exc:
        tool.add(img, url_for(img), None)
    assert "firmware/record-tested.sh" in str(exc.value) and "targets/esp32-c5/tested.json" in str(exc.value)
    assert "thingstudio-esp32-c5" not in builds(repo)


def test_an_image_recorded_under_another_target_is_not_tested_for_this_one(repo):
    body = b"the same bytes"
    c5 = image(repo, "esp32-c5", body=body)
    record(repo, c5)
    classic = image(repo, "classic-esp32", body=body)
    with pytest.raises(tool.CatalogueError):
        tool.add(classic, url_for(classic), None)


def test_the_url_has_to_serve_this_exact_file(repo):
    img = image(repo, "classic-esp32")
    record(repo, img)
    with pytest.raises(tool.CatalogueError) as exc:
        tool.add(img, "https://example.invalid/other.bin", None)
    assert "other.bin" in str(exc.value)
    with pytest.raises(tool.CatalogueError) as exc:
        tool.add(img, url_for(img).replace("https:", "http:"), None)
    assert "must be https" in str(exc.value)


@pytest.mark.parametrize("name", ["thingstudio-classic-esp32.bin", "thingstudio-classic-esp32-15.0.0-ab12cd3-dirty.bin",
                                  "thingstudio-esp32-s9-15.0.0-ab12cd3.bin"])
def test_the_target_and_version_come_from_the_file_name(repo, name):
    wrong = repo["root"] / name
    wrong.write_bytes(b"x")
    with pytest.raises(tool.CatalogueError):
        tool.add(wrong, url_for(wrong), None)


def test_check_passes_on_a_consistent_catalogue(repo):
    assert tool.check() == []


def test_check_names_an_untested_thingstudio_version(repo):
    data = json.loads(repo["catalogue"].read_text())
    data["builds"][1]["versions"][0]["sha256"] = "b" * 64
    repo["catalogue"].write_text(json.dumps(data))
    assert any("not in firmware/targets/classic-esp32/tested.json" in line for line in tool.check())


def test_check_names_a_duplicate_build_and_a_bad_hash(repo):
    data = json.loads(repo["catalogue"].read_text())
    data["builds"].append(dict(data["builds"][0]))
    data["builds"][0]["versions"][0]["sha256"] = "nope"
    repo["catalogue"].write_text(json.dumps(data))
    problems = tool.check()
    assert any("listed twice" in line for line in problems)
    assert any("sha256 is not 64 hex" in line for line in problems)


# -- firmware_targets: a target is a folder, and an incomplete one fails ----------------------------------------


def test_every_target_folder_is_found(repo):
    assert [t.id for t in targets.targets()] == sorted(TARGETS)
    assert targets.target("esp32-c5").filesystem() == (0x310000, 0xF0000)


def test_a_new_folder_missing_a_board_file_fails_check(repo):
    (repo["root"] / "firmware" / "targets" / "esp32-c5" / "board" / "partitions.csv").unlink()
    assert any("esp32-c5: missing board/partitions.csv" in line for line in targets.check())


def test_a_chip_that_disagrees_with_the_processor_fails_check(repo):
    path = repo["root"] / "firmware" / "targets" / "esp32-c5" / "target.json"
    facts = json.loads(path.read_text())
    facts["chip"] = "esp32c3"
    path.write_text(json.dumps(facts))
    assert any("processor esp32-c5 flashes as 'esp32c5'" in line for line in targets.check())


def test_a_catalogue_address_that_disagrees_with_the_target_fails_check(repo):
    data = json.loads(repo["catalogue"].read_text())
    data["builds"][1]["address"] = 4096
    repo["catalogue"].write_text(json.dumps(data))
    assert any("address 4096, target says 0" in line for line in targets.check())


def test_a_thingstudio_build_with_no_target_folder_fails_check(repo):
    data = json.loads(repo["catalogue"].read_text())
    data["builds"].append(dict(data["builds"][1], id="thingstudio-esp32-s3"))
    repo["catalogue"].write_text(json.dumps(data))
    assert any("'thingstudio-esp32-s3' has no firmware/targets/ folder" in line for line in targets.check())


def test_a_pin_that_is_not_a_tag_is_refused(repo):
    path = repo["root"] / "firmware" / "targets" / "esp32-c5" / "target.json"
    facts = json.loads(path.read_text())
    facts["espIdf"] = "master"
    path.write_text(json.dumps(facts))
    with pytest.raises(targets.TargetError) as exc:
        targets.targets()
    assert "espIdf" in str(exc.value)


def test_current_names_each_target_without_an_image_at_the_runtime_version(repo):
    missing = targets.current(None)
    assert [line.split(":")[0] for line in missing] == ["classic-esp32", "esp32-c5"]
    assert all("15.0.0" in line for line in missing)
    record(repo, image(repo, "esp32-c5"))
    assert [line.split(":")[0] for line in targets.current(None)] == ["classic-esp32"]
    record(repo, image(repo, "classic-esp32"))
    assert targets.current(None) == []


def test_an_image_at_an_older_runtime_does_not_count(repo):
    record(repo, image(repo, "esp32-c5", version="14.1.0"))
    assert any(line.startswith("esp32-c5:") for line in targets.current(None))
