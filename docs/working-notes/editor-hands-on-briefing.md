# Briefing: editor hands-on continues -- timer, error attribution, save/load landed

For the next chat. Read `CLAUDE.md` and `../thingstudio-design-doc.md` in
full before starting — this is a pointer/summary, not a replacement for
either. As of commit `2469c80`. This file replaces the previous version
of itself (git history has that one, if the earlier hardware-bring-up
detail is ever needed) — same ongoing hands-on session, not a new topic.

## Where things stand

The previous version of this briefing left one open item: no Connect/
Deploy round-trip confirmed against real hardware. This session closed
that and kept going interactively — same mode as before, Mike testing in
his own browser against his flashed board, reporting back what he sees.

## Confirmed working, hands-on, this session (don't rebuild or re-verify)

- **Connect/Deploy round-trip**: inject → gpio_out (GPIO12, onboard LED)
  deployed and ran correctly, including fan-out (gpio_out + debug from one
  inject) and redeploy over an already-running flow (changed inject
  payload true→false, redeployed, LED changed — confirms listener.py's
  `cancel_running()` path works, not just first-deploy-ever).
- **function node**: real MicroPython (boolean invert) round-tripped
  correctly on-device.
- **timer node** (new this session): a canvas node type for
  `thingstudio/timer` — the node type already existed in the compiler
  registry and was HIL-validated, it just never had a canvas class or
  toolbar button before. Added to `editor/src/app/nodes.ts` +
  `index.html`. Answers a real question Mike hit hands-on: "why doesn't
  inject → invert → gpio_out flash the LED" — `inject` rebuilds the same
  literal payload from scratch every tick (no memory between ticks);
  `timer` keeps a real incrementing counter, a `global`-scoped variable
  per node *instance* (`ctx.uniqueName("timer_count")` guarantees no
  collision between multiple timer nodes on one canvas — confirmed by
  tracing the actual dedup logic, not assumed).
- **Compile/runtime error node attribution** (new this session): two
  distinct paths, both flag the offending node red on the canvas —
  1. `mpy-cross` `SyntaxError` (compile-time): `compile.ts`'s
     `CompileResult` now also returns `nodeLineRanges`
     (`{nodeId,startLine,endLine}[]`, computed directly from the same
     text it emits, not re-derived from it afterward — see the type's own
     doc comment). `main.ts` parses `line N` out of `mpy-cross`'s stderr
     and highlights the matching node.
  2. `NODE_ERROR` (runtime, §5 fault isolation): the easier and, in
     practice, more common case — the device already reports the exact
     node ID, no line-number math needed. This is the one actually hit in
     testing (`msg22` — a typo referencing an undefined name — is
     syntactically valid Python, so `mpy-cross` never rejects it; it only
     fails once executed on-device).
  Both confirmed hands-on. Node highlight color is cached/restored per
  node (`node._thingstudioDefaultColor`) and cleared at the start of
  every Deploy attempt so a stale red doesn't linger.
- **Flow save/load** (new this session): `editor/src/flow-file/` — the
  *real* git-friendly format from design doc §6 (`nodes`/`edges` split
  from `layout`, deterministic serialization), not a placeholder cut
  down to "just wire up `graph.serialize()`". File System Access API
  with download/upload fallback (`file-io.ts`). Loader verified against
  the actual vendored Litegraph source before writing (not guessed): a
  node's own `configure({properties, pos, size})` syncs properties,
  widget display, and position/size together in one call;
  `LGraphNode.prototype.connect()` takes a raw numeric target node ID
  directly. An unregistered node type on load is reported and skipped
  rather than aborting the whole file (fault-handling priority applied to
  file I/O). Confirmed hands-on: save/open round-trip reconstructs
  nodes/wires/positions correctly, re-saving an unchanged flow is
  byte-identical (the actual git-diff requirement), `npm test` green.

## Two real things hit and fixed/worked around this session — don't rediscover

1. **Litegraph's file-picker `accept` filter doesn't reliably match
   compound/multi-dot extensions.** `file-io.ts` originally filtered on
   `.flow.json`; Chromium's File System Access API didn't match it,
   so *every* file — including one just saved with that exact name —
   showed up greyed out/unselectable in the open dialog. Fixed: filter on
   a single plain extension (`.json`) instead. The saved filename itself
   can still be `flow.flow.json` as a naming convention — the OS/browser
   extension check only looks at whatever follows the *last* dot,
   regardless of what precedes it.
2. **Git writes (`add`/`commit`) from this agent's own Linux sandbox
   against the live-mounted repo routinely leave a stale
   `.git/index.lock` or `.git/HEAD.lock` behind** — same root cause as
   the earlier `node_modules` cross-platform bug (the sandbox can't
   delete files it creates on the shared mount, `Operation not permitted`
   on unlink). Cost real back-and-forth before the pattern was
   recognized. Now written into `CLAUDE.md` itself, not just a working
   note, since it's a standing operational rule same weight as the
   npm-install-script rule: reads (`status`/`log`/`diff`) from the
   sandbox are fine; `add`/`commit` get handed to Mike as exact commands
   to run in a real Terminal, not run from the sandbox at all.

## What's NOT yet done / open — pick up here

- **HELLO/version pre-flight gate** (`version.ts` exists, still unused) —
  unchanged from the original bare-minimum scope cut, still not wired in.
- **Inspector polish beyond error highlighting** — the two error-
  attribution paths above cover *some* of what the original briefing
  called "any inspector polish beyond a plain scrolling console," but
  not all of it (no live `VALUE_STREAM` display, no structured per-node
  status beyond "currently red or not").
- **Node-RED-style compact node appearance** (fixed-height pill shape,
  icon + label, config moved to a shared panel instead of inline
  widgets) — raised, scoped (difficulty assessed against the vendored
  Litegraph's actual `ROUND_SHAPE`/`onDrawForeground` API), deferred as
  cosmetic. Full writeup: `mvp-feature-priorities.md`'s "Real editor
  shell" entry, 2026-08-14 dated notes. Not started.
- **Node-RED-style `context` for state access** — the real fix for the
  flashing-LED case above, more general than the `timer` workaround:
  `context`/`flow` `get`/`set` objects exposed directly inside a
  `function` node's own code, rather than one-off state baked into
  individual node types. Not starting from nothing — `variable_get`/
  `variable_set` already implement almost exactly Node-RED's *flow*
  scope (a shared in-RAM dict keyed by name); the gap is node-private
  scope and giving `function`'s generated code direct access to either,
  which today only the dedicated variable nodes have. Full writeup,
  including the API-shape open questions: `mvp-feature-priorities.md`'s
  "stateful nodes and cross-message synchronization" entry, 2026-08-14
  addendum. Deliberately kept separate from that entry's harder
  join/synchronization half (buffering, timeouts, N-way waits) — plain
  context get/set needs none of that. Not started.
- ~~**Untried hands-on**: a real repeat-interval `inject`.~~ **Confirmed
  hands-on, later session (2026-08-14 continuation):** `inject` with
  `repeat: "1s"` deployed and fired on its own, no redeploy needed per
  tick — the `repeatMs > 0` branch (compiler wraps it in
  `while True: ... await asyncio.sleep_ms(...)`), previously only
  exercised off-device. Distinct from the flashing-LED `context` case
  above, which used `manual` repeat and toggled via redeploy, not an
  on-device timer loop — worth being precise about since it's an easy
  mix-up (confirmed by asking directly rather than assuming). `5s`/`30s`
  not separately re-tried — same code path, same `REPEAT_MS` table
  (`inject.ts`), no reason to expect a different result. Still untried:
  disconnect mid-flow, reconnect behavior, and anything I2C/SPI (still
  gated on hardware availability, unchanged from earlier briefings).
- **Three medium-term infra needs**, raised out of sequence, not scoped
  as designs yet: static site for editor hosting, a documentation site,
  and a Tasmota-style runtime install page (which turns out to need
  `device-runtime` packaged as a single flashable image first — that
  packaging question isn't scoped anywhere either). Full writeup: new
  `docs/working-notes/deployment-and-distribution-notes.md`.

## Conventions to keep following (unchanged, don't relitigate)

- `CLAUDE.md`: prompt for commits at natural checkpoints — this session
  did (3 commits: the hardware round-trip proof, then timer+error-
  attribution+save-load combined, then the CLAUDE.md git-lock
  documentation itself). Flag any new npm/Python package before
  installing (none installed this session). Update
  `docs/third-party-licenses.md` in the same change as any new
  dependency — not needed this session, `flow-file/` and the timer node
  use only existing vendored/registry code, nothing new to track.
- `tsc --noEmit` and the full test suite green before every commit —
  confirmed both, every change this session (`tsc --noEmit` run from the
  sandbox after each edit; `npm test` run by Mike, since `vitest` touches
  the same vite/esbuild pipeline the sandbox shouldn't run against a
  live-mounted `node_modules`, same reasoning as the original
  `node_modules` bug).
- No direct hardware or real-browser access from an agent sandbox — every
  hands-on confirmation this session (hardware round-trip, save/load
  round-trip, the LED-flash debugging) was Mike testing in his own
  browser/hardware and reporting back, same as always.
- Git writes from the sandbox: hand Mike the exact command now, per the
  new `CLAUDE.md` section — don't attempt `git commit` from the sandbox
  even if the immediate lock issue seems already cleared, since the
  failure mode is often a leftover file from an *earlier* operation, not
  necessarily the current one.

## Not in scope for this chat (carried forward, unchanged)

- New node types (I2C/SPI sensors — still gated on hardware availability).
- Tier 2 (live value streaming/persistence) and the rest of Tier 3 beyond
  what landed this session (HELLO/version gate, deeper inspector polish).
- Node-RED-style compact node appearance — scoped, deferred, see above.
