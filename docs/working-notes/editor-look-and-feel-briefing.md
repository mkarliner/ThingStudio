# Briefing: poc-rete look-and-feel refinement

For the next chat. Read `CLAUDE.md` in full before starting, same as
always. Also read `pocs/poc-rete/README.md` in full — this file is a
pointer/summary on top of it, not a replacement. Skim
`pocs/poc-c/nodes.js` too (see "Why" below for what specifically to look
at there).

**Correction on this file's own scope, 2026-08-15**: an earlier version of
this briefing was written against the real `editor/` (Litegraph) shell by
mistake — "refining the editor look and feel" was Mike's reaction to
`pocs/poc-rete/`, the Rete.js spike, specifically ("good start, bit
clunky"), not a request to touch the real editor. Rewritten for the
correct target.

## What kind of session this is

Continuing work on an existing throwaway spike (`pocs/poc-rete/`), not a
fresh POC and not real product work. Two real interaction bugs already
got found and fixed hands-on this session (function node's layout squeeze
at height 70; drag-to-splice never firing for a dock-drop) — confirmed
working (inject→function splice tested directly by Mike). What's left is
visual polish: the default Rete classic Vue preset renders plain, generic
node boxes, and Mike's "bit clunky" reaction is most likely pointing at
that rather than at anything broken. **Still not a decision, still not a
migration** — same framing `rete-spike-briefing.md` and
`pocs/poc-rete/README.md`'s own verdict both already state. Making the
spike look better makes the qualitative "does it feel as good as
Litegraph" comparison fairer and more informative; it isn't itself a
reason to adopt Rete.

## Why

`pocs/poc-c/nodes.js` (the original POC-C Litegraph/Drawflow spike) gave
each of the 5 fake node types its own color and a small custom-drawn
indicator: inject dark green (`#2e5c2e`/`#1f3f1f`), function amber
(`#6e5b2e`/`#3f341f`), debug grey (`#555`/`#2b2b2b`), gpio out red
(`#6e3b3b`/`#3f1f1f`) with a live LED dot drawn via `onDrawForeground`,
mqtt out blue (`#3b3b6e`/`#1f1f3f`) with a live "→ topic: value" label.
`pocs/poc-rete/src/nodes.ts` has none of that — every node type renders
identically via Rete's default classic Vue preset, which is a big part of
why it reads as generic/clunky next to poc-c's Litegraph build. Rete's own
customization guide (retejs.org/docs/guides/renderers/vue, "Customization"
section) exists specifically for this: `render.addPreset(Presets.classic
.setup({ customize: { node(context) {...}, socket() {...}, connection()
{...} } }))` lets you swap in your own Vue component per node/socket/
connection type instead of the library defaults. That's the mechanism to
reach for, not fighting the default component's CSS from outside.

## What to actually do

- Give each of the 5 node types (`InjectNode`, `FunctionNode`, `DebugNode`,
  `GpioOutNode`, `MqttPublishNode`) its own color, matching poc-c's palette
  above for a fair side-by-side — a custom node Vue component (or a
  `customize.node(context)` switch keyed on `context.payload.kind`, which
  `nodes.ts` already sets on every node instance) is the natural place for
  this, following the official customization pattern rather than global
  CSS overrides fighting the shipped component.
- gpio out and mqtt out lost their live-value indicators when poc-rete
  dropped Litegraph's per-frame `onExecute` for a hand-rolled `propagate()`
  (see poc-rete's README, "no dataflow engine included") — worth deciding
  whether to wire a visual "last value" indicator back in via that same
  `propagate()` call now that it exists, since the debug sidebar currently
  carries that whole burden alone and poc-c's canvas-level feedback (an
  LED, an inline label) was part of what made it feel responsive.
  Genuinely optional, not a hard requirement — decide based on how much
  it actually closes the "clunky" gap versus the color work above.
- General layout/spacing pass on `App.vue`/`PropertyPanel.vue`/
  `DebugSidebar.vue` — these were built functional-first, not polished;
  compare directly against poc-c's own sidebar/toolbar look if useful.
- Re-check `FunctionNode`'s `160×100` sizing (and the other 4 types' sizes)
  hold up once real per-type styling exists — the fix that resolved the
  squeeze bug was sized against the *plain* default renderer; a custom
  component with different padding/font could need different numbers, so
  verify rather than assume the same values still fit.

## Real costs to weigh honestly

- No new npm package should be needed for this (Vue component
  customization is core `rete-vue-plugin` functionality, already
  installed) — if the session reaches for one anyway, `CLAUDE.md`'s
  flag-and-approve-individually rule still applies, no exception for "just
  a spike."
- **Don't run `npm install` or `npm run dev` directly against
  `pocs/poc-rete/` from the agent sandbox.** This session's own build
  process hit the documented `node_modules` cross-platform corruption
  issue (`CLAUDE.md`) — worked around by installing into a scratch
  directory outside the live-mounted repo and copying only source files
  (`.ts`/`.vue`, never `node_modules`) into `pocs/poc-rete/`. Keep doing it
  that way: scratch-install, verify (`tsc --noEmit`, `vite build`,
  `node verify-checkpoint1.mjs`), copy source only.
- Real-browser drag/visual feel is still Mike's call to make, same as
  every other hands-on confirmation in this project — a sandbox has no
  browser available to check this in personally, only headless/build-level
  verification (which doesn't cover "does it look good").

## Success criteria

Each node type is visually distinguishable at a glance (color, matching
poc-c's palette) instead of five identical grey boxes. `tsc --noEmit` and
a real `vite build` stay clean throughout. Mike's own hands-on read in his
browser is the actual bar — "does this close the clunky gap" — not
something to declare from the diff alone.

## Conventions to keep following (unchanged, see `CLAUDE.md`)

Flag any new npm/Node.js package before installing, individually. Git
writes (`add`/`commit`) get handed to Mike as exact commands for a real
Terminal, never run from the sandbox — reads (`status`/`log`/`diff`) are
fine. Update `docs/third-party-licenses.md` in the same change as
anything newly installed, if it comes to that (unlikely here).

## Not in scope for this chat

Deciding to adopt or drop Rete — that stays exactly where
`pocs/poc-rete/README.md`'s own verdict leaves it. Touching the real
`editor/` (Litegraph) shell at all. New node types, checkpoints, or
compiler/protocol work — this is visual polish on an existing spike, not
new scope.
