#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# bench/host/summarise.py
#
# Read result files and print a markdown table. One row per file: this is
# deliberately not an average across boards, because a combined figure hides
# exactly the port differences the bench exists to show.
#
# Usage:
#   python3 bench/host/summarise.py bench/results/*.json
#   python3 bench/host/summarise.py bench/results/*.json --out /tmp/summary.md

import argparse
import json
import os
import sys


def load(paths):
    out = []
    for path in paths:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print("skipping %s: %s" % (path, e), file=sys.stderr)
            continue
        data["_path"] = os.path.basename(path)
        out.append(data)
    return out


def board_label(data):
    meta = data.get("meta", {})
    machine = meta.get("uname", {}).get("machine") or meta.get("platform") or "?"
    collection = data.get("collection", {})
    when = (collection.get("collected_at") or "")[:10]
    return "%s %s" % (machine, when)


def format_value(value, digits=0):
    if value is None:
        return "-"
    try:
        if digits:
            return ("%%.%df" % digits) % float(value)
        return "%.0f" % float(value)
    except (TypeError, ValueError):
        return str(value)


def bench_rows(data):
    tests = data.get("tests", {})
    interp = tests.get("interp", {})
    async_ = tests.get("async", {})
    timer = tests.get("timer", {})
    adc = tests.get("adc", {})
    irq = tests.get("irq", {})
    thread = tests.get("thread", {})

    def interp_ops(name):
        row = interp.get(name) or {}
        return row.get("ops_per_s")

    def timer_p99(freq):
        row = timer.get(str(freq)) or {}
        return (row.get("interval_us") or {}).get("p99")

    def timer_missed(freq):
        row = timer.get(str(freq)) or {}
        return row.get("missed")

    return [
        board_label(data),
        format_value(interp_ops("pass")),
        format_value(interp_ops("func_call")),
        format_value(interp_ops("float_add")),
        format_value(async_.get("switch_per_s")),
        format_value((async_.get("sleep_latency") or {}).get("p99")),
        "%s / %s" % (format_value(timer_p99(1000)), format_value(timer_missed(1000))),
        "%s / %s" % (format_value(timer_p99(10000)), format_value(timer_missed(10000))),
        format_value(adc.get("samples_per_s")),
        format_value((irq.get("interval_us") or {}).get("p99")),
        format_value(thread.get("scaling"), 2),
    ]


BENCH_HEADER = [
    "board / date",
    "pass ops/s",
    "call ops/s",
    "float ops/s",
    "switch/s",
    "sleep p99 us",
    "1k p99 / missed",
    "10k p99 / missed",
    "ADC samples/s",
    "IRQ p99 us",
    "thread x",
]


def viper_rows(data):
    rows = []
    board = board_label(data)
    for name in sorted(data.get("tests", {})):
        variants = data["tests"][name].get("variants", {})
        plain = variants.get("plain", {})
        native = variants.get("native", {})
        viper = variants.get("viper", {})
        rows.append([
            board,
            name,
            format_value(plain.get("us_median")),
            format_value(native.get("us_median")),
            format_value(viper.get("us_median")),
            format_value(native.get("speedup_vs_plain"), 2),
            format_value(viper.get("speedup_vs_plain"), 2),
        ])
    return rows


VIPER_HEADER = [
    "board / date",
    "test",
    "plain us",
    "native us",
    "viper us",
    "native x",
    "viper x",
]


def table(header, rows):
    lines = ["| " + " | ".join(header) + " |",
             "|" + "|".join(["---"] * len(header)) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", help="result JSON files")
    parser.add_argument("--out", help="write markdown here instead of stdout")
    args = parser.parse_args(argv)

    data = load(args.files)
    if not data:
        return 1

    bench = [d for d in data if d.get("collection", {}).get("suite", "bench") == "bench"]
    viper = [d for d in data if d.get("collection", {}).get("suite") == "viper"]

    chunks = []
    if bench:
        chunks.append("## MicroPython baseline\n\n" +
                      table(BENCH_HEADER, [bench_rows(d) for d in bench]))
    if viper:
        rows = []
        for d in viper:
            rows.extend(viper_rows(d))
        chunks.append("## Viper / native\n\n" + table(VIPER_HEADER, rows))

    text = "\n\n".join(chunks) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote %s" % args.out)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
