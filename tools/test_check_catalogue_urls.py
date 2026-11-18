# SPDX-License-Identifier: Apache-2.0
"""Tests for tools/check_catalogue_urls.py, with a fake network. Standard library only.

    python3 tools/test_check_catalogue_urls.py
"""

import unittest
import urllib.error
from datetime import date

import check_catalogue_urls as cc

GH = "https://github.com/mkarliner/ThingStudio"
TODAY = date(2026, 11, 17)


def asset(tag, name):
    return f"{GH}/releases/download/{tag}/{name}"


def catalogue(*versions):
    """versions: (url, date) pairs, all in one build."""
    return {"builds": [{"id": "thingstudio-classic-esp32", "versions": [
        {"version": f"15.{i}.0", "date": when, "url": url} for i, (url, when) in enumerate(versions)]}]}


class FakeNet:
    """Links in `live` answer; tags in `published` are published releases (the API says 200, others 404, or
    `release_status` when given, for a GitHub that gives no clear answer)."""

    def __init__(self, live, flaky=(), published=(), release_status=None):
        self.live = set(live)
        self.published = set(published)
        self.release_status = release_status
        self.release_calls = []
        self.flaky = {u: 1 for u in flaky}  # fails this many times, then answers
        self.calls = []

    def __call__(self, url):
        self.calls.append(url)
        if self.flaky.get(url):
            self.flaky[url] -= 1
            return "timed out"
        return 200 if url in self.live or url in self.flaky else 404

    def release(self, owner, repo, tag):
        self.release_calls.append(tag)
        if self.release_status is not None:
            return self.release_status
        return 200 if tag in self.published else 404


def run(cat, net, **kw):
    return cc.check_links(cat, fetch=net, release=net.release, pause=lambda s: None, today=TODAY, **kw)


class LinkTests(unittest.TestCase):
    def test_every_link_answering_is_clean(self):
        url = asset("v0.12.2", "a.bin")
        self.assertEqual(run(catalogue((url, "2026-11-12")), FakeNet([url])), ([], []))

    def test_an_asset_missing_from_a_published_release_is_an_error(self):
        # 2026-11-12: catalogued on v0.12.0 (published), uploaded to v0.12.2.
        url = asset("v0.12.0", "thingstudio-classic-esp32-15.1.0-e8d4804.bin")
        errors, warnings = run(catalogue((url, "2026-11-12")), FakeNet([], published=["v0.12.0"]))
        self.assertEqual(len(errors), 1)
        self.assertIn("release v0.12.0 is published but has no thingstudio-classic-esp32-15.1.0", errors[0])
        self.assertEqual(warnings, [])

    def test_a_fresh_link_on_an_unpublished_release_is_a_warning(self):
        url = asset("v0.13.0", "a.bin")
        errors, warnings = run(catalogue((url, "2026-11-16")), FakeNet([]), max_pending_days=3)
        self.assertEqual(errors, [])
        self.assertIn("release v0.13.0 is not published yet", warnings[0])

    def test_an_unpublished_release_becomes_an_error_after_the_grace_period(self):
        url = asset("v0.13.0", "a.bin")
        errors, _ = run(catalogue((url, "2026-11-10")), FakeNet([]), max_pending_days=3)
        self.assertIn("7 days after the catalogue named it", errors[0])

    def test_without_a_grace_period_pending_stays_a_warning(self):
        url = asset("v0.13.0", "a.bin")
        errors, warnings = run(catalogue((url, "2026-01-01")), FakeNet([]))
        self.assertEqual((errors, len(warnings)), ([], 1))

    def test_the_required_tag_must_answer_now(self):
        url = asset("v0.12.2", "a.bin")
        errors, _ = run(catalogue((url, "2026-11-17")), FakeNet([]), require_tag="v0.12.2")
        self.assertIn("although v0.12.2 should be live", errors[0])

    def test_a_broken_non_github_link_is_an_error(self):
        url = "https://micropython.org/resources/firmware/X.bin"
        errors, _ = run(catalogue((url, "2026-08-24")), FakeNet([]))
        self.assertIn("answers 404", errors[0])

    def test_a_network_blip_is_retried_not_reported(self):
        url = asset("v0.12.2", "a.bin")
        net = FakeNet([], flaky=[url])
        self.assertEqual(run(catalogue((url, "2026-11-12")), net), ([], []))
        self.assertEqual(net.calls.count(url), 2)

    def test_each_release_is_asked_about_once(self):
        a, b = asset("v0.12.0", "a.bin"), asset("v0.12.0", "b.bin")
        net = FakeNet([], published=["v0.12.0"])
        errors, _ = run(catalogue((a, "2026-11-12"), (b, "2026-11-12")), net)
        self.assertEqual(len(errors), 2)
        self.assertEqual(net.release_calls, ["v0.12.0"])

    def test_an_unclear_answer_about_the_release_is_not_guessed(self):
        # 2026-11-17: the release web page answered a script 403, and the first cut called v0.12.0 unpublished.
        url = asset("v0.12.0", "a.bin")
        net = FakeNet([], release_status=403)
        errors, warnings = run(catalogue((url, "2026-11-12")), net)
        self.assertIn("didn't say whether v0.12.0 is published (403)", errors[0])
        self.assertEqual(warnings, [])
        self.assertEqual(len(net.release_calls), cc.TRIES)


class AttachingTests(unittest.TestCase):
    def test_an_entry_naming_another_release_is_refused(self):
        name = "thingstudio-classic-esp32-15.1.0-e8d4804.bin"
        errors, _ = cc.check_attaching(catalogue((asset("v0.12.0", name), "2026-11-12")), "v0.12.2", [name], "tag")
        self.assertIn("links thingstudio-classic-esp32-15.1.0-e8d4804.bin on v0.12.0", errors[0])
        self.assertIn("being attached to v0.12.2", errors[0])

    def test_an_entry_naming_this_release_passes(self):
        cat = catalogue((asset("v0.12.2", "a.bin"), "2026-11-12"))
        self.assertEqual(cc.check_attaching(cat, "v0.12.2", ["a.bin"], "tag"), ([], []))

    def test_an_image_with_no_entry_is_a_warning(self):
        errors, warnings = cc.check_attaching(catalogue(), "v0.12.2", ["a.bin"], "tag")
        self.assertEqual(errors, [])
        self.assertIn("no catalogue entry for a.bin", warnings[0])

    def test_older_versions_of_other_files_are_left_alone(self):
        cat = catalogue((asset("v0.12.2", "new.bin"), "2026-11-12"), (asset("v0.12.0", "old.bin"), "2026-11-06"))
        self.assertEqual(cc.check_attaching(cat, "v0.12.2", ["new.bin"], "tag"), ([], []))


class SiteTests(unittest.TestCase):
    def test_a_missing_site_catalogue_is_an_error(self):
        def gone(url):
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        errors = cc.check_site("https://docs.thingstudio.net/catalogue/builds.json", gone)
        self.assertIn("serves no catalogue", errors[0])
        self.assertIn("(404)", errors[0])

    def test_a_served_catalogue_passes(self):
        self.assertEqual(cc.check_site("https://x/builds.json", lambda u: '{"builds": []}'), [])

    def test_a_page_that_is_not_json_is_an_error(self):
        self.assertIn("is not JSON", cc.check_site("https://x/builds.json", lambda u: "<html>")[0])


class CommandLineTests(unittest.TestCase):
    def test_attaching_runs_offline_and_fails_on_a_mismatch(self):
        import json
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "builds.json"
            path.write_text(json.dumps(catalogue((asset("v0.12.0", "a.bin"), "2026-11-12"))))
            self.assertEqual(cc.main(["--catalogue", str(path), "--attaching", "v0.12.2", "a.bin"]), 1)
            self.assertEqual(cc.main(["--catalogue", str(path), "--attaching", "v0.12.0", "a.bin"]), 0)


if __name__ == "__main__":
    unittest.main()
