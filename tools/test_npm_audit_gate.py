# SPDX-License-Identifier: Apache-2.0
"""Tests for tools/npm_audit_gate.py. Standard library only.

    python3 tools/test_npm_audit_gate.py
"""

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

import npm_audit_gate as g

TODAY = date(2026, 11, 18)
PICO = "GHSA-fc5q-39xc-vjpf"


def advisory(name, severity, ghsa):
    return {"source": 1, "name": name, "dependency": name, "title": f"{name} is bad", "severity": severity,
            "url": f"https://github.com/advisories/{ghsa}", "range": "<=4.0.7"}


def report(*advisories_):
    """Shaped like the 2026-11-18 picomatch report: the package with the bug lists the advisory object in `via`,
    the ones that inherit it list plain names."""
    vulns = {}
    for adv in advisories_:
        vulns[adv["name"]] = {"name": adv["name"], "severity": adv["severity"], "via": [adv]}
    vulns["vitest"] = {"name": "vitest", "severity": "high", "via": [a["name"] for a in advisories_] or ["x"]}
    return {"auditReportVersion": 2, "vulnerabilities": vulns, "metadata": {}}


def accepted(review_by="2026-12-18", ident=PICO):
    return {ident: {"id": ident, "package": "picomatch", "reason": "dev-only", "reviewBy": review_by}}


class AdvisoryTests(unittest.TestCase):
    def test_reads_advisory_objects_not_inherited_names(self):
        found = g.advisories(report(advisory("picomatch", "high", PICO)))
        self.assertEqual(list(found), [PICO])
        self.assertEqual(found[PICO]["package"], "picomatch")

    def test_moderate_and_low_are_not_gated(self):
        self.assertEqual(g.advisories(report(advisory("x", "moderate", "GHSA-m"), advisory("y", "low", "GHSA-l"))), {})

    def test_critical_is_gated(self):
        self.assertIn("GHSA-c", g.advisories(report(advisory("x", "critical", "GHSA-c"))))

    def test_an_npm_error_report_fails(self):
        with self.assertRaises(g.GateError):
            g.advisories({"error": {"code": "ENOAUDIT", "summary": "registry unreachable"}})

    def test_an_unknown_report_version_fails(self):
        with self.assertRaises(g.GateError):
            g.advisories({"auditReportVersion": 1})


class GateTests(unittest.TestCase):
    def run_gate(self, found_report, acc):
        return g.gate(g.advisories(found_report), acc, TODAY, "audit-accepted.json")

    def test_an_unaccepted_high_fails(self):
        errors, _ = self.run_gate(report(advisory("picomatch", "high", PICO)), {})
        self.assertIn(f"high {PICO} in picomatch", errors[0])
        self.assertIn("record an accepted risk in audit-accepted.json", errors[0])

    def test_an_accepted_high_passes_with_a_note(self):
        errors, notes = self.run_gate(report(advisory("picomatch", "high", PICO)), accepted())
        self.assertEqual(errors, [])
        self.assertIn("accepted until 2026-12-18", notes[0])

    def test_the_review_date_itself_still_passes(self):
        errors, _ = self.run_gate(report(advisory("picomatch", "high", PICO)), accepted("2026-11-18"))
        self.assertEqual(errors, [])

    def test_an_expired_acceptance_fails(self):
        errors, _ = self.run_gate(report(advisory("picomatch", "high", PICO)), accepted("2026-11-17"))
        self.assertIn("due for review on 2026-11-17", errors[0])

    def test_an_acceptance_whose_advisory_has_gone_fails(self):
        errors, _ = self.run_gate(report(), accepted())
        self.assertIn("no longer appears in npm audit: delete its entry", errors[0])

    def test_accepting_one_advisory_does_not_accept_another(self):
        errors, notes = self.run_gate(report(advisory("picomatch", "high", PICO), advisory("y", "high", "GHSA-new")),
                                      accepted())
        self.assertEqual(len(errors), 1)
        self.assertIn("GHSA-new", errors[0])
        self.assertEqual(len(notes), 1)


class FileTests(unittest.TestCase):
    def write(self, d, name, data):
        path = Path(d) / name
        path.write_text(json.dumps(data))
        return path

    def test_an_entry_missing_its_reason_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            entry = {"id": PICO, "package": "picomatch", "reviewBy": "2026-12-18"}
            path = self.write(d, "a.json", {"accepted": [entry]})
            with self.assertRaises(g.GateError) as ctx:
                g.load_accepted(path)
            self.assertIn("lacks reason", str(ctx.exception))

    def test_a_bad_date_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            entry = {"id": PICO, "package": "p", "reason": "r", "reviewBy": "soon"}
            path = self.write(d, "a.json", {"accepted": [entry]})
            with self.assertRaises(g.GateError):
                g.load_accepted(path)

    def test_the_repository_file_loads(self):
        repo_file = Path(__file__).resolve().parent.parent / "editor" / "audit-accepted.json"
        self.assertIn(PICO, g.load_accepted(repo_file))

    def test_command_line_exit_codes(self):
        with tempfile.TemporaryDirectory() as d:
            rep = self.write(d, "r.json", report(advisory("picomatch", "high", PICO)))
            acc = self.write(d, "a.json", {"accepted": list(accepted().values())})
            none = Path(d) / "missing.json"
            self.assertEqual(g.main(["--report", str(rep), "--accepted", str(acc)], today=TODAY), 0)
            self.assertEqual(g.main(["--report", str(rep), "--accepted", str(none)], today=TODAY), 1)


if __name__ == "__main__":
    unittest.main()
