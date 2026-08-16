# Briefing: planning the Rete migration (and browser-vs-real-app)

For the next chat. Read `CLAUDE.md` in full, and `../thingstudio-design-doc.md`
in full — this reverses one of its resolved §11 decisions, which is exactly
the "architecture change" case CLAUDE.md's own orientation note says to
read the design doc in full for, not skip. Also skim
`docs/working-notes/editor-look-and-feel-briefing.md` and
`pocs/poc-rete/README.md` (the spike's own verdict) — this briefing builds
on both directly.

**Model note:** use Opus for this session. It's a planning/architecture
decision under real tradeoffs (from-scratch vs. migrate, informed by actual
code coupling, not a green-field design), not implementation — the kind of
reasoning-heavy work worth the deeper model. Switch back to Sonnet once
there's a concrete plan and the session moves to writing code.

## What kind of session this is

Planning only — Mike's own framing. The deliverable is a decision and a
scoped plan, not migration code. Two decisions are on the table, and
they're related but not the same decision:

1. **Rete over Litegraph for the real `editor/`.** Mike has decided this —
   it's not open for re-litigation, §11's "resolved 2026-08-11 per POC-C:
   Litegraph.js" gets superseded. What's still open is *how* to get there:
   rebuild `editor/`'s canvas layer from scratch on Rete, or migrate the
   existing Litegraph-coupled code incrementally. See "What to actually do"
   below — there's real evidence in the current codebase bearing on this,
   worth reading before deciding, not a coin flip.
2. **A real (installed) app instead of all-in-browser.** Mentioned
   alongside the Rete decision, genuinely separate, and much less
   specified — what "real app" means concretely (Electron, Tauri, something
   else) isn't stated anywhere yet. This directly touches §4's "browser-
   based... no install" framing and §4/§5's WebSerial-specific transport
   assumption (a native app could use direct serial APIs instead, a
   different technical path with different tradeoffs — no browser
   sandboxing, but installer/packaging/auto-update burden, a cross-platform
   build matrix). **This needs Mike's own steer on what he actually has in
   mind before it can be scoped at all** — don't assume Electron vs. Tauri
   vs. anything else without asking.

## What to actually do

Read before recommending anything:

- `docs/working-notes/mvp-feature-priorities.md` — Tier 0 (compiler, `msg`
  envelope/type system, real wire protocol, fault isolation) is done, with
  a hardware pass on fault isolation. Tier 1 (node set) is partway done:
  software-only nodes done, GPIO/timers and network nodes off-device done
  with hardware passes *pending*, I2C/SPI sensors not started, plus the new
  candidate node types folded in this session (interrupt/pin-change, ADC,
  debounce, UDP/TCP, mDNS, file ops, filter/event compression) awaiting
  reprioritization. This is real, hardware-validated work sitting on top of
  the current Litegraph-coupled canvas layer — the migration's whole cost
  profile depends on how much of it that layer actually touches.
- **The coupling boundary is already checked, not assumed — read this
  before deciding from-scratch vs. migrate:**
  - `editor/src/node-library/*.ts` (inject, function-node, gpio-out,
    gpio-in, pwm-out, timer, http-request, mqtt-*, arithmetic, boolean,
    comparator, variable-get/set, debug, wifi-status) — confirmed
    Litegraph-independent. Pure `NodeDefinition` codegen objects
    (`compiler/node-definition.ts`'s contract), no canvas API touched
    anywhere. Verified by reading `inject.ts` directly, not inferred.
  - `editor/src/compiler/`, `editor/src/protocol/` — same, confirmed
    canvas-independent (`compiler/compile.ts`'s fault-isolation wrapping,
    the real wire protocol, all untouched by canvas library choice).
  - `editor/src/flow-file/flow-file.ts` — explicitly documents itself as
    "deliberately pure and Litegraph-independent" in its own header; the
    canvas-coupled half is named as living in `main.ts`'s `currentSource()`.
  - **The one real, concrete coupling point found:**
    `editor/src/compiler/graph.ts`'s own header says the compiler's input
    shape is modeled directly on `LGraph.serialize()`'s `{nodes, links}`
    output, specifically so "whatever the real canvas integration produces
    later doesn't need translating" — except now it does. This is a real,
    bounded migration cost: either write a Rete-graph → `{nodes,links}`
    adapter (cheaper, keeps the tested compiler input contract unchanged)
    or change `graph.ts`'s accepted shape to something canvas-agnostic
    (touches tested compiler code, bigger but arguably more correct
    long-term). Worth deciding explicitly, not defaulting to one silently.
  - **The actual Litegraph-specific surface:** `editor/src/app/nodes.ts`
    (130 lines — canvas node classes, widgets, colors/sizes, directly
    analogous to what `pocs/poc-rete/src/nodes.ts` +
    `ThingstudioNode.vue` already prototype) and `editor/src/app/main.ts`
    (584 lines — canvas setup/wiring, `new LG.LGraph()`/`LGraphCanvas`,
    plus `currentSource()`'s live-canvas-to-flow-shape glue, plus whatever
    toolbar/property-panel/deploy-button wiring lives there too — read it,
    don't assume it's only canvas setup).
  - This is real evidence that "migrate incrementally" is a genuinely
    smaller job than "from scratch" might sound like — most of the
    hardware-validated Tier 0/1 work is already decoupled from Litegraph.
    Worth confirming this reading holds up (read `main.ts` in full, it
    wasn't fully read putting this briefing together, only grepped for
    `LiteGraph`/`LGraph` references) before treating it as settled.
- `pocs/poc-rete/README.md`'s own verdict, plus this session's follow-on
  work (not yet in that file) — two real, unresolved gaps worth carrying
  into the real migration, not just the visual-polish wins:
  - **Checkpoint 3 (palette drag-and-drop)** — `rete-dock-plugin` was
    removed from the spike (redundant with the left-sidebar palette this
    session added), then drag-and-drop was rebuilt as a hand-rolled native
    HTML5 DnD gesture instead (`PaletteSidebar.vue`/`App.vue`). That
    hand-rolled version is proven to work (tested live in the browser this
    session) but is *this project's own code*, not `rete-dock-plugin`'s
    "official" mechanism — worth knowing which one (if either) the real
    migration should build on.
  - **A real type-compatibility gap, not a rendering bug:** poc-rete's
    `function` node output is `AnySocket`; `gpio_out`'s input is strictly
    `BoolSocket`; `BoolSocket.isCompatibleWith` only accepts
    `instanceof BoolSocket`, so `Any → Bool` connections are rejected by
    checkpoint 1's own validation, correctly, per how the sockets are
    currently defined. The real editor's actual type system (§6: `int`,
    `number`, `bool`, `string`, `bytes`, `any`, with defined coercion rules
    like "an `int` output can feed a `number` input") needs this resolved
    deliberately during migration, not inherited as-is from poc-rete's
    stricter spike sockets.
- Ask Mike directly what "real app" means before scoping it at all (see
  above) — this briefing deliberately doesn't guess.

## Not in scope for this chat

Writing any migration code. Deciding the browser-vs-real-app question
without Mike's input first. Re-opening whether Rete is the right call —
that part is decided; only the *how* is open.

## Real costs to weigh honestly

This reverses a decision that had real evaluation behind it (POC-C's
Litegraph-vs-Drawflow comparison, §11's original resolution) — worth being
plain that adopting Rete isn't free even with the coupling boundary being
narrower than it might sound: `app/nodes.ts` and the canvas-relevant parts
of `app/main.ts` are real, working, hardware-integrated code (deploy flow,
property editing, whatever else `main.ts` turns out to hold), not a spike.
Every one of poc-rete's own checkpoints (mid-drag type rejection,
drag-to-splice, palette drag-and-drop, property panel separation) needs to
actually hold up against the real node set and real deploy flow, not just
the 5 fake node types poc-rete tested against.

## Success criteria

A written decision (from-scratch vs. migrate, with the actual reasoning,
not just a preference) and a scoped task list for the real migration work,
informed by this session's coupling-boundary findings rather than
re-deriving them. The browser-vs-real-app question resolved with Mike's
actual answer, not assumed. Nothing here requires code to be written to be
"done" — the plan is the deliverable.

## Conventions to keep following (unchanged, see `CLAUDE.md`)

Flag any new npm/Node.js package before installing, individually — a real
app shell (Electron/Tauri/whatever) would be a much bigger flag-and-approve
conversation than poc-rete's Rete packages were. Git writes get handed to
Mike as exact commands for a real Terminal, never run from the sandbox.
Update `docs/third-party-licenses.md` and design doc §12 in the same change
as any real dependency decision, not batched up for later.
