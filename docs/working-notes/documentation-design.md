# Working note: documentation — design (activity 2 of 3)

Status: decision-complete + scaffolded, 2026-09-07. Picks up where `documentation-scoping.md` (activity 1) and
`documentation-tech-selection.md` (activity 3) left off — those answered "what needs documenting" and "what tool
renders/hosts it"; this note answers "how is it structured," then physically scaffolds the MkDocs project around
that structure. Read the other two first if the "why" behind a structural call here isn't obvious from this file
alone.

## Decision: two-part structure, not one guide

`documentation-scoping.md` left this open as a real design call, dependent on the node reference's actual length.
Resolved here: **a narrative guide plus a separate node reference**, matching the split CLAUDE.md's own interim
style reference (Node-RED's Concepts page, linking out to "Working with..." pages) already calls for, and matching
`custom-nodes.md`'s own precedent of being a complete, standalone document rather than folded into a longer one.

- **Flow builder guide** — one narrative arc: getting started → canvas basics → flow lifecycle → debugging/
  troubleshooting. Task-oriented, read start to end by a new user once, referenced piecemeal after that.
- **Node reference** — lookup-oriented, not narrative. Resolved as **one file per node**, not one long page,
  for a reason beyond just "14 entries and growing": `documentation-scoping.md`'s 2026-09-07 addendum records
  Mike's in-editor-node-reference idea, which needs the node-reference text as **one authored source shared with
  the editor**, not content baked into a single monolithic guide page. A standalone per-node file is directly
  readable (or renderable) by a future in-editor panel without any string-splitting; one long page isn't.
- **`custom-nodes.md`** — unchanged, stays its own standalone document (developer guide, not end-user guide),
  linked from the node reference's landing page rather than duplicated into it. This was already the finding in
  `documentation-scoping.md`'s "Audiences" section; this note doesn't revisit it.

This makes three top-level documents in the published site, not two: the flow builder guide (4 pages), the node
reference (14 node pages + a short landing page), and `custom-nodes.md`.

## Site structure

`docs/` already holds `thingstudio-design-doc.md` and `working-notes/` — both explicitly out of scope for this
site (`documentation-scoping.md`'s "Audiences" section: contributor-facing material is already served by
`CLAUDE.md`/`working-notes/`, and duplicating it here would be scope creep against a line the project already
drew). Rather than restructure `docs/` to make MkDocs' default `docs/` convention work, `mkdocs.yml` points
`docs_dir` at the existing `docs/user-guide/` directory directly — `custom-nodes.md` already lives there, so
nothing needs moving. `mkdocs.yml` itself lives at the repo root, alongside `package.json`/other project-level
config.

```
docs/user-guide/
  index.md              -- landing page, one paragraph + links into the guide and reference
  getting-started.md
  canvas-basics.md
  flow-lifecycle.md
  debugging.md
  custom-nodes.md       -- existing, unchanged
  nodes/
    index.md            -- short landing page for the reference section
    inject.md
    function.md
    debug.md
    gpio-out.md
    pwm-out.md
    timer.md
    interrupt.md
    delay.md
    wifi-status.md
    udp-send.md
    udp-receive.md
    http-request.md
    mqtt-publish.md
    mqtt-subscribe.md
```

File names match each node's `NodeKind` identifier with underscores turned to hyphens (`udp_send` →
`udp-send.md`), the same convention `editor/src/node-library/*.ts`'s own filenames already use — one less
naming scheme to keep in sync.

## Nav layout

```yaml
nav:
  - Home: index.md
  - Getting started: getting-started.md
  - Canvas basics: canvas-basics.md
  - Flow lifecycle: flow-lifecycle.md
  - Debugging & troubleshooting: debugging.md
  - Node reference:
      - Overview: nodes/index.md
      - inject: nodes/inject.md
      - function: nodes/function.md
      - debug: nodes/debug.md
      - gpio out: nodes/gpio-out.md
      - pwm out: nodes/pwm-out.md
      - timer: nodes/timer.md
      - interrupt: nodes/interrupt.md
      - delay: nodes/delay.md
      - wifi status: nodes/wifi-status.md
      - udp send: nodes/udp-send.md
      - udp receive: nodes/udp-receive.md
      - http request: nodes/http-request.md
      - mqtt publish: nodes/mqtt-publish.md
      - mqtt subscribe: nodes/mqtt-subscribe.md
  - Writing custom nodes: custom-nodes.md
```

Node order follows `registry.ts`'s own registration order (general/software nodes first, then GPIO/timer, then
network), not alphabetical — matches the palette sidebar's own grouping logic (`palette.ts`'s `group` field) so a
reader who's used the editor finds things where they'd expect.

## What this session scaffolded

Per the prior briefing's own framing of this candidate ("scaffold the actual MkDocs project"), this session
created the real project skeleton, not just this design note:

- `mkdocs.yml` (repo root) — Material theme, light/dark toggle, search, the nav above.
- `.github/workflows/docs.yml` — builds and publishes to GitHub Pages via `mkdocs gh-deploy` on push to `main`,
  matching `ci.yml`'s existing style/commenting convention. **Not yet run** — needs `mkdocs`/`mkdocs-material`
  actually installed and a real `mkdocs build` verified locally first (see "Not done" below).
- Every page listed under "Site structure" above, as a **placeholder** — a title, a one-line description of
  what the page covers (node pages: pulled from that node's own `editor/src/node-library/*.ts` header comment,
  not invented), and an explicit "content not yet written" line. This proves the nav/structure actually builds
  and renders correctly without pre-empting the separate content-writing pass.
- A `docs/third-party-licenses.md` entry for `mkdocs`/`mkdocs-material`, flagged as **not yet installed** — see
  that file directly for the exact wording and what it still needs once Mike runs the real `pip install`.

## Not done (deliberately, left for later)

- **Actual guide/node-reference content.** `documentation-scoping.md` already named this as separate build
  work, not a scoping-or-design task; that boundary holds here too. Most node content already exists, scattered
  across `editor/src/node-library/*.ts` header comments and `outstanding-items.md` entries (the scoping note's
  own "Node reference" section has the pull-together list) — a real but bounded writing task, sizeable enough
  (4 guide pages + 14 node pages) to be its own session rather than folded into this one.
- **Installing `mkdocs`/`mkdocs-material` and running a real `mkdocs build`/`mkdocs serve`.** Per `CLAUDE.md`'s
  "npm install / build / test from the agent sandbox" convention (same shared-mount hazard applies to a Python
  virtualenv's compiled dependencies as to `node_modules`, even though that section is written about npm
  specifically) — Mike runs this himself; see the handoff briefing for the exact commands.
- **The in-editor node-reference feature itself** (`outstanding-items/in-editor-node-reference.md`) — unaffected
  structurally by this scaffold (the per-node files now exist at a stable path a future panel could read from),
  but its own property-panel-vs-tab UI question and content-sourcing mechanism are still unscoped, unchanged by
  this session.
- **The still-open CI-vendor-neutrality question** — `docs.yml` publishes via GitHub Pages same as
  `documentation-tech-selection.md` already decided, knowingly against that open question; this note doesn't
  revisit it either.
