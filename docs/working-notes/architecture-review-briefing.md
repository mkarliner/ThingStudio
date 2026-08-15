# Briefing: results of the decisions/assumptions review (2026-08-15)

This file replaces the previous version of itself (git history has the
original pre-session version, if the exact original candidate-list
wording is ever needed) — same session this briefing kicked off, now
carrying its results forward for whatever picks up next. Read `CLAUDE.md`
and `../thingstudio-design-doc.md` in full before starting, same as
always — this is a pointer/summary, not a replacement for either.

## What kind of session this was

Confirmed as a review/discussion session, not a build session, per the
original briefing's framing. One direct file edit was made — a policy
addendum in `mvp-feature-priorities.md`, documentation only, no code —
everything else below is discussion, findings, and open items, not
built. Nothing from `mvp-feature-priorities.md`'s open list was picked
up.

## Resolved / settled this session

- **RP2040/RP2350 RAM floor (§3).** No longer blocked on hardware — Mike
  has both an RP2040 and an RP2350 board in hand now, plus other ESP32
  variants. Desk research first (published MicroPython numbers show
  plain-RP2040 free heap in the 160–224KB range depending on version/
  config, in a similar absolute ballpark to POC-A's 168KB-free-under-load
  number on ESP32-C3 despite RP2040's smaller total RAM — suggesting the
  ESP32 port simply carries more fixed overhead, not that RP2040 is
  obviously worse) narrowed uncertainty but doesn't meet §3's own bar
  ("real v1 bring-up data") since it's not Pico W specifically and
  doesn't include Thingstudio's own runtime. Real resolution: **new
  standing convention** (see below) makes this a routine measurement
  going forward rather than a standalone open question. RP2040 support
  is soft-committed — Mike will drop it without much resistance if
  headroom proves tight, since RP2350 is barely more expensive; the §3
  fallback plan (raise the Pico-family floor to RP2350) was already
  named as acceptable in the design doc itself.
- **`variable_get`/`variable_set` vs. `context`/`flow`.** Reconfirmed
  settled — the 2026-08-14 decision (keep both; variable nodes as GUI
  convenience, `context`/`flow` for direct function-node access) stands,
  nothing's surfaced to trip its own "revisit only if wrong in practice"
  condition.
- **Node-RED visual/interaction fidelity policy — drag-to-splice
  reclassified.** Written up as a dated addendum in
  `mvp-feature-priorities.md` (2026-08-15, in place under the original
  2026-08-14 policy entry). Moved from axis 2 ("case-by-case cost-vs-
  frequency, not urgent") toward axis 1 ("always match") territory: (1)
  the actual cost Mike identified isn't "click-to-insert feels bad," a
  UX-quality question, but "doesn't match Node-RED muscle memory," an
  audience-fit question — which is exactly axis 1's own stated
  justification (§2's target audience is already fluent in Node-RED);
  (2) separately, evaluating Rete.js (below) found an official plugin
  that gives drag-to-splice close to free, lowering the engineering cost
  the original axis-2 placement was reasoned from. Both inputs moved the
  same direction independently. Not scoped as a design or started —
  priority changed, not status.

## Not resolved — genuinely still open, needs real data

- **CBOR-over-JSON (§13).** Cannot be closed out yet, and the earlier
  framing ("real messages have now flowed, is that enough data") turned
  out to be wrong on inspection: everything that's flowed so far (HELLO,
  DEPLOY, NODE_ERROR) ran over POC-A/D's ad hoc text/base64 protocol, not
  the real CBOR-framed §13 protocol, which Tier 0 hasn't built yet. No
  real payload-size data exists. Revisit once Tier 0's real wire protocol
  lands.
- **Module-scope state RAM cost** (timer counters, `_flow_vars`,
  per-function-node `context` dicts). Agreed low a priori risk — small
  dicts/counters, unlikely to matter much even against RP2040's tighter
  floor — but the real unknown (MicroPython's per-object overhead,
  `uasyncio`-churn-driven GC fragmentation under a stateful flow, not raw
  data size) hasn't been measured on any platform. Resolution: fold
  `gc.mem_free()` sampling into the new milestone hardware passes below
  rather than a dedicated spike.
  - **Addendum: no stated maximum-flow-size assumption exists anywhere
    in the design doc** (max node count, max stateful-node count). A RAM
    trend line needs a ceiling to validate against — worth pinning down
    alongside the milestone RAM measurements, not before.

## New candidate assumptions surfaced this session (not on the original list)

- **The boot/connect "fresh boot" mental model — a second, unflagged
  instance found.** The HELLO-timing symptom already has a 2026-08-14
  editor-side fix (soft-gate on absence, hard-block on version
  mismatch); the real fix (an explicit `HELLO_REQUEST` on connect) is
  identified and deliberately deferred, needs a hardware pass. Checking
  further per the original briefing's own question ("does anything else
  in §5/§9 quietly share this model") found: yes — §5's boot-time Ctrl-C
  escape-hatch window is live only for a few seconds after physical
  boot, so it provides **no fallback if the listener wedges later in a
  long-running device's life**, which is now the normal case per this
  session's earlier finding, not the edge case the window was designed
  around. Only physical reflash recovers that today. §13's own wording
  ("announces... on connect") already implied per-connection behavior
  the real implementation (boot-triggered only) doesn't match. Not
  fixed — see the recovery-button idea below, which directly addresses
  this gap.
- **Recovery button/jumper for a wedged listener.** New idea, raised by
  Mike as a response to the gap above. Should be a **runtime-image
  feature, not a node** — same category as §5's existing watchdog, both
  need to survive exactly the failure modes they're a backstop against,
  so neither can depend on a flow having deployed correctly. Effectively
  makes §5's boot-time Ctrl-C window available on demand for the life of
  the device rather than only briefly after physical boot. Concrete
  implementation notes worth keeping for whenever this is scoped:
  MicroPython hard-IRQ handlers can't reliably allocate on the heap, so
  the ISR itself should only set a flag or call `micropython.schedule()`,
  deferring the real work (reuse the already-proven `cancel_running()`
  path, then re-enable whatever §9 currently disables) to the main loop;
  needs a debounce/hold-duration convention (Tasmota/ESPHome-style) so a
  stray press can't kill a running production flow; RP2040/RP2350's
  BOOTSEL is a separate, heavier, silicon-level recovery tier already
  free on that hardware (full-reflash territory, not "get a REPL without
  reflashing") — doesn't replace this, sits below it as a second rung. A
  GPIO input node letting a flow author react to the *same* physical
  button is a legitimate, separate feature (ordinary application I/O) —
  must not be conflated with the recovery mechanism itself, which has to
  stay outside the flow's own lifecycle. Not scoped as a design, not
  started.
- **Editor/DAG canvas library — Litegraph vs. Rete.js, raised by Mike,
  not on the original candidate list.** Underlying worry: Litegraph is
  "too opinionated," and matching more Node-RED editor conventions (not
  just drag-to-splice — a drag-and-drop node palette, property sheets
  separate from the canvas render, "other stuff not thought of yet")
  will mean fighting it repeatedly rather than building custom
  functionality against something more general. Evaluated Rete.js:
  headless core with framework-specific (React/Vue/Angular/Svelte/Lit)
  renderer plugins instead of a canvas draw loop, MIT licensed, actively
  maintained (v2.0.6, June 2026, commits into July). Found real,
  specific hits rather than one: drag-to-splice has an official plugin
  (`connection-mastery-plugin`); the palette-drag-and-drop ask has an
  official plugin (`dock-plugin`); property-sheet-separate-from-canvas
  isn't a plugin at all, it falls out of component-based rendering for
  free (a sibling component reading the same selection state), versus
  Litegraph where the only precedent is the one-off `function` node code
  modal that would need generalizing. The multi-output/routing gap
  originally suspected as a Litegraph limitation is probably actually
  Thingstudio's own compiler/graph-model gap (`NodeDefinition` has one
  output, `GraphLink.origin_slot` is always `0`) — worth confirming
  directly before folding it into the same complaint. Real costs on the
  other side: switching means redoing a working, hardware-proven
  Litegraph integration (`nodes.ts`, save/load, error highlighting via
  `node.color`/`node.bgcolor`); several real npm packages instead of one
  vendored file (flag-and-approve territory per `CLAUDE.md`, each needs
  a `third-party-licenses.md` line); unconfirmed total bundle size across
  the plugin set; unconfirmed whether Rete's socket-type validation
  rejects mid-drag the way Litegraph's `isValidConnection` does, which
  was the specific property that won Litegraph the original POC-C
  comparison. **Not decided.** Floated as worth a real POC-C-shaped
  spike — the same representative node types (inject/function/gpio_out/
  mqtt) built out in Rete and compared side by side against what's
  already working in Litegraph, checking drag-time type rejection,
  `dock-plugin` palette, a real separate property panel, and
  drag-to-splice together. Not started.
- **Browser-only "no install" claim (§4).** Flagged as unusually
  undermotivated relative to how rigorously the rest of the design doc
  argues its calls — asserted as §4's opening line with no argument
  behind it, unlike §5's MicroPython case, §11's Litegraph POC evidence,
  or §3's explicit RP2040 proviso. Mike doesn't recall specifically
  choosing it and would give it up if it makes other things easier.
  Checked current browser support rather than relying on memory: Safari
  has never supported WebSerial and Apple has no stated plans to add it;
  Firefox only gained support in v151, released May 2026. Web
  Bluetooth (the planned v2 transport) is **permanently** Chromium-only
  — both Firefox and Safari have explicitly refused to implement it for
  years on privacy/security grounds, a stated policy position, not a
  lagging gap. POC-B's WASM `mpy-cross` build exists specifically to
  satisfy "no install," and the design doc itself flags it as ongoing CI
  maintenance ("needs rebuilding and testing against each MicroPython
  version bump"), not a one-time cost. A native app (Electron/Tauri
  wrapping the same web UI — orthogonal to the Litegraph/Rete choice
  above, either runs identically in a browser tab or a native window)
  would remove both transport constraints via native serial/BLE
  libraries and let `mpy-cross` run as its real native binary, at the
  cost of packaging/signing/update-mechanism work that doesn't exist
  today. Also worth keeping: §2 already frames the target audience as
  "the same demographic Node-RED itself serves" — but Node-RED itself
  isn't zero-install either (`npm install` plus a local server), so the
  audience-fit argument doesn't actually support browser-only the way it
  might first appear to; if anything the Node-RED community is already
  used to installing something, per Mike. **Explicitly kept separate
  from the editor-library decision** — two independent open decisions,
  not one. Not decided, not started.
- **Editor board-awareness — explicitly medium-term, "not for now."**
  Filter the node palette by target board (an RP2040 PIO node shouldn't
  show on an ESP32 target) and warn about board-specific problematic
  pins (flash SPI pins, ESP32 boot-strapping pins like GPIO0/2/12/15,
  RP2040's QSPI-reserved pins). Connects to §6's already-flagged v2 gap
  (no pin-conflict detection between independently-authored flows) and
  §7's node definition model — each node type's existing JSON editor
  descriptor is the natural place to add board-compatibility and
  pin-hazard fields later, not a new mechanism. Not scoped, not started.
- **Low-memory warning.** Mike's ask, not yet scoped. §13 already
  describes HELLO reporting free flash/RAM "on connect... so the editor
  can warn before a flow is too big for the target" — that intent
  exists in the design doc, but only the version-compatibility half of
  the HELLO/`decideDeploy` pre-flight check is actually wired in
  (2026-08-14); nothing compares free space against flow size yet. A
  separate, ongoing/runtime version (device notices `gc.mem_free()`
  trending low during operation, not just a one-time pre-deploy check)
  would need a threshold — which depends on the max-flow-size assumption
  above being pinned down first — and a wire-protocol message to carry
  it, which depends on the real §13 protocol landing (still open, see
  CBOR-over-JSON above). Not scoped, not started.

## New standing convention, needs a home

**Real hardware pass on at least two different boards at every major
milestone from here on** — Mike's own commitment this session, made
possible by now having RP2040, RP2350, and other ESP32 variants in hand.
This session's only job regarding it was to remember to remind him,
which this briefing now does on the record. Not yet written into
`CLAUDE.md` or `docs/working-notes/validation/mvp-validation-plan.md` —
worth deciding which one owns it next session, since it's the kind of
cross-cutting rule that only reliably survives if it's actually written
down (same reasoning as the commit-prompting and npm-flagging rules
already in `CLAUDE.md`). The module-scope-state RAM sampling above
should ride along with these passes rather than needing its own spike.

## Conventions followed this session (unchanged, see `CLAUDE.md`)

Read `CLAUDE.md`, the design doc, and `editor-hands-on-briefing.md` in
full before starting, per this session's own original briefing. One
direct file edit made (`mvp-feature-priorities.md`'s policy addendum) —
documentation only, no code, so no `tsc`/`npm test` implications. No
`git add`/`git commit` run from the sandbox; if Mike wants this
committed, the command needs to be handed to him for a real Terminal,
per the standing git-lock rule. No hardware or real-browser access
attempted from the sandbox.

## Not in scope for this chat (unchanged from the original briefing)

New node types, new editor features, picking up `mvp-feature-priorities.md`'s
open list — none of that happened, consistent with this being a
review/discussion session throughout.
