#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# firmware/bench.py
#
# The one hands-on step of a firmware release: test each target's CI-built image on a real board and record it.
# Step 2 of docs/working-notes/firmware-pipeline-scoping.md (2026-11-10). For every target in firmware/targets/:
#
#   1. fetch the image the Firmware images workflow built from HEAD, or from the last commit that changed an image
#      input (the workflow's push paths), so a bench-only commit needs no new build (gh run download)
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
#   python3 firmware/bench.py --catalogue vX.Y.Z     # ... then the catalogue entries and signature
#   python3 firmware/bench.py --images-from firmware/out   # images you built yourself (build.sh), not CI's
#
# Needs: gh (logged in), esptool and mpremote (install.sh), pyserial, node, and editor/dist-cli built
# (cd editor && npm run build:cli). A native mpy-cross at the target's MicroPython tag is built once into
# ~/.cache/thingstudio/ if none is given (THINGSTUDIO_MPY_CROSS or --mpy-cross); that needs a C compiler.
#
# One path, no recovery chain (AGENTS.md): a failed check stops that target, records nothing, and says what
# failed. The only retries are the ones you choose at a prompt (a board that needed BOOT held, say).

import argparse
import hashlib
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
        # A warning, not a refusal: CI built the images from the commit, so local edits don't change what is
        # flashed; they only mean the tree differs from what you are testing (2026-11-12, first bench run).
        say("bench: note -- uncommitted changes under device-runtime/ or firmware/ (the images are HEAD's):\n  %s"
            % "\n  ".join(dirty))


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
        missing.append("pyserial for %s (%s -m pip install pyserial, or run with the repo's .venv first on PATH)"
                       % (sys.executable, sys.executable))
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


def image_inputs():
    """The workflow's push `paths`, as git pathspecs: what goes into an image, minus its "!" exclusions.
    Read from the workflow so the two can't drift (no YAML library: a plain list under `paths:`)."""
    lines = (REPO / ".github" / "workflows" / WORKFLOW).read_text().splitlines()
    start = next((i for i, line in enumerate(lines) if line.strip() == "paths:"), None)
    if start is None:
        raise BenchError("no push paths in .github/workflows/%s" % WORKFLOW)
    specs = []
    for line in lines[start + 1:]:
        item = line.strip()
        if not item.startswith("- "):
            break
        pattern = item[2:].strip().strip("\"'")
        specs.append(":(exclude,glob)" + pattern[1:] if pattern.startswith("!") else ":(glob)" + pattern)
    return specs


def git_ok(*args):
    return run(["git", "-C", str(REPO)] + list(args), capture_output=True).returncode == 0


def image_run(head):
    """The newest successful Firmware images run whose images are HEAD's: built from HEAD or an ancestor of it,
    with no image input changed since. Returns (run id, the commit it built)."""
    out = run(["gh", "run", "list", "--workflow", WORKFLOW, "--status", "success",
               "--json", "databaseId,headSha", "--limit", "50"], capture_output=True, cwd=REPO)
    if out.returncode != 0:
        raise BenchError("gh run list failed: %s" % out.stderr.strip())
    inputs = image_inputs()
    for r in json.loads(out.stdout or "[]"):
        sha = r["headSha"]
        if (sha == head or git_ok("merge-base", "--is-ancestor", sha, head)) \
                and git_ok("diff", "--quiet", sha, head, "--", *inputs):
            return str(r["databaseId"]), sha
    last = run(["git", "-C", str(REPO), "log", "-1", "--format=%h", head, "--", *inputs], capture_output=True)
    raise BenchError("no successful %s run has HEAD's image inputs (last changed in %s) -- push and wait for the "
                     "build (or check the Actions tab)" % (WORKFLOW, last.stdout.strip() or head[:7]))


def fetch_ci_images(ids, head, into):
    """The Firmware images run whose images are HEAD's, one artifact per target."""
    run_id, sha = image_run(head)
    if sha != head:
        say("bench: images from %s (no image input changed since; HEAD is %s)" % (sha[:7], head[:7]))
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


def reset_step(bench):
    """bench.json's "reset", for a board whose RESET button doesn't bring the runtime back (the ESP32-C5-340X)."""
    return bench.get("reset") or "Press RESET on the board"


def flash(target, bench, image, port):
    env = dict(os.environ, PORT=port)
    while True:
        result = run([str(HERE / "install.sh"), target.id, str(image)], env=env)
        if result.returncode == 0:
            return
        if bench.get("flashing"):
            say("bench: %s" % bench["flashing"])
        choice = ask("[r]etry the install, [m]ain.py only (image is written; reset it first), [s]kip %s? "
                     % target.id).strip().lower()
        if choice == "m":
            main_py = image.parent / "main.py"
            if run(["mpremote", "connect", port, "fs", "cp", str(main_py), ":/main.py"]).returncode != 0:
                raise BenchError("could not write /main.py over %s" % port)
            ask("%s, then Enter " % reset_step(bench))
            return
        if choice != "r":
            raise BenchError("skipped after a failed install")


def cli(args, mpy_cross=None, timeout=60):
    cmd = [sys.executable, str(DEVICE_CLI)] + args
    env = dict(os.environ)
    if mpy_cross:
        env["THINGSTUDIO_MPY_CROSS"] = mpy_cross
    return run(cmd, capture_output=True, env=env, timeout=timeout)


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


class NoHello(BenchError):
    pass


def session(port, flow, mpy_cross):
    """HELLO, then the flow deployed DEPLOYS times over itself, all in ONE open of the port: a CH340 board (the
    ESP32-C5-340X) answers one open per replug and nothing on the next (learnings/hardware-bringup-hil-rig.md),
    so a HELLO in one process and a deploy in another failed (2026-11-12). Returns (HELLO, [DEPLOY_ACK]).
    30 s covers every board we hold booting and waiting out its Ctrl-C window."""
    out = cli(["flow", "deploy", str(REPO / flow), "--port", port, "--json", "--timeout", "4",
               "--hello-wait", "30", "--repeat", str(DEPLOYS)], mpy_cross=mpy_cross, timeout=60 + 60 * DEPLOYS)
    info, acks, steps = None, [], []
    for line in out.stdout.splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if record.get("kind") == "status" and record.get("text"):
            steps.append(record["text"])
        elif record.get("kind") == "console" and record.get("text"):
            steps.append("[board] " + record["text"])
        message = record.get("message") or {}
        if message and message.get("type") not in ("HELLO", "DEPLOY_ACK"):
            steps.append("[board] %s" % json.dumps(message, sort_keys=True))
        if message.get("type") == "HELLO" and info is None:
            info = message
        if message.get("type") == "DEPLOY_ACK":
            acks.append(message)
    if info is None:
        raise NoHello(((out.stderr or "").strip().splitlines() or ["no HELLO"])[-1])
    if out.returncode != 0 or len(acks) != DEPLOYS or acks[-1].get("ok") is False:
        # device_cli's own steps first (which libraries did it send?), then the whole of its stderr: a compile
        # error's cause is at the top of a Node trace, not the end.
        detail = "\n".join(steps + [(out.stderr or "").strip() or out.stdout.strip()])
        raise BenchError("deploy failed after %d of %d:\n  %s"
                         % (len(acks), DEPLOYS, "\n  ".join(detail.splitlines()[-40:])))
    return info, acks


def bench_target(target, folder, args):
    bench = firmware_targets.bench(target)
    image = image_in(folder, target)
    version = firmware_targets.runtime_version()
    frozen = json.loads((folder / "_deps.json").read_text())
    mpy_cross = mpy_cross_for(target.micropython, args.mpy_cross)

    port = find_port(target, bench)
    say("bench: %s on %s" % (image.name, port))
    flash(target, bench, image, port)

    say("bench: asking for HELLO (up to 30 s), then deploying %s %d times" % (bench["flow"], DEPLOYS))
    while True:
        try:
            info, acks = session(port, bench["flow"], mpy_cross)
            break
        except NoHello as e:
            say("bench: %s" % e)
            if ask("%s, then Enter to ask again (s to skip %s) " % (reset_step(bench), target.id)).strip() == "s":
                raise
    # Checked after the deploys (they ran in the same open), but before anything is recorded.
    count = check_hello(info, version, frozen)
    say("bench: HELLO %s, %d libraries frozen; %s" % (version, count, memory(info)))

    figures = [memory(info)]
    for n, ack in enumerate(acks, 1):
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


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def tested_image(target, version):
    """The target's newest tested.json entry at `version`, as (sha256, entry). Whichever run recorded it."""
    at = [(h, e) for h, e in target.tested().items()
          if (firmware_targets.parse_image_name(e.get("image", "")) or (None, None))[1] == version]
    if not at:
        raise BenchError("%s has no tested image at %s -- bench it first: python3 firmware/bench.py %s"
                         % (target.id, version, target.id))
    newest = max(e.get("date", "") for _, e in at)
    latest = [(h, e) for h, e in at if e.get("date", "") == newest]
    if len(latest) > 1:
        raise BenchError("%s has %d images tested at %s on %s (%s): remove the one not to ship from %s"
                         % (target.id, len(latest), version, newest, ", ".join(e["image"] for _, e in latest),
                            target.tested_path.relative_to(REPO)))
    return latest[0]


def ci_image(target, image_name, into):
    """Downloads `image_name` from the Firmware images run that built it (artifacts are kept 90 days)."""
    sha7 = firmware_targets.parse_image_name(image_name)[2]
    full = run(["git", "-C", str(REPO), "rev-parse", "--verify", "--quiet", sha7 + "^{commit}"], capture_output=True)
    if full.returncode != 0:
        raise BenchError("%s: commit %s is not in this checkout (git fetch?)" % (image_name, sha7))
    sha = full.stdout.strip()
    out = run(["gh", "run", "list", "--workflow", WORKFLOW, "--commit", sha, "--status", "success",
               "--json", "databaseId", "--limit", "1"], capture_output=True, cwd=REPO)
    runs = json.loads(out.stdout or "[]") if out.returncode == 0 else []
    if not runs:
        raise BenchError("%s: no successful %s run for %s (gh: %s) -- put the image in firmware/out/%s/ yourself"
                         % (image_name, WORKFLOW, sha7, out.stderr.strip() or "none listed", target.id))
    into.mkdir(parents=True, exist_ok=True)
    name = "firmware-%s-%s" % (target.id, sha)
    if run(["gh", "run", "download", str(runs[0]["databaseId"]), "--name", name, "--dir", str(into)],
           cwd=REPO).returncode != 0:
        raise BenchError("could not download %s (a run's artifacts are kept 90 days)" % name)
    return into / image_name


def catalogue_images(images_dir):
    """Every target's tested image at the runtime version, copied into firmware/out/<target>/ (where publish.sh
    takes the newest image from) with its .sha256 and main.py. Refuses before writing anything if one is missing."""
    version = firmware_targets.runtime_version()
    found = []
    for target in firmware_targets.targets():
        digest, entry = tested_image(target, version)
        image = images_dir / target.id / entry["image"] if images_dir else None
        if image is None or not image.is_file():
            image = ci_image(target, entry["image"], Path(tempfile.mkdtemp(prefix="thingstudio-catalogue-")) / target.id)
        if not image.is_file() or sha256_of(image) != digest:
            raise BenchError("%s does not hash to its tested.json entry (%s...)" % (image, digest[:12]))
        found.append((target, image, entry))
    images = []
    for target, image, entry in found:
        out = REPO / "firmware" / "out" / target.id
        out.mkdir(parents=True, exist_ok=True)
        for src in (image, image.with_name(image.name + ".sha256"), image.parent / "main.py",
                    image.parent / "_deps.json"):
            if src.is_file() and src.resolve() != (out / src.name).resolve():
                shutil.copy2(src, out / src.name)
        (out / image.name).touch()  # the newest in out/, so publish.sh takes this one
        say("bench: catalogue %s <- %s (tested %s on %s)" % (target.id, image.name, entry["date"], entry["board"]))
        images.append(out / image.name)
    return images


def catalogue(release, images_dir):
    images = catalogue_images(images_dir)
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
                        help="afterwards, add every target's tested image at the runtime version to builds.json "
                             "for this release (whichever run recorded it), and sign it")
    parser.add_argument("--catalogue-only", action="store_true",
                        help="with --catalogue: no bench, just the catalogue from the images already tested")
    args = parser.parse_args(argv)
    args.mpy_cross = args.mpy_cross or os.environ.get("THINGSTUDIO_MPY_CROSS")

    try:
        all_targets = {t.id: t for t in firmware_targets.targets()}
        ids = args.targets or list(all_targets)
        unknown = [t for t in ids if t not in all_targets]
        if unknown:
            raise BenchError("no target %s (known: %s)" % (", ".join(unknown), ", ".join(all_targets)))
        if args.catalogue_only:
            if not args.catalogue:
                raise BenchError("--catalogue-only needs --catalogue vX.Y.Z")
            if args.targets:
                raise BenchError("--catalogue-only takes no targets: the catalogue covers every target")
            if not shutil.which("gh"):
                raise BenchError("missing: gh")
            catalogue(args.catalogue, args.images_from)
            say("\nCommit in your own Terminal:\n  rm -f .git/index.lock\n  git add firmware/builds.json "
                "firmware/builds.json.sig\n  git commit -m \"firmware: catalogue %s\"\n  git push" % args.catalogue)
            return 0
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
    if args.catalogue and not failed:
        try:
            catalogue(args.catalogue, images_dir)
        except BenchError as e:
            say("bench: %s" % e)
            return 1
    elif args.catalogue and failed:
        say("bench: catalogue left alone -- every target needs a tested image first")
    if recorded or (args.catalogue and not failed):
        files = "firmware/targets/*/tested.json" + (" firmware/builds.json firmware/builds.json.sig"
                                                     if args.catalogue and not failed else "")
        say("\nCommit in your own Terminal:\n  rm -f .git/index.lock\n  git add %s\n"
            "  git commit -m \"firmware: record runtime %s images as tested\"\n  git push"
            % (files, firmware_targets.runtime_version()))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
