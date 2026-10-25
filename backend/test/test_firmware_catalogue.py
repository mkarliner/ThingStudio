# SPDX-License-Identifier: Apache-2.0
# backend/test/test_firmware_catalogue.py
#
# tools/firmware_catalogue.py: the step between "an image was tested" and "the editor offers it". The parts worth
# pinning are the refusals -- an image whose hash is not in tested.json must not reach the catalogue, and the
# version, URL basename and hash all have to describe the same file.

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


def _load_tool():
    spec = importlib.util.spec_from_file_location("firmware_catalogue", REPO / "tools" / "firmware_catalogue.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tool = _load_tool()

IMAGE = "thingstudio-classic-esp32-14.1.0-ab12cd3.bin"
URL = f"https://github.com/mkarliner/ThingStudio/releases/download/v0.10.0/{IMAGE}"


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A catalogue and a tested record of its own, so the real files are never touched."""
    (tmp_path / "firmware" / "classic-esp32").mkdir(parents=True)
    catalogue = {
        "schema": 1,
        "builds": [
            {
                "id": "esp32-generic",
                "supplier": "micropython",
                "family": "esp32",
                "label": "ESP32 / WROOM (generic)",
                "runtime": "install",
                "versions": [
                    {"version": "1.29.0", "date": "2026-08-24", "url": "https://example.invalid/a.bin", "sha256": "a" * 64}
                ],
            },
            {
                "id": tool.BUILD_ID,
                "supplier": "thingstudio",
                "family": "esp32",
                "label": "Thingstudio image",
                "runtime": "install",
                "note": "frozen runtime",
                "address": 0,
                "versions": [
                    {
                        "version": "14.0.1",
                        "date": "2026-10-24",
                        "url": "https://github.com/x/y/releases/download/v0.7.2/thingstudio-classic-esp32-14.0.1-7e7c73b.bin",
                        "sha256": "5acd9580170b172551f91310605465379d644689670b1f33d89e4e3724f7afc4",
                    }
                ],
            },
        ],
    }
    path = tmp_path / "firmware" / "builds.json"
    path.write_text(json.dumps(catalogue, indent=2) + "\n")
    tested = tmp_path / "firmware" / "classic-esp32" / "tested.json"
    tested.write_text(json.dumps({"5acd9580170b172551f91310605465379d644689670b1f33d89e4e3724f7afc4": {"image": "old.bin"}}))
    image = tmp_path / IMAGE
    image.write_bytes(b"a real image, in this test anyway")
    monkeypatch.setattr(tool, "CATALOGUE", path)
    monkeypatch.setattr(tool, "TESTED", tested)
    return {"root": tmp_path, "catalogue": path, "tested": tested, "image": image}


def record(repo, digest: str) -> None:
    data = json.loads(repo["tested"].read_text())
    data[digest] = {"image": IMAGE, "board": "CYD", "date": "2026-10-25", "tested": "flashed, booted"}
    repo["tested"].write_text(json.dumps(data))


def test_a_tested_image_becomes_the_newest_version(repo):
    record(repo, tool.sha256_of(repo["image"]))
    message = tool.add(repo["image"], URL, "2026-10-25")
    assert "14.1.0" in message and "CYD" in message
    build = json.loads(repo["catalogue"].read_text())["builds"][1]
    assert build["versions"][0]["version"] == "14.1.0"
    assert build["versions"][0]["url"] == URL
    assert build["versions"][0]["sha256"] == tool.sha256_of(repo["image"])
    # The old version stays: a user may be on it, and the dialog shows every pinned version.
    assert build["versions"][1]["version"] == "14.0.1"
    # Everything else about the build is left alone.
    assert build["address"] == 0 and build["runtime"] == "install" and build["note"] == "frozen runtime"


def test_an_untested_image_is_refused_and_says_how_to_test_it(repo):
    with pytest.raises(tool.CatalogueError) as exc:
        tool.add(repo["image"], URL, None)
    assert "record-tested.sh" in str(exc.value)
    # Nothing was written.
    assert json.loads(repo["catalogue"].read_text())["builds"][1]["versions"][0]["version"] == "14.0.1"


def test_the_url_has_to_serve_this_exact_file(repo):
    record(repo, tool.sha256_of(repo["image"]))
    with pytest.raises(tool.CatalogueError) as exc:
        tool.add(repo["image"], "https://example.invalid/other.bin", None)
    assert "other.bin" in str(exc.value)
    with pytest.raises(tool.CatalogueError) as exc:
        tool.add(repo["image"], URL.replace("https:", "http:"), None)
    assert "must be https" in str(exc.value)


def test_the_version_comes_from_the_file_name(repo):
    record(repo, tool.sha256_of(repo["image"]))
    wrong = repo["root"] / "thingstudio-classic-esp32.bin"
    wrong.write_bytes(repo["image"].read_bytes())
    record(repo, tool.sha256_of(wrong))
    with pytest.raises(tool.CatalogueError) as exc:
        tool.add(wrong, URL, None)
    assert "does not carry its version" in str(exc.value)


def test_check_passes_on_a_consistent_catalogue(repo):
    assert tool.check() == []


def test_check_names_an_untested_thingstudio_version(repo):
    data = json.loads(repo["catalogue"].read_text())
    data["builds"][1]["versions"][0]["sha256"] = "b" * 64
    repo["catalogue"].write_text(json.dumps(data))
    problems = tool.check()
    assert any("not in tested.json" in line for line in problems)


def test_check_names_a_duplicate_build_and_a_bad_hash(repo):
    data = json.loads(repo["catalogue"].read_text())
    data["builds"].append(dict(data["builds"][0]))
    data["builds"][0]["versions"][0]["sha256"] = "nope"
    repo["catalogue"].write_text(json.dumps(data))
    problems = tool.check()
    assert any("listed twice" in line for line in problems)
    assert any("sha256 is not 64 hex" in line for line in problems)
