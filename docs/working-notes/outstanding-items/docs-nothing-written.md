# Documentation — nothing written (basic user docs, developer guide)

`mikes-questions-and-points.md`: basic user docs, a developer guide ("how to make new node types"). The developer-guide half is done: `docs/user-guide/custom-nodes.md` covers node authoring — see `custom-node-authoring-scoping.md`.

**2026-09-06, Mike's call when prioritizing:** split into three separate activities rather than one lump "write the docs" task — (1) **scoping**: what actually needs documenting, for which audience(s); (2) **design**: structure/format/information architecture; (3) **tech selection**: what tool/generator produces and hosts it.

**2026-09-07: activity 1 (scoping) done — see `docs/working-notes/documentation-scoping.md`.** Finding: the developer-guide half of the original ask needs nothing further (already served by `custom-nodes.md`); the actual gap is a missing end-user flow-builder guide. The scoping note has the full content inventory (getting started, canvas basics, flow lifecycle, debugging/troubleshooting, a node reference for the 14 canvas-wired node types) and an explicit out-of-scope list (nothing unbuilt, no contributor-facing material, no structure/format/tool choices).

**Same session, Mike raised two more things.** (1) Node summaries should also live in the editor itself — property panel or a separate tab — not only the external guide; captured as its own addendum in `documentation-scoping.md` plus a new, separately-tracked UI item (`outstanding-items/in-editor-node-reference.md`), since it's real UI work distinct from writing the guide, with a real content-source implication for tooling. (2) Mike named the tech-selection question directly ("readthedocs or something") — resolved same session, `docs/working-notes/documentation-tech-selection.md`: **MkDocs + Material theme, hosted on GitHub Pages for now** (confirmed self-hostable/portable, not a lock-in — Mike's own explicit "for the moment" framing on the host).

**Activity 2 (design — structure/format) is the only piece of this item still open.**

**2026-09-07: activity 2 (design) done, in a separate session — see `docs/working-notes/documentation-design.md`.**
Decided a two-part structure (a 4-page narrative flow-builder guide, plus a one-file-per-node reference — the
per-node split chosen specifically so the in-editor-node-reference idea below has a single shareable content
source rather than two hand-maintained copies) and a nav layout, then physically scaffolded the MkDocs project:
`mkdocs.yml` (repo root, `docs_dir` pointed at the existing `docs/user-guide/`), `.github/workflows/docs.yml`
(gh-deploy on push to `main`), and every page from `index.md` through the 14 node pages as a placeholder (title +
one-line description pulled from that node's own header comment, explicit "content not yet written" marker).
`docs/third-party-licenses.md` got a "Documentation build tooling" entry for `mkdocs`/`mkdocs-material`, flagged
as not yet installed.

**All three activities are now done or scaffolded. What's actually left:**
- Writing the real guide content (4 pages) and node-reference content (14 pages) — a real, bounded writing task,
  not scoping or design. Most of the material already exists, scattered across node header comments and
  `outstanding-items.md` entries; `documentation-scoping.md`'s own "Node reference" section has the pull-together
  list.
- Mike running the actual `pip install mkdocs mkdocs-material` and a local `mkdocs build`/`mkdocs serve` to verify
  the scaffold actually works, per the same shared-mount reasoning that keeps npm installs out of the sandbox.
