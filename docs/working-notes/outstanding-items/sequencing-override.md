# Sequencing override set by Mike, 2026-08-20 (read before picking anything else as "next")

Out of this list's normal order, in this sequence:

1. ~~**Custom node authoring** + **documentation**~~ — **implemented 2026-08-20**, scoping and implementation both,
   in the same session. Two-file package format (`<name>.node.json` + `<name>.node.py`), a generic `NodeDefinition`
   builder (`node-library/custom-node.ts`) requiring zero `compile.ts` changes, session-scoped browser loading
   (multi-file picker, `custom-nodes-store.ts`), no sandboxing (same trust boundary as the `function` node, confirmed
   with Mike), output ports capped at 1 by codegen validation only (not the package format). 285/285 editor tests
   pass (30 files, up from 29), `tsc --noEmit` and `vite build` both clean. End-user documentation:
   `docs/user-guide/custom-nodes.md`. Full reasoning: `custom-node-authoring-scoping.md`; ledger entries:
   `decisions.md`'s "Node authoring / extensibility" section, `learnings.md`'s "Custom node authoring" section
   (the `nonlocal`-not-`global` gotcha). See the custom-node-authoring item — its own "real open questions" list is
   now resolved, not just this bullet.
2. **A deliberately narrow validation session, next.** Mike will run a session equipped with *only*
   `docs/user-guide/custom-nodes.md` — not the outstanding-items index, not `CLAUDE.md`, not the rest of
   `docs/working-notes/` — and ask it to build a new node type from a brief, as a real test of whether the
   documentation alone is sufficient for that task, not just whether it reads well. Not this project's job to set up.
3. **Resume normal order after (2) closes out** — back to whichever item is earliest in the backlog at that point
   (currently rp2350 bring-up, unless something changes before then).
