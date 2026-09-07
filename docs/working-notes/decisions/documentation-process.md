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
