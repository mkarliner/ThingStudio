# Briefing: Rete.js spike — editor/DAG canvas library evaluation

For the next chat. Read `CLAUDE.md` and `../thingstudio-design-doc.md` in
full before starting, same as always — this is a pointer, not a
replacement for either. Read `../architecture-review-briefing.md` too,
specifically its "Editor/DAG canvas library" entry, for the full
reasoning behind this spike — this file doesn't repeat that detail.

## What kind of session this is

A POC-C-shaped comparison spike, not a build session and not a
commitment to switch anything. Mirrors §15.3's own POC-C methodology —
same representative fake node types, side-by-side against what already
exists — rather than inventing a new evaluation process. The current
Litegraph integration is real, working, and hardware-proven (Connect/
Deploy round-trip, save/load, error highlighting all confirmed hands-on
per `editor-hands-on-briefing.md`). This spike does not touch, replace,
or assume the replacement of any of that. If its results are compelling
enough to warrant an actual migration decision, say so explicitly before
sliding from spike into real replacement work — same rule the original
architecture-review session applied throughout.

## Why (see `architecture-review-briefing.md` for the full reasoning)

Mike's own diagnosis: Litegraph feels too opinionated for what this
project increasingly wants from its canvas — real custom-canvas-code
cost already required for compact node appearance (deferred, scoped) and
for drag-to-splice (recently reclassified higher-priority — see
`mvp-feature-priorities.md`'s 2026-08-15 addendum), plus a palette
drag-and-drop and a separate property-sheet panel neither of which exist
yet. Rete.js was evaluated on paper as a candidate: headless core with
framework-specific renderer plugins (React/Vue/Angular/Svelte/Lit)
instead of a canvas draw loop, MIT licensed, actively maintained (v2.0.6,
June 2026). This session is where that paper evaluation gets checked
hands-on.

## What to actually build and test

Reuse POC-C's exact five fake node types for a direct, apples-to-apples
comparison: inject, function, gpio_out, mqtt_out (publish), debug —
mocked behavior only, no compiler or device involved, matching POC-C's
own scope exactly.

Four specific things to confirm, each with a specific mechanism already
identified during the review as the reason to *expect* a positive
result — verify it, don't assume it holds:

1. **Type-checked wiring rejects an invalid connection mid-drag**, not
   just after the fact. This is the specific property that won Litegraph
   the original POC-C comparison (`LiteGraph.isValidConnection`).
   Confirm Rete's socket-type system does the same rather than a looser
   "connect then validate and rip it back out" pattern — that pattern is
   what specifically lost Drawflow the original comparison, so this is
   the one checkpoint that could genuinely kill the idea if it doesn't
   hold.
2. **Drag-to-splice** via `connection-mastery-plugin` — drop a node onto
   an existing wire, confirm it splices in correctly (the connection
   splits into two, rewired through the dropped node). This is the
   feature that started the whole review.
3. **Palette drag-and-drop** via `dock-plugin` — a draggable node preview
   that instantiates the correct node type at the drop location.
4. **Property sheet separate from the canvas** — build one node type's
   property editing as a genuinely separate panel component (not inline
   widgets on the node body), confirm it reflects the currently-selected
   node's state and edits propagate back correctly.

Also worth recording, since these were flagged as open/unconfirmed during
the review rather than assumed:

- **Real bundle size** across the actual package set needed (core +
  `area-plugin` + `connection-plugin` + a renderer + `dock-plugin` +
  `connection-mastery-plugin`), for direct comparison against Litegraph's
  known ~491KB — no single comparable number exists yet since Rete is
  split across packages.
- **Multi-select support** (native or hand-rolled) — POC-C's original
  bar for Litegraph vs. Drawflow; wasn't the trigger for this spike but
  worth checking for completeness given how badly Drawflow failed it.
- **Whether the multi-output/routing gap is actually Rete's problem or
  Thingstudio's own.** The review suspected `NodeDefinition` having
  exactly one output and `GraphLink.origin_slot` always being `0` is a
  Thingstudio compiler/graph-model limitation, not a Litegraph one —
  confirm by checking whether Rete's socket model natively supports
  multiple named output sockets per node (expected: yes, this is
  standard for node-graph libraries; if so, this closes the question
  definitively instead of leaving it as a suspicion carried over from
  the review).

## Real costs to weigh honestly against the results

- Switching means redoing a working, hardware-proven integration —
  `editor/src/app/nodes.ts`, the save/load round-trip (`editor/src/
  flow-file/`), error highlighting via `node.color`/`node.bgcolor`. None
  of that is broken today; a switch is a rewrite, not a bug fix. This
  spike's job is to find out whether that rewrite is worth it, not to
  talk anyone into it.
- Several real npm packages instead of Litegraph's one vendored file —
  flag-and-approve territory per `CLAUDE.md`'s npm rule, **individually**,
  before any install. Each one gets `npm install --ignore-scripts`, a
  quick sanity check (recent maintenance activity, whether it even has an
  install script), and a `docs/third-party-licenses.md` line once
  approved.
- Keep this spike throwaway/mocked, like POC-C was — no compiler, no
  device, no real `msg` envelope — so it doesn't quietly become de facto
  v1 work before an actual decision gets made.

## Success criteria (mirroring POC-C's own bar)

Mostly qualitative again — does it feel at least as good to build a small
flow here as in the current Litegraph editor — plus the four concrete
technical checkpoints above, plus the honest bundle-size number. The goal
is settling "adopt Rete" or "stay on Litegraph, tackle the four items
individually against its grain" with evidence, the same posture POC-C
itself took toward Litegraph vs. Drawflow, not a guess either way.

## Conventions to keep following (unchanged, see `CLAUDE.md`)

Flag any new npm/Node.js package before installing, individually, with
the recommended `--ignore-scripts` install and a quick sanity check per
package. Update `docs/third-party-licenses.md` in the same change as any
new dependency. Git writes (`add`/`commit`) get handed to Mike as exact
commands for a real Terminal, never run from the sandbox — reads
(`status`/`log`/`diff`) are fine. No direct hardware access needed for
this spike (browser-only, no device involved, matching POC-C's own
scope), but the actual "does it feel good" judgment call is still Mike's,
in his own browser, same as every prior hands-on confirmation.

## Not in scope for this chat

Replacing Litegraph in the real editor. The real compiler, the real `msg`
envelope/type system, any device connection, any persistence beyond the
browser session — same out-of-scope list §15.3 set for POC-C itself.
Also not in scope: the browser-vs-native-app question raised the same
review session — that's an explicitly separate, orthogonal decision (see
`architecture-review-briefing.md`), not entangled with this one.
