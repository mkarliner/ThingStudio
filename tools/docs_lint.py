#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Style lint for the user guide (docs/user-guide/), with a shrinking baseline.

The checkable subset of docs/working-notes/docs-style-guide.md, enforced mechanically so a fix does not regress
between review passes (docs/working-notes/user-guide-editing-plan.md has the strategy). Python standard library
only; runs in a second or two.

    python3 tools/docs_lint.py                  check; exit 1 on a regression or a stale baseline entry
    python3 tools/docs_lint.py --all            list every violation, ignoring the baseline
    python3 tools/docs_lint.py --prune          delete baseline entries that no longer violate (never adds)
    python3 tools/docs_lint.py --init-baseline  write the first baseline (refuses if the file exists)

Rules (rule id: what it flags; each maps to a finding in reviews/2026-11-01-user-guide.md):

    opening              "this page" / "this section" in a page's opening paragraph, the first prose after
                         the title (C1)
    uk-spelling          colour, catalogue, recognis*, grey*, centre*, behaviour*, outside code (C2)
    plans                working-notes paths, "coming soon", "next to be written", "more are coming",
                         "work in progress" (C4)
    duplicate-term       the same leading **term** twice in one Properties section (C5.5)
    repeated-sentence    a sentence of eight or more words that appears twice in one file (C2); a "See …"
                         cross-reference doesn't count
    trailing-whitespace  trailing spaces or tabs
    blank-lines          more than one consecutive blank line

"Code" means fenced blocks and `inline spans` for uk-spelling (so `neopixel`'s 'colour' payload key is fine) and
fenced blocks only for repeated-sentence. HTML comments are never linted: text commented out for later is not
shown to the reader. ai-authoring.md and nodes-catalog.md are written for AI readers and are skipped.

The baseline (docs/style-lint-baseline.json) lists every violation that exists today as file / rule / snippet
(plus a count when the same snippet occurs more than once). The check fails on a violation the baseline does not
list (a regression or a new instance) and on a baseline entry that no longer violates (so the baseline shrinks as
fixes land and never grows silently). Adding an entry is a hand-edit that shows in review; --prune and
--init-baseline cannot add to an existing baseline. Judgment calls (voice, chattiness, repeated ideas, length) are
not checked here.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GUIDE = "docs/user-guide"
BASELINE = "docs/style-lint-baseline.json"
SKIPPED = {f"{GUIDE}/ai-authoring.md", f"{GUIDE}/nodes-catalog.md"}

RULES = (
    "opening",
    "uk-spelling",
    "plans",
    "duplicate-term",
    "repeated-sentence",
    "trailing-whitespace",
    "blank-lines",
)

OPENING_RE = re.compile(r"\b(?:this|these)\s+(?:page|section)\b", re.I)
UK_RE = re.compile(r"\b(?:colour|catalogue|recognis|grey|centre|behaviour)\w*", re.I)
PLANS_RE = re.compile(r"working-notes|coming soon|next to be written|more are coming|work[ -]in[ -]progress", re.I)

FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
CODE_SPAN_RE = re.compile(r"(`+)(.+?)\1")
LINK_TARGET_RE = re.compile(r"\]\([^)]*\)")
URL_RE = re.compile(r"https?://\S+")
TAG_RE = re.compile(r"<[^>]+>")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
ADMONITION_RE = re.compile(r"^(?:!!!|\?\?\?\+?)\s")
LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
LEAD_TERM_RE = re.compile(r"^\s*[-*+]\s+\*\*([^*]+)\*\*")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9*_\[`\"'(])")
MIN_REPEAT_WORDS = 8


@dataclass(frozen=True)
class Violation:
    file: str
    rule: str
    snippet: str
    line: int

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.file, self.rule, self.snippet)


# ---- reading a page ----------------------------------------------------------------------------------------


def numbered_lines(text: str, keep_fences: bool) -> list[tuple[int, str]]:
    """The page's lines with fenced code blanked (or kept) and HTML comments removed, line numbers preserved."""
    out: list[str] = []
    fence: str | None = None
    for raw in text.splitlines():
        m = FENCE_RE.match(raw)
        if fence is None and m:
            fence = m.group(1)[0]
            out.append(raw if keep_fences else "")
        elif fence is not None:
            if m and m.group(1)[0] == fence:
                fence = None
            out.append(raw if keep_fences else "")
        else:
            out.append(raw)
    joined = COMMENT_RE.sub(lambda mo: re.sub(r"[^\n]", "", mo.group()), "\n".join(out))
    return list(enumerate(joined.split("\n"), start=1))


def strip_code(s: str) -> str:
    return CODE_SPAN_RE.sub("", s)


def for_spelling(s: str) -> str:
    return TAG_RE.sub("", URL_RE.sub("", LINK_TARGET_RE.sub("]", strip_code(s))))


def squash(s: str) -> str:
    return " ".join(s.split())


def window(s: str, start: int, end: int, pad: int = 25) -> str:
    """The match with about `pad` characters each side, trimmed to whole words so the snippet reads."""
    lo, hi = max(0, start - pad), min(len(s), end + pad)
    if lo > 0 and not s[lo - 1].isspace() and not s[lo].isspace():
        lo = start if (nxt := s.find(" ", lo, start)) == -1 else nxt + 1
    if hi < len(s) and not s[hi].isspace() and not s[hi - 1].isspace():
        hi = end if (prv := s.rfind(" ", end, hi)) == -1 else prv
    return squash(s[lo:hi])


# ---- the rules ---------------------------------------------------------------------------------------------


def check_opening(rel: str, text: str) -> list[Violation]:
    lines = numbered_lines(text, keep_fences=False)
    i = 0
    for k, (_, line) in enumerate(lines):
        if line.startswith("# "):
            i = k + 1
            break
    n = len(lines)
    while i < n:
        no, line = lines[i]
        if not line.strip():
            i += 1
            continue
        if ADMONITION_RE.match(line):  # skip the admonition and its indented body
            i += 1
            while i < n and (not lines[i][1].strip() or lines[i][1].startswith((" ", "\t"))):
                i += 1
            continue
        if HEADING_RE.match(line) or LIST_RE.match(line) or line.lstrip().startswith(("|", "<", ">", "![")):
            return []  # the page has no prose opening
        block = []
        while i < n and lines[i][1].strip():
            block.append(lines[i][1].strip())
            i += 1
        opening = squash(strip_code(" ".join(block)))
        m = OPENING_RE.search(opening)
        if m:
            return [Violation(rel, "opening", window(opening, m.start(), m.end(), 35), no)]
        return []
    return []


def check_spelling(rel: str, text: str) -> list[Violation]:
    found = []
    for no, line in numbered_lines(text, keep_fences=False):
        s = for_spelling(line)
        for m in UK_RE.finditer(s):
            found.append(Violation(rel, "uk-spelling", window(s, m.start(), m.end()), no))
    return found


def check_plans(rel: str, text: str) -> list[Violation]:
    found = []
    for no, line in numbered_lines(text, keep_fences=True):
        for m in PLANS_RE.finditer(line):
            found.append(Violation(rel, "plans", window(line, m.start(), m.end(), 30), no))
    return found


def check_duplicate_terms(rel: str, text: str) -> list[Violation]:
    found = []
    level = 0
    seen: dict[str, int] = {}
    for no, line in numbered_lines(text, keep_fences=False):
        h = HEADING_RE.match(line)
        if h:
            depth = len(h.group(1))
            if level and depth <= level:
                level = 0
            if not level and h.group(2).strip().lower() == "properties":
                level, seen = depth, {}
            continue
        if not level:
            continue
        m = LEAD_TERM_RE.match(line)
        if m:
            term = squash(m.group(1)).rstrip(":").lower()
            if term in seen:
                found.append(Violation(rel, "duplicate-term", term, no))
            seen.setdefault(term, no)
    return found


def sentences(text: str) -> list[tuple[int, str]]:
    """(line, normalized sentence) for each sentence of prose, list item and admonition body."""
    out: list[tuple[int, str]] = []
    unit: list[str] = []
    start = 0

    def flush() -> None:
        if unit:
            joined = squash(" ".join(unit))
            for s in SENTENCE_SPLIT_RE.split(joined):
                out.append((start, s.lower()))
        unit.clear()

    for no, line in numbered_lines(text, keep_fences=False):
        stripped = line.strip()
        if (
            not stripped
            or HEADING_RE.match(line)
            or ADMONITION_RE.match(line)
            or stripped.startswith(("|", "<", "![", "---"))
        ):
            flush()
            continue
        if LIST_RE.match(line):
            flush()
            line = LIST_RE.sub("", line, count=1)
        if not unit:
            start = no
        unit.append(line.strip().replace("`", ""))
    flush()
    return out


def check_repeated_sentences(rel: str, text: str) -> list[Violation]:
    seen: dict[str, list[int]] = {}
    for no, s in sentences(text):
        # A "See [Page](link)." pointer is a cross-reference, and repeating one is how pages link a shared home.
        if len(s.split()) >= MIN_REPEAT_WORDS and not s.startswith("see "):
            seen.setdefault(s, []).append(no)
    found = []
    for s, nos in seen.items():
        for no in nos[1:]:
            found.append(Violation(rel, "repeated-sentence", s[:70], no))
    return found


def check_whitespace(rel: str, text: str) -> list[Violation]:
    """Trailing whitespace and blank-line runs, outside fenced code (a code sample may need both)."""
    found = []
    fence: str | None = None
    blank_run = 0
    last_text = ""
    for no, line in enumerate(text.splitlines(), start=1):
        m = FENCE_RE.match(line)
        if fence is None and m:
            fence = m.group(1)[0]
            blank_run = 0
            continue
        if fence is not None:
            if m and m.group(1)[0] == fence:
                fence = None
            blank_run = 0
            continue
        if line != line.rstrip():
            found.append(Violation(rel, "trailing-whitespace", line.strip()[:60] or "(whitespace-only line)", no))
        if line.strip():
            blank_run = 0
            last_text = line.strip()[:60]
        else:
            blank_run += 1
            if blank_run == 2:
                found.append(Violation(rel, "blank-lines", "after: " + last_text, no))
    return found


CHECKS = (check_opening, check_spelling, check_plans, check_duplicate_terms, check_repeated_sentences, check_whitespace)


def lint_text(rel: str, text: str) -> list[Violation]:
    found: list[Violation] = []
    for check in CHECKS:
        found.extend(check(rel, text))
    return found


def lint_tree(root: Path) -> list[Violation]:
    found: list[Violation] = []
    for path in sorted((root / GUIDE).rglob("*.md")):
        rel = path.relative_to(root).as_posix()
        if rel in SKIPPED:
            continue
        found.extend(lint_text(rel, path.read_text(encoding="utf-8")))
    return found


# ---- the baseline ------------------------------------------------------------------------------------------


def tally(violations: list[Violation]) -> Counter:
    return Counter(v.key for v in violations)


def load_baseline(path: Path) -> Counter:
    if not path.is_file():
        raise SystemExit(f"{path} not found. Create it once with --init-baseline.")
    data = json.loads(path.read_text(encoding="utf-8"))
    counts: Counter = Counter()
    for e in data["violations"]:
        if e["rule"] not in RULES:
            raise SystemExit(f"{path}: unknown rule {e['rule']!r}")
        counts[(e["file"], e["rule"], e["snippet"])] += int(e.get("count", 1))
    return counts


def save_baseline(path: Path, counts: Counter) -> None:
    entries = []
    for (file, rule, snippet), n in sorted(counts.items()):
        entry = {"file": file, "rule": rule, "snippet": snippet}
        if n > 1:
            entry["count"] = n
        entries.append(entry)
    doc = {
        "description": (
            "Every user-guide style violation that exists today (tools/docs_lint.py). Entries only leave: "
            "fix the page, then delete its entry (or run `python3 tools/docs_lint.py --prune`). Adding one is a "
            "deliberate hand-edit that shows in review."
        ),
        "violations": entries,
    }
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def describe(key: tuple[str, str, str], n: int) -> str:
    file, rule, snippet = key
    times = f" (x{n})" if n > 1 else ""
    return f"{file}: {rule}: {snippet!r}{times}"


# ---- command line ------------------------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", type=Path, default=REPO, help="repository root (default: this checkout)")
    ap.add_argument("--baseline", type=Path, help=f"baseline file (default: {BASELINE} under the root)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--all", action="store_true", help="list every violation, ignoring the baseline")
    mode.add_argument("--prune", action="store_true", help="delete baseline entries that no longer violate")
    mode.add_argument("--init-baseline", action="store_true", help="write the first baseline (refuses if one exists)")
    args = ap.parse_args(argv)

    root = args.root.resolve()
    baseline_path = args.baseline or root / BASELINE
    violations = lint_tree(root)
    actual = tally(violations)

    if args.all:
        for v in violations:
            print(f"{v.file}:{v.line}: {v.rule}: {v.snippet!r}")
        print(f"{len(violations)} violations in {len({v.file for v in violations})} files")
        return 0

    if args.init_baseline:
        if baseline_path.exists():
            print(f"{baseline_path} exists. Delete entries by hand or with --prune; adding is a hand-edit.", file=sys.stderr)
            return 2
        save_baseline(baseline_path, actual)
        print(f"wrote {baseline_path.relative_to(root) if baseline_path.is_relative_to(root) else baseline_path}: "
              f"{sum(actual.values())} violations in {len(actual)} entries")
        return 0

    baseline = load_baseline(baseline_path)
    if args.prune:
        kept = baseline & actual
        removed = baseline - kept
        save_baseline(baseline_path, kept)
        for key, n in sorted(removed.items()):
            print("removed " + describe(key, n))
        print(f"pruned {sum(removed.values())} violations from the baseline; {sum(kept.values())} remain")
        baseline = kept

    new = actual - baseline
    stale = baseline - actual
    for v in violations:
        if new[v.key] > 0:
            print(f"{v.file}:{v.line}: {v.rule}: {v.snippet!r}")
    if new:
        print(f"\n{sum(new.values())} violation(s) not in the baseline. Fix them: the baseline only shrinks.", file=sys.stderr)
    for key, n in sorted(stale.items()):
        print("baseline entry no longer violates: " + describe(key, n), file=sys.stderr)
    if stale:
        print(f"\n{sum(stale.values())} stale baseline entr(ies). Delete them from {BASELINE} "
              "(or run `python3 tools/docs_lint.py --prune`).", file=sys.stderr)
    if new or stale:
        return 1
    print(f"docs lint: ok ({sum(actual.values())} known violations in the baseline, none new)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
