# Briefing: remaining MVP work after v0.1.1

Status: brief, 2026-09-27. Written at the end of the packaging session that shipped v0.1.1. Scope is
`road-to-mvp.md` (project doc) and `mvp-kickoff-brief.md`; this says what's left, adds Mike's two new items
from 2026-09-27, and suggests an order.

## Where things stand

- MVP items 1-6 (runtime install from the editor, connect errors, board-aware compile, chip defaults/definitions,
  full property panel, WiFi transport) are done.
- Item 7, packaging: **v0.1.1 is published** (github.com/mkarliner/ThingStudio/releases/latest). One-command
  install on macOS/Linux (`curl … | sh`, from the release's own `install.sh`), per-platform bundles with their
  own Python for macOS arm64/x86_64, Linux x86_64/aarch64 and Windows x86_64, all smoke-tested in CI. macOS
  builds are signed and notarized, and Local Network permission works from any terminal (verified in a clean
  macOS 15 account). Detail: `packaging-install-routes-briefing.md`.
- Item 8, docs: every canvas node has a page; getting-started, first flow, boards, WiFi and debugging pages
  exist. Task guides, per-display pages and the troubleshooting list are still to do (below).

## New items (Mike, 2026-09-27)

### A. User docs on GitHub Pages

Nearly there already. `.github/workflows/docs.yml` runs `mkdocs gh-deploy` on pushes to `main` that touch
`mkdocs.yml` or `docs/user-guide/**` (and on "Run workflow"), and it succeeds: the site is on the `gh-pages`
branch. What's missing is the repo setting: GitHub reports no Pages site. `mkdocs.yml`'s `site_url` and the
backend's `ONLINE_DOCS_URL` (`docs_site.py`, the "read this online" link on the not-built page) both already
point at `https://mkarliner.github.io/ThingStudio/`.

1. **Mike:** Settings → Pages → Build and deployment → Source: *Deploy from a branch*, branch `gh-pages`,
   folder `/ (root)` → Save. Wait a minute, open the URL above.
2. Check: every page renders, internal links work, and `/docs/…` links the editor produces resolve online
   too (the editor links console messages to docs pages, `board-diagnosis.ts`).
3. Link it: README (top), the release notes, and `install.sh`'s closing message ("Docs: …").
4. Decide whether the online site should say which release it describes. Today it tracks `main`, which can
   run ahead of the latest release. Cheap option: a line on the home page, "these docs follow the latest code;
   the copy inside Thingstudio matches your installed version" (the backend serves its own bundled docs at
   `/docs/`, so an installed copy is always consistent with itself).

### B. Custom nodes load automatically

Today: `~/.thingstudio/custom-nodes/<name>.node.json` + `.node.py`, listed and served by the backend
(`GET /api/custom-nodes`, `GET /api/custom-nodes/{name}`, `admin_api.py`), but the editor only loads a package
when the user picks it via "Load custom node…" (`PaletteSidebar.vue`, `custom-nodes-store.ts`), and forgets it on
reload. A flow using an unloaded custom node fails to compile with "not loaded this session -- use Load custom
node… first" (`main.ts`).

**Mike's call, 2026-09-27: load them automatically.** This reverses the 2026-08-20/21 "session-scoped only"
decision (`decisions/node-authoring.md`), which predates the backend-owned `~/.thingstudio` folder. Trust is
unchanged: loading only registers a palette entry (templating, nothing executes in the editor), and a custom
node's Python only runs on a board after the user places it and deploys, same as today. The folder is the
user's own. Record the reversal in `decisions/node-authoring.md` when building it.

Shape:

- On editor start (after the backend connects), list `/api/custom-nodes`, fetch each, validate, and register
  with `loadOrReplaceCustomNodePackage`. Same on a backend reconnect.
- **A broken package must not block the rest** (fault-handling rule): skip it and log one console line naming
  the file and the problem (`CustomNodeDescriptorError` text). The palette shows the good ones.
- Opening or deploying a flow that uses a type that failed to load says so by name, pointing at the file.
- Keep "Load custom node…" as **Reload custom nodes** (re-reads the folder after the user edits a file), or
  drop it; either way no file picker. Also consider a light "changed on disk" check on focus, not a watcher.
- Type-id collisions between two files: first one wins, the second is reported (the strict
  `registerCustomNodePackage` rule), rather than silently replacing.
- Docs: `custom-nodes.md` "Loading a custom node" and the "Session-scoped loading" limitation both change.
  Human-facing docs style (CLAUDE.md): short.
- Tests: editor unit tests for load-all with one bad package; backend already covers the API.

## Remaining MVP work

**Packaging (item 7)**

- Windows: PowerShell one-liner (`install.ps1`, same release-asset pattern as `install.sh`), SmartScreen
  "More info → Run anyway" documented, winget and scoop manifests. The Windows zip builds and passes CI's smoke
  test but no person has run it yet.
- Homebrew tap (macOS/Linux), pointing at the release archives.
- `thingstudio` as the command name, `thingstudio-backend` kept as an alias; `--help` still says the old name.
- `thingstudio service` helper + launchd/systemd recipes. A launchd *agent* is not exempt from Local Network
  (TN3179): it needs `AssociatedBundleIdentifiers` or to run `thingstudio-python` (which carries its own
  Info.plist); test in a clean macOS 15 account, never Mike's own (stale entries, see below).
- Fresh-VM acceptance per route: clean Linux VM (x86_64 and a Pi), clean Windows.

**Docs (item 8)**

- Task guides after "Blink an LED": read a sensor; show something on a display.
- A page per supported display module (SSD1306, ST7789 family incl. M5Stack), not only inside the node pages.
- Troubleshooting from real failures (runtime not installed, SPI too fast, `MemoryError`): check `debugging.md`
  against that list.
- Example flows in the docs deploy and run on real hardware before a release.
- Developer section, when written: run `make run` from Apple's Terminal on macOS (`outstanding-items.md`).

**Bug found 2026-09-27 (Pico W):** the board forgets its WiFi-transport password on a power cycle
(`outstanding-items.md`, Network). Not on the path to a first blink (USB), but every WiFi user hits it. Next
step there: read `/_board.json` over USB before and after a power cycle.

**The finish line:** the newcomer test. A fresh machine and a fresh board to a blinking LED in 15 minutes,
following only the docs; every question they hit is answered in the docs or becomes an MVP item.

## Suggested order

1. A (Pages): Mike's one setting, then the checks and links. Small; newcomers will land there first.
2. A first newcomer test on a Mac, early: the Mac route is real and signed now, and what a newcomer trips on
   should decide the docs work. Write a one-page session script for it (what to hand over, what to watch).
3. B (custom nodes auto-load).
4. The password bug.
5. Windows installer, then a real person on real Windows.
6. Task guides and troubleshooting, shaped by step 2.
7. Service helper, Homebrew, winget/scoop, fresh-VM acceptance, then the full newcomer test.

## Things to know before starting

- **macOS Local Network testing:** judge it only on macOS 15+ and only in a user account that has never run a
  build with the `org.thingstudio.backend` identity. Mike's own account has stale entries macOS can't delete;
  there, run Thingstudio from Apple's Terminal. macOS 14 has no Local Network privacy at all.
  (`learnings/backend-security-research.md`, 2026-09-27.)
- **Workflow files and the Makefile are protected from the agent's remote writes:** hand Mike a patch in
  `.verify-tmp/` to apply (`patch -p1 < …`), as this session did.
- **Releases:** bump `backend/pyproject.toml`'s version, commit, tag `vX.Y.Z`, push the tag; CI builds, signs,
  notarizes and smoke-tests all five bundles and makes a **draft** release; publish it by hand. A tag must
  match the version or the run stops.
