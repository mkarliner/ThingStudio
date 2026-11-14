#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# bench/host/run_bench.py
#
# Run bench/device/bench.py on a board over mpremote (or on a local unix-port
# MicroPython for validating the script), parse its JSON block, stamp the
# result with host metadata, and write a results file.
#
# The board side is deliberately one self-contained file: this runner only
# copies it and calls main(). That keeps the on-device surface small and lets
# the same file run from Thonny with no host at all.
#
# Examples:
#   python3 bench/host/run_bench.py --port /dev/ttyACM0 --label esp32s3
#   python3 bench/host/run_bench.py --local ~/micropython/ports/unix/build-standard/micropython
#   python3 bench/host/run_bench.py --port /dev/ttyACM0 --tests timer,thread --timer-freqs 100,1000
#
# Needs `mpremote` on PATH for --port:  python3 -m pip install mpremote
#
# The IRQ test needs a signal on --irq-pin. Without it, pass --tests to skip
# it (the default set does). The ADC test needs --adc-pins on ESP32; RP2040
# defaults to pin 26.

import argparse
import datetime
import hashlib
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BENCH_DIR = os.path.dirname(THIS_DIR)
REPO_ROOT = os.path.dirname(BENCH_DIR)
DEVICE_BENCH = os.path.join(BENCH_DIR, "device", "bench.py")
DEVICE_VIPER = os.path.join(BENCH_DIR, "device", "viper_bench.py")
RESULTS_DIR = os.path.join(BENCH_DIR, "results")

SUITES = {
    "bench": {
        "path": DEVICE_BENCH,
        "module": "bench",
        "begin": "=== BENCH_JSON_BEGIN ===",
        "end": "=== BENCH_JSON_END ===",
    },
    "viper": {
        "path": DEVICE_VIPER,
        "module": "viper_bench",
        "begin": "=== VIPER_JSON_BEGIN ===",
        "end": "=== VIPER_JSON_END ===",
    },
}


def die(message):
    print("ERR: %s" % message, file=sys.stderr)
    raise SystemExit(2)


def git_commit():
    try:
        out = subprocess.check_output(
            ["git", "-C", REPO_ROOT, "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
        )
        return out.decode("ascii", "replace").strip()
    except Exception:
        return None


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def bench_argv(args):
    argv = []
    if args.tests:
        argv += ["--tests", args.tests]
    if args.reps is not None:
        argv += ["--reps", str(args.reps)]
    if args.duration_ms is not None:
        argv += ["--duration-ms", str(args.duration_ms)]
    if args.interp_ms is not None:
        argv += ["--interp-ms", str(args.interp_ms)]
    if args.adc_pins:
        argv += ["--adc-pins", args.adc_pins]
    if args.irq_pin is not None:
        argv += ["--irq-pin", str(args.irq_pin)]
    if args.irq_out_pin is not None:
        argv += ["--irq-out-pin", str(args.irq_out_pin)]
    if args.irq_hz is not None:
        argv += ["--irq-hz", str(args.irq_hz)]
    if args.irq_edge:
        argv += ["--irq-edge", args.irq_edge]
    if args.timer_freqs:
        argv += ["--timer-freqs", args.timer_freqs]
    if args.timer_id is not None:
        argv += ["--timer-id", str(args.timer_id)]
    if args.timer_hard:
        argv += ["--timer-hard"]
    return argv


def run_local(args, argv, suite):
    micropython = args.local
    if not os.path.isfile(micropython):
        die("no such MicroPython binary: %s" % micropython)
    cmd = [micropython, suite["path"]] + argv
    return cmd, subprocess.run(cmd, capture_output=True, text=True)


def mpremote_command(args):
    if args.mpremote:
        return args.mpremote
    found = shutil.which("mpremote")
    if found:
        return found
    # A venv/install may expose it as a module but not on PATH.
    probe = subprocess.run(
        [sys.executable, "-m", "mpremote", "--version"],
        capture_output=True,
        text=True,
    )
    if probe.returncode == 0:
        return "%s -m mpremote" % sys.executable
    die("mpremote not found. Install it with: %s -m pip install mpremote" % sys.executable)


def run_remote(args, argv, suite):
    mp = mpremote_command(args)
    base = shlex.split(mp)
    connect = base + ["connect", args.port]

    destination = ":%s.py" % suite["module"]
    copied = subprocess.run(
        connect + ["fs", "cp", suite["path"], destination],
        capture_output=True,
        text=True,
    )
    if copied.returncode != 0:
        sys.stderr.write(copied.stdout)
        sys.stderr.write(copied.stderr)
        die("copying %s to the board failed" % os.path.basename(suite["path"]))

    # main() takes a Python list of strings. json.dumps gives a valid Python
    # literal for strings/ints and avoids hand-rolled quoting.
    call = "import %s; %s.main(%s)" % (suite["module"], suite["module"], json.dumps(argv))
    cmd = connect + ["exec", call]
    return cmd, subprocess.run(cmd, capture_output=True, text=True)


def extract_json(stdout, begin, end):
    start = stdout.find(begin)
    if start < 0:
        return None
    start += len(begin)
    stop = stdout.find(end, start)
    if stop < 0:
        return None
    text = stdout[start:stop].strip()
    try:
        return json.loads(text)
    except ValueError as e:
        raise SystemExit("ERR: the board's JSON block is not valid JSON: %s" % e)


def slug(text, fallback="board"):
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or fallback


def label_for(args, result):
    if args.label:
        return slug(args.label)
    meta = result.get("meta", {})
    machine = meta.get("uname", {}).get("machine")
    return slug(machine, "local" if args.local else "board")


def viper_summary_lines(result):
    lines = []
    for name in sorted(result.get("tests", {})):
        row = result["tests"][name]
        variants = row.get("variants", {})
        parts = []
        for variant in ("plain", "native", "viper"):
            v = variants.get(variant)
            if not v:
                continue
            if v.get("skipped") or v.get("error"):
                parts.append("%s=skip" % variant)
            else:
                parts.append("%s=%sus (%sx)" % (variant, v.get("us_median"),
                                                v.get("speedup_vs_plain")))
        lines.append("%-14s %s" % (name, "  ".join(parts)))
    return lines


def summary_lines(result):
    lines = []
    tests = result.get("tests", {})
    interp = tests.get("interp", {})
    if interp and not interp.get("error"):
        for name in ("pass", "int_add", "func_call", "dict_get", "float_add"):
            row = interp.get(name)
            if row and not row.get("error"):
                lines.append("interp %-10s %10.0f ops/s" % (name, row.get("ops_per_s") or 0))
    async_ = tests.get("async", {})
    if async_ and not async_.get("error"):
        lat = async_.get("sleep_latency", {})
        lines.append(
            "async  %8.0f switches/s  sleep p99=%s us  drift=%s us"
            % (async_.get("switch_per_s") or 0, lat.get("p99"), async_.get("sleep_drift_us"))
        )
    timer = tests.get("timer", {})
    for key in sorted(timer, key=lambda k: int(k) if str(k).isdigit() else 0):
        row = timer[key]
        if not isinstance(row, dict):
            continue
        if row.get("error"):
            lines.append("timer  %-8s error: %s" % (key, row["error"]))
        elif not row.get("skipped"):
            lines.append(
                "timer  %-8s achieved=%8.1f Hz  missed=%-4s p99=%s us"
                % (key, row.get("achieved_hz") or 0, row.get("missed"),
                   row.get("interval_us", {}).get("p99"))
            )
    adc = tests.get("adc", {})
    if adc and not adc.get("error") and not adc.get("skipped"):
        lines.append(
            "adc    %8.0f samples/s  pins=%s"
            % (adc.get("samples_per_s") or 0, adc.get("pins"))
        )
    elif adc.get("skipped"):
        lines.append("adc    skipped: %s" % adc["skipped"])
    irq = tests.get("irq", {})
    if irq and not irq.get("error") and not irq.get("skipped"):
        lines.append(
            "irq    %8d edges  missed=%-4s  ~%.0f Hz (rough; LA for latency)"
            % (irq.get("count") or 0, irq.get("missed"), irq.get("achieved_hz") or 0)
        )
    thread = tests.get("thread", {})
    if thread and not thread.get("skipped") and not thread.get("error"):
        lines.append(
            "thread scaling=%s  single=%s  double=%s"
            % (thread.get("scaling"), thread.get("single_count"), thread.get("double_count"))
        )
    return lines


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--port", help="mpremote target, e.g. /dev/ttyACM0 or COM5")
    target.add_argument("--local", help="path to a local MicroPython (unix port) binary")
    parser.add_argument("--mpremote", help="mpremote executable (default: PATH, then -m mpremote)")
    parser.add_argument("--suite", choices=sorted(SUITES), default="bench",
                        help="bench: interpreter/scheduler/IO baseline; viper: plain vs native vs viper")
    parser.add_argument("--tests", help="comma-separated subset (default: interp,gc,async,timer,adc,thread)")
    parser.add_argument("--reps", type=int)
    parser.add_argument("--duration-ms", type=int)
    parser.add_argument("--interp-ms", type=int)
    parser.add_argument("--adc-pins", help="comma-separated ADC pin numbers, e.g. 26 or 1,2")
    parser.add_argument("--irq-pin", type=int)
    parser.add_argument("--irq-out-pin", type=int)
    parser.add_argument("--irq-hz", type=int)
    parser.add_argument("--irq-edge", choices=("rising", "falling", "both"))
    parser.add_argument("--timer-freqs", help="comma-separated Hz, e.g. 100,1000,5000")
    parser.add_argument("--timer-id", type=int)
    parser.add_argument("--timer-hard", action="store_true",
                        help="ask for a hard-ISR timer callback; the default is the soft path "
                             "(the callbacks record timestamps, which a hard ISR must not allocate)")
    parser.add_argument("--label", help="results filename label (default: board name)")
    parser.add_argument("--out-dir", default=RESULTS_DIR)
    parser.add_argument("--raw", help="also write the raw console output here")

    args = parser.parse_args(argv)
    suite = SUITES[args.suite]
    argv_bench = bench_argv(args)

    if args.local:
        cmd, proc = run_local(args, argv_bench, suite)
    else:
        cmd, proc = run_remote(args, argv_bench, suite)

    if proc.stdout:
        sys.stdout.write(proc.stdout)
    if proc.stderr:
        sys.stderr.write(proc.stderr)

    result = extract_json(proc.stdout or "", suite["begin"], suite["end"])
    if result is None:
        die("no JSON block in the output (see the console above; is MicroPython running?)")

    collected = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    result["collection"] = {
        "collected_at": collected.isoformat(),
        "method": "local" if args.local else "mpremote",
        "target": args.local or args.port,
        "host": platform.platform(),
        "python": platform.python_version(),
        "repo_commit": git_commit(),
        "bench_sha256": sha256(suite["path"]),
        "suite": args.suite,
        "command": " ".join(cmd),
    }

    os.makedirs(args.out_dir, exist_ok=True)
    suffix = "" if args.suite == "bench" else "-%s" % args.suite
    name = "%s-%s%s.json" % (collected.strftime("%Y-%m-%d-%H%M"), label_for(args, result), suffix)
    path = os.path.join(args.out_dir, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, sort_keys=True)
        f.write("\n")

    print("\n--- summary ---")
    lines = viper_summary_lines(result) if args.suite == "viper" else summary_lines(result)
    for line in lines:
        print(line)
    print("\nwrote %s" % path)

    if args.raw:
        with open(args.raw, "w", encoding="utf-8") as f:
            f.write(proc.stdout or "")
            if proc.stderr:
                f.write("\n--- stderr ---\n")
                f.write(proc.stderr)
        print("wrote %s" % args.raw)

    if proc.returncode != 0:
        return proc.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
