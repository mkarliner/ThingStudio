#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Writes llms.txt and llms-full.txt for the docs site (the llmstxt.org convention, so an AI assistant can find and read
the docs). Run after `mkdocs build`; the files go in the site directory.

  llms.txt       a title, a summary and a link to every page in the nav, grouped as the nav groups them
  llms-full.txt  the text of every page in nav order, each under its URL

Reads mkdocs.yml's `nav` (a plain line parse: sections are `- Name:` lines, pages are `- Title: path.md`) and the
pages in docs/user-guide/. Standard library only. `--check` reads the nav and fails if a page it names is missing.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUMMARY = (
    "Thingstudio is a node-and-wire visual editor for microcontrollers. You build a flow on a canvas; it compiles to "
    "MicroPython and runs on the board. To write flows without the editor, start with the page 'Writing flows with an AI "
    "assistant' (ai-authoring), then the node catalog, and check each flow with the thingstudio-compile command."
)


def read_nav(mkdocs_yml: Path) -> list[tuple[str, list[tuple[str, str]]]]:
    """[(section, [(title, path)])]. Top-level pages sit in a section named ''."""
    lines = mkdocs_yml.read_text(encoding="utf-8").splitlines()
    try:
        start = next(i for i, l in enumerate(lines) if l.startswith("nav:"))
    except StopIteration:
        raise SystemExit("mkdocs.yml has no nav:")
    sections: list[tuple[str, list[tuple[str, str]]]] = []
    current: tuple[str, list[tuple[str, str]]] | None = None
    for line in lines[start + 1 :]:
        if line and not line.startswith(" "):
            break
        m = re.match(r"^( *)- (.+?):\s*(\S+\.md)?\s*$", line)
        if not m:
            continue
        indent, title, path = len(m.group(1)), m.group(2), m.group(3)
        if path is None:  # a section heading
            current = (title, [])
            sections.append(current)
        elif indent <= 2:  # a top-level page
            if current is None or current[0] != "":
                current = ("", [])
                sections.append(current)
            current[1].append((title, path))
        else:
            if current is None:
                current = ("", [])
                sections.append(current)
            current[1].append((title, path))
    return [s for s in sections if s[1]]


def page_url(site_url: str, path: str) -> str:
    p = path[:-3] if path.endswith(".md") else path
    if p == "index":
        return site_url
    if p.endswith("/index"):
        p = p[: -len("index")]
        return site_url + p
    return site_url + p + "/"


def first_sentence(text: str, limit: int = 160) -> str:
    """The first prose sentence of a page, for the link's note."""
    para: list[str] = []
    in_code = False
    for line in text.splitlines():
        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code or line.startswith("#") or line.startswith("<!--") or line.startswith("|") or line.startswith("!"):
            if para:
                break
            continue
        if not line.strip():
            if para:
                break
            continue
        para.append(line.strip())
    s = " ".join(para)
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s).replace("`", "")
    m = re.match(r"(.+?[.!?])(\s|$)", s)
    out = m.group(1) if m else s
    return (out[: limit - 1] + "…") if len(out) > limit else out


def site_url_of(mkdocs_yml: Path) -> str:
    m = re.search(r"^site_url:\s*(\S+)", mkdocs_yml.read_text(encoding="utf-8"), re.M)
    url = m.group(1) if m else "/"
    return url if url.endswith("/") else url + "/"


def build(root: Path, out_dir: Path) -> list[str]:
    mkdocs_yml = root / "mkdocs.yml"
    docs = root / "docs" / "user-guide"
    site = site_url_of(mkdocs_yml)
    nav = read_nav(mkdocs_yml)
    missing = [p for _, pages in nav for _, p in pages if not (docs / p).is_file()]
    if missing:
        raise SystemExit("nav names pages that do not exist: " + ", ".join(missing))

    index = ["# Thingstudio", "", f"> {SUMMARY}", ""]
    full = ["# Thingstudio documentation", "", f"> {SUMMARY}", ""]
    for section, pages in nav:
        if section:
            index += [f"## {section}", ""]
        else:
            index += ["## Pages", ""]
        for title, path in pages:
            text = (docs / path).read_text(encoding="utf-8")
            note = first_sentence(text)
            index.append(f"- [{title}]({page_url(site, path)})" + (f": {note}" if note else ""))
            full += ["", "---", "", f"Source: {page_url(site, path)}", "", text.rstrip(), ""]
        index.append("")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "llms.txt").write_text("\n".join(index).rstrip() + "\n", encoding="utf-8")
    (out_dir / "llms-full.txt").write_text("\n".join(full).rstrip() + "\n", encoding="utf-8")
    return [p for _, pages in nav for _, p in pages]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", type=Path, default=ROOT, help="repo root (default: this repo)")
    ap.add_argument("--out", type=Path, default=None, help="output directory (default: <root>/site)")
    ap.add_argument("--check", action="store_true", help="only check that every page in the nav exists")
    args = ap.parse_args()
    out = args.out or (args.root / "site")
    if args.check:
        nav = read_nav(args.root / "mkdocs.yml")
        missing = [p for _, pages in nav for _, p in pages if not (args.root / "docs" / "user-guide" / p).is_file()]
        if missing:
            print("nav names pages that do not exist: " + ", ".join(missing), file=sys.stderr)
            return 1
        print(f"nav ok: {sum(len(p) for _, p in nav)} pages")
        return 0
    pages = build(args.root, out)
    print(f"wrote {out / 'llms.txt'} and {out / 'llms-full.txt'} ({len(pages)} pages)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
