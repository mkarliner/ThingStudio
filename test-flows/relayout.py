#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# test-flows/relayout.py
#
# Lays a flow file out left to right: sources at the left edge, every wire running to a node further
# right, branches stacked vertically within their column. Mike's rule, 2026-10-22: a flow that wraps
# back to the left edge on its second row reads as a rats nest, and that is only a layout accident --
# nothing about the graph needs it.
#
# A node's column is its longest distance from a source (so a longer path never has to go backwards to
# meet a shorter one); its row is its place within that column. Nodes with no wires at all go in a
# column of their own at the left.
#
# Usage:
#   python3 test-flows/relayout.py test-flows/gui-hero-*.flow.json     # rewrite in place
#   python3 test-flows/relayout.py --check test-flows/*.flow.json      # report wires that go backwards
#
# Layout is the only thing touched: nodes, edges, configs, panes, screens are left byte-for-byte as
# they were (the file is re-serialised, so compare with `git diff` before committing).

import argparse
import json
import sys

COLUMN_X = 260
ROW_Y = 170
ORIGIN = (60, 60)


def columns(data):
    """{node id: column}. Longest path from a source; disconnected nodes get -1."""
    ids = [n["id"] for n in data["nodes"]]
    incoming = {nid: 0 for nid in ids}
    outgoing = {nid: [] for nid in ids}
    for origin, _slot, target, _tslot in data["edges"]:
        if origin in outgoing and target in incoming:
            outgoing[origin].append(target)
            incoming[target] += 1

    depth = {}

    def visit(nid, stack):
        if nid in depth:
            return depth[nid]
        if nid in stack:  # a cycle: the compiler rejects these, but don't hang on one
            return 0
        stack.add(nid)
        preds = [d for d, targets in outgoing.items() if nid in targets]
        value = 0 if not preds else 1 + max(visit(p, stack) for p in preds)
        stack.discard(nid)
        depth[nid] = value
        return value

    for nid in ids:
        visit(nid, set())
    # Normalise so the leftmost node is column 0: a source is depth 0 already, this only guards
    # against an all-unwired graph.
    base = min(depth.values()) if depth else 0
    return {nid: value - base for nid, value in depth.items()}


def rows_by_column(data, depth):
    """Order within a column: by the average column of the node's predecessors, then id, so a branch
    stays next to whatever feeds it."""
    order = {}
    for origin, _slot, target, _tslot in data["edges"]:
        order.setdefault(target, []).append(depth.get(origin, 0))
    columns = {}
    for nid, col in depth.items():
        columns.setdefault(col, []).append(nid)
    for col, ids in columns.items():
        ids.sort(key=lambda n: (sum(order.get(n, [col])) / max(len(order.get(n, [col])), 1), n))
    return columns


def relayout(data):
    depth = columns(data)
    by_column = rows_by_column(data, depth)
    layout = {}
    left = min(by_column) if by_column else 0
    for col in sorted(by_column):
        for row, nid in enumerate(by_column[col]):
            layout[nid] = {"pos": [ORIGIN[0] + (col - left) * COLUMN_X, ORIGIN[1] + row * ROW_Y]}
    data["layout"] = layout
    return data


def backwards_wires(data):
    layout = data.get("layout", {})
    bad = []
    for origin, _slot, target, _tslot in data["edges"]:
        a = layout.get(origin, {}).get("pos")
        b = layout.get(target, {}).get("pos")
        if a and b and b[0] <= a[0]:
            bad.append((origin, target, a[0], b[0]))
    return bad


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="only report wires that don't run left to right")
    parser.add_argument("flows", nargs="+")
    args = parser.parse_args(argv)

    problems = 0
    for path in args.flows:
        with open(path) as f:
            data = json.load(f)
        if args.check:
            bad = backwards_wires(data)
            if bad:
                problems += len(bad)
                print("%s:" % path)
                for origin, target, x1, x2 in bad:
                    print("  %s (x=%d) -> %s (x=%d)" % (origin, x1, target, x2))
            continue
        relayout(data)
        with open(path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print("relaid out %s (%d nodes)" % (path, len(data["nodes"])))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
