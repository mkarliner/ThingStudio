#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# tools/check_catalogue_urls.py
#
# Checks that every download link in the firmware catalogue (firmware/builds.json) works. A broken link fails
# quietly: the user sees a 404 in the Install firmware dialog, gives up, and nobody hears about it. On 2026-11-12
# the three 15.1.0 images were catalogued under v0.12.0 but uploaded to v0.12.2, and stayed broken for five days
# with no report (learnings/firmware-builds.md). So a machine checks instead.
#
# Usage:
#   python3 tools/check_catalogue_urls.py                          # every link in firmware/builds.json
#   python3 tools/check_catalogue_urls.py --max-pending-days 3     # ... and an unpublished release is an error
#                                                                   #     once its catalogue entry is 3 days old
#   python3 tools/check_catalogue_urls.py --site URL                # ... and the docs site serves a catalogue
#   python3 tools/check_catalogue_urls.py --require-tag v0.12.2     # links on this release must work now
#   python3 tools/check_catalogue_urls.py --attaching v0.12.2 a.bin b.bin   # offline: entries for these files
#                                                                            # must name this release
#
# A link to a GitHub release asset that doesn't answer is one of two things. If the release is published, the asset
# is missing: an error. If it isn't (no release yet, or still a draft), the link is pending: the catalogue entries
# go into the commit the tag points at, before publish.sh uploads the images (firmware/README.md, Publishing), so a
# fresh pending link is expected. It is a warning, unless the release is the one named by --require-tag, or the
# entry is older than --max-pending-days. Any other link (micropython.org) must answer.
#
# Stdlib only, so CI and publish.sh can run it with any Python 3.10+.

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Callable

REPO = Path(__file__).resolve().parent.parent
CATALOGUE = REPO / "firmware" / "builds.json"
RELEASE_ASSET = re.compile(r"^https://github\.com/([^/]+)/([^/]+)/releases/download/([^/]+)/([^/]+)$")
USER_AGENT = "thingstudio-catalogue-check"
TIMEOUT_S = 30
TRIES = 3
RETRY_PAUSE_S = 5


@dataclass
class Link:
    build: str
    version: str
    date: str | None
    url: str


def links(catalogue: dict) -> list[Link]:
    found = []
    for build in catalogue.get("builds", []):
        for version in build.get("versions", []):
            found.append(Link(build.get("id", "?"), version.get("version", "?"), version.get("date"),
                              version.get("url", "")))
    return found


def probe(url: str) -> int | str:
    """The HTTP status a GET for the first byte gets, after redirects, or a reason it got none. A ranged GET, not
    HEAD: GitHub's asset redirect and some mirrors answer HEAD differently from what a download sees."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": "bytes=0-0"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except (urllib.error.URLError, OSError) as exc:
        return str(getattr(exc, "reason", exc))


def release_state(owner: str, repo: str, tag: str) -> int | str:
    """GitHub's API status for a release by tag: 200 published, 404 a draft or no release (the API hides drafts
    without a token that can write). Not the release web page: it answers scripts 403 or 429 at will. Uses
    GITHUB_TOKEN when set (CI has one), for the rate limit."""
    request = urllib.request.Request(
        f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}",
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
    )
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            if json.loads(response.read().decode("utf-8")).get("draft"):
                return 404  # a token that can see drafts: a draft is not published
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return str(getattr(exc, "reason", exc))


def answers(status: int | str) -> bool:
    return status in (200, 206)


def probe_with_retries(url: str, fetch: Callable[[str], int | str], pause: Callable[[float], None]) -> int | str:
    """A link has to fail TRIES times to count: a newly published asset can take a moment to appear, and a network
    blip is not a broken link."""
    status: int | str = "not tried"
    for attempt in range(TRIES):
        status = fetch(url)
        if answers(status):
            return status
        if attempt < TRIES - 1:
            pause(RETRY_PAUSE_S)
    return status


def probe_with_retries_state(ask: Callable[[], int | str], pause: Callable[[float], None]) -> int | str:
    """A release's state, asked up to TRIES times while GitHub gives no clear answer (neither 200 nor 404)."""
    state: int | str = "not tried"
    for attempt in range(TRIES):
        state = ask()
        if state in (200, 404):
            return state
        if attempt < TRIES - 1:
            pause(RETRY_PAUSE_S)
    return state


def days_since(when: str | None, today: date) -> int | None:
    try:
        return (today - date.fromisoformat(when)).days if when else None
    except ValueError:
        return None


def check_links(
    catalogue: dict,
    *,
    require_tag: str | None = None,
    max_pending_days: int | None = None,
    fetch: Callable[[str], int | str] = probe,
    release: Callable[[str, str, str], int | str] = release_state,
    pause: Callable[[float], None] = time.sleep,
    today: date | None = None,
) -> tuple[list[str], list[str]]:
    """(errors, warnings) for every link in the catalogue."""
    today = today or date.today()
    errors: list[str] = []
    warnings: list[str] = []
    states: dict[str, int | str] = {}
    for link in links(catalogue):
        what = f"{link.build} {link.version}"
        if not link.url:
            errors.append(f"{what}: no url")
            continue
        status = probe_with_retries(link.url, fetch, pause)
        if answers(status):
            continue
        asset = RELEASE_ASSET.match(link.url)
        if asset is None:
            errors.append(f"{what}: {link.url} answers {status}")
            continue
        owner, repo, tag, name = asset.groups()
        key = f"{owner}/{repo}@{tag}"
        if key not in states:
            states[key] = probe_with_retries_state(lambda: release(owner, repo, tag), pause)
        state = states[key]
        if state not in (200, 404):
            errors.append(f"{what}: {link.url} answers {status}, and GitHub didn't say whether {tag} is published "
                          f"({state}) -- check by hand")
            continue
        if state == 200:
            errors.append(f"{what}: release {tag} is published but has no {name} ({status}) -- upload it there, "
                          f"or fix the url to the release that has it")
            continue
        age = days_since(link.date, today)
        pending = f"{what}: release {tag} is not published yet, so {name} doesn't download"
        if tag == require_tag:
            errors.append(f"{what}: {link.url} answers {status} although {tag} should be live")
        elif max_pending_days is not None and age is not None and age > max_pending_days:
            errors.append(f"{pending}, {age} days after the catalogue named it -- publish it (firmware/publish.sh "
                          f"{tag} --publish) or fix the url")
        else:
            warnings.append(pending)
    return errors, warnings


def check_site(url: str, fetch_text: Callable[[str], str] | None = None) -> list[str]:
    """The docs site serves a catalogue. Without one, installs keep whatever copy they last saved, however stale,
    and nothing tells anyone: the Docs workflow only warns when it skips an unsigned catalogue."""
    def default_fetch(u: str) -> str:
        request = urllib.request.Request(u, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return response.read().decode("utf-8")

    try:
        text = (fetch_text or default_fetch)(url)
    except (urllib.error.URLError, OSError) as exc:
        why = getattr(exc, "code", None) or getattr(exc, "reason", exc)
        return [f"the docs site serves no catalogue at {url} ({why}) -- sign it (tools/catalogue_sign.py sign), "
                "push, and check the Docs workflow published it"]
    try:
        json.loads(text)
    except ValueError:
        return [f"{url} is not JSON -- check the Docs workflow's catalogue step"]
    return []


def check_attaching(catalogue: dict, tag: str, names: list[str], label: str) -> tuple[list[str], list[str]]:
    """Offline, before an upload: every catalogue entry for a file being attached to `tag` must name `tag`."""
    errors: list[str] = []
    warnings: list[str] = []
    for name in names:
        matching = [link for link in links(catalogue) if link.url.rsplit("/", 1)[-1] == name]
        if not matching:
            warnings.append(f"{label}: no catalogue entry for {name} -- the editor won't offer it "
                            f"(tools/firmware_catalogue.py --image ... --url ...)")
        for link in matching:
            asset = RELEASE_ASSET.match(link.url)
            linked_tag = asset.group(3) if asset else None
            if linked_tag != tag:
                errors.append(f"{label}: {link.build} {link.version} links {name} on {linked_tag or link.url}, but it "
                              f"is being attached to {tag} -- fix the url to {tag}, sign, and commit before tagging")
    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that the firmware catalogue's download links work.")
    parser.add_argument("--catalogue", type=Path, default=CATALOGUE, help="the builds.json to check")
    parser.add_argument("--require-tag", help="links on this release must work now (after publishing it)")
    parser.add_argument("--max-pending-days", type=int,
                        help="an unpublished release's links are an error once the entry is older than this")
    parser.add_argument("--site", help="also check that this URL serves a catalogue (the docs site's copy)")
    parser.add_argument("--attaching", nargs="+", metavar=("TAG", "FILE"),
                        help="offline: entries for these file names must link them on TAG")
    args = parser.parse_args(argv)

    try:
        catalogue = json.loads(args.catalogue.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"catalogue-links: can't read {args.catalogue}: {exc}", file=sys.stderr)
        return 1

    if args.attaching:
        if len(args.attaching) < 2:
            parser.error("--attaching needs a tag and at least one file name")
        errors, warnings = check_attaching(catalogue, args.attaching[0], args.attaching[1:], str(args.catalogue))
    else:
        errors, warnings = check_links(catalogue, require_tag=args.require_tag, max_pending_days=args.max_pending_days)
        if args.site:
            errors += check_site(args.site)

    for line in warnings:
        print(f"catalogue-links: warning: {line}")
    for line in errors:
        print(f"catalogue-links: {line}", file=sys.stderr)
    if errors:
        return 1
    print(f"catalogue-links: ok ({len(links(catalogue))} links)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
