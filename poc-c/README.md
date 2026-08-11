# POC-C: node/wire canvas feel spike (Litegraph.js vs Drawflow)

Tests the claim in design doc §15.3: does a node/wire dataflow canvas feel good
to author in for this audience, and — the concrete technical checkpoint —
does Litegraph.js or Drawflow integrate cleanly enough to settle §11's open
editor-library question.

Both are throwaway integrations: 5 fake node types (inject, function,
gpio out, mqtt out, debug), placeholder behavior only, no compiler, no real
`msg` envelope, no device, no persistence beyond the browser session.

**Files**

- `index.html`, `app.js`, `nodes.js`, `litegraph.min.js`, `litegraph.css` — the
  Litegraph.js build.
- `drawflow/index.html`, `drawflow/app.js`, `drawflow/drawflow.min.js`,
  `drawflow/drawflow.min.css` — the Drawflow build, same 5 node types and
  mocks, for a direct side-by-side.

Both vendored libraries are official MIT-licensed npm builds, pinned exact
version, fetched with `npm pack --ignore-scripts` and hash-verified against
the registry's published `dist.shasum` before being copied in (no build step,
no `package.json`, no npm dependency at runtime — plain `<script src>`).

## Running

Both are static pages — open `index.html` or `drawflow/index.html` directly
in Chrome/Edge/Firefox. No server needed (unlike POC-A, neither uses
WebSerial). Toolbar has "+" buttons per node type, "Load example flow"
(wires inject → function → gpio out / mqtt out / debug), and "Clear canvas".

## What's the same in both builds

- Same 5 node types, same properties, same mocked type contract: `gpio out`'s
  input is deliberately typed `bool`-only (mirrors §6's real port-type
  contract), everything else is generic (`*`/any).
- Same debug sidebar (mirrors Node-RED's debug tab).
- Same "edit code…" modal for the function node.
- Same example flow layout and firing behavior.

## Technical comparison

| | Litegraph.js 0.7.18 | Drawflow 0.0.60 |
|---|---|---|
| Vendored bundle size | 491 KB (`litegraph.min.js`) | 46 KB (`drawflow.min.js`) — ~10x smaller |
| Runtime npm dependencies | 0 | 0 |
| Node rendering | Single `<canvas>`, nodes drawn via `onDrawForeground` + a fixed widget set (`combo`/`text`/`number`/`toggle`/`button` — all single-line) | Real DOM elements per node, arbitrary HTML body with `df-*` two-way-bound attributes |
| Port/payload type checking | Native — `LiteGraph.isValidConnection()` runs *during the drag*; a mismatched wire literally can't be dropped | None built in. Had to hand-write a type registry (`PORT_TYPES`) plus a `connectionCreated` handler that lets the connection form, checks it, and calls `removeSingleConnection()` if it's invalid — a "flash then reject" UX rather than "can't drop it" |
| Execution / live values | Native — `graph.start()` + `onExecute`/`getInputData`/`setOutputData` run every frame; wiring the mock GPIO LED, MQTT log, and debug sidebar up to "live" propagation was ~free | None — Drawflow is editor-only. Had to hand-write `propagate()`/`receive()` to walk `editor.export()` and push a value through connected nodes by hand on every inject fire |
| Multi-select | Native — shift/ctrl-click and box-select (`dragging_rectangle`) both work out of the box; confirmed working after fixing a config mistake on our end (`canvas.multi_select = true` made plain clicks additive — removed, see git history) | **Not present.** `dist/drawflow.min.js` has no `shiftKey` handling anywhere and only a *singular* `node_selected` field — no selected-nodes collection to build multi-select on top of. Confirmed via headless test (`editor.node_selected` stays a lone id, never a set). Would need to be built from scratch: an owned box-select rectangle, shift/ctrl-click accumulation, group drag |
| Zoom / pan | Native (scroll = zoom, drag = pan) | Native (ctrl+wheel = zoom, drag = pan, per its own README) |
| Node property editing | Single-line widgets only; the function node's multi-line code needed a custom HTML modal (same modal built for both variants here) | Arbitrary HTML per node body — multi-line `<textarea>` could in principle live directly in the node itself, no modal required (this POC still used the same modal for a fair side-by-side, but Drawflow doesn't force that) |

## Verdict

Litegraph needed **zero custom infrastructure** to get type-checked wiring,
live value propagation, and multi-select — all three are core library
features whose object model (`LGraphNode` subclasses with `onExecute` /
`onDrawForeground` / `addWidget`) maps directly onto Thingstudio's actual
node/wire/live-value/typed-payload design (§5, §6). Drawflow needed a
hand-rolled type registry, a hand-rolled connection guard, and a hand-rolled
mini dataflow-propagation engine to reach feature parity on the first two —
and multi-select isn't reachable at all without building real editor
infrastructure Drawflow doesn't provide a hook for.

Against §15.3's literal technical checkpoint — "does \[the library\]
integrate cleanly enough for this node model without a large amount of
custom canvas code" — the answer is **Litegraph, clearly**, on the
evidence gathered here. Drawflow's much smaller bundle and its
plain-DOM/HTML node bodies (nicer default property-editing ergonomics, no
widget system to learn) are real, worth naming, but they don't offset having
to build a type system, an execution engine, and multi-select by hand.

This is a technical read, not the qualitative "does it feel good to build a
flow here" half of §15.3's success criteria — that's inherently a hands-on
judgment call, not something this writeup can settle. Worth trying both
yourself before treating the library choice as fully locked.

## Results (2026-08-11)

Both builds verified headlessly (Chrome extension in this environment
couldn't open local `file://` pages, so verification ran the actual library
code directly — Litegraph's core in plain Node.js, Drawflow's in jsdom —
rather than through pixel-level browser automation): all 5 node types place
and construct without error in both; the example flow wires end-to-end in
both; the mocked type-mismatch case (switching `inject` to `string` and
wiring into `gpio out`'s `bool`-only input) is correctly rejected in both,
though by materially different mechanisms (see table above); mocked
propagation reaches the GPIO LED, MQTT log, and debug sidebar in both.
Litegraph's multi-select was confirmed working after a real bug fix (see
above); Drawflow's absence of any multi-select primitive was confirmed by
source inspection and a headless check rather than assumed.
