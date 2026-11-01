# SPDX-License-Identifier: Apache-2.0
"""Tests for tools/docs_lint.py: each rule's hit and non-hit, and the baseline ratchet. Standard library only.

    python3 tools/test_docs_lint.py
"""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import docs_lint as lint


def rules(text, rule=None):
    return [v for v in lint.lint_text("p.md", text) if rule is None or v.rule == rule]


class OpeningTests(unittest.TestCase):
    def test_flags_this_page_in_the_opening_paragraph(self):
        self.assertEqual(len(rules("# T\n\nPins are checked. This page covers\nboards.\n\nMore.\n", "opening")), 1)

    def test_flags_this_section(self):
        self.assertEqual(len(rules("# T\n\nThis section lists the nodes.\n", "opening")), 1)

    def test_ignores_later_paragraphs_and_other_openings(self):
        self.assertEqual(rules("# T\n\nHow a flow is saved.\n\nSee this page for more.\n", "opening"), [])

    def test_ignores_code_spans(self):
        self.assertEqual(rules("# T\n\nThe `this page` marker.\n", "opening"), [])

    def test_skips_an_admonition_before_the_opening(self):
        text = "# T\n\n!!! tip\n    This page is for the impatient.\n\nThis page covers boards.\n"
        self.assertEqual(len(rules(text, "opening")), 1)

    def test_a_page_opening_with_a_heading_or_list_has_no_opening(self):
        self.assertEqual(rules("# T\n\n## Next\n\nThis page covers x.\n", "opening"), [])
        self.assertEqual(rules("# T\n\n- this page\n", "opening"), [])


class SpellingTests(unittest.TestCase):
    def test_flags_uk_forms(self):
        text = "The colour, the catalogue, it recognises a board, greys out, in the centre, behaviour.\n"
        self.assertEqual(len(rules(text, "uk-spelling")), 6)

    def test_ignores_us_forms_code_and_links(self):
        text = (
            "The color, gray, center, behavior, recognizes.\n\n"
            "`'colour'` in a span, and [x](colour.md) and https://x/colour.png.\n\n"
            "```\ncolour = 1\n```\n\n<!-- colour -->\n"
        )
        self.assertEqual(rules(text, "uk-spelling"), [])

    def test_snippet_has_no_split_words(self):
        sentence = "Alphabet betamax gammaray deltawave epsilonic zetacode the colour of the seashore and skylark overhead."
        (v,) = rules(sentence + "\n", "uk-spelling")
        self.assertIn("colour", v.snippet)
        self.assertLess(len(v.snippet), len(sentence))
        self.assertTrue(set(v.snippet.split()) <= set(sentence.split()), v.snippet)


class PlansTests(unittest.TestCase):
    def test_flags_each_pattern(self):
        for s in ("see working-notes/x.md", "Coming soon.", "next to be written", "More are coming", "Work in progress"):
            self.assertEqual(len(rules(s + "\n", "plans")), 1, s)

    def test_flags_in_code_but_not_in_comments(self):
        self.assertEqual(len(rules("`working-notes/x.md`\n", "plans")), 1)
        self.assertEqual(rules("<!--\ncoming soon\n-->\n", "plans"), [])


class DuplicateTermTests(unittest.TestCase):
    def test_flags_a_repeat_in_properties(self):
        text = "## Properties\n\n- **palette** — a\n- **pin** — b\n- **Palette** — c\n"
        (v,) = rules(text, "duplicate-term")
        self.assertEqual((v.snippet, v.line), ("palette", 5))

    def test_ignores_other_sections_and_separate_property_sections(self):
        text = "## Wiring\n\n- **a** — x\n- **a** — y\n\n## Properties\n\n- **a** — x\n\n## Behavior\n\n- **a** — x\n"
        self.assertEqual(rules(text, "duplicate-term"), [])

    def test_a_subsection_stays_in_properties(self):
        text = "## Properties\n\n- **a** — x\n\n### More\n\n- **a** — y\n"
        self.assertEqual(len(rules(text, "duplicate-term")), 1)


class RepeatedSentenceTests(unittest.TestCase):
    S = "Uses the flow's WiFi network, shared by every WiFi node in the flow."

    def test_flags_a_verbatim_repeat_across_wrapped_lines(self):
        text = f"## A\n\n{self.S} Then more.\n\n## B\n\nFirst. Uses the flow's WiFi network,\nshared by every WiFi node in the flow.\n"
        self.assertEqual(len(rules(text, "repeated-sentence")), 1)

    def test_flags_a_repeat_in_list_items(self):
        self.assertEqual(len(rules(f"- {self.S}\n- {self.S}\n", "repeated-sentence")), 1)

    def test_ignores_short_sentences_code_blocks_and_tables(self):
        self.assertEqual(rules("Set the pin. Set the pin.\n", "repeated-sentence"), [])
        self.assertEqual(rules(f"```\n{self.S}\n{self.S}\n```\n", "repeated-sentence"), [])
        self.assertEqual(rules(f"| {self.S} |\n| {self.S} |\n", "repeated-sentence"), [])

    def test_different_code_in_the_same_sentence_is_not_a_repeat(self):
        text = "Set the `pin` property to the board's LED pin.\n\nSet the `rate` property to the board's LED pin.\n"
        self.assertEqual(rules(text, "repeated-sentence"), [])


class WhitespaceTests(unittest.TestCase):
    def test_trailing_whitespace(self):
        (v,) = rules("# T\n\nlook familiar.  \n\nclean\n", "trailing-whitespace")
        self.assertEqual((v.snippet, v.line), ("look familiar.", 3))

    def test_blank_line_runs_count_once_per_run(self):
        found = rules("a\n\n\n\nb\n\nc\n\n\nd\n", "blank-lines")
        self.assertEqual([v.line for v in found], [3, 9])
        self.assertEqual(found[0].snippet, "after: a")

    def test_fenced_code_is_exempt(self):
        self.assertEqual(rules("```\nx  \n\n\ny\n```\n"), [])


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "docs/user-guide").mkdir(parents=True)
        self.page = self.root / "docs/user-guide/a.md"
        self.page.write_text("# A\n\nThe colour is red.\n")
        (self.root / "docs/user-guide/ai-authoring.md").write_text("The colour.\n")  # skipped

    def tearDown(self):
        self._tmp.cleanup()

    def run_lint(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return lint.main(["--root", str(self.root), *args])

    def baseline(self):
        return json.loads((self.root / lint.BASELINE).read_text())["violations"]

    def test_init_then_clean(self):
        self.assertEqual(self.run_lint("--init-baseline"), 0)
        self.assertEqual(self.baseline(), [{"file": "docs/user-guide/a.md", "rule": "uk-spelling", "snippet": "The colour is red."}])
        self.assertEqual(self.run_lint(), 0)

    def test_init_refuses_to_overwrite(self):
        self.run_lint("--init-baseline")
        self.assertEqual(self.run_lint("--init-baseline"), 2)

    def test_a_new_violation_fails(self):
        self.run_lint("--init-baseline")
        self.page.write_text("# A\n\nThe colour is red.\n\nThe grey is dull.\n")
        self.assertEqual(self.run_lint(), 1)

    def test_a_second_instance_of_a_baselined_snippet_fails(self):
        self.run_lint("--init-baseline")
        self.page.write_text("# A\n\nThe colour is red.\n\nThe colour is red.\n")
        self.assertEqual(self.run_lint(), 1)

    def test_a_fixed_violation_makes_its_entry_stale(self):
        self.run_lint("--init-baseline")
        self.page.write_text("# A\n\nThe color is red.\n")
        self.assertEqual(self.run_lint(), 1)

    def test_prune_removes_stale_entries_and_never_adds(self):
        self.run_lint("--init-baseline")
        self.page.write_text("# A\n\nThe color is red.\n\nThe grey is dull.\n")
        self.assertEqual(self.run_lint("--prune"), 1)  # the grey line is new, so still failing
        self.assertEqual(self.baseline(), [])

    def test_counts_round_trip(self):
        self.page.write_text("# A\n\nThe colour is red.\n\nThe colour is red.\n")
        self.run_lint("--init-baseline")
        self.assertEqual(self.baseline()[0]["count"], 2)
        self.assertEqual(self.run_lint(), 0)


class RepoTests(unittest.TestCase):
    def test_the_checked_in_baseline_matches_the_guide(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(lint.main([]), 0)


if __name__ == "__main__":
    unittest.main()
