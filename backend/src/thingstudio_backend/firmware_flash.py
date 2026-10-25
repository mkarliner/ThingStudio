# SPDX-License-Identifier: Apache-2.0
# backend/src/thingstudio_backend/firmware_flash.py
#
# Flashing a blank board from the editor (docs/working-notes/editor-firmware-flashing-scoping.md, revised
# 2026-10-25: this is for every board that can run MicroPython, not an ESP32 feature). The backend owns the
# host side -- it lists the targets a user can pick, fetches and verifies the image, and runs the board's tool
# -- and the editor only sees a job and its lines.
#
# The generic path is the main path: a target and a file are enough, with no board definition involved. A board
# definition's `firmware` block only pre-fills the tool, the image and its hash. Tools live here, in the core,
# because running package-supplied commands is the thing this project's postures rule out; boards are data.
#
# The user picks the transport ("serial" port or "volume" mounted drive); nothing here probes a port or guesses
# a board. Auto-detection is a later step that will fill the same `{kind, value}` target, not change this shape.
#
# Failure rules (AGENTS.md): one deterministic path, no retry or repair chain; every failure names the step and
# the figure. An unknown chip, tool, transport or file format is refused by name, with the one next step.

from __future__ import annotations

import hashlib
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

from .persisted_store import PersistedStore

logger = logging.getLogger(__name__)

TRANSPORTS = ("serial", "volume")
_DOWNLOAD_TIMEOUT_S = 30
_FLASH_BAUD = 460800
_MAX_LINE = 400
_COPY_BLOCK = 1 << 20
# esptool prints progress as "Writing at 0x... (50 %)" in 4.x and as a bar in 5.x; both carry the number.
_PERCENT = re.compile(r"(\d+)\s*%")
# A MicroPython ESP32 image is ~2 MB and a UF2 ~1 MB; 32 MB leaves room for vendor images without making the
# backend a general file store. The editor uploads what the user chose, so the limit is stated in the refusal.
MAX_UPLOAD_BYTES = 32 * 1024 * 1024


class FirmwareError(Exception):
    """A refused or failed flash. `step` says where (target/download/flash), so the editor can say it once."""

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
    board: str = ""
    tool: str = ""
    target: str = ""
    started: float = field(default_factory=time.time)

    def public(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "line": self.line,
            "progress": self.progress,
            "error": self.error,
            "step": self.step,
            "board": self.board,
            "tool": self.tool,
            "target": self.target,
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


# -- targets: enumeration only, never identification ------------------------------------------------


def list_targets(transport: str) -> list[dict]:
    """The concrete targets the user can pick for one transport. No probing, no board guessing."""
    if transport not in TRANSPORTS:
        raise FirmwareError("target", f"unknown transport {transport!r} (known: {', '.join(TRANSPORTS)})")
    return _serial_targets() if transport == "serial" else _volume_targets()


# pyserial's placeholder when the operating system gives a port no name. A label of just "n/a" tells the user
# nothing and hides the device path, which is the part they can match against esptool's own output (2026-10-25:
# the CYD's own port showed as "n/a" in the dialog).
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


def _volume_roots() -> list[Path]:
    if sys.platform == "darwin":
        return [Path("/Volumes")]
    return [Path("/media"), Path("/run/media")]


def _visible_dirs(root: Path) -> list[Path]:
    """Directories directly under `root`, hidden ones left out. An unreadable root is not an error here: the
    listing is best effort and the dialog offers a typed path as well."""
    try:
        return [child for child in root.iterdir() if child.is_dir() and not child.name.startswith(".")]
    except OSError:
        return []


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
        targets.append({"kind": "volume", "value": str(path), "label": path.name or str(path)})
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


def image_path(store: PersistedStore, firmware: dict, override: str | None = None) -> Path:
    """The image on disk: a local file when given, else the block's pinned URL (downloaded, cached, verified)."""
    tool = str(firmware.get("tool") or "")
    image = firmware.get("image") or {}
    expected = str(image.get("sha256") or "").lower()

    if override:
        path = Path(override).expanduser()
        if not path.is_file():
            raise FirmwareError("download", f"no such image: {path}")
        if tool == "uf2" and path.suffix.lower() != _expected_suffix(tool):
            raise FirmwareError(
                "download",
                f"{path.name} is not a .uf2 — a UF2 board takes a .uf2 from https://micropython.org/download/",
            )
        if expected and _sha256(path) != expected:
            raise FirmwareError(
                "download",
                f"{path.name} is not the image this board expects (sha256 {_sha256(path)[:16]}…, "
                f"wanted {expected[:16]}…); pick the board's published image or a different file",
            )
        return path

    url = str(image.get("url") or "")
    if not url or not expected:
        raise FirmwareError("download", "the board's firmware entry has no image URL and sha256")
    suffix = _expected_suffix(tool)
    cache = store.base_dir / "firmware"
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"{expected}{suffix}"
    if path.is_file() and _sha256(path) == expected:
        return path
    scheme = urllib.parse.urlparse(url).scheme
    if scheme not in ("http", "https", "file"):
        raise FirmwareError("download", f"unsupported image URL scheme {scheme!r}")
    try:
        with urllib.request.urlopen(url, timeout=_DOWNLOAD_TIMEOUT_S) as response, path.open("wb") as out:
            shutil.copyfileobj(response, out)
    except OSError as exc:
        raise FirmwareError("download", f"could not fetch {url}: {exc}") from exc
    got = _sha256(path)
    if got != expected:
        path.unlink(missing_ok=True)
        raise FirmwareError(
            "download",
            f"{url} is not the expected image (sha256 {got[:16]}…, wanted {expected[:16]}…)",
        )
    return path


def image_cached(store: PersistedStore, firmware: dict) -> bool:
    """True when the block's pinned image is already in ~/.thingstudio/firmware (no network needed)."""
    image = firmware.get("image") or {}
    expected = str(image.get("sha256") or "").lower()
    if not expected:
        return False
    tool = str(firmware.get("tool") or "")
    return (store.base_dir / "firmware" / f"{expected}{_expected_suffix(tool)}").is_file()


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
    """One flashing tool. A tool owns its options (`flash` in the board block), which targets it accepts, and
    how it writes the image. Adding one is a core change and an interface change, deliberately."""

    name = ""
    transport = ""
    options: tuple[str, ...] = ()

    def validate(self, flash: object) -> dict:
        if not isinstance(flash, dict):
            raise FirmwareError("flash", f'"firmware.flash" for {self.name} must be an object')
        unknown = [key for key in flash if key not in self.options]
        if unknown:
            allowed = ", ".join(self.options) or "none"
            raise FirmwareError(
                "flash",
                f'firmware.flash: {self.name} does not take "{unknown[0]}" (it takes: {allowed})',
            )
        return dict(flash)

    def run(self, job: Job, options: dict, target: str, image: Path) -> None:
        raise NotImplementedError


class Esptool(Tool):
    name = "esptool"
    transport = "serial"
    options = ("chip", "baud", "offset")

    def run(self, job: Job, options: dict, target: str, image: Path) -> None:
        chip = str(options.get("chip") or "auto")
        baud = int(options.get("baud") or _FLASH_BAUD)
        offset = int(options.get("offset") or 0)
        cmd = [
            *esptool_command(),
            "--chip", chip,
            "--port", target,
            "--baud", str(baud),
            "--before", "default-reset",
            "--after", "no-reset",
            "write-flash", hex(offset), str(image),
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.strip()[:_MAX_LINE]
            if not line:
                continue
            job.line = line
            percent = _PERCENT.search(line)
            if percent:
                job.progress = min(99, int(percent.group(1)))
        code = proc.wait()
        if code != 0:
            raise FirmwareError("flash", f"esptool exited {code} at {job.line or 'the start'} on {target}")


class Uf2(Tool):
    name = "uf2"
    transport = "volume"
    options = ()

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


def board_definition(store: PersistedStore, board_id: str) -> dict:
    for item in store.list_definitions("boards"):
        if item.name != board_id or not item.valid or not isinstance(item.data, dict):
            continue
        firmware = item.data.get("firmware")
        if isinstance(firmware, dict):
            return {**firmware, "id": board_id}
        raise FirmwareError(
            "target",
            f'board {board_id!r} has no "firmware" block. Pick the image from '
            "https://micropython.org/download/ and use Choose a file.",
        )
    raise FirmwareError("target", f"no board definition named {board_id!r}")


def tool_for(firmware: dict) -> Tool:
    name = str(firmware.get("tool") or "")
    tool = TOOLS.get(name)
    if tool is None:
        known = ", ".join(sorted(TOOLS))
        raise FirmwareError("flash", f"flashing tool {name!r} is not supported (known: {known})")
    return tool


class FirmwareJobs:
    """One flash at a time (a second start while one runs is refused). Status is polled by the editor."""

    def __init__(self, store: PersistedStore):
        self._store = store
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def start(
        self,
        target: dict,
        board_id: str | None = None,
        image_path_override: str | None = None,
        offset: int | None = None,
    ) -> Job:
        if not isinstance(target, dict):
            raise FirmwareError("target", "target must be an object like {\"kind\": \"serial\", \"value\": \"…\"}")
        kind = target.get("kind")
        value = target.get("value")
        if kind not in TRANSPORTS:
            raise FirmwareError("target", f"unknown target kind {kind!r} (known: {', '.join(TRANSPORTS)})")
        if not isinstance(value, str) or not value:
            raise FirmwareError("target", "target.value is required (the port or the mounted volume)")

        if board_id:
            firmware = board_definition(self._store, board_id)
            tool = tool_for(firmware)
        else:
            if not image_path_override:
                raise FirmwareError(
                    "target",
                    'give a board or an imagePath. For a board MicroPython publishes, choose its file from '
                    "https://micropython.org/download/",
                )
            tool = TOOLS["esptool"] if kind == "serial" else TOOLS["uf2"]
            firmware = {"id": "local", "tool": tool.name, "transport": tool.transport}
            # A file with no board has no recipe to say where it goes, and the address differs by chip: ESP32 and
            # S2 take it at 0x1000, S3/C3/C6 and the ESP8266 at 0. Writing at the wrong one reports success and
            # leaves a board that doesn't boot, so the address is required rather than defaulted, and the editor
            # asks for it.
            if tool.name == "esptool":
                if offset is None:
                    raise FirmwareError(
                        "target",
                        "give the address the image goes at: 0x1000 for an ESP32 or ESP32-S2, 0 for an ESP32-S3, "
                        "C3, C6 or ESP8266",
                    )
                if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
                    raise FirmwareError("target", f"offset must be a whole number of bytes, not {offset!r}")
                firmware = {**firmware, "flash": {"offset": offset}}
            elif offset is not None:
                raise FirmwareError("target", "uf2 copies the file to the mounted drive; it takes no address")
        if tool.transport != kind:
            raise FirmwareError(
                "target",
                f"{tool.name} writes over {tool.transport}, not {kind} — pick a {tool.transport} target or a "
                "board that matches",
            )
        options = tool.validate(firmware.get("flash", {}))
        if image_path_override:
            firmware = {**firmware, "imagePath": image_path_override}

        with self._lock:
            if any(job.state == "running" for job in self._jobs.values()):
                raise FirmwareError("flash", "a flash is already running")
            job = Job(
                id=uuid.uuid4().hex[:12],
                board=str(firmware.get("id") or board_id or "local"),
                tool=tool.name,
                target=value,
            )
            self._jobs[job.id] = job
        thread = threading.Thread(target=self._run, args=(job, tool, options, firmware, value), daemon=True)
        thread.start()
        return job

    def status(self, job_id: str) -> Job:
        job = self._jobs.get(job_id)
        if job is None:
            raise FirmwareError("job", f"no flash job {job_id!r}")
        return job

    def _run(self, job: Job, tool: Tool, options: dict, firmware: dict, target: str) -> None:
        try:
            job.step = "download"
            image = image_path(self._store, firmware, firmware.get("imagePath"))
            job.line = f"flashing {image.name} with {tool.name}"
            job.step = "flash"
            tool.run(job, options, target, image)
            job.progress = 100
            job.line = "flashed"
            job.state = "done"
        except FirmwareError as exc:
            job.state = "failed"
            job.step = exc.step
            job.error = exc.message
        except OSError as exc:
            job.state = "failed"
            job.step = "flash"
            job.error = f"could not run {tool.name}: {exc}"
