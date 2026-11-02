# User guide editing: phases 0-4 landed, the MQTT tutorial written (untested), phase 5 next

Status: continuation brief, filed 2026-11-01. Executes `user-guide-editing-plan.md` against
`reviews/2026-11-01-user-guide.md`. Phases 0, 1, 2 (with the discussion #5 additions) and 3 are done and committed;
phase 3's Gap 2 (the MQTT tutorial) has its spec and is its own session. Phase 2a (the Examples page, the compile test)
and phase 4 (contradictions, the GUI page) landed 2026-11-02 after the commits below, and the MQTT tutorial (Gap 2) is
written but has not run on a board. Next: Mike's board run of Gap 2, then phases 5-7.
The remaining phases run on Sonnet 5.5 (Mike, 2026-11-02); `user-guide-phase-0-briefing.md`, the GLM-5.3-Flash brief for
phase 0, is superseded by this work and marked so.
Read the plan's "done" notes under each phase first, then the review's last two sections ("Phase 0 fact-checks" and
the C6 correction). They carry the answers this brief only points at.

## State

Pushed to `main` on 2026-11-02 up to `12787b4`. Phase 4 and the MQTT tutorial are committed locally and not pushed
(check `git status -sb`). The commits that carry the work:

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
of commits. The lint baseline is at 11 entries, all known: `nodes/neopixel.md` 4 spellings, `boards.md` 2 spellings and an
opening, `nodes/function.md` 1, `custom-nodes.md` 1, `nodes/index.md` an opening, and `sensor-display.md`'s
work-in-progress note (a deliberate hand-added entry). Phase 5 deletes most of them.

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
- **Example folder paths per install route** are a table on the Examples page ("Where the folder is"), from the
  installer scripts. `topic` is not required on a message. `http in` takes GET or POST only and never reads a body. The node
  status list includes `ntp`, `adc`, `neopixel`.
- **Phase 2a:** `examples.md` owns the examples-folder table (Installation details points at it);
  `editor/test/examples-compile.test.ts` checks every `examples/*.flow.json`, so a new example is covered automatically; it
  still needs an entry on `examples.md` and a line in `examples/README.md`.
- **Phase 4:** `gui-layout.md` is gone, merged into `nodes/gui.md` "Laying out pages" (one model: cell grid, **panel**).
  The `gui modal` bullet and the "Modals in the flow file" section are HTML-commented, not deleted (decision 2); `gui
  navigator` is removed. Anchors other pages use stay: `#laying-out-pages`, `#themes`, `#rotating-the-screen`, `#buttons`.
- **Gap 2's choices:** a new flow, not tutorial 2's grown (that flow has `http in` and `wifi status`, and the debugging entry
  says `wifi status` beside MQTT nodes can fail the join). The example's topics carry the placeholder `change-this-number`
  on purpose: a shared number would let strangers switch each other's LEDs. The function node exists because `gpio out`
  uses Python truthiness, so the text `off` would count as on.
- **Mike's own voice (2026-11-02):** some places suit his personal, slightly humorous voice. Don't write it: write the
  neutral version, flag the place to him by page and heading in your summary, and add it to the style guide's "Places for
  Mike's own voice" list (the first five are there). AGENTS.md and `decisions/documentation-process.md` carry the rule.
- **Refusal wording:** one short attributing clause on troubleshooting pages, none on reference pages (style guide,
  "A refusal says it is deliberate, once").
- **Tutorials:** every download says "open the file, don't copy it"; the "Next" pointers stay; the index lists four
  tutorials and no plans.
  "Blink from your network" is titled **Web Blink** (Mike, 2026-11-02); its file is still `blink-from-your-network.md`, so
  the published URL and the README link keep working. Use the new title in any text that names it.
- **Mike's own text in the tutorials is settled** (`tutorials-and-examples-landed-briefing.md`; read it before editing any
  tutorial page). Phase 3 cut some of it on the user-guide review's findings and had to restore it: the "An important
  point to understand" box in Two more blinks (`534cde8`), and in Blink from your network the credentials story, the
  `.local`/VPN line and "up to a second" (the commit after it). The review's Two more blinks finding 2 and Blink from
  your network findings 3 and 7 are overridden. The voice changes that stayed (dash asides, "Next" headings, "The server
  is open") came from the review and were not individually checked with Mike.

## Next, in order

1. **Gap 2, "Blink from anywhere": Mike runs it on a board.** `tutorials/blink-from-anywhere.md` and
   `examples/blink-from-anywhere.flow.json` are written, compile, and pass the layout and syntax checks; nothing here can run a
   flow, so the page is unverified. To test: open the example (set the pin, replace `change-this-number` in both topics, fill the
   `tutorial wifi` and `test-mosquitto` forms) and deploy; `mosquitto_sub -t 'thingstudio/<n>/#' -v` while clicking the inject's
   ▶; `mosquitto_pub ... -t thingstudio/<n>/led -m on` and `off`. Then check the build steps by hand against the editor: the
   MQTT Broker form (name, host, port), the **WiFi** field on an MQTT node, and that the second MQTT node shows the first one's
   broker. Unknowns: whether a phone on mobile data reaches port 1883 (the page defers to the debugging entry), and whether the
   subscribe node's dot turns green as the page says. Fix the page from what you see.
2. **Phase 5** (node pages to layout and voice): each page's findings are its checklist. Requirement added by Mike: every
   Wiring example is copy-pasteable. Include the facts in the review's phase 0 section (`http in`, the missing **WiFi**
   property on both MQTT pages, whose new one-line `## Errors` sections should take their error text).
3. **Phases 6-7** (structure, pictures) as the plan says. Phase 7 needs the screenshot route below.

## For Mike (not docs work)

- Read the `wifi status 201/202` sub-entry in `debugging.md` against discussion #5. It was written from the plan and the
  source; the discussion wasn't readable here. The advice to remove a `wifi status` node beside MQTT nodes follows the
  plan, and nothing in the source proves that node is the cause.
- Product side, already outstanding items: a warning in the compiled-source view (it holds the resolved WiFi password and
  broker login), the misleading `[wifi] … reachable over WiFi` line, and a plainer console line for an unreachable broker.
- `examples/http-blink.flow.json`'s `debug` node prints only the payload, so the tutorial tells readers to tick
  **full message**. Shipping the example with it ticked would let that sentence go.
- `examples/README.md` still says `basic-http-request` "takes a value out of the answer"; the flow doesn't (it is
  `inject -> http request -> debug`). The README duplicates the new Examples page; shorten it to a pointer if you want one home.
- `gui-headliner-sensor-freenove-s3-4in.flow.json` carries the hidden `gui navigator` node, and `sensor-display.md` still
  mentions it (remark 6); that tutorial is parked (remark 5), so decide example or tutorial when it is reworked.
- Phase 4 commented out the `gui modal` bullet as well as its flow-file section. The review also offered one line saying
  modals aren't laid out in the editor; say if you want that instead.
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
  clone's base, then copy back with `device_commit_files`. Not needed for docs-only phases. For 2a it worked like this: in the
  push clone, `git fetch --depth=1 origin main` and `git checkout -f origin/main`, `npm ci --ignore-scripts` in `editor/` (seconds,
  with a warm cache), write and run the test there, copy a new file back (its `stagedPath` must be under `/mnt/user-data/outputs/`;
  compare SHA-256 afterwards). To run the docs tests against docs edits made on the Mac, stage the changed files with
  `device_stage_files` and copy them into the clone first.
- Screenshots for phase 7 (`tools/screenshots.py`): the device VM can't download Chromium. Stage `editor/dist`,
  `backend/src`, `tools/screenshots.py` and `docs/screenshots/` into the container, `pip install aiohttp pyserial`, run
  with `PYTHONPATH=backend/src` and `--chromium` pointing at the preinstalled Playwright Chromium, then commit the PNGs back.
- The ThingStudio Project docs mirror briefings; this one has a copy at `claude/user-guide-editing-landed-briefing.md`.
  `project_write` takes `content` or a staged file under `/mnt/user-data/uploads` (stage with `device_stage_files`).
