# Briefing: palette ordering + multiple panes landed and committed

For the next chat. Read `CLAUDE.md` in full, as always.

**Everything from this session is committed** -- tip is `8b78dca`, working tree clean. Three commits, split docs
from code per this session's own convention: `e2359f3` (multiple-panes feature code), `cba9d80` (palette-ordering
feature code), `8b78dca` (docs: resolve both `outstanding-items/` design files, and this session's own
housekeeping in `outstanding-items.md`). **Mike ran `tsc --noEmit`/`vitest run` plus his own manual browser
smoke test on both features before authorizing the commits ("all good")** -- this is confirmed, not an open
question carried forward (unlike the prior handoff's own top item).

## What landed this session

1. **Palette node-family ordering** (`cba9d80`) -- replaced `PaletteSidebar.vue`'s hardcoded source-then-sink
   `KINDS` array with an explicit numeric `priority` field on both `KindStyle` (built-in nodes) and
   `CustomNodeDescriptor` (custom nodes), controlling order within each existing `group`. `group` itself is
   unchanged -- no finer-grained grouping was added. Docs: `docs/user-guide/custom-nodes.md`. Design fully
   scoped before any code was written -- see `outstanding-items/palette-node-family-ordering.md`, now moved to
   "Resolved" in `outstanding-items.md`.

2. **Multiple panes for one large flow, still one flow** (`e2359f3`) -- the bigger piece. Lets a large flow be
   split visually across tabbed panes (network setup / sensors / actuators, etc.) while staying one canvas
   graph, one compile/deploy unit underneath -- not Node-RED's separate-tabs-are-separate-flows model. Design
   fully scoped through several rounds with Mike before any code was written: tabbed not tiled; cross-pane wires
   deferred to post-MVP (Node-RED's own new link-node pattern is the reference for whenever that's picked back
   up); pane membership is a separate layer (`panes`/`paneOf` in `flow-file.ts`, mirroring that file's own
   existing `layout` precedent -- deliberately kept out of node data, for the same git-diff-hygiene reason
   `layout` itself was split out originally); panes default-named "Flow 01"/"Flow 02"/etc., renamed via
   double-click on the tab label; "+" on the tab bar adds a pane; a tab's "X" removes the pane and deletes all of
   its nodes, no confirmation beyond the browser `confirm()` dialog already used elsewhere in this app. No
   reordering until post-MVP.

   New files: `editor/src/app/rete/panes-store.ts` (reactive pane store, ~207 lines), `editor/src/app/rete/
   PaneTabs.vue` (tab bar UI, ~197 lines). Touched: `flow-file.ts`/`flow-file.test.ts` (format change, full
   backward compatibility for old flow files with no `panes`/`paneOf`), `editor-setup.ts` (node-delete/
   pane-delete upkeep), `ThingstudioNode.vue`/`ThingstudioConnection.vue` (hide pane-inactive nodes/wires),
   `main.ts` (wiring through node-create, save/load, clear-canvas, and console-click-to-navigate), `index.html`
   (tab-bar mount point).

   **One thing worth knowing, found and fixed before Mike ever saw a broken build**: the first approach hid
   pane-inactive nodes with CSS `display:none`. Reading `rete-render-utils`'s actual vendored source
   (`node_modules/rete-render-utils/rete-render-utils.esm.js`) turned up that its `getElementCenter()` -- used
   for every wire/socket endpoint position -- checks `child.offsetParent` and, if null, retries forever via
   `setTimeout(0)` rather than failing. `display:none` elements have a null `offsetParent` by spec, so this
   would have caused an infinite polling loop for every wire connecting two nodes in a hidden pane, for as long
   as that pane stayed closed. Fixed by switching to `visibility: hidden; pointer-events: none;` instead, which
   keeps a normal, measurable layout box while staying invisible and unclickable. Checked this doesn't
   reintroduce a different risk: the app has no drag-rectangle multi-select (only click/ctrl-click), both of
   which `visibility:hidden` correctly excludes from hit-testing per the CSS spec.

   The hard invariant this whole feature had to preserve -- the compiler/save path always sees the *whole* flow
   regardless of which pane is on screen -- holds because `currentSource()`'s `toGraphData()` and
   `extractCanvasSnapshot()` both still read `reteEditor.getNodes()`/`getConnections()` directly, never filtered
   by pane; panes are purely a display-and-bookkeeping layer on top of the same underlying graph.

   Design fully scoped before any code was written -- see `outstanding-items/multi-pane-canvas.md`, now moved to
   "Resolved" in `outstanding-items.md`.

## Also done this session, not a feature

- **`outstanding-items.md` housekeeping**: moved the Palette-ordering and Multiple-panes bullets out of
  "UI / editor" and into "Resolved" now that both are built, tested, and committed (they previously still read
  as "buildable" rather than "done" -- a loose end from the prior session, closed here). Updated the "Current
  handoff doc" pointer to this file, including a note on which of the prior briefing's open items this session
  actually closed (the two orphaned UI-wishlist bullets it flagged as needing Mike's decision) versus which are
  still untouched (see that pointer line for the full list -- inject-click-opens-property-sheet bug, `CLAUDE.md`
  msg/payload convention, router/switch node, TCP send/listen-receive, node-flow-execution docs,
  deploy-runtime-from-editor).

## Open threads carried forward, not touched this session

Nothing new opened by this session's own work, but worth keeping in mind: no automated component-level test
coverage exists for `.vue` files in this project (no `vue-tsc`, no component tests; confirmed by grep this
session), so any future bug in `panes-store.ts` / `PaneTabs.vue` / the hide-inactive-pane logic will only ever be
caught by a real browser smoke test, not `tsc` or `vitest`. Not something to fix reflexively -- just don't trust
a clean `tsc`/`vitest` run alone for changes in this area.

Everything else in `outstanding-items.md` is untouched by this session -- see that file's own "Current handoff
doc" pointer line above for exactly what the prior briefing left open.

## Suggested next-session candidates

Pulled from `outstanding-items.md`'s current priority tags, highest first:

1. **Console-click-to-navigate always recenters the viewport** (untagged but raised 2026-09-13 by Mike, small
   well-scoped annoyance) -- only pan/zoom when the target node isn't already visible in the current viewport.
   ([detail](outstanding-items/console-click-viewport-jump.md))
2. **Context model, Node-RED-style** (P2, unscoped) -- needs a scoping conversation with Mike before it's
   buildable, same as palette-ordering/multi-panes needed this session.
   ([detail](outstanding-items/context-model-node-red-style.md))
3. **Node-status-indicators real-hardware follow-ups** (P2, mostly landed) -- real MicroPython test suite,
   `vitest` re-run against the updated mqtt/wifi codegen, a hardware check of `mqtt_publish`'s connected/
   disconnected reporting, and clear-on-redeploy. ([detail](outstanding-items/node-status-indicators.md))
4. **Deploy the runtime itself from the browser editor** (P3, needs a real design session) --
   ([detail](outstanding-items/deploy-runtime-from-editor.md))
5. **Board-specific node collections** (P3, unscoped) -- reuse the existing `group` field, plus a target-board
   selector on the canvas that filters the palette. ([detail](outstanding-items/board-specific-node-collections.md))

Not picked for this shortlist but still live: RP2350 bring-up continuation (P5, gated on Mike's own timeline),
WiFi provisioning/captive portal, low-memory warning (P4), general UI wishlist remainder (P5), and everything
still carried forward from the prior briefing (see this file's "Also done this session" section above).

## Not in scope for this chat

- RP2350 wiring/bring-up continuation -- parked on Mike's own timeline.
- Cross-pane wires -- post-MVP, deliberately deferred, see the multi-pane-canvas detail file.
- Pane reordering -- post-MVP, same file.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself, never executed from the sandbox. Read-only git commands (`status`/`log`/`diff`) are fine to run
directly -- but even those can leave a stale `.git/index.lock` behind (confirmed again this session -- a
read-only `git status` left one that the sandbox itself then couldn't remove, `Operation not permitted`) --
always tell Mike to `rm -f .git/index.lock` before any commit attempt, regardless of what ran before it. Working
tree is clean as of this writing; nothing to commit at session start.
