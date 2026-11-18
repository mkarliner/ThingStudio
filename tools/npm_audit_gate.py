#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/npm_audit_gate.py
#
# CI's npm audit gate, with named exceptions. It fails on any high or critical advisory in the editor's dependency
# tree, as `npm audit --audit-level=high` did, unless that advisory is listed in editor/audit-accepted.json with a
# reason and a review-by date. Why not the bare command: on 2026-11-18 a high advisory for picomatch
# (GHSA-fc5q-39xc-vjpf) arrived with no fixed version, and CI went red on every push. The project rule is that a
# high with no fix is an explicit accepted-risk decision, not a step to comment out (decisions/third-party-pinning.md).
#
# An accepted entry fails the gate again when:
#   - its review-by date has passed (look again: is there a fix now? is the reason still true?);
#   - the advisory no longer appears (the fix landed: delete the entry, so the list only shrinks).
#
# Usage (CI, in editor/):
#   python3 ../tools/npm_audit_gate.py                      # runs `npm audit --json` itself
#   python3 ../tools/npm_audit_gate.py --report audit.json  # an audit report saved earlier
#
# Stdlib only.

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

GATED = ("high", "critical")
ACCEPTED_DEFAULT = Path("audit-accepted.json")


class GateError(Exception):
    pass


def advisories(report: dict) -> dict[str, dict]:
    """{advisory id: {package, severity, title, url}} for every gated advisory in an `npm audit --json` report
    (auditReportVersion 2). A package's `via` lists advisory objects for its own bugs and plain names for the
    packages it inherits them from; only the objects are advisories."""
    if "error" in report:
        raise GateError(f"npm audit failed: {report['error'].get('summary') or report['error']}")
    if report.get("auditReportVersion") != 2:
        raise GateError(f"unexpected npm audit report version {report.get('auditReportVersion')!r}")
    found: dict[str, dict] = {}
    for vulnerability in report.get("vulnerabilities", {}).values():
        for via in vulnerability.get("via", []):
            if not isinstance(via, dict) or via.get("severity") not in GATED:
                continue
            url = via.get("url", "")
            advisory_id = url.rstrip("/").rsplit("/", 1)[-1] if url else str(via.get("source"))
            found[advisory_id] = {"package": via.get("name"), "severity": via.get("severity"),
                                  "title": via.get("title"), "url": url}
    return found


def load_accepted(path: Path) -> dict[str, dict]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise GateError(f"{path} is not valid JSON: {exc}") from exc
    accepted: dict[str, dict] = {}
    for entry in data.get("accepted", []):
        missing = [k for k in ("id", "package", "reason", "reviewBy") if not entry.get(k)]
        if missing:
            raise GateError(f"{path}: an entry lacks {', '.join(missing)}: {entry}")
        try:
            date.fromisoformat(entry["reviewBy"])
        except ValueError as exc:
            raise GateError(f"{path}: {entry['id']} reviewBy {entry['reviewBy']!r} is not YYYY-MM-DD") from exc
        accepted[entry["id"]] = entry
    return accepted


def gate(found: dict[str, dict], accepted: dict[str, dict], today: date, accepted_name: str) -> tuple[list, list]:
    """(errors, notes)."""
    errors: list[str] = []
    notes: list[str] = []
    for advisory_id, adv in sorted(found.items()):
        entry = accepted.get(advisory_id)
        if entry is None:
            errors.append(f"{adv['severity']} {advisory_id} in {adv['package']}: {adv['title']} ({adv['url']}). Fix it "
                          f"(update the package), or record an accepted risk in {accepted_name}")
        elif date.fromisoformat(entry["reviewBy"]) < today:
            errors.append(f"{advisory_id} in {adv['package']}: the accepted risk was due for review on "
                          f"{entry['reviewBy']}. Check for a fix; if there is still none and the reason holds, move "
                          f"reviewBy on in {accepted_name}")
        else:
            notes.append(f"accepted until {entry['reviewBy']}: {adv['severity']} {advisory_id} in {adv['package']} "
                         f"({entry['reason']})")
    for advisory_id in sorted(set(accepted) - set(found)):
        errors.append(f"{advisory_id} ({accepted[advisory_id]['package']}) no longer appears in npm audit: delete its "
                      f"entry from {accepted_name}")
    return errors, notes


def run_npm_audit() -> dict:
    result = subprocess.run(["npm", "audit", "--json"], capture_output=True, text=True)
    try:
        return json.loads(result.stdout)  # npm audit exits non-zero whenever it finds anything; the JSON decides
    except ValueError as exc:
        raise GateError(f"npm audit gave no JSON (exit {result.returncode}): {result.stderr.strip()[:300]}") from exc


def main(argv: list[str] | None = None, today: date | None = None) -> int:
    parser = argparse.ArgumentParser(description="npm audit, failing on high/critical advisories not accepted.")
    parser.add_argument("--report", type=Path, help="an `npm audit --json` report (default: run npm audit here)")
    parser.add_argument("--accepted", type=Path, default=ACCEPTED_DEFAULT, help="the accepted-risks file")
    args = parser.parse_args(argv)
    try:
        report = json.loads(args.report.read_text(encoding="utf-8")) if args.report else run_npm_audit()
        errors, notes = gate(advisories(report), load_accepted(args.accepted), today or date.today(),
                             str(args.accepted))
    except (GateError, OSError, ValueError) as exc:
        print(f"npm-audit-gate: {exc}", file=sys.stderr)
        return 1
    for line in notes:
        print(f"npm-audit-gate: {line}")
    for line in errors:
        print(f"npm-audit-gate: {line}", file=sys.stderr)
    if errors:
        return 1
    print("npm-audit-gate: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
