# Documentation — nothing written (basic user docs, developer guide)

`mikes-questions-and-points.md`: basic user docs, a developer guide ("how to make new node types"). The developer-guide half is done: `docs/user-guide/custom-nodes.md` covers node authoring — see `custom-node-authoring-scoping.md`.

**2026-09-06, Mike's call when prioritizing:** split into three separate activities rather than one lump "write the docs" task — (1) **scoping**: what actually needs documenting, for which audience(s); (2) **design**: structure/format/information architecture; (3) **tech selection**: what tool/generator produces and hosts it.

**2026-09-07: activity 1 (scoping) done — see `docs/working-notes/documentation-scoping.md`.** Finding: the developer-guide half of the original ask needs nothing further (already served by `custom-nodes.md`); the actual gap is a missing end-user flow-builder guide. The scoping note has the full content inventory (getting started, canvas basics, flow lifecycle, debugging/troubleshooting, a node reference for the 14 canvas-wired node types) and an explicit out-of-scope list (nothing unbuilt, no contributor-facing material, no structure/format/tool choices).

**Same session, Mike raised two more things.** (1) Node summaries should also live in the editor itself — property panel or a separate tab — not only the external guide; captured as its own addendum in `documentation-scoping.md` plus a new, separately-tracked UI item (`outstanding-items/in-editor-node-reference.md`), since it's real UI work distinct from writing the guide, with a real content-source implication for tooling. (2) Mike named the tech-selection question directly ("readthedocs or something") — resolved same session, `docs/working-notes/documentation-tech-selection.md`: **MkDocs + Material theme, hosted on GitHub Pages for now** (confirmed self-hostable/portable, not a lock-in — Mike's own explicit "for the moment" framing on the host).

**Activity 2 (design — structure/format) is the only piece of this item still open.**
