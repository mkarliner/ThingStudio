# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/firmware_flash.py
#
# Flashing a blank board from the editor (decisions/firmware-catalogue.md, 2026-10-25: the shape is Thonny's --
# the chip family owns the knowledge, a build is a variant inside a family, a board only points at one).
#
# Three inputs, and nothing is guessed:
#   * the target   -- a serial port or a mounted volume the user picked (no probing of anything else);
#   * the family   -- from the processor definition's `flash` block: which tool, esptool's chip id, and the
#                     address an image starts at. Read from a chosen local file with `esptool image_info`;
#   * the image    -- a build version out of firmware/builds.json (URL + pinned sha256), or a file the user chose.
#
# The backend owns the tools because running package-supplied commands is what this project's postures rule out;
# boards and builds are data. Images are verified against their sha256 before anything is written, and cached by
# hash so a second flash needs no network.
#
# Failure rules (AGENTS.md): one deterministic path, no retry or repair chain; every failure names the step and
# the figure. An unknown family, build, version, tool, transport or file format is refused by name.

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from serial.tools import list_ports

from . import assets
from .persisted_store import PersistedStore

logger = logging.getLogger(__name__)

TRANSPORTS = ("serial", "volume")
_DOWNLOAD_TIMEOUT_S = 30
_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024
_FLASH_BAUD = 460800
_MAX_LINE = 400
_COPY_BLOCK = 1 << 20
# esptool prints progress as "Writing at 0x... (50 %)" in 4.x and as a bar in 5.x; both carry the number.
_PERCENT = re.compile(r"(\d+)\s*%")
# esptool image_info prints "Detected image type: ESP32-S3".
_IMAGE_TYPE = re.compile(r"Detected image type:\s*(\S+)")
# A MicroPython ESP32 image is ~2 MB and a UF2 ~1 MB; 64 MB leaves room for vendor images without making the
# backend a general file store. The editor uploads what the user chose, so the limit is stated in the refusal.
MAX_UPLOAD_BYTES = 32 * 1024 * 1024


class FirmwareError(Exception):
    """A refused or failed flash. `step` says where (target/catalogue/download/flash), so the editor can say it
    once rather than guess."""

    def __init__(self, step: str, message: str):
        super().__init__(message)
        self.step = step
        self.message = message


@dataclass
class Job:
    id: str
    state: str = "running"  # running | done | failed
    line: str = ""
    progress: int = 0
    error: str = ""
    step: str = ""
    family: str = ""
    build: str = ""
    version: str = ""
    tool: str = ""
    target: str = ""
    # Every line the tool printed, capped: the dialog shows them, because "esptool exited 2" alone is not enough
    # to tell a bad cable from a bad address (2026-10-25).
    log: list[str] = field(default_factory=list)
    started: float = field(default_factory=time.time)

    def say(self, line: str) -> None:
        self.line = line
        self.log.append(line)
        del self.log[:-200]

    def public(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "line": self.line,
            "progress": self.progress,
            "error": self.error,
            "step": self.step,
            "family": self.family,
            "build": self.build,
            "version": self.version,
            "tool": self.tool,
            "target": self.target,
            "log": list(self.log),
        }


def esptool_command() -> list[str]:
    """How to run esptool, as an argv prefix. Overridable for tests, then the two console-script names
    pip installs, then this Python's own module -- a packaged Thingstudio has esptool installed but its
    scripts directory is not on PATH (the launcher runs the bundled Python directly)."""
    override = os.environ.get("THINGSTUDIO_ESPTOOL")
    if override:
        return [override]
    for name in ("esptool.py", "esptool"):
        found = shutil.which(name)
        if found:
            return [found]
    return [sys.executable, "-m", "esptool"]


# -- families: the chip owns the knowledge --------------------------------------------------------


@dataclass(frozen=True)
class Family:
    id: str
    label: str
    tool: str
    chip: str | None
    address: int

    def public(self) -> dict:
        return {"id": self.id, "label": self.label, "tool": self.tool, "chip": self.chip, "address": self.address}


def families(store: PersistedStore) -> dict[str, Family]:
    """Every processor that says how it is flashed, keyed by the processor id. A processor with no `flash` block
    (the STM32/pyboard, until `dfu` exists) is simply not flashable from here."""
    found: dict[str, Family] = {}
    for item in store.list_definitions("processors"):
        if not item.valid or not isinstance(item.data, dict):
            continue
        flash = item.data.get("flash")
        if not isinstance(flash, dict):
            continue
        tool = str(flash.get("tool") or "")
        if tool not in ("esptool", "uf2"):
            logger.warning("processor %s: unknown flash tool %r; not offered", item.name, tool)
            continue
        chip = flash.get("chip")
        address = flash.get("address")
        found[item.name] = Family(
            id=item.name,
            label=str(item.data.get("name") or item.name),
            tool=tool,
            chip=str(chip) if isinstance(chip, str) and chip else None,
            address=address if isinstance(address, int) and address >= 0 else 0,
        )
    return found


# -- the catalogue: builds per family, each version pinned by sha256 --------------------------------


@dataclass(frozen=True)
class BuildVersion:
    version: str
    date: str
    url: str
    sha256: str


@dataclass(frozen=True)
class Build:
    id: str
    family: str
    supplier: str
    label: str
    info_url: str
    runtime: str
    versions: tuple[BuildVersion, ...]


def _builds_from(data: object, where: str) -> list[Build]:
    if not isinstance(data, dict):
        raise FirmwareError("catalogue", f"{where}: must be a JSON object with a builds list")
    builds = data.get("builds")
    if not isinstance(builds, list):
        raise FirmwareError("catalogue", f"{where}: no builds list")
    out: list[Build] = []
    for index, raw in enumerate(builds):
        place = f"{where}: build {index + 1}"
        if not isinstance(raw, dict):
            raise FirmwareError("catalogue", f"{place} is not an object")
        for key in ("id", "family", "label"):
            if not isinstance(raw.get(key), str) or not raw[key]:
                raise FirmwareError("catalogue", f'{place} has no "{key}"')
        raw_versions = raw.get("versions")
        if not isinstance(raw_versions, list) or not raw_versions:
            raise FirmwareError("catalogue", f"{place} ({raw['id']}) has no versions")
        versions: list[BuildVersion] = []
        for ventry in raw_versions:
            if not isinstance(ventry, dict) or not all(isinstance(ventry.get(k), str) for k in ("version", "url", "sha256")):
                raise FirmwareError("catalogue", f"{place} ({raw['id']}): a version needs version, url and sha256")
            sha = str(ventry["sha256"]).lower()
            if not re.fullmatch(r"[0-9a-f]{64}", sha):
                raise FirmwareError(
                    "catalogue", f"{place} ({raw['id']}) {ventry['version']}: sha256 must be 64 hex characters"
                )
            url = str(ventry["url"])
            if urllib.parse.urlparse(url).scheme not in ("http", "https", "file"):
                raise FirmwareError("catalogue", f"{place} ({raw['id']}) {ventry['version']}: unsupported URL {url!r}")
            versions.append(
                BuildVersion(
                    version=str(ventry["version"]),
                    date=str(ventry.get("date") or ""),
                    url=url,
                    sha256=sha,
                )
            )
        out.append(
            Build(
                id=str(raw["id"]),
                family=str(raw["family"]),
                supplier=str(raw.get("supplier") or "unknown"),
                label=str(raw["label"]),
                info_url=str(raw.get("infoUrl") or ""),
                runtime=str(raw.get("runtime") or "none"),
                versions=tuple(versions),
            )
        )
    return out


def catalogue_sources() -> list[Path]:
    """Where builds come from. One file today (`firmware/builds.json`, shipped with the install); a list because a
    manufacturer-supplied repository is the intended extension (decisions/firmware-catalogue.md, 2026-10-25)."""
    return [assets.asset_dirs().builds]


def load_catalogue(paths: list[Path] | None = None) -> list[Build]:
    """Every build from the catalogue sources. A missing source is a refusal, not an empty list: a silently empty
    catalogue is the "no boards at all" bug with a friendly face. A second source may not reuse a build id."""
    found: dict[str, Build] = {}
    for path in paths if paths is not None else catalogue_sources():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise FirmwareError("catalogue", f"no firmware catalogue at {path}") from exc
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise FirmwareError("catalogue", f"cannot read the firmware catalogue {path}: {exc}") from exc
        for build in _builds_from(data, str(path)):
            if build.id in found:
                raise FirmwareError("catalogue", f"build {build.id!r} is listed twice")
            found[build.id] = build
    return list(found.values())


def catalogue(store: PersistedStore) -> dict:
    """What the editor's dialog needs: the families it can flash, and the builds of each, with whether a version is
    already downloaded. Builds whose family has no `flash` block are left out -- they cannot be written yet."""
    known = families(store)
    builds = []
    for build in load_catalogue():
        family = known.get(build.family)
        if family is None:
            logger.info("catalogue build %s names family %r, which cannot be flashed; left out", build.id, build.family)
            continue
        builds.append(
            {
                "id": build.id,
                "family": build.family,
                "supplier": build.supplier,
                "label": build.label,
                "infoUrl": build.info_url,
                "runtime": build.runtime,
                "tool": family.tool,
                "versions": [
                    {
                        "version": version.version,
                        "date": version.date,
                        "url": version.url,
                        "sha256": version.sha256,
                        "cached": _cached_path(store, version.sha256, family.tool).is_file(),
                    }
                    for version in build.versions
                ],
            }
        )
    return {"families": [family.public() for family in known.values()], "builds": builds}


def build_version(builds: list[Build], build_id: str, version: str) -> tuple[Build, BuildVersion]:
    """One build and one of its versions, refused by name when either is unknown."""
    build = next((item for item in builds if item.id == build_id), None)
    if build is None:
        raise FirmwareError("catalogue", f"no build {build_id!r} in the firmware catalogue")
    for entry in build.versions:
        if entry.version == version:
            return build, entry
    known = ", ".join(item.version for item in build.versions)
    raise FirmwareError("catalogue", f"{build_id} has no version {version!r} (known: {known})")


# -- targets: enumeration only, never identification ------------------------------------------------


def list_targets(transport: str) -> list[dict]:
    """The concrete targets the user can pick for one transport. No probing, no board guessing."""
    if transport not in TRANSPORTS:
        raise FirmwareError("target", f"unknown transport {transport!r} (known: {', '.join(TRANSPORTS)})")
    return _serial_targets() if transport == "serial" else _volume_targets()


# pyserial's placeholder when the operating system gives a port no name. A label of just "n/a" tells the user
# nothing and hides the device path, which is the part they can match against esptool's own output (2026-10-25).
_NO_DESCRIPTION = {"", "n/a"}


def _serial_targets() -> list[dict]:
    """Serial ports, USB devices first, each labelled with its device path.

    The ordering is presentation, not identification: a vendor id says only that a real USB device is behind the
    port (the same rule the editor's port picker uses), never which board is on it. A plain `/dev/ttyS0` is one
    of the computer's own UARTs, and it sorts below the USB ones rather than at the top of the list."""
    ports = list(list_ports.comports())
    ports.sort(key=lambda port: port.vid is None)
    targets = []
    for port in ports:
        description = str(port.description or "").strip()
        label = port.device
        if description.lower() not in _NO_DESCRIPTION:
            label = f"{port.device} -- {description}"
        targets.append({"kind": "serial", "value": port.device, "label": label})
    return targets


def _visible_dirs(root: Path) -> list[Path]:
    """Directories directly under `root`, hidden ones left out. An unreadable root is not an error here: the
    listing is best effort and the dialog offers a typed path as well."""
    try:
        return [child for child in root.iterdir() if child.is_dir() and not child.name.startswith(".")]
    except OSError:
        return []


def _volume_roots() -> list[Path]:
    if sys.platform == "darwin":
        return [Path("/Volumes")]
    return [Path("/media"), Path("/run/media")]


def _uf2_board(path: Path) -> str | None:
    """The board's own statement of what it is, from INFO_UF2.TXT in a UF2 bootloader volume. Not a guess from the
    volume label: the bootloader writes this file, and the dialog uses it only to preselect a build."""
    try:
        text = (path / "INFO_UF2.TXT").read_text(errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        if line.startswith("Board-ID:"):
            return line.split(":", 1)[1].strip() or None
    return None


def _volume_targets() -> list[dict]:
    """Mounted volumes, best effort: the user can also type a path.

    Each system names volumes differently, and only Linux puts a per-user directory between the mount root and
    the drive: macOS lists the volumes themselves one level under /Volumes (the boot volume shows there too, and
    is not a target), Windows names each one by drive letter, and Linux mounts at /media/<user>/<label> or
    /run/media/<user>/<label>, so the level below the root is what the user picks. Applying Linux's extra level
    on macOS lists the boot disk's own folders -- an ls of / -- instead of the mounted drives (2026-10-25)."""
    found: list[Path] = []
    if os.name == "nt":
        home = Path.home().drive.upper()
        found = [Path(f"{letter}:\\") for letter in "DEFGHIJKLMNOPQRSTUVWXYZ" if f"{letter}:" != home]
        found = [path for path in found if path.is_dir()]
    elif sys.platform == "darwin":
        boot = Path("/")
        for root in _volume_roots():
            for child in _visible_dirs(root):
                try:
                    if child.resolve() == boot:
                        continue
                except OSError:
                    pass
                found.append(child)
    else:
        for root in _volume_roots():
            for child in _visible_dirs(root):
                found.extend(_visible_dirs(child) or [child])
    seen: set[str] = set()
    targets = []
    for path in sorted(found, key=lambda p: str(p)):
        if str(path) in seen:
            continue
        seen.add(str(path))
        targets.append(
            {
                "kind": "volume",
                "value": str(path),
                "label": path.name or str(path),
                # A UF2 bootloader states its own board id; the dialog uses it to preselect a build.
                "model": _uf2_board(path),
            }
        )
    return targets


# -- images ---------------------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(_COPY_BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


def _expected_suffix(tool: str) -> str:
    return ".uf2" if tool == "uf2" else ".bin"


def _cached_path(store: PersistedStore, sha256: str, tool: str) -> Path:
    return store.base_dir / "firmware" / f"{sha256}{_expected_suffix(tool)}"


def image_path(store: PersistedStore, tool: str, sha256: str, url: str) -> Path:
    """The image on disk for one catalogue version: the cached copy when its hash still matches, else downloaded
    and verified. A wrong hash deletes the download and refuses -- there is no retry and no fallback."""
    path = _cached_path(store, sha256, tool)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and _sha256(path) == sha256:
        return path
    scheme = urllib.parse.urlparse(url).scheme
    if scheme not in ("http", "https", "file"):
        raise FirmwareError("download", f"unsupported image URL scheme {scheme!r}")
    try:
        with urllib.request.urlopen(url, timeout=_DOWNLOAD_TIMEOUT_S) as response, path.open("wb") as out:
            size = 0
            while True:
                block = response.read(_COPY_BLOCK)
                if not block:
                    break
                size += len(block)
                if size > _DOWNLOAD_MAX_BYTES:
                    out.close()
                    path.unlink(missing_ok=True)
                    raise FirmwareError(
                        "download",
                        f"{url} is larger than {_DOWNLOAD_MAX_BYTES // (1024 * 1024)} MB; that is not a firmware image",
                    )
                out.write(block)
    except FirmwareError:
        raise
    except OSError as exc:
        path.unlink(missing_ok=True)
        raise FirmwareError("download", f"could not fetch {url}: {exc}") from exc
    got = _sha256(path)
    if got != sha256:
        path.unlink(missing_ok=True)
        raise FirmwareError(
            "download",
            f"{url} is not the expected image (sha256 {got[:16]}…, wanted {sha256[:16]}…)",
        )
    return path


def inspect_image(path: Path) -> str | None:
    """The chip family a .bin image is for, read out of the image itself with `esptool image_info`, or None when
    esptool cannot tell (a .uf2, a damaged file, esptool missing). Never a guess: the editor offers the answer as
    the family, and the user can change it."""
    if path.suffix.lower() != ".bin":
        return None
    try:
        result = subprocess.run(
            [*esptool_command(), "image_info", "--version", "2", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    match = _IMAGE_TYPE.search(result.stdout)
    return match.group(1) if match else None


def family_for_image_name(name: str | None, known: dict[str, Family]) -> str | None:
    """Match esptool's image type ("ESP32-S3") to a family id, by the family's id, chip id or label."""
    if not name:
        return None

    def norm(value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", value.lower())

    wanted = norm(name)
    for family in known.values():
        if wanted in {norm(family.id), norm(family.chip or ""), norm(family.label)}:
            return family.id
    return None


def save_upload(store: PersistedStore, name: str, data: bytes) -> dict:
    """Keep a file the user chose in the editor, so a later flash job can name it by path. The browser cannot
    hand the backend a local path, so the bytes come over HTTP; the name is only a label, and the hash is how
    the same file is recognised twice."""
    if not data:
        raise FirmwareError("download", "the uploaded image is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise FirmwareError(
            "download",
            f"the image is {len(data)} bytes; the limit is {MAX_UPLOAD_BYTES} (a MicroPython or Thingstudio "
            "image is a few MB — check you picked the right file)",
        )
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(name).name) or "image.bin"
    digest = hashlib.sha256(data).hexdigest()
    uploads = store.base_dir / "firmware" / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    path = uploads / f"{digest[:16]}-{safe}"
    path.write_bytes(data)
    return {"path": str(path), "sha256": digest, "size": len(data), "name": safe}


# -- tools: the core's registry, one entry per way of writing a board's flash -----------------------


class Tool:
    """One flashing tool. A tool owns its options and how it writes the image. Adding one is a core change and an
    interface change, deliberately."""

    name = ""
    transport = ""

    def run(self, job: Job, options: dict, target: str, image: Path) -> None:
        raise NotImplementedError


class Esptool(Tool):
    name = "esptool"
    transport = "serial"

    def run(self, job: Job, options: dict, target: str, image: Path) -> None:
        chip = options.get("chip")
        address = int(options.get("address") or 0)
        baud = int(options.get("baud") or _FLASH_BAUD)
        cmd = [*esptool_command()]
        if chip:
            cmd += ["--chip", str(chip)]
        cmd += ["--port", target, "--baud", str(baud)]
        if options.get("noStub"):
            cmd.append("--no-stub")
        # esptool spells the operation `write_flash`: the hyphenated form only exists from 5.x, and a board whose
        # Python carries 4.x answers "invalid choice: 'write-flash'" (2026-10-25, Mike's first real flash).
        # `keep` reads flash mode and size out of the image, which is Thonny's default and stops us inventing a
        # flash size for a board we have not seen.
        cmd += ["write_flash", "--flash_mode", "keep", "--flash_size", "keep"]
        if options.get("erase", True):
            cmd.append("--erase-all")
        cmd += [hex(address), str(image)]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.strip()[:_MAX_LINE]
            if not line:
                continue
            job.say(line)
            percent = _PERCENT.search(line)
            if percent:
                job.progress = min(99, int(percent.group(1)))
        code = proc.wait()
        if code != 0:
            raise FirmwareError("flash", f"esptool exited {code} at {job.line or 'the start'} on {target}")


class Uf2(Tool):
    name = "uf2"
    transport = "volume"

    def run(self, job: Job, options: dict, target: str, image: Path) -> None:
        volume = Path(target)
        if not volume.is_dir():
            raise FirmwareError(
                "flash",
                f"{volume} is not there any more — is the board still in its bootloader (BOOTSEL held while "
                "plugging in)?",
            )
        destination = volume / image.name
        total = image.stat().st_size
        written = 0
        job.line = f"copying {image.name} to {volume.name}"
        try:
            with image.open("rb") as src, destination.open("wb") as out:
                for block in iter(lambda: src.read(_COPY_BLOCK), b""):
                    out.write(block)
                    written += len(block)
                    job.progress = min(99, int(written * 100 / total)) if total else 0
                    job.line = f"{written} of {total} bytes to {volume.name}"
        except OSError as exc:
            raise FirmwareError("flash", f"could not copy to {volume}: {exc}") from exc


TOOLS: dict[str, Tool] = {tool.name: tool for tool in (Esptool(), Uf2())}


class FirmwareJobs:
    """One flash at a time (a second start while one runs is refused). Status is polled by the editor."""

    def __init__(self, store: PersistedStore):
        self._store = store
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def start(self, request: dict) -> Job:
        if not isinstance(request, dict):
            raise FirmwareError("target", 'the request must be an object with a "target"')
        target = request.get("target")
        if not isinstance(target, dict):
            raise FirmwareError("target", 'the request needs a "target" object like {"kind": "serial", "value": "…"}')
        kind = target.get("kind")
        value = target.get("value")
        if kind not in TRANSPORTS:
            raise FirmwareError("target", f"unknown target kind {kind!r} (known: {', '.join(TRANSPORTS)})")
        if not isinstance(value, str) or not value:
            raise FirmwareError("target", "target.value is required (the port or the mounted volume)")

        known = families(self._store)
        family_id = request.get("family")
        if family_id is not None and not isinstance(family_id, str):
            raise FirmwareError("target", "family must be a string (a processor id)")
        family = known.get(family_id) if family_id else None
        tool = TOOLS["esptool"] if kind == "serial" else TOOLS["uf2"]

        build_id = request.get("build")
        version = request.get("version")
        image_override = request.get("imagePath")
        if image_override is not None and not isinstance(image_override, str):
            raise FirmwareError("target", "imagePath must be a string")
        if bool(build_id) == bool(image_override):
            raise FirmwareError("target", 'give either "build" + "version" or "imagePath", not both and not neither')

        if family is not None and family.tool != tool.name:
            raise FirmwareError(
                "target",
                f"{family.label} is written with {family.tool}, not over a "
                f"{'serial port' if kind == 'serial' else 'mounted drive'}",
            )
        if tool.name == "esptool" and family is None:
            raise FirmwareError(
                "target",
                "choose the chip family, so esptool knows which chip and address to use "
                "(the family comes from the processor definition's flash block)",
            )
        address = request.get("address")
        if address is not None and (not isinstance(address, int) or isinstance(address, bool) or address < 0):
            raise FirmwareError("target", f"address must be a whole number of bytes, not {address!r}")
        if address is not None and tool.name == "uf2":
            raise FirmwareError("target", "uf2 copies the file to the mounted drive; it takes no address")
        baud = request.get("baud")
        if baud is not None and (not isinstance(baud, int) or isinstance(baud, bool) or baud <= 0):
            raise FirmwareError("target", f"baud must be a positive whole number, not {baud!r}")

        build: Build | None = None
        entry: BuildVersion | None = None
        if build_id:
            build, entry = build_version(load_catalogue(), str(build_id), str(version or ""))

        options = {
            "chip": family.chip if family else None,
            "address": address if address is not None else (family.address if family else 0),
            "baud": baud or _FLASH_BAUD,
            "noStub": bool(request.get("noStub")),
            "erase": request.get("erase") is not False,
        }

        with self._lock:
            if any(job.state == "running" for job in self._jobs.values()):
                raise FirmwareError("flash", "a flash is already running")
            job = Job(
                id=uuid.uuid4().hex[:12],
                family=family.id if family else "",
                build=str(build_id or "local"),
                version=str(entry.version) if entry else "",
                tool=tool.name,
                target=value,
            )
            self._jobs[job.id] = job
        thread = threading.Thread(
            target=self._run,
            args=(job, tool, options, build, entry, image_override),
            daemon=True,
        )
        thread.start()
        return job

    def status(self, job_id: str) -> Job:
        job = self._jobs.get(job_id)
        if job is None:
            raise FirmwareError("job", f"no flash job {job_id!r}")
        return job

    def _run(
        self,
        job: Job,
        tool: Tool,
        options: dict,
        build: Build | None,
        entry: BuildVersion | None,
        image_override: str | None,
    ) -> None:
        try:
            job.step = "download"
            if entry is not None:
                job.say(f"fetching {entry.version}")
                image = image_path(self._store, tool.name, entry.sha256, entry.url)
            else:
                assert image_override is not None
                image = Path(image_override)
                if not image.is_file():
                    raise FirmwareError("download", f"no such image: {image}")
                if tool.name == "uf2" and image.suffix.lower() != ".uf2":
                    raise FirmwareError("download", f"{image.name} is not a .uf2 — a mounted drive takes a .uf2")
            job.say(f"flashing {image.name} with {tool.name}")
            job.step = "flash"
            tool.run(job, options, job.target, image)
            job.progress = 100
            job.say("flashed")
            job.state = "done"
        except FirmwareError as exc:
            job.state = "failed"
            job.error = exc.message
            job.step = exc.step
        except Exception as exc:  # noqa: BLE001 - a job must end with a line, never silence
            logger.exception("flash job %s crashed", job.id)
            job.state = "failed"
            job.step = "flash"
            job.error = f"the flash stopped unexpectedly on {job.target}: {exc}"
