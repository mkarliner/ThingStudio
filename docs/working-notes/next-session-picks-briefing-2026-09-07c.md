# Briefing: documentation design done + MkDocs project scaffolded — pick content-writing, Backend/auth, or a
# smaller item next

For the next chat. Read `CLAUDE.md` in full, as always.

**Check `git log` and `git status` before assuming anything below is committed.** This session's work is **not
committed from this session**, per standing project rule (git writes go to Mike as exact commands to run
himself). Confirm with `git status --short` before trusting anything here is safely on disk. Files touched this
session: new `docs/working-notes/documentation-design.md`, `mkdocs.yml`, `.github/workflows/docs.yml`,
`docs/user-guide/index.md`, `docs/user-guide/getting-started.md`, `docs/user-guide/canvas-basics.md`,
`docs/user-guide/flow-lifecycle.md`, `docs/user-guide/debugging.md`, `docs/user-guide/nodes/` (index + 14 node
placeholder pages), this briefing; edited `docs/third-party-licenses.md`, `docs/working-notes/outstanding-items.md`,
`docs/working-notes/outstanding-items/docs-nothing-written.md`, `docs/working-notes/decisions.md`,
`docs/working-notes/decisions/documentation-process.md`, `docs/working-notes/mikes-questions-and-points.md`.

**`.git/index.lock` reappeared again this session, on a plain `git status`.** Same recurring hazard the prior
briefing flagged — `rm -f .git/index.lock` in a real Terminal before trusting any git command works.

## What this session did

Picked **documentation, activity 2 (design)** — the item the prior briefing said was now fully unblocked (real
content inventory from activity 1, a chosen tool from activity 3). Wrote `documentation-design.md`, deciding:

1. **Two-part structure**: a 4-page narrative flow-builder guide (getting started, canvas basics, flow
   lifecycle, debugging) plus a separate node reference — **one file per node**, not one long page, chosen
   specifically so the in-editor-node-reference idea (`outstanding-items/in-editor-node-reference.md`) has a
   single content source a future editor panel could read directly. `custom-nodes.md` stays its own standalone
   document, linked rather than duplicated.
2. **Site structure**: `mkdocs.yml`'s `docs_dir` points at the existing `docs/user-guide/` rather than
   restructuring `docs/` itself — `docs/`'s design-doc and working-notes content is explicitly out of scope for
   this site.
3. **Nav layout**: matches `registry.ts`'s own node registration order, not alphabetical.

**Then physically scaffolded the MkDocs project**, not just the design note:

- `mkdocs.yml` (repo root) — Material theme, light/dark toggle, search, the nav above.
- `.github/workflows/docs.yml` — `mkdocs gh-deploy` on push to `main`, matching `ci.yml`'s style. **Not yet run.**
- Every page (`index.md` + 4 guide pages + `nodes/index.md` + 14 node pages) as a **placeholder** — a title, a
  one-line description pulled from that node's own header comment in `editor/src/node-library/`, and an explicit
  "content not yet written" marker. Proves the nav/structure is real without pre-empting the content-writing pass.
- `docs/third-party-licenses.md`: new "Documentation build tooling" entry for `mkdocs` (1.6.1, BSD-2-Clause) and
  `mkdocs-material` (9.7.7, MIT) — versions/licenses confirmed against PyPI this session, flagged as **not yet
  installed**. Pinned the same versions in `.github/workflows/docs.yml`'s `pip install` step.

All the tracking files updated in the same pass: `outstanding-items.md`'s docs entry, `docs-nothing-written.md`,
`decisions.md`'s "Docs / process" section (now 4 entries in `decisions/documentation-process.md`), and
`mikes-questions-and-points.md`'s Documentation annotation.

## Not in scope for this chat (deliberately)

- **Actual guide/node-reference content.** This was already the boundary the scoping session drew, and it holds
  here — a real, bounded writing task (4 guide pages + 14 node pages), most of it pulling together material
  already scattered across node header comments and `outstanding-items.md`, sizeable enough to be its own session.
- **Installing `mkdocs`/`mkdocs-material` or running a real `mkdocs build`/`mkdocs serve`.** Per this project's
  npm-install-from-the-sandbox convention (same shared-mount hazard applies to a Python venv's compiled deps) —
  Mike's own step, commands below.
- **The in-editor node-reference feature itself** — unaffected structurally (the per-node files now exist at a
  stable path), but its own UI design questions are untouched.
- **The still-open CI-vendor-neutrality question** — `docs.yml` publishes via GitHub Pages same as already
  decided, knowingly against that open question, not silently resolved further.

## Suggested next-session candidates

1. **Documentation content-writing.** All three activities (scoping, tech selection, design/scaffold) are now
   done. The only piece left is writing the real content for the 4 guide pages and 14 node-reference pages —
   `documentation-scoping.md`'s content inventory and `documentation-design.md`'s file layout are both ready to
   write against directly. Verify the scaffold actually builds first (see "For Mike" below) before or alongside
   writing content, so broken nav/links surface early.
2. **Backend/auth — start the build.** [P1], design-complete (Python/aiohttp/pyserial; two auth postures; one
   multiplexed WebSocket endpoint) — only code is missing. `backend-auth-overview.md` + its three linked design
   docs are the starting reading, in that order. Bigger, probably its own dedicated session.
3. **In-editor node reference** — real UI work (a `PropertyPanel.vue` section or new tab), needs its own scoping
   pass first (property-panel-vs-tab, and how it sources content — the per-node markdown files this session
   created are one real candidate for that source now).
4. **The WiFi functor/singleton question** and the **Threading/multicore** entry (both still untriaged in
   `mikes-questions-and-points.md`) — both read-and-assess tasks, cheap to fold into whichever session.

If a smaller, buildable-right-now item is wanted instead: **[P2]** multi-output-port support and **[P2]** delete
node/wire are both real code, no hardware, no design-doc dependency.

## For Mike, in a real Terminal

Clear the lock file first if it's blocking anything:

```
rm -f .git/index.lock
```

Verify the MkDocs scaffold actually builds (pin versions match `docs/third-party-licenses.md` and
`.github/workflows/docs.yml`):

```
pip install mkdocs==1.6.1 mkdocs-material==9.7.7
mkdocs serve
```

Then open the printed local URL and check the nav renders and every placeholder page loads. If the installed
package metadata's version/license differs from what's recorded, update `docs/third-party-licenses.md`'s
"Documentation build tooling" table to match (its own stated practice).

## Success criteria (whichever item gets picked)

Same bar as every prior session — see the original `next-session-picks-briefing-2026-09-07.md` for the full text.
Documentation design/scaffold work counts as "real deliverable" the same way the scoping and tooling notes did.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself in a real Terminal, never executed from the sandbox. Suggested commit for this session's changes:

```
git add mkdocs.yml .github/workflows/docs.yml docs/user-guide/index.md docs/user-guide/getting-started.md \
  docs/user-guide/canvas-basics.md docs/user-guide/flow-lifecycle.md docs/user-guide/debugging.md \
  docs/user-guide/nodes/ docs/third-party-licenses.md docs/working-notes/documentation-design.md \
  docs/working-notes/outstanding-items.md docs/working-notes/outstanding-items/docs-nothing-written.md \
  docs/working-notes/decisions.md docs/working-notes/decisions/documentation-process.md \
  docs/working-notes/mikes-questions-and-points.md \
  docs/working-notes/next-session-picks-briefing-2026-09-07c.md
git commit -m "Design end-user docs structure, scaffold MkDocs project (config, GH Actions workflow, placeholder pages), track mkdocs/mkdocs-material as pending third-party deps"
```
