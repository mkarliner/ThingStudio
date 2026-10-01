# Decisions: documentation process

**2026-09-07 — documentation scoping resolved: end-user guide is the real gap, developer guide already done.**
Full reasoning: `docs/working-notes/documentation-scoping.md`. Of the original ask's two halves (basic user docs,
a developer guide for node authoring), the developer-guide half is fully served by `docs/user-guide/
custom-nodes.md` and needs no further work. The actual open item is a missing end-user flow-builder guide,
audienced per the design doc's own §2 target audience (home-automation tinkerers / IoT professionals), explicitly
excluding contributor-facing material (already served by `CLAUDE.md`/`working-notes/`) and anything not yet
built (per `CLAUDE.md`'s "concise, not exhaustive" rule — a roadmap belongs in `README.md`/`outstanding-items.md`,
not a how-to-use-it guide). Structure/format (activity 2) is left open, not decided in this pass.

**2026-09-07 — documentation tooling decided: MkDocs + Material theme, hosted on GitHub Pages for now.** Full
reasoning: `docs/working-notes/documentation-tech-selection.md`. Weighed against Sphinx/Read the Docs, VitePress,
Docusaurus, and plain unrendered Markdown; MkDocs won on zero new npm dependency, plain-Markdown portability
(matters for the in-editor node-reference idea below, which needs a content source both the docs site and the
editor can read), and an established style track record matching this project's own concise end-user-doc
convention. Hosting on GitHub Pages was Mike's own explicit "for the moment" call, made knowingly against the
still-open CI-vendor-neutrality question (`outstanding-items/ci-vendor-neutrality.md`) rather than silently
deciding it — checked against `CLAUDE.md`'s "don't paint into a dead end" test and confirmed not a lock-in:
MkDocs' output is portable static HTML, so switching hosts later is a config change, not a rebuild.

**2026-09-07 — in-editor node reference raised, not yet designed.** Mike's own idea, same session: node summaries
should be available directly in the editor (property panel or a separate tab), not only the external guide.
Real implication for the decisions above: node-reference content needs one authored source shared between the
editor and the docs site, not two independently hand-maintained copies. Tracked as its own UI item,
`outstanding-items/in-editor-node-reference.md` — not designed or built yet.

**2026-09-07 — documentation design resolved: two-part structure, MkDocs project scaffolded.** Full reasoning:
`docs/working-notes/documentation-design.md`. Structure: a 4-page narrative flow-builder guide (getting started,
canvas basics, flow lifecycle, debugging) plus a separate node reference, one file per node rather than one long
page -- chosen specifically because the in-editor-node-reference idea above needs a single content source a
future editor panel could read directly, not text embedded in a longer page. `custom-nodes.md` stays its own
standalone document, linked rather than duplicated. `mkdocs.yml`'s `docs_dir` points at the existing
`docs/user-guide/` rather than restructuring `docs/` itself, since `docs/`'s other contents (the design doc,
working-notes) are explicitly out of scope for this site. Scaffolded, not just designed: `mkdocs.yml`, a GitHub
Actions `gh-deploy` workflow, and every page as a placeholder -- actual content-writing is a separate, later task.

**2026-09-07 — node-reference nav corrected to actually group by palette, not just resemble it.** Full
reasoning: `documentation-design.md`'s "Nav layout" section (see its "Corrected" note). The scaffolded nav was a
flat list this file's own prose incorrectly described as matching the palette sidebar's grouping — it didn't.
Nav now has three real subsections (General/Network/Hardware, `palette.ts`'s `DEFAULT_NODE_GROUPS` order) with
nodes in each ordered the same way `PaletteSidebar.vue` actually renders them. `mkdocs.yml` and
`docs/user-guide/nodes/index.md` both updated in the same change.

**2026-09-07 — documentation content-writing done; all three original activities plus content now complete.**
Full detail: `outstanding-items/docs-nothing-written.md`. The 4 guide pages and 14 node-reference pages
scaffolded as placeholders earlier the same day now have real content -- sourced from each node's own
`editor/src/node-library/*.ts` header comment and `NodeDefinition`, `PropertyPanel.vue`'s actual field labels
(read directly, not inferred from the compiler-side property names), `README.md`, `test-flows/README.md`, and
`CLAUDE.md`'s own conventions (the fault-handling corollary for the WiFi/MQTT ordering-race note, the
"concise, not exhaustive" style rule for pacing). Only remaining piece of the whole documentation item: Mike
installing `mkdocs`/`mkdocs-material` and running a real build to confirm the site renders correctly.

- **2026-09-23 — Docs hosting: local for an installed copy, GitHub Pages for pre-install reading.** Mike's
  call. The backend serves the built site at `/docs/` (`docs_site.py`, `--docs-dir`, dev default the repo's
  `site/`), so help works with no internet — the case that matters most is a user whose board won't connect,
  who may be offline or on a machine set up only for this. GitHub Pages (`site_url` in `mkdocs.yml`) stays for
  people deciding whether to install. Details:
  - The editor's help links (`board-diagnosis.ts` advice, the toolbar **Docs** button) always point at the
    backend's copy, derived from the backend URL field (`backendHttpBaseUrl()`), never at GitHub Pages.
  - Docs not built on this machine → `/docs/…` answers 503 with a short page saying so, the online URL of the
    same page, and the build command. Legible failure, not a 404 for a link the editor itself produced.
  - `theme.font: false` so the built site makes no Google Fonts request offline. Checked on a real build: the
    only external URLs left are ordinary links.
  - Packaging (MVP item 7) must bundle the built `site/` and pass `--docs-dir`; `site/` is now gitignored.
  - GitHub Pages returned 404 on 2026-09-23 — the workflow exists but the site isn't live. See
    `outstanding-items/documentation-site.md`.

## 2026-10-01: onboarding is one straight line of numbered steps

- **Decision (Mike, from the first newcomer test, 2026-09-30):** the route from a new board to a blinking LED reads
  as a straight line that only points forward. "Getting started" opens with the list of steps, because people read
  it first and skip anything before it. Steps, one page each, nav group "Getting started":
  1. Install Thingstudio (`getting-started.md`), 2. Install MicroPython (`installing-micropython.md`),
  3. Connect your board (`connecting.md`), 4. Install the runtime (`installing-runtime.md`),
  5. Blink an LED (`first-flow.md`). Each page ends "Next: Step N+1".
- Why: the old order put Installing MicroPython before Getting started, its first check needed Thingstudio already
  installed, and it ended "Go back to Getting started". The volunteer (an experienced programmer, new to
  microcontrollers) was unsure whether he had to install MicroPython at all.
- Off-path detail (packages, no-installer routes, upgrade/remove, from source, `--no-browser`, command-line runtime
  install) moved to `installing-more.md`, linked from step 1 and step 4.
- Page URLs the editor links to (`getting-started/`, `installing-micropython/`) are unchanged, so released editors'
  doc links still land on the right step.
- Install MicroPython now names other chips (STM32 etc.) and points them at the MicroPython docs; see `CLAUDE.md`,
  "Unsupported boards: expect them anyway".

## 2026-10-01: user-guide screenshots are taken automatically from the built editor

- **Decision (Mike's ask):** screenshots in the user guide come from `tools/screenshots.py`, not by hand, so they
  keep up with the code. It starts `thingstudio-backend` on a spare port, opens the built editor in headless
  Chromium (Python Playwright), loads a fixture flow from `docs/screenshots/` and saves PNGs to
  `docs/user-guide/images/`. No board involved.
- Flows load through the editor's existing `<input type=file>` fallback (the script deletes
  `showOpenFilePicker`), so the editor needed no test hook.
- Runs in the docs workflow (now also triggered by `editor/**` changes) and the release workflow before
  `mkdocs build`. The PNGs are committed too, so a plain local `make` builds the docs without Playwright; `make
  screenshots` retakes them locally (downloads Chromium the first time).
- Playwright is pinned in `docs/screenshots/requirements.txt`, kept apart from `docs/requirements.txt`.
- Shots that need a board (console after a deploy) stay as text in the docs for now.
- Same day: `editor-parts.png`, the editor with its parts outlined and numbered, for the legend at the top of
  `canvas-basics.md`. The script draws the callouts from the live DOM (element ids in `EDITOR_PARTS`), so they
  follow layout changes; a renamed or removed id fails the run by name. The legend's numbers are kept in step with
  `EDITOR_PARTS` by hand.
