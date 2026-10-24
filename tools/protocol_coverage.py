#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/protocol_coverage.py
#
# Builds interfaces/protocol/COVERAGE.md: one row per wire-protocol message, saying in plain words whether
# it is in the spec, has conformance vectors, is sent and handled where its direction says it should be,
# is mentioned by tests on each side, and appears in a sequence diagram (interfaces/protocol/SEQUENCES.md).
#
#   python3 tools/protocol_coverage.py           rewrite COVERAGE.md
#   python3 tools/protocol_coverage.py --check   exit 1 if COVERAGE.md is out of date or a problem is found
#
# Plain standard-library Python, reads files only. It finds senders and handlers by pattern, not by
# understanding the code, so it answers "is there one at all", not "is it right" -- that is the audit's job
# (docs/working-notes/reviews/*-protocol-audit.md). The patterns are listed in PATTERNS below; if the code
# changes how it sends or matches a message, change them here.

import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
PROTO = os.path.join(ROOT, "interfaces", "protocol")
OUT = os.path.join(PROTO, "COVERAGE.md")
SEQUENCES = os.path.join(PROTO, "SEQUENCES.md")

# Where each side's code lives, and how a send or a handler looks there.
EDITOR_SRC = os.path.join(ROOT, "editor", "src")
EDITOR_PROTOCOL_DIR = os.path.join(EDITOR_SRC, "protocol")  # the codec itself: not a sender or a handler
DEVICE_SRC = os.path.join(ROOT, "device-runtime", "src")
TEST_DIRS = {
    "editor": os.path.join(ROOT, "editor", "test"),
    "board": os.path.join(ROOT, "device-runtime", "test"),
}
# Messages one side deliberately no longer sends or handles, with the reason. Shown in the matrix as
# "no, on purpose" instead of being reported as a problem. Remove an entry when the reason stops being true.
ON_PURPOSE = {
    ("DEPLOY", "editor_send"): "kept for editors before 11.3.0; this editor always deploys in pieces "
                                "(FLOW_PUT/FLOW_COMMIT), and the board still accepts DEPLOY",
}
PATTERNS = {
    # editor: a message object literal, e.g. transport.send({ type: "FLOW_PUT", ... }) or pieces.push({ type: "DEP_PUT", ...
    "editor_send": r'type:\s*"{name}"',
    # editor: a match on an arriving message, e.g. m.type === "FLOW_ACK"
    "editor_handle": r'\.type\s*===\s*"{name}"',
    # board: a message dict, e.g. {"type": "FLOW_ACK", ...}
    "board_send": r'"type":\s*"{name}"',
    # board: listener.py's dispatch, e.g. msg_type == "FLOW_PUT" or msg_type in ("STATE_READ", ...)
    "board_handle": r'msg_type\s*==\s*"{name}"|msg_type\s+in\s+\([^)]*"{name}"',
}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def source_files(top, exts, skip_dir=None):
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = sorted(d for d in dirnames if d not in ("node_modules", "__pycache__", "vendor"))
        if skip_dir and os.path.normpath(dirpath).startswith(os.path.normpath(skip_dir)):
            continue
        for fn in sorted(filenames):
            if fn.endswith(exts):
                yield os.path.join(dirpath, fn)


def code_only(path):
    """The file with comments removed, so a message named in a comment doesn't count as a send or a handler.
    Rough (a comment marker inside a string is treated as a comment), which only ever hides a match."""
    text = read(path)
    if path.endswith(".py"):
        return re.sub(r"(?m)^\s*#.*$|\s#\s.*$", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)(^|[^:])//.*$", r"\1", text)


def files_matching(paths, pattern):
    rx = re.compile(pattern)
    return [rel(p) for p in paths if rx.search(code_only(p))]


def id_table(path, start_marker):
    """NAME: id pairs from the MessageType table in messages.ts or messages.py."""
    text = read(path)
    i = text.find(start_marker)
    if i < 0:
        return None
    block = text[i : text.find("}", i)]
    return {m.group(1): int(m.group(2)) for m in re.finditer(r'^\s*"?([A-Z_]+)"?\s*:\s*(\d+)\s*,', block, re.M)}


def diagram_names(text, known):
    """Message names used on arrows in SEQUENCES.md's mermaid blocks.

    Rule (also stated at the top of SEQUENCES.md): on an arrow line `A->>B: TEXT`, an unquoted ALL-CAPS first
    word is a protocol message name. Anything else (quoted text, lower case) is not a message."""
    used, unknown = set(), set()
    for block in re.findall(r"```mermaid\n(.*?)```", text, re.S):
        for line in block.splitlines():
            m = re.match(r"\s*\w+\s*-[-x)]*>>?[+-]?\s*\w+\s*:\s*(\S+)", line)
            if not m:
                continue
            word = m.group(1).rstrip(",.")
            if re.fullmatch(r"[A-Z][A-Z0-9_]+", word):
                (used if word in known else unknown).add(word)
    return used, unknown


def yes(v):
    return "yes" if v else "**no**"


def build():
    table = json.load(open(os.path.join(PROTO, "messages.json"), encoding="utf-8"))
    messages = table["messages"]
    names = [m["name"] for m in messages]
    spec = read(os.path.join(PROTO, "SPEC.md"))
    vectors = json.load(open(os.path.join(PROTO, "vectors", "messages.json"), encoding="utf-8"))["vectors"]
    vector_count = {}
    for v in vectors:
        t = v.get("message", {}).get("type")
        vector_count[t] = vector_count.get(t, 0) + 1

    editor_files = list(source_files(EDITOR_SRC, (".ts", ".vue"), skip_dir=EDITOR_PROTOCOL_DIR))
    board_files = list(source_files(DEVICE_SRC, (".py",)))
    test_files = {k: list(source_files(d, (".ts", ".py"))) for k, d in TEST_DIRS.items()}
    seq_text = read(SEQUENCES) if os.path.exists(SEQUENCES) else ""
    in_diagrams, unknown_in_diagrams = diagram_names(seq_text, set(names))

    ts_ids = id_table(os.path.join(EDITOR_PROTOCOL_DIR, "messages.ts"), "export const MessageType")
    py_ids = id_table(os.path.join(DEVICE_SRC, "messages.py"), "MessageType = {")

    problems = []
    if ts_ids is None or py_ids is None:
        problems.append("could not find the MessageType table in editor/src/protocol/messages.ts or device-runtime/src/messages.py")
    rows, where = [], []
    for m in messages:
        name, mid, direction = m["name"], m["id"], m["direction"]
        reserved = m["summary"].lower().startswith("reserved")
        to_board = direction in ("editor->device", "both")
        to_editor = direction in ("device->editor", "both")
        pat = {k: p.format(name=name) for k, p in PATTERNS.items()}
        e_send = files_matching(editor_files, pat["editor_send"]) if to_board else []
        b_handle = files_matching(board_files, pat["board_handle"]) if to_board else []
        b_send = files_matching(board_files, pat["board_send"]) if to_editor else []
        e_handle = files_matching(editor_files, pat["editor_handle"]) if to_editor else []
        quoted = re.compile(r'"%s"' % name)
        e_tests = [rel(p) for p in test_files["editor"] if quoted.search(read(p))]
        b_tests = [rel(p) for p in test_files["board"] if quoted.search(read(p))]
        in_spec = re.search(r"^### %s\b" % name, spec, re.M) is not None
        n_vec = vector_count.get(name, 0)
        ids_agree = ts_ids is not None and py_ids is not None and ts_ids.get(name) == mid and py_ids.get(name) == mid

        def cell(applies, found, key):
            if not applies:
                return "n/a"
            if not found and (name, key) in ON_PURPOSE:
                return "no, on purpose"
            return yes(found)

        arrow = {"editor->device": "editor → board", "device->editor": "board → editor", "both": "both ways"}[direction]
        rows.append(
            "| %d | `%s`%s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |"
            % (
                mid, name, " (reserved)" if reserved else "", arrow,
                yes(ids_agree), yes(in_spec), str(n_vec) if n_vec else "**0**",
                cell(to_board, e_send, "editor_send"), cell(to_board, b_handle, "board_handle"),
                cell(to_editor, b_send, "board_send"), cell(to_editor, e_handle, "editor_handle"),
                yes(e_tests), yes(b_tests), yes(name in in_diagrams),
            )
        )
        parts = []
        def found_in(files, key, none="**nothing found**"):
            if files:
                return "in " + ", ".join("`%s`" % f for f in files)
            if (name, key) in ON_PURPOSE:
                return "nowhere, on purpose: " + ON_PURPOSE[(name, key)]
            return none

        if to_board:
            parts.append("editor sends it %s" % found_in(e_send, "editor_send"))
            parts.append("board handles it %s" % found_in(b_handle, "board_handle"))
        if to_editor:
            parts.append("board sends it %s" % found_in(b_send, "board_send"))
            parts.append("editor acts on it %s" % found_in(e_handle, "editor_handle", "nowhere beyond logging it"))
        where.append("- **`%s`** (%d, %s): %s." % (name, mid, arrow, "; ".join(parts)))

        # What counts as a problem. Reserved messages are allowed to have no sender or handler.
        if not ids_agree:
            problems.append("`%s`: the id in messages.json (%d) is not the same in messages.ts (%s) and messages.py (%s)"
                            % (name, mid, ts_ids.get(name) if ts_ids else "?", py_ids.get(name) if py_ids else "?"))
        if not in_spec:
            problems.append("`%s` has no section in SPEC.md" % name)
        if not n_vec:
            problems.append("`%s` has no conformance vector" % name)
        if name not in in_diagrams:
            problems.append("`%s` appears in no sequence diagram in SEQUENCES.md" % name)
        if not reserved:
            if to_board and not e_send and (name, "editor_send") not in ON_PURPOSE:
                problems.append("`%s` goes editor → board, but nothing in the editor sends it" % name)
            if to_board and not b_handle:
                problems.append("`%s` goes editor → board, but the board's listener does not dispatch it" % name)
            if to_editor and not b_send:
                problems.append("`%s` goes board → editor, but nothing on the board sends it" % name)
    for name in sorted(unknown_in_diagrams):
        problems.append("SEQUENCES.md draws a message `%s` that is not in messages.json" % name)
    for table_name, ids in (("messages.ts", ts_ids), ("messages.py", py_ids)):
        for extra in sorted(set(ids or {}) - set(names)):
            problems.append("%s has a message `%s` that is not in messages.json" % (table_name, extra))

    lines = [
        "<!-- Generated by tools/protocol_coverage.py. Do not edit by hand: run `python3 tools/protocol_coverage.py`. -->",
        "",
        "# Wire protocol coverage",
        "",
        "One row per message in `messages.json`, checked against the code. This file is regenerated, not written:",
        "run `python3 tools/protocol_coverage.py` after changing the protocol, and `make test` fails",
        "(`--check`) when it is out of date or a problem below appears.",
        "",
        "It answers \"is there one at all\", found by pattern: is the message in the spec, does it have vectors, does",
        "the side that should send it send it, does the side that should handle it handle it, does a test mention",
        "it, is it drawn in [`SEQUENCES.md`](SEQUENCES.md). It cannot say whether the behaviour is right. Exchanges",
        "(which reply answers which request, retries, timeouts) are not covered by any conformance vector today;",
        "the sequence diagrams are where a person checks those.",
        "",
        "## Problems",
        "",
    ]
    lines += ["- " + p for p in problems] if problems else ["None found."]
    lines += [
        "",
        "## The matrix",
        "",
        "\"n/a\" means the column doesn't apply in that direction. \"Editor handles\" means the editor waits for or acts",
        "on the message somewhere beyond logging it; every arriving message is logged to the console regardless.",
        "\"Tests mention\" means a test file names the message, which is a weak signal: it does not mean the",
        "exchange is tested.",
        "",
        "| Id | Message | Direction | Ids agree (json/ts/py) | In SPEC.md | Vectors | Editor sends | Board handles | Board sends | Editor handles | Editor tests mention | Board tests mention | In a diagram |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    lines += rows
    lines += ["", "## Where each message lives in the code", ""]
    lines += where
    lines += [""]
    return "\n".join(lines), problems


def main():
    text, problems = build()
    if "--check" in sys.argv[1:]:
        current = read(OUT) if os.path.exists(OUT) else ""
        failed = False
        if current != text:
            print("interfaces/protocol/COVERAGE.md is out of date: run python3 tools/protocol_coverage.py")
            failed = True
        for p in problems:
            print("protocol coverage: " + p.replace("`", ""))
            failed = True
        sys.exit(1 if failed else 0)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote %s (%d problem%s)" % (rel(OUT), len(problems), "" if len(problems) == 1 else "s"))


if __name__ == "__main__":
    main()
