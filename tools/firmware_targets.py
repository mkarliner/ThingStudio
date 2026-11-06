#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/firmware_targets.py
#
# The one place that knows what a custom-firmware target is. A target is a folder under firmware/targets/<id>/
# holding its own facts (target.json), its MicroPython board files (board/) and its record of tested images
# (tested.json). Everything else -- build.sh, install.sh, record-tested.sh, publish.sh, the catalogue tool, CI and
# the editor's tests -- reads targets from here and names none of them ("Scope is not shape", AGENTS.md;
# decisions/custom-firmware.md).
#
# Adding a target is a new folder; `check` fails until it is complete, and its catalogue entry in firmware/builds.json
# is created from target.json when its first image is published (tools/firmware_catalogue.py --image).
#
# Usage:
#   python3 tools/firmware_targets.py list                      # one id per line
#   python3 tools/firmware_targets.py env <id>                  # shell assignments for build.sh/install.sh
#   python3 tools/firmware_targets.py check                     # every target and its catalogue entry
#   python3 tools/firmware_targets.py current [--tag REF] [--warn]
#       # each target has a tested image at the runtime version (built from a commit REF contains);
#       # --warn reports and exits 0 (CI on main), without it a missing image fails (the release gate)
#
# Stdlib only, Python 3.10+.

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TARGETS_DIR = REPO / "firmware" / "targets"
CATALOGUE = REPO / "firmware" / "builds.json"
PROCESSORS = REPO / "editor" / "src" / "definitions" / "processors"
LISTENER = REPO / "device-runtime" / "src" / "listener.py"

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")
IMAGE_RE = re.compile(r"^thingstudio-(?P<target>[a-z0-9-]+?)-(?P<version>\d+\.\d+\.\d+)-(?P<sha>[0-9a-f]{7,40})\.bin$")
BOARD_FILES = ("mpconfigboard.h", "sdkconfig.board", "partitions.csv")

# target.json: key -> (type, what it is). All required.
FIELDS = {
    "label": (str, "what the firmware dialog shows, e.g. 'classic ESP32, 4 MB, no PSRAM'"),
    "family": (str, "the processor id (editor/src/definitions/processors/<family>.json) and catalogue family"),
    "chip": (str, "esptool's chip id; must equal the processor's flash.chip"),
    "idfTarget": (str, "ESP-IDF's IDF_TARGET"),
    "micropython": (str, "MicroPython tag the image is built from, e.g. v1.29.0"),
    "espIdf": (str, "ESP-IDF tag it is built with, e.g. v5.5.2"),
    "address": (int, "where the merged image is written; also merge_bin's --target-offset"),
    "portSdkconfig": (list, "the port's own sdkconfig fragments, in order (boards/sdkconfig.base, ...)"),
}


class TargetError(Exception):
    pass


@dataclass(frozen=True)
class Target:
    id: str
    dir: Path
    label: str
    family: str
    chip: str
    idf_target: str
    micropython: str
    esp_idf: str
    address: int
    port_sdkconfig: tuple[str, ...]

    @property
    def build_id(self) -> str:
        """The catalogue build id and the image name prefix."""
        return f"thingstudio-{self.id}"

    @property
    def board_name(self) -> str:
        """The board directory name inside MicroPython's ports/esp32/boards/."""
        return "thingstudio_" + self.id.replace("-", "_")

    @property
    def tested_path(self) -> Path:
        return self.dir / "tested.json"

    def image_name(self, version: str, sha: str) -> str:
        return f"{self.build_id}-{version}-{sha}.bin"

    def tested(self) -> dict:
        return load_json(self.tested_path) if self.tested_path.is_file() else {}

    def filesystem(self) -> tuple[int, int]:
        """(offset, size) of the filesystem partition in board/partitions.csv: install.sh erases it."""
        for row in partitions(self.dir / "board" / "partitions.csv"):
            if row["type"] == "data" and row["subtype"] in ("fat", "littlefs") and row["name"] == "vfs":
                return row["offset"], row["size"]
        raise TargetError(f"{self.id}: board/partitions.csv has no vfs data partition (fat or littlefs)")


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise TargetError(f"no such file: {path.relative_to(REPO)}") from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TargetError(f"cannot read {path.relative_to(REPO)}: {exc}") from exc


def partitions(path: Path) -> list[dict]:
    rows = []
    text = "\n".join(line for line in path.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))
    for fields in csv.reader(io.StringIO(text)):
        fields = [f.strip() for f in fields]
        if len(fields) < 5 or not fields[0]:
            continue
        try:
            rows.append({"name": fields[0], "type": fields[1], "subtype": fields[2],
                         "offset": int(fields[3], 0), "size": int(fields[4], 0)})
        except ValueError as exc:
            raise TargetError(f"{path.relative_to(REPO)}: cannot read row {fields!r}") from exc
    return rows


def load_target(folder: Path) -> Target:
    tid = folder.name
    if not ID_RE.match(tid):
        raise TargetError(f"firmware/targets/{tid}: a target id is lower-case words joined by '-'")
    raw = load_json(folder / "target.json")
    for key, (kind, meaning) in FIELDS.items():
        if not isinstance(raw.get(key), kind) or isinstance(raw.get(key), bool):
            raise TargetError(f"{tid}/target.json: '{key}' must be a {kind.__name__} -- {meaning}")
    unknown = sorted(set(raw) - set(FIELDS) - {"$comment"})
    if unknown:
        raise TargetError(f"{tid}/target.json: unknown keys {', '.join(unknown)}")
    for key in ("micropython", "espIdf"):
        if not TAG_RE.match(raw[key]):
            raise TargetError(f"{tid}/target.json: '{key}' must be a release tag like v1.29.0, not {raw[key]!r}")
    if not all(isinstance(s, str) and s.startswith("boards/sdkconfig.") for s in raw["portSdkconfig"]):
        raise TargetError(f"{tid}/target.json: portSdkconfig entries are the port's boards/sdkconfig.* files")
    return Target(
        id=tid, dir=folder, label=raw["label"], family=raw["family"], chip=raw["chip"],
        idf_target=raw["idfTarget"], micropython=raw["micropython"], esp_idf=raw["espIdf"],
        address=raw["address"], port_sdkconfig=tuple(raw["portSdkconfig"]),
    )


def targets() -> list[Target]:
    if not TARGETS_DIR.is_dir():
        raise TargetError("no firmware/targets/ directory")
    found = [load_target(d) for d in sorted(TARGETS_DIR.iterdir()) if d.is_dir()]
    if not found:
        raise TargetError("firmware/targets/ has no targets")
    return found


def target(tid: str) -> Target:
    folder = TARGETS_DIR / tid
    if not folder.is_dir():
        known = ", ".join(t.id for t in targets())
        raise TargetError(f"no target {tid!r} (known: {known})")
    return load_target(folder)


def parse_image_name(name: str) -> tuple[str, str, str] | None:
    """thingstudio-esp32-c5-15.0.0-ab12cd3.bin -> ("esp32-c5", "15.0.0", "ab12cd3")."""
    m = IMAGE_RE.match(name)
    return (m["target"], m["version"], m["sha"]) if m else None


def runtime_version(ref: str | None = None) -> str:
    """The runtime version in the working tree, or at a git ref (a release tag)."""
    if ref is None:
        src = LISTENER.read_text(encoding="utf-8")
    else:
        shown = subprocess.run(["git", "-C", str(REPO), "show", f"{ref}:{LISTENER.relative_to(REPO).as_posix()}"],
                               capture_output=True, text=True, check=False)
        if shown.returncode != 0:
            raise TargetError(f"cannot read {LISTENER.relative_to(REPO)} at {ref}: {shown.stderr.strip()}")
        src = shown.stdout
    m = re.search(r'_RUNTIME_VERSION\s*=\s*\{"major":\s*(\d+),\s*"minor":\s*(\d+),\s*"patch":\s*(\d+)\}', src)
    if not m:
        raise TargetError("cannot read _RUNTIME_VERSION from device-runtime/src/listener.py")
    return "%s.%s.%s" % m.groups()


# -- check -------------------------------------------------------------------------------------------------


def check() -> list[str]:
    """Every problem with the targets and their catalogue entries. Empty when complete."""
    problems: list[str] = []
    try:
        all_targets = targets()
        catalogue = load_json(CATALOGUE)
    except TargetError as exc:
        return [str(exc)]
    builds = {b.get("id"): b for b in catalogue.get("builds", [])}
    ours = {b for b, entry in builds.items() if entry.get("supplier") == "thingstudio"}
    for t in all_targets:
        where = f"firmware/targets/{t.id}"
        for name in BOARD_FILES:
            if not (t.dir / "board" / name).is_file():
                problems.append(f"{where}: missing board/{name}")
        if (t.dir / "board" / "partitions.csv").is_file():
            try:
                t.filesystem()
                if not any(r["type"] == "app" for r in partitions(t.dir / "board" / "partitions.csv")):
                    problems.append(f"{where}: board/partitions.csv has no app partition")
            except TargetError as exc:
                problems.append(str(exc))
        if (t.dir / "board" / "sdkconfig.board").is_file():
            text = (t.dir / "board" / "sdkconfig.board").read_text(encoding="utf-8")
            if "CONFIG_PARTITION_TABLE_CUSTOM_FILENAME" in text:
                problems.append(f"{where}: board/sdkconfig.board sets the partition file; build.sh writes that line")
        proc_path = PROCESSORS / f"{t.family}.json"
        if not proc_path.is_file():
            problems.append(f"{where}: family {t.family!r} has no processor definition ({proc_path.relative_to(REPO)})")
        else:
            flash = load_json(proc_path).get("flash") or {}
            if flash.get("chip") != t.chip:
                problems.append(f"{where}: chip {t.chip!r}, but processor {t.family} flashes as {flash.get('chip')!r}")
        try:
            tested = t.tested()
        except TargetError as exc:
            problems.append(str(exc))
            tested = {}
        for digest, entry in tested.items():
            if not re.fullmatch(r"[0-9a-f]{64}", digest):
                problems.append(f"{where}/tested.json: key {digest[:16]}... is not a sha256")
            parsed = parse_image_name(str(entry.get("image", "")))
            if parsed is None or parsed[0] != t.id:
                problems.append(f"{where}/tested.json: {entry.get('image')!r} is not a {t.build_id}-<version>-<sha>.bin")
            for key in ("board", "date", "tested"):
                if not entry.get(key):
                    problems.append(f"{where}/tested.json: {entry.get('image')} has no '{key}'")
        build = builds.get(t.build_id)
        if build is None:
            # Fine until its first image is published: tools/firmware_catalogue.py --image creates the entry.
            continue
        ours.discard(t.build_id)
        if build.get("label") != t.label:
            problems.append(f"{t.build_id}: label {build.get('label')!r}, target says {t.label!r}")
        if build.get("supplier") != "thingstudio":
            problems.append(f"{t.build_id}: supplier must be 'thingstudio'")
        if build.get("family") != t.family:
            problems.append(f"{t.build_id}: family {build.get('family')!r}, target says {t.family!r}")
        if build.get("address") != t.address:
            problems.append(f"{t.build_id}: address {build.get('address')!r}, target says {t.address}")
        for version in build.get("versions") or []:
            if version.get("sha256") not in tested:
                problems.append(f"{t.build_id} {version.get('version')}: not in {where}/tested.json")
            name = Path(str(version.get("url", ""))).name
            parsed = parse_image_name(name)
            if parsed is None or parsed[0] != t.id or parsed[1] != version.get("version"):
                problems.append(f"{t.build_id} {version.get('version')}: URL names {name!r}")
    for orphan in sorted(ours):
        problems.append(f"firmware/builds.json: Thingstudio build {orphan!r} has no firmware/targets/ folder")
    # Images are release assets, never committed: one committed by mistake (2026-11-06, a `git add -A` after the
    # .gitignore pattern moved) made every later build's tree dirty once it was deleted.
    listed = subprocess.run(["git", "-C", str(REPO), "ls-files", "--", "firmware/*.bin", "firmware/**/*.bin"],
                            capture_output=True, text=True, check=False)
    for path in listed.stdout.split():
        problems.append(f"{path}: a firmware image is committed -- images are release assets (git rm it)")
    return problems


# -- current: the rebuild-at-every-runtime-bump rule --------------------------------------------------------


def is_ancestor(sha: str, ref: str) -> bool:
    result = subprocess.run(["git", "-C", str(REPO), "merge-base", "--is-ancestor", sha, ref],
                            capture_output=True, check=False)
    return result.returncode == 0


def current(tag: str | None) -> list[str]:
    """One line per target that has no tested image at the runtime version (built from a commit `tag` contains)."""
    version = runtime_version(tag)
    missing = []
    for t in targets():
        hits = []
        for entry in t.tested().values():
            parsed = parse_image_name(str(entry.get("image", "")))
            if parsed and parsed[1] == version and (tag is None or is_ancestor(parsed[2], tag)):
                hits.append(entry["image"])
        if not hits:
            built_from = f", built from a commit {tag} contains" if tag else ""
            missing.append(f"{t.id}: no tested image at runtime {version}{built_from} -- build, flash and "
                           f"record it (firmware/README.md)")
    return missing


# -- CLI -------------------------------------------------------------------------------------------------


def shell_env(t: Target) -> str:
    fs_offset, fs_size = t.filesystem()
    values = {
        "TARGET_ID": t.id, "TARGET_LABEL": t.label, "TARGET_FAMILY": t.family, "TARGET_CHIP": t.chip,
        "TARGET_IDF_TARGET": t.idf_target, "TARGET_MPY_VERSION": t.micropython, "TARGET_IDF_VERSION": t.esp_idf,
        "TARGET_ADDRESS": hex(t.address), "TARGET_BOARD": t.board_name, "TARGET_BUILD_ID": t.build_id,
        "TARGET_FS_OFFSET": hex(fs_offset), "TARGET_FS_SIZE": hex(fs_size),
        "TARGET_PORT_SDKCONFIG": " ".join(t.port_sdkconfig),
    }
    out = []
    for key, value in values.items():
        if "'" in value:
            raise TargetError(f"{t.id}: {key} contains a quote")
        out.append(f"{key}='{value}'")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Custom-firmware targets: list, inspect and check them.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    env = sub.add_parser("env")
    env.add_argument("target")
    sub.add_parser("check")
    cur = sub.add_parser("current")
    cur.add_argument("--tag", help="only count images built from a commit this ref contains")
    cur.add_argument("--warn", action="store_true", help="report, but exit 0")
    args = parser.parse_args(argv)
    try:
        if args.cmd == "list":
            print("\n".join(t.id for t in targets()))
        elif args.cmd == "env":
            print(shell_env(target(args.target)))
        elif args.cmd == "check":
            problems = check()
            for line in problems:
                print(f"firmware_targets: {line}", file=sys.stderr)
            if problems:
                return 1
            print(f"firmware_targets: {len(targets())} targets, each complete and agreeing with the catalogue")
        elif args.cmd == "current":
            missing = current(args.tag)
            for line in missing:
                if args.warn:
                    print(f"::warning::{line}" if "GITHUB_ACTIONS" in os.environ else f"warning: {line}")
                else:
                    print(f"firmware_targets: {line}", file=sys.stderr)
            if missing and not args.warn:
                return 1
            if not missing:
                print(f"firmware_targets: every target has a tested image at runtime {runtime_version()}")
        return 0
    except TargetError as exc:
        print(f"firmware_targets: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
