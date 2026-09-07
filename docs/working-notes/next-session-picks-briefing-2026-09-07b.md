# Briefing: documentation scoping + tooling both decided — pick Backend/auth, docs design, or the WiFi question next

For the next chat. Read `CLAUDE.md` in full, as always, plus `docs/working-notes/mikes-questions-and-points.md`
(picked up a new, untriaged entry mid-session — "Threading / multicore support, maybe surfaced as Exec node?" —
added by Mike directly, not investigated or scoped this session, same "flag for next session" treatment as the
WiFi functor/singleton entry got before. **Also cleaned this session, Mike's explicit go-ahead**: every item
whose annotation showed it fully resolved/decided/superseded elsewhere was removed outright rather than just
pointed-at -- 111 lines down to 73. Nothing lost: every removed item's full context still lives at whatever its
old annotation pointed to (outstanding-items.md's "Resolved" section, decisions.md, or the design doc); git
history has this file's exact prior wording if it's ever needed. The header note in the file itself records this
new convention -- future sessions can keep doing this going forward, not just this once.)

**Check `git log` and `git status` before assuming anything below is committed.** As of this writing the tip
should be a new commit on top of `77d96e1` — this session's work is **not committed from this session**, per
standing project rule (git writes go to Mike as exact commands to run himself). Confirm with
`git status --short` before trusting anything here is safely on disk. Files touched this session: new
`docs/working-notes/documentation-scoping.md`, `documentation-tech-selection.md`,
`decisions/documentation-process.md`, `outstanding-items/in-editor-node-reference.md`, this briefing; edited
`outstanding-items.md`, `outstanding-items/docs-nothing-written.md`, `decisions.md`.

## What this session did

Picked the **documentation — scoping pass**, the lower-risk of the two [P1] candidates the prior briefing
offered. Wrote `documentation-scoping.md`: the developer-guide half of the original ask needs nothing further
(`docs/user-guide/custom-nodes.md` already covers it); the real gap is a missing **end-user flow-builder guide**,
with a full content inventory (getting started, canvas basics incl. the single-wifi-owner-per-flow rule, flow
lifecycle, debugging/troubleshooting, a 14-entry node reference) and an explicit out-of-scope list.

**Mid-session, Mike raised two more things, both now resolved into the record:**

1. **In-editor node reference** — node summaries should live in the editor itself (property panel or a separate
   tab), not only the external guide. This isn't just a UI ask: it means the node-reference content needs one
   authored source both the editor and the docs site pull from, not two hand-maintained copies. Tracked as its
   own item, `outstanding-items/in-editor-node-reference.md` — **not scoped or designed yet**, real next-session
   candidate if a smaller UI-flavored pick is wanted.
2. **Doc tooling ("readthedocs or something")** — researched and decided the same session:
   **MkDocs + Material theme, hosted on GitHub Pages for now.** Full comparison in
   `documentation-tech-selection.md`. Mike confirmed MkDocs' static output is portable (self-hostable, not tied
   to any one host) before picking GitHub Pages as the starting point — an explicit "for the moment" call, made
   knowingly against the still-open CI-vendor-neutrality question rather than silently deciding it.

`outstanding-items.md`'s docs entry, its `docs-nothing-written.md` detail file, and `decisions.md`'s "Docs /
process" section (now 3 entries in `decisions/documentation-process.md`) all reflect the current state:
**activities 1 (scoping) and 3 (tech selection) are done; only activity 2 (design — structure/format) is still
open.**

## Not in scope for this chat (deliberately)

- Activity 2 (design) itself — deciding one-guide-vs-two, node-reference page structure, and nav layout. Now
  fully unblocked (real content inventory + a real tool already picked), a clean next-session pick.
- Actually writing the end-user guide's content, or the MkDocs project scaffold/CI publish workflow — build work,
  not this session's scoping/tooling-decision job.
- Scoping or designing the in-editor node-reference feature itself.
- Investigating the new "Threading / multicore support" entry Mike added to `mikes-questions-and-points.md` —
  flagged above, not touched.

## Suggested next-session candidates

1. **Documentation, activity 2 (design)** — now has both a content inventory and a chosen tool. Decide structure
   (one guide or two — `custom-nodes.md` already stands alone for node authors), node-reference page split, and
   scaffold the actual MkDocs project (`pip install mkdocs mkdocs-material`, a `mkdocs.yml`, a GitHub Actions
   `gh-deploy` workflow — new CI surface, worth a cross-reference from `ci-vendor-neutrality.md`). Installing the
   pip packages needs a `docs/third-party-licenses.md` entry at install time, per CLAUDE.md's tracking rule.
2. **Backend/auth — start the build.** [P1], design-complete (Python/aiohttp/pyserial; two auth postures; one
   multiplexed WebSocket endpoint) — only code is missing. `backend-auth-overview.md` + its three linked design
   docs are the starting reading, in that order. Bigger, probably its own dedicated session.
3. **In-editor node reference** — real UI work (a `PropertyPanel.vue` section or new tab), needs its own scoping
   pass first (property-panel-vs-tab, and how it sources content given the shared-with-docs requirement).
4. **The WiFi functor/singleton question** (still untriaged) and the new **Threading/multicore** entry — both
   read-and-assess tasks, cheap to fold into whichever session, or do standalone if time is short.

If a smaller, buildable-right-now item is wanted instead: **[P2]** multi-output-port support and **[P2]** delete
node/wire are both real code, no hardware, no design-doc dependency.

## Success criteria (whichever item gets picked)

Same bar as every prior session — see `next-session-picks-briefing-2026-09-07.md` for the full text. Documentation
design/build work counts as "real deliverable" the same way this session's scoping and tooling notes did.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself in a real Terminal, never executed from the sandbox. Suggested commit for this session's changes:

```
git add docs/working-notes/documentation-scoping.md docs/working-notes/documentation-tech-selection.md \
  docs/working-notes/next-session-picks-briefing-2026-09-07b.md docs/working-notes/outstanding-items.md \
  docs/working-notes/outstanding-items/docs-nothing-written.md \
  docs/working-notes/outstanding-items/in-editor-node-reference.md docs/working-notes/decisions.md \
  docs/working-notes/decisions/documentation-process.md docs/working-notes/mikes-questions-and-points.md
git commit -m "Scope end-user docs, decide MkDocs+Material/GitHub Pages, track in-editor node-reference idea, prune resolved items from mikes-questions-and-points.md"
```

Also worth a reminder while in a real Terminal: `rm -f .git/index.lock` if it's reappeared (it did again this
session, on a plain `git status`) — check before it blocks anyone's next git command.
