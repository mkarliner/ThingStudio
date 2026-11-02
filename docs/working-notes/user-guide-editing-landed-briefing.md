# User guide editing: phases 0-3 landed, 2a and the MQTT tutorial next

Status: continuation brief, filed 2026-11-01. Executes `user-guide-editing-plan.md` against
`reviews/2026-11-01-user-guide.md`. Phases 0, 1, 2 (with the discussion #5 additions) and 3 are done and committed;
phase 3's Gap 2 (the MQTT tutorial) has its spec and is its own session. Next: phase 2a, then Gap 2, then phases 4-7.
The remaining phases run on Sonnet 5.5 (Mike, 2026-11-02); `user-guide-phase-0-briefing.md`, the GLM-5.3-Flash brief for
phase 0, is superseded by this work and marked so.
Read the plan's "done" notes under each phase first, then the review's last two sections ("Phase 0 fact-checks" and
the C6 correction). They carry the answers this brief only points at.

## State

Merged to `main` and pushed on 2026-11-02 (`ebe787e`; later commits are in `git log`). The commits that carry the work:

| Commit | What |
| --- | --- |
| `c6cc54c` | Phase 0: fact-checks appended to the review; `tools/docs_lint.py`, its tests, baseline, `ci.yml` job, AGENTS.md rule |
| `6468d8a` | Phase 1: quick fixes (Installation details, Installing MicroPython, openings, first-flow, debugging labels) |
| `3206fbb` | Phase 2: Memory home, MQTT-unreachable and runtime-on-custom-image entries, FAQ trims, node-red, wifi-provisioning |
| `584790f` | Merge of the remote's `97ad236` and `f670e35` (the MQTT tutorial spec, the sample-scavenger decisions) |
| `beb625b` | Phase 3: Blink from your network rebuilt, Two more blinks voice pass, tutorials index, sensor-display note |
| `d1845de` | Phase 2 additions: `wifi status 201/202` sub-entry, support pointer, share-the-flow FAQ entry |
| `30569ec` | Blink from your network: tick **full message** when starting from the example file |

Uncommitted: only the deleted `docs/working-notes/.outstanding-items.md.swp`. It is an editor swap file; leave it out
of commits. The lint baseline is at 29 entries, all known: `nodes/gui.md` 16 spellings, `nodes/neopixel.md` 4,
`boards.md` 2 spellings and an opening, `nodes/display-spi.md` a duplicate `palette` and a spelling,
`nodes/function.md` 1, `custom-nodes.md` 1, `nodes/index.md` an opening, and `sensor-display.md`'s work-in-progress
note (a deliberate hand-added entry). Phases 4-5 delete most of them.

## Settled, don't re-derive

- **The lint** (`python3 tools/docs_lint.py`, tests `python3 tools/test_docs_lint.py`, CI job `docs-lint`). Two
  departures from the plan's first text, both recorded in it: the opening rule checks the opening paragraph, not the
  first sentence; the repeated-sentence rule ignores sentences starting "See ". `--prune` removes fixed entries and
  never adds; adding an entry is a hand edit.
- **GUI layout (C5.3):** the editor implements the cell grid and calls the checkbox **panel**; the row/column tree is
  stale text and `layout.ts` is dead for users. The review's phase 0 section lists the four `gui.md` edits.
- **The `[memory]` line:** MicroPython total free, plus the ESP-IDF heap's free and largest block (ESP32 only). The
  review's C6 (b) was wrong about MicroPython's largest block (corrected in the review).
- **The memory home is two places on purpose:** `debugging.md` "Memory" explains the line;
  "MemoryError or a library that won't load" keeps the recovery steps, because the editor links to that heading.
  Headings the editor links to must not change: `board-wont-connect`, `board-stuck-restarting`,
  `commands-and-the-python-prompt`, `module-missing-on-the-board`, `memoryerror-or-a-library-that-wont-load`.
- **Example folder paths per install route** are a table in Installation details ("Example flows"), from the installer
  scripts. `topic` is not required on a message. `http in` takes GET or POST only and never reads a body. The node
  status list includes `ntp`, `adc`, `neopixel`.
- **Refusal wording:** one short attributing clause on troubleshooting pages, none on reference pages (style guide,
  "A refusal says it is deliberate, once").
- **Tutorials:** every download says "open the file, don't copy it"; the "Next" pointers stay; the index lists three
  tutorials and no plans.
- **Mike's own text in the tutorials is settled** (`tutorials-and-examples-landed-briefing.md`; read it before editing any
  tutorial page). Phase 3 cut some of it on the user-guide review's findings and had to restore it: the "An important
  point to understand" box in Two more blinks (`534cde8`), and in Blink from your network the credentials story, the
  `.local`/VPN line and "up to a second" (the commit after it). The review's Two more blinks finding 2 and Blink from
  your network findings 3 and 7 are overridden. The voice changes that stayed (dash asides, "Next" headings, "The server
  is open") came from the review and were not individually checked with Mike.

## Next, in order

1. **Phase 2a: the Examples page and a CI compile check** (spec in the plan, "Phase 2a"). Things to decide or watch:
   - Installation details' "Example flows" section is linked from the Home tip, Blink an LED, the tutorials index and
     both tutorials (`installation-details.md#example-flows`). The plan says the Examples page subsumes Gap 4. Suggested:
     the Examples page owns the table, Installation details keeps one sentence and a link, and every link above is
     updated. The link check catches a missed anchor.
   - `examples/README.md` already describes the same eight flows for the repo. One home for changing facts: keep the
     README thin and link to the page, or the reverse.
   - The compile check generalizes `editor/test/gui-trend.test.ts` (`compileWithHooks` over one example) to every
     `examples/**/*.flow.json`. Wrinkle to check first: `http-blink` and `basic-mqtt` name credentials that don't exist
     (`tutorial wifi`), so the test needs the credential resolution the existing tests use.
   - The test needs npm and vitest, which never run on the mount (see below). Mike runs the docs tests:
     `cd editor && ./node_modules/.bin/vitest run test/docs-llms.test.ts test/cli-check-flow.test.ts test/cli-describe.test.ts`.
     The new example test needs the same.
2. **Gap 2, the MQTT tutorial "Blink from anywhere"** (spec in the plan, "Gap 2 spec"). When it lands: add it to
   `tutorials/index.md`; point "Next" on `blink-from-your-network.md` at it as well as `examples/basic-mqtt.flow.json`;
   link `debugging.md#mqtt-broker-unreachable` from "nothing arrives?"; ship its flow in `examples/` with a README line;
   keep the public-broker caveat (`test.mosquitto.org`, a random topic prefix, anyone can subscribe). It needs a real
   board run by Mike before it is called done: nothing here can run a flow.
3. **Phase 4** (contradictions): the review's per-page entries for `nodes/gui.md`, `gui-layout.md`, `node-conventions.md`
   and `display-spi.md`. Merging `gui-layout.md` means removing its nav line in `mkdocs.yml` and fixing links from the
   FAQ, `nodes/gui.md` and `sensor-display.md`. Comment out the modal section with an HTML comment (the lint skips
   comments). Remove `gui navigator` outright.
4. **Phase 5** (node pages to layout and voice): each page's findings are its checklist. Requirement added by Mike: every
   Wiring example is copy-pasteable. Include the facts in the review's phase 0 section (`http in`, the missing **WiFi**
   property on both MQTT pages, whose new one-line `## Errors` sections should take their error text).
5. **Phases 6-7** (structure, pictures) as the plan says. Phase 7 needs the screenshot route below.

## For Mike (not docs work)

- Read the `wifi status 201/202` sub-entry in `debugging.md` against discussion #5. It was written from the plan and the
  source; the discussion wasn't readable here. The advice to remove a `wifi status` node beside MQTT nodes follows the
  plan, and nothing in the source proves that node is the cause.
- Product side, already outstanding items: a warning in the compiled-source view (it holds the resolved WiFi password and
  broker login), the misleading `[wifi] … reachable over WiFi` line, and a plainer console line for an unreachable broker.
- `examples/http-blink.flow.json`'s `debug` node prints only the payload, so the tutorial tells readers to tick
  **full message**. Shipping the example with it ticked would let that sentence go.
- The lint's two departures are in the plan's notes, not `decisions/`. Move them if you want them on that record.

## Environment facts (every toolchain this run used)

**The device bridge (the Mac's repo):**
- The folder must be requested: `device_request_folder_access` for `~/Src/Thingstudio` (lower-case "s"). The shell sees
  it as `$HOME/mnt/Thingstudio`. Python is 3.10.12 here and 3.12 in CI, so lint code stays 3.10-compatible.
- Docs build, in a venv outside the repo (never the repo's `.venv`, which has Mac binaries):
  `python3 -m venv ~/mkv && ~/mkv/bin/pip install -q "mkdocs==1.6.1" mkdocs-material`, then from the repo
  `~/mkv/bin/mkdocs build --strict -d ~/site-check`. The Material "MkDocs 2.0" banner is not a warning; the exit code
  is the result. The venv lives in the session home and is gone next session; it reinstalls in about a minute.
- Internal link and anchor check over the built site. No script is in the repo; this one (30 lines) is what ran, saved
  outside the repo and run with `python3 -I`:

  ```python
  import sys
  from pathlib import Path
  from html.parser import HTMLParser
  from urllib.parse import urlparse, unquote
  root = Path(sys.argv[1]).resolve()
  class P(HTMLParser):
      def __init__(s): super().__init__(); s.ids=set(); s.links=[]
      def handle_starttag(s, tag, attrs):
          a=dict(attrs)
          if a.get("id"): s.ids.add(a["id"])
          if tag=="a" and a.get("name"): s.ids.add(a["name"])
          if tag=="a" and a.get("href"): s.links.append(a["href"])
  pages={}
  for f in root.rglob("*.html"):
      p=P(); p.feed(f.read_text(encoding="utf-8")); pages[f]=p
  bad=[]; n=0
  for f,p in pages.items():
      if f.name=="404.html": continue
      for href in p.links:
          u=urlparse(href)
          if u.scheme or u.netloc or href.startswith(("mailto:","javascript:")): continue
          n+=1
          t = f if not u.path else (f.parent/unquote(u.path)).resolve()
          if t.is_dir(): t=t/"index.html"
          if not t.exists(): bad.append((f.relative_to(root),href,"missing file")); continue
          if u.fragment and t.suffix==".html":
              tp=pages.get(t)
              if tp is None or unquote(u.fragment) not in tp.ids: bad.append((f.relative_to(root),href,"missing anchor"))
  print(n,"internal links checked;",len(bad),"broken")
  for b in bad[:20]: print(*b)
  ```

  The editor's doc links (`DOC_*` constants and `"page/#anchor"` strings in `editor/src`) were checked the same way against
  the built site: extract them with a regex, check page and anchor exist.
- `grep -r` over the repo root times out (120 s default for `device_bash`, because of `node_modules` and `site/`). Name the
  directories (`docs/user-guide editor/src backend/src`) and wrap in `timeout 60`.
- Edits that worked: Python read-modify-write with `assert old in s` before each replace; heredocs for new files.

**Git, from the sandbox:**
- `CLAUDE.md` says git writes are Mike's, to run in his Terminal. This run, Mike said "you have permission to commit" and
  granted deletion once through `device_request_delete_permission`, which lasts for the session and has to be asked for
  again. Ask before the first commit; don't assume the grant carries over.
- Without delete permission a commit works but leaves `.git/HEAD.lock`, `.git/objects/maintenance.lock` and
  `tmp_obj_*` behind, and any command that takes the index lock twice (a merge) fails with "index.lock: File exists".
  Move a lock aside (`mv`, directly under `.git`) or delete it once permitted, and only a lock the sandbox user made
  moments ago with no git running (check owner and mtime). `.git/HEAD.lock.stale.5` is Mike's older one.
- Two Macs, different sessions: `~/Src/Thingstudio` (MacBook Air) and `~/Src/ThingStudio` (Mac mini). `get_device_info` says
  which is connected. Delete permission is per folder and per session; ask again on each. The mini's sandbox has no git
  identity: commit with `git -c user.name='Michael Karliner' -c user.email='mike@karliner.net' commit ...`. For read-only
  checks use `git --no-optional-locks status` (plain `status` can leave an `index.lock`).
- Pushing: the device has no push credentials. Carry the commits in a bundle so the hashes stay the same:
  `git bundle create .push.bundle <remote-tip>..main` in the repo, `device_stage_files` it, then in a cloud clone
  (`add_repo` with `access: push`, `git init` + `git fetch --depth=60 origin main`) `git fetch <bundle> main:to-push` and
  `git push origin to-push:refs/heads/main`. Delete the bundle from the repo afterwards. Pushing `main` deploys the docs.
- SSH to GitHub fails from the device ("Host key verification failed"). HTTPS works:
  `git fetch https://github.com/mkarliner/thingstudio docs/context-diet`, then `git merge FETCH_HEAD`. `pull.rebase` is
  unset, so a merge. Stage by explicit paths so the `.swp` deletion stays out.
- Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the `Claude-Session:` line.

**The cloud container (separate from the Mac):**
- `add_repo` for `mkarliner/ThingStudio` (read) reports anonymous reads work; `git ls-remote` and a shallow
  `git fetch --depth=40 https://github.com/mkarliner/thingstudio docs/context-diet` worked there. The clone path is
  `/home/claude/mkarliner/thingstudio`.
- `gh api graphql` is blocked ("GraphQL is not available from Claude Code sessions"), so GitHub Discussions can't be read;
  REST works for issues and pull requests.
- npm, vitest, vite and tsc never run against the Mac mount. The pattern that works: clone into the container,
  `npm ci --ignore-scripts` in `editor/`, edit and test there, check each target file's SHA-256 on the Mac still matches the
  clone's base, then copy back with `device_commit_files`. Not needed for docs-only phases; needed for 2a's test.
- Screenshots for phase 7 (`tools/screenshots.py`): the device VM can't download Chromium. Stage `editor/dist`,
  `backend/src`, `tools/screenshots.py` and `docs/screenshots/` into the container, `pip install aiohttp pyserial`, run
  with `PYTHONPATH=backend/src` and `--chromium` pointing at the preinstalled Playwright Chromium, then commit the PNGs back.
- The ThingStudio Project docs mirror briefings; this one has a copy at `claude/user-guide-editing-landed-briefing.md`.
  `project_write` takes `content` or a staged file under `/mnt/user-data/uploads` (stage with `device_stage_files`).
