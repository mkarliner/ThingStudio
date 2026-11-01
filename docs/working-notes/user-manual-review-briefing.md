# User manual review after the first real tester

Status: brief, 2026-11-01. For one session whose first job is an **overall review of the user manual**
(`docs/user-guide/`) for style, human readability and content, in two stages: a quick pass with a summary for Mike,
then a detailed written review for a later authoring/editing session to work from. This session reviews; it does not
rewrite pages. When the written review is filed, hand back to Mike.

Read first: `docs-style-guide.md` (the rules), `docs/tester-ready.md` (the feedback loop and the four learner
profiles), `AGENTS.md`'s "Human-facing documentation: concise, not exhaustive" and "Read the user manual before the
code", `outstanding-items/user-docs-rewrite.md` (the standing P1-P3 list), `docs-style-review.md` (Mike's earlier
remarks, verbatim: his taste, in his words), and `tutorials-and-examples-landed-briefing.md` (the tutorials thread
running on the same branch).

## Why now

Thingstudio is soft-launched and the first real tester arrived on v0.11.x. The 2026-10-29 session fixed four blockers
they hit and changed editor labels the docs describe, and the tutorials session added two tutorials and moved the
custom-image advice in the same week. The manual has had many authors and many targeted fixes since the last whole
review (2026-10-10/11); it needs one reader going through all of it, as a stranger would.

## Scope

All of `docs/user-guide/` in nav order (`mkdocs.yml`), plus pages reachable only by link. Not in scope for style:
`ai-authoring.md` and the generated `nodes-catalog.md` (written for AI readers), but check both for facts.

What to judge, per page:

- **Style:** the style guide's rules (voice, current state only, reader's words, no sizing words, opening sentence,
  lists introduced, one home for changing facts, page types and the node-page layout, limitations, word list).
- **Human readability:** does it read like a person wrote it, concise, one idea per paragraph; is it the right length
  for its job; would each learner profile get what it needs (Path-follower: one clear success per step;
  Adventurer: loud failures and where to look; Reader: no contradictions; Sample-scavenger: a complete flow to copy).
- **Content:** accurate against the running editor and the console (open the editor beside the page; labels, menu
  paths, defaults, messages); complete for the job (a missing step, an unexplained error); in the right place and
  order (`style guide`, "Order follows the reader's work"); no duplication across pages; links that go where they
  say.

## Stage 1: quick pass, summary for Mike

Skim every page once (82 files). Keep notes as you go; don't stop to write findings up properly.

Deliver to Mike **in the conversation** (short enough to read in five minutes):

- an overall verdict: how close the manual is to "a stranger succeeds from the docs alone";
- the five to ten biggest problems across the manual, each with an example page;
- a one-line verdict per section (Getting started, Tutorials, Building flows, Boards and networks, Node reference,
  Extending, Troubleshooting, Background/If you already know);
- the questions below, plus any new ones the pass raises.

Then **stop for Mike's reaction** before stage 2: he may reorder priorities, drop a section or add remarks. Record
his remarks verbatim at the top of the written review, as `docs-style-review.md` did.

## Stage 2: the detailed written review

File it as `docs/working-notes/reviews/YYYY-MM-DD-user-guide.md` and add its line to `reviews/README.md`. A review
records findings, not decisions (that folder's rule). Write it for an authoring/editing session that has not seen
this one, so each finding stands alone:

- **Mike's remarks** from stage 1, verbatim.
- **Cross-cutting findings** (patterns that recur), each with the rule it breaks and two or three page examples.
- **Per-page findings**, in nav order. For each page: a verdict (fine / light edit / rewrite / merge / cut), then
  numbered findings, each with the location (heading or quoted phrase), what is wrong, and the change to make,
  concretely enough to act on without re-deriving it ("replace 'Thingstudio image' with 'Thingstudio custom image',
  the dialog's label" rather than "check terminology"). Mark factual errors separately from style.
- **Gaps:** pages or sections that should exist and don't, with what they'd cover and where they'd sit.
- **A suggested order of work** for the editing session(s): first-hour route first, then what a tester hits next.
- **Checks run** and their results (below).

## Known findings to include (from the 2026-10-29 session)

These are already established; put them in the review rather than rediscovering them:

1. **MQTT broker unreachable, no explanation anywhere.** The console said only `mqtt connect to host:1883 failed
   after 3 attempts (... 'Timeout on socket write' ..., wifi status 1010)`. Causes found, all "the board can't reach
   the broker from its own network": the board on a phone hotspot while the broker is on a home LAN (the laptop
   reached it only through WireGuard); the mobile network apparently dropping port 1883 even to `test.mosquitto.org`
   (not confirmed: the port-80 vs 1883 socket test was never run); Mosquitto 2 listening only on localhost unless
   `listener 1883` / `allow_anonymous true`. What worked: a relay on the laptop (`ssh -g -N -L
   0.0.0.0:1883:<broker>:1883 localhost` with Remote Login on, or a Python asyncio relay; `brew install socat` needed
   a build). Needs a `debugging.md` entry linked from both MQTT node pages, and possibly a clearer console line.
2. **"Did I install the runtime by accident?"** On the custom image, Install runtime writes only `main.py`; a stray
   copy can only come from flashing without "Erase all flash first" over an older install; check with
   `import os; print(os.listdir('/'))` in the console's Python box. Not in the docs.
3. **The `[memory]` line is misread.** The tester took `ESP-IDF heap 27 KB free` for the cause of the MQTT failure.
   No page says which number matters when, or that a real memory failure says `MemoryError`.
4. **Pages already known to be out of date:** `debugging.md` (~line 118, "a Thingstudio image");
   `ai-authoring.md` (the `brokerConfigId` example implies a broker per node; the compile now uses the flow's one
   broker); `coming-from/node-red.md` (Node-RED users expect a broker per node: say it is one per flow).
5. **Two authors in one week** on `custom-firmware.md` and `installing-micropython.md`: read both whole for
   consistency.
6. **Pictures:** `tools/screenshots.py` takes only the editor overview. The broker edit form and the Install
   firmware dialog are where words were weakest; candidates for labelled screenshots.

## What changed in the product on 2026-10-29 (v0.11.0, v0.11.1)

The manual must match these; check every page that describes them against the running editor:

1. **One MQTT broker per flow**, like WiFi (Mike: "for new users this is a trap"). The broker config is a
   singleton; every MQTT node's **MQTT Broker** field shows and edits the flow's one broker; the compile hook
   ignores a node's own `brokerConfigId`. Decision: `decisions/config-nodes-tier1-scope.md`, last entry.
2. **The field shows "unassigned"** unless the flow has exactly one broker (or WiFi network). A flow saved with
   two shows unassigned; picking one keeps only that one. The compile error for two says to pick one in the field
   (it used to say "reopen the flow in the editor to merge them", which the editor never did).
3. **Broker/WiFi edit panel is one form.** ✎ opens the saved values (host, port, username, password; or SSID,
   password, security, reprovisioning) with **Save** and **Cancel**; Cancel discards (the old panel auto-saved).
   No nested "credential" dropdown. A credential the flow names but this computer lacks: the form says so, and
   saving creates it. **+** form: name, values, "Saved on this computer, not in the flow."
4. **Install firmware dialog:** Chip family → **Firmware** (**Official MicroPython (micropython.org)** or
   **Thingstudio custom image**) → Build → Version. The custom image's versions are in Version (14.1.0, 14.0.1);
   its build is labelled "classic ESP32, 4 MB, no PSRAM". `custom-firmware.md` now installs from the editor first,
   and its manual route says each image is on the release it shipped with, not `releases/latest`.

Pages already updated that day: `working-in-the-editor.md` (Config nodes), `nodes/mqtt-publish.md`,
`nodes/mqtt-subscribe.md`, `custom-firmware.md`, `installing-micropython.md`, `nodes-catalog.md` (regenerated).
The tutorials session edited `custom-firmware.md` and `installing-micropython.md` after that (the custom image is
now the advised flash for standard ESP32s): read both whole for consistency, they had two authors in one week.

## Questions for Mike (ask in the stage 1 summary)

1. **Installing a specific Thingstudio version** (`THINGSTUDIO_VERSION`, added to `installation-details.md` and a
   pointer in `getting-started.md` on 2026-10-29 by mistake, when "pinned release" meant the firmware image): keep
   or drop? Accurate either way; never answered.
2. Should the MQTT console message change wording (known finding 1), or only the docs?
3. Tutorial 3 (MQTT): which broker should a stranger use? A public broker may be blocked on mobile networks; a home
   broker is unreachable from a hotspot. The answer shapes known finding 1's entry too.

## Checks to run and report in the review

- `mkdocs build --strict` and an internal link check over the built site.
- The editor's doc links (`editor/src/app/board-diagnosis.ts`, `DOC_*` paths and anchors) resolve.
- `editor/test/firmware-assets.test.ts` and `editor/test/cli-describe.test.ts` pass (they check the firmware page and
  that `nodes-catalog.md` is current).
- Word counts per page (the rewrite list uses them), to show where length is the problem.

## Done when

- Stage 1's summary is delivered and Mike has reacted.
- The written review is filed in `reviews/`, indexed in `reviews/README.md`, with every page in nav order covered,
  the known findings included, and a suggested order of work.
- `outstanding-items/user-docs-rewrite.md` points at the review as the current list (one line; don't rewrite it).
- Nothing in `docs/user-guide/` changed by this session.

## Environment facts (verified 2026-11-01)

- **Two machines carry this repo.** Mike's MacBook Air: `~/Src/Thingstudio` (lower-case "s" in Thingstudio; the
  other Mac has `~/Src/ThingStudio`). The tutorials session ran on a Linux box at `/home/mike/ThingStudio`, serving
  docs with `.venv/bin/mkdocs serve --dev-addr 0.0.0.0:8000` (Mike reads `http://192.168.10.216:8000/`).
- **Branch:** `docs/context-diet`, which already contains `main` (v0.11.1, `d312e9f`) plus 22 tutorial/example
  commits. Merging it to `main` is Mike's call. The working tree may hold the tutorials session's uncommitted
  review items (D1 R32 `LED` alias, the modem-sleep thread): don't commit or revert them.
- **Git writes are Mike's** (`CLAUDE.md`: sandbox commits leave `.git/*.lock`; agent sessions can't push tags).
  Hand him exact commands, starting `rm -f .git/index.lock`. The deleted `.outstanding-items.md.swp` in `git
  status` is an editor swap file: leave it out of commits.
- **npm/vitest/vite never against the shared mount** (`CLAUDE.md`). The cloud-session pattern that worked: clone
  `github.com/mkarliner/ThingStudio` into the cloud workspace, `npm ci --ignore-scripts` in `editor/`, edit and test
  there, check each target file's SHA-256 on the Mac matches the clone's base before copying back
  (`device_commit_files`), so nothing of Mike's is overwritten.
- **Docs toolchain in a cloud clone:** `python3 -m venv`, `pip install -r docs/requirements.txt`,
  `mkdocs build --strict -d <out>` (prints a Material "MkDocs 2.0" banner; ignore it). Backend for UI screenshots:
  `pip install -e backend`, `thingstudio-backend --port 8799 --no-browser --data-dir <tmp> --static-dir
  editor/dist`; Playwright (Python) is preinstalled; seed credentials as JSON in
  `<data-dir>/credentials/{mqtt-broker,wifi}/<name>.json`.
- **Known flaky test:** `backend/test/test_ws_relay.py::test_install_runtime_relays_progress_before_the_result`
  fails about half the time on unchanged `main` (a timing race). Not a regression signal.
