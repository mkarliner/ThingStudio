#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# firmware/bench.py
#
# The one hands-on step of a firmware release: test each target's CI-built image on a real board and record it.
# Step 2 of docs/working-notes/firmware-pipeline-scoping.md (2026-11-10). For every target in firmware/targets/:
#
#   1. fetch the image the Firmware images workflow built from HEAD (gh run download)
#   2. ask for the target's board (bench.json), find its serial port, flash it (install.sh)
#   3. check HELLO: runtime version, and every frozen library present at its hash
#   4. deploy the target's flow (bench.json) three times, each over the last, reading free memory after each
#   5. show the note it would record; on "y", record it (record-tested.sh)
#
# Then, with --catalogue vX.Y.Z, add the recorded images to builds.json with their release URLs and sign it.
#
# Usage, from the repo root, with ThingStudio closed (it holds the serial port):
#   python3 firmware/bench.py                         # every target
#   python3 firmware/bench.py esp32-c5                # just one
#   python3 firmware/bench.py --catalogue v0.12.0     # ... then the catalogue entries and signature
#   python3 firmware/bench.py --images-from firmware/out   # images you built yourself (build.sh), not CI's
#
# Needs: gh (logged in), esptool and mpremote (install.sh), pyserial, node, and editor/dist-cli built
# (cd editor && npm run build:cli). A native mpy-cross at the target's MicroPython tag is built once into
# ~/.cache/thingstudio/ if none is given (THINGSTUDIO_MPY_CROSS or --mpy-cross); that needs a C compiler.
#
# One path, no recovery chain (AGENTS.md): a failed check stops that target, records nothing, and says what
# failed. The only retries are the ones you choose at a prompt (a board that needed BOOT held, say).

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / "tools"))
import firmware_targets  # noqa: E402

DEVICE_CLI = REPO / "test-flows" / "device_cli.py"
COMPILE_CLI = REPO / "editor" / "dist-cli" / "thingstudio-compile.mjs"
WORKFLOW = "firmware-images.yml"
DEPLOYS = 3


class BenchError(Exception):
    pass


def say(text=""):
    print(text, flush=True)


def ask(prompt):
    try:
        return input(prompt)
    except EOFError:
        raise BenchError("no answer (stdin closed) -- run this in a terminal")


def run(cmd, **kw):
    return subprocess.run(cmd, text=True, **kw)


# -- before anything is flashed ---------------------------------------------------------------------------------


def head_sha():
    out = run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True)
    if out.returncode != 0:
        raise BenchError("not a git checkout: %s" % out.stderr.strip())
    return out.stdout.strip()


def require_clean_tree():
    out = run(["git", "-C", str(REPO), "status", "--porcelain", "--", "device-runtime", "firmware"],
              capture_output=True)
    # Records and the catalogue change as the bench runs (a second run after a failed target sees the first run's
    # records); they are not in an image. Everything else under device-runtime/ and firmware/ is.
    outputs = ("firmware/out/", "/tested.json", "firmware/builds.json")
    dirty = [line for line in out.stdout.splitlines() if not any(o in line for o in outputs)]
    if dirty:
        raise BenchError("uncommitted changes under device-runtime/ or firmware/:\n  %s\n"
                         "The images are built from a commit; commit and push first." % "\n  ".join(dirty))


def require_tools(need_gh):
    missing = []
    for tool in (["gh"] if need_gh else []) + ["node", "mpremote"]:
        if not shutil.which(tool):
            missing.append(tool)
    if not (shutil.which("esptool") or shutil.which("esptool.py")):
        missing.append("esptool")
    try:
        import serial  # noqa: F401
    except ImportError:
        missing.append("pyserial (pip install pyserial)")
    if missing:
        raise BenchError("missing: %s" % ", ".join(missing))
    if not COMPILE_CLI.is_file():
        raise BenchError("%s is missing -- build it: cd editor && npm run build:cli" % COMPILE_CLI.relative_to(REPO))


def mpy_cross_for(tag, given):
    """A native mpy-cross from the same MicroPython tag as the image, so flow bytecode loads on it."""
    if given:
        return given
    cache = Path.home() / ".cache" / "thingstudio" / ("micropython-" + tag)
    binary = cache / "mpy-cross" / "build" / "mpy-cross"
    if binary.is_file():
        return str(binary)
    say("bench: building mpy-cross from MicroPython %s into %s (once)" % (tag, cache))
    if not cache.is_dir():
        cache.parent.mkdir(parents=True, exist_ok=True)
        if run(["git", "clone", "--depth", "1", "--branch", tag,
                "https://github.com/micropython/micropython.git", str(cache)]).returncode != 0:
            raise BenchError("could not clone MicroPython %s" % tag)
    if run(["make", "-C", str(cache / "mpy-cross")], stdout=subprocess.DEVNULL).returncode != 0:
        raise BenchError("could not build mpy-cross in %s (needs a C compiler: xcode-select --install)" % cache)
    return str(binary)


# -- images -----------------------------------------------------------------------------------------------------


def fetch_ci_images(ids, sha, into):
    """The Firmware images run for this commit, one artifact per target."""
    out = run(["gh", "run", "list", "--workflow", WORKFLOW, "--commit", sha, "--status", "success",
               "--json", "databaseId", "--limit", "1"], capture_output=True, cwd=REPO)
    if out.returncode != 0:
        raise BenchError("gh run list failed: %s" % out.stderr.strip())
    runs = json.loads(out.stdout or "[]")
    if not runs:
        raise BenchError("no successful %s run for %s -- push it and wait for the build (or check the Actions tab)"
                         % (WORKFLOW, sha[:7]))
    run_id = str(runs[0]["databaseId"])
    for tid in ids:
        dest = into / tid
        dest.mkdir(parents=True, exist_ok=True)
        name = "firmware-%s-%s" % (tid, sha)
        say("bench: fetching %s (run %s)" % (name, run_id))
        got = run(["gh", "run", "download", run_id, "--name", name, "--dir", str(dest)], cwd=REPO)
        if got.returncode != 0:
            raise BenchError("could not download %s" % name)


def image_in(folder, target):
    images = sorted(folder.glob(target.build_id + "-*.bin"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not images:
        raise BenchError("no %s image in %s" % (target.id, folder))
    image = images[0]
    if image.name.endswith("-dirty.bin"):
        raise BenchError("%s is a -dirty build and can't be recorded" % image.name)
    for needed in ("main.py", "_deps.json"):
        if not (folder / needed).is_file():
            raise BenchError("%s is missing next to %s" % (needed, image.name))
    return image


# -- the board --------------------------------------------------------------------------------------------------


def usb_ports():
    from serial.tools import list_ports
    return {p.device: (p.description or "") for p in list_ports.comports() if p.vid is not None}


def find_port(target, bench):
    before = usb_ports()
    ask("\n== %s: plug in the %s, then press Enter " % (target.id, bench["board"]))
    deadline = time.time() + 5
    while time.time() < deadline:
        new = sorted(set(usb_ports()) - set(before))
        if len(new) == 1:
            return new[0]
        time.sleep(0.5)
    ports = sorted(usb_ports().items())
    if len(ports) == 1:
        return ports[0][0]
    if not ports:
        raise BenchError("no USB serial port appeared -- check the cable carries data")
    for i, (device, desc) in enumerate(ports, 1):
        say("  %d. %s  %s" % (i, device, desc))
    choice = ask("Which port is the %s? " % bench["board"]).strip()
    try:
        return ports[int(choice) - 1][0]
    except (ValueError, IndexError):
        raise BenchError("no such port: %r" % choice)


def flash(target, bench, image, port):
    env = dict(os.environ, PORT=port)
    while True:
        result = run([str(HERE / "install.sh"), target.id, str(image)], env=env)
        if result.returncode == 0:
            return
        if bench.get("flashing"):
            say("bench: %s" % bench["flashing"])
        choice = ask("[r]etry the install, [m]ain.py only (image is written; press RESET first), [s]kip %s? "
                     % target.id).strip().lower()
        if choice == "m":
            main_py = image.parent / "main.py"
            if run(["mpremote", "connect", port, "fs", "cp", str(main_py), ":/main.py"]).returncode != 0:
                raise BenchError("could not write /main.py over %s" % port)
            ask("Press RESET on the board, then Enter ")
            return
        if choice != "r":
            raise BenchError("skipped after a failed install")


def cli(args, mpy_cross=None, timeout=60):
    cmd = [sys.executable, str(DEVICE_CLI)] + args
    env = dict(os.environ)
    if mpy_cross:
        env["THINGSTUDIO_MPY_CROSS"] = mpy_cross
    return run(cmd, capture_output=True, env=env, timeout=timeout)


def hello(port):
    """The board boots, waits out its Ctrl-C window, then answers. 30 s covers every board we hold."""
    deadline = time.time() + 30
    last = ""
    while time.time() < deadline:
        out = cli(["hello", "--port", port, "--json", "--timeout", "5"], timeout=30)
        if out.returncode == 0 and out.stdout.strip():
            return json.loads(out.stdout.strip().splitlines()[-1])
        last = (out.stderr or out.stdout).strip().splitlines()[-1:] or [""]
        last = last[0]
        time.sleep(2)
    raise BenchError("no HELLO within 30 s (%s)" % last)


def memory(message):
    kb = lambda n: "%d KB" % (n // 1024) if isinstance(n, int) else "?"  # noqa: E731
    text = "free %s" % kb(message.get("freeRamBytes"))
    if "largestIdfHeapBlockBytes" in message:
        text += ", IDF %s free, largest %s" % (kb(message.get("freeIdfHeapBytes")),
                                               kb(message.get("largestIdfHeapBlockBytes")))
    return text


def check_hello(info, version, frozen):
    found = "%(major)s.%(minor)s.%(patch)s" % (info.get("runtimeVersion") or {"major": "?", "minor": "?", "patch": "?"})
    if found != version:
        raise BenchError("HELLO says runtime %s, expected %s" % (found, version))
    on_board = info.get("dependencies") or {}
    wrong = sorted(name for name, entry in frozen.items() if on_board.get(name) != entry.get("hash"))
    if wrong:
        raise BenchError("frozen libraries missing or at another hash: %s" % ", ".join(wrong))
    return len(frozen)


def deploy(port, flow, mpy_cross):
    out = cli(["flow", "deploy", str(REPO / flow), "--port", port, "--json", "--timeout", "4"],
              mpy_cross=mpy_cross, timeout=120)
    acks = []
    for line in out.stdout.splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        message = record.get("message") or {}
        if message.get("type") == "DEPLOY_ACK":
            acks.append(message)
    if out.returncode != 0 or not acks or acks[-1].get("ok") is False:
        tail = (out.stderr or out.stdout).strip().splitlines()[-3:]
        raise BenchError("deploy failed:\n  %s" % "\n  ".join(tail))
    return acks[-1]


def bench_target(target, folder, args):
    bench = firmware_targets.bench(target)
    image = image_in(folder, target)
    version = firmware_targets.runtime_version()
    frozen = json.loads((folder / "_deps.json").read_text())
    mpy_cross = mpy_cross_for(target.micropython, args.mpy_cross)

    port = find_port(target, bench)
    say("bench: %s on %s" % (image.name, port))
    flash(target, bench, image, port)

    while True:
        try:
            info = hello(port)
            break
        except BenchError as e:
            say("bench: %s" % e)
            if ask("Press RESET on the board, then Enter to ask again (s to skip %s) " % target.id).strip() == "s":
                raise
    count = check_hello(info, version, frozen)
    say("bench: HELLO %s, %d libraries frozen; %s" % (version, count, memory(info)))

    figures = [memory(info)]
    for n in range(1, DEPLOYS + 1):
        ack = deploy(port, bench["flow"], mpy_cross)
        say("bench: deploy %d/%d ok; %s" % (n, DEPLOYS, memory(ack)))
        figures.append(memory(ack))

    flow_name = Path(bench["flow"]).name
    note = ("bench.py: install clean; HELLO %s with all %d libraries frozen; %s deployed %dx, each over the last. "
            "Memory at boot: %s. After the last deploy: %s." % (version, count, flow_name, DEPLOYS, figures[0],
                                                                figures[-1]))
    say("\nbench: will record for %s on %s:\n  %s" % (image.name, bench["board"], note))
    if ask("Record it? [y/N] ").strip().lower() != "y":
        raise BenchError("not recorded (your call)")
    if run([str(HERE / "record-tested.sh"), str(image), bench["board"], note]).returncode != 0:
        raise BenchError("record-tested.sh failed")
    return image


def catalogue(images, release):
    repo = run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], capture_output=True,
               cwd=REPO).stdout.strip()
    if not repo:
        raise BenchError("gh repo view gave no repository name")
    for image in images:
        url = "https://github.com/%s/releases/download/%s/%s" % (repo, release, image.name)
        if run([sys.executable, str(REPO / "tools" / "firmware_catalogue.py"), "--image", str(image),
                "--url", url]).returncode != 0:
            raise BenchError("firmware_catalogue.py refused %s" % image.name)
    say("bench: signing the catalogue (the signing key's passphrase)")
    if run([sys.executable, str(REPO / "tools" / "catalogue_sign.py"), "sign"]).returncode != 0:
        raise BenchError("catalogue_sign.py sign failed")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Test each firmware target's image on a board and record it.")
    parser.add_argument("targets", nargs="*", help="target ids (default: every target)")
    parser.add_argument("--images-from", type=Path,
                        help="a folder with <target>/ subfolders of images you built yourself, instead of CI's")
    parser.add_argument("--mpy-cross", help="native mpy-cross (default: THINGSTUDIO_MPY_CROSS, else built once)")
    parser.add_argument("--catalogue", metavar="vX.Y.Z",
                        help="afterwards, add the recorded images to builds.json for this release, and sign it")
    args = parser.parse_args(argv)
    args.mpy_cross = args.mpy_cross or os.environ.get("THINGSTUDIO_MPY_CROSS")

    try:
        all_targets = {t.id: t for t in firmware_targets.targets()}
        ids = args.targets or list(all_targets)
        unknown = [t for t in ids if t not in all_targets]
        if unknown:
            raise BenchError("no target %s (known: %s)" % (", ".join(unknown), ", ".join(all_targets)))
        require_tools(need_gh=args.images_from is None or bool(args.catalogue))
        if args.images_from is None:
            require_clean_tree()
            sha = head_sha()
            images_dir = Path(tempfile.mkdtemp(prefix="thingstudio-bench-"))
            fetch_ci_images(ids, sha, images_dir)
        else:
            images_dir = args.images_from
    except BenchError as e:
        say("bench: %s" % e)
        return 1

    recorded, failed = [], []
    for tid in ids:
        try:
            recorded.append(bench_target(all_targets[tid], images_dir / tid, args))
        except BenchError as e:
            say("bench: %s: %s" % (tid, e))
            failed.append(tid)
        except subprocess.TimeoutExpired as e:
            say("bench: %s: timed out (%s)" % (tid, " ".join(map(str, e.cmd[:3]))))
            failed.append(tid)

    say("\n== %s" % date.today().isoformat())
    for image in recorded:
        say("recorded  %s" % image.name)
    for tid in failed:
        say("NOT done  %s" % tid)
    if recorded and args.catalogue and not failed:
        try:
            catalogue(recorded, args.catalogue)
        except BenchError as e:
            say("bench: %s" % e)
            return 1
    elif args.catalogue and failed:
        say("bench: catalogue left alone -- every target needs a tested image first")
    if recorded:
        files = "firmware/targets/*/tested.json" + (" firmware/builds.json firmware/builds.json.sig"
                                                     if args.catalogue and not failed else "")
        say("\nCommit in your own Terminal:\n  rm -f .git/index.lock\n  git add %s\n"
            "  git commit -m \"firmware: record runtime %s images as tested\"\n  git push"
            % (files, firmware_targets.runtime_version()))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
