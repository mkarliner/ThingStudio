# Briefing: pause for a decisions/assumptions review before more code

For the next chat. Read `CLAUDE.md` and `../thingstudio-design-doc.md` in
full before starting, same as always — this is a pointer, not a
replacement for either. Read `editor-hands-on-briefing.md` too, for what
the live system actually does today; this file doesn't repeat that detail.

## What kind of session this is

Mike's explicit call, made after watching the live system work hands-on
(not mid-feature): before writing more code, review some of the design
doc's initial decisions and assumptions against what's actually been
learned running a real editor against a real device. This is a review/
discussion session, not a build session. Don't reach for the open-items
list (`mvp-feature-priorities.md`'s inspector-polish, compact-node-
appearance, etc.) by default — those are still real and still open, but
picking one up is explicitly *not* the ask here unless the review itself
concludes one needs an immediate fix.

## First thing to do: ask Mike what's actually on his mind

He raised this without naming specific decisions in the message that
triggered this briefing. The candidate list below is this session's own
compilation from re-reading the design doc against what hands-on use
surfaced — a starting point offered *to* the conversation, not a
pre-decided agenda. Ask first; use the list to prompt if useful, not as
a checklist to march through regardless of what he actually meant.

## Why now, concretely

The design doc (written 2026-08-09) made several calls before any live
system existed — some resolved later against POC data (§11), some
explicitly left open pending "real v1 bring-up data" or "once real
payload sizes are measured" (§3, §13) rather than decided blind. This
session was the first real stretch of hands-on use against a live,
working (if still bare-minimum) editor+device round-trip, not just
isolated POC spikes — so some provisional calls now have real evidence
behind them for the first time, and at least one real friction point
surfaced that the design doc's reasoning didn't anticipate. Worth a
deliberate pass rather than letting each surface ad hoc mid-feature.

## Candidate assumptions worth examining (starting points, not a verdict)

- **RP2040/RP2350's RAM floor (§3).** Still explicitly flagged
  "provisional... revisit once v1 bring-up data exists" in the doc
  itself. Every hands-on RAM number that exists (POC-A's 168KB free
  headroom, this session's context/flow/timer work) is ESP32-C3 only —
  nothing on Pico-family hardware yet. §3 already names its own
  fallback (raise the Pico floor to RP2350) if headroom proves tight;
  the open question is really "revisit now, or wait until an RP2040
  board is actually in hand."
- **The implicit "device boots, then editor connects shortly after"
  assumption running through §5/§9/§13's fault-isolation and HELLO
  design.** This session hit a concrete case where the opposite is now
  the common path: a deployed flow persists and keeps running across
  many editor sessions, so "device already running when Connect fires"
  is the normal case, not "device just booted." The HELLO-timing gap
  (device sends it once, at boot, editor-only workaround already
  shipped — see `mvp-feature-priorities.md`'s 2026-08-14 entry) was one
  symptom of this; worth checking whether §9's Ctrl-C-disabled-while-
  listener-owns-the-transport reasoning, or anything else in §5, quietly
  shares the same "fresh boot" mental model.
- **RAM cost of the redeploy-persistent, module-scope state pattern.**
  Timer counters, `_flow_vars`, and now a per-function-node `context`
  dict each are long-lived module-scope objects. Right now all of it is
  in-RAM only (Tier 2's flash-backed store isn't built yet, so a
  redeploy already resets everything by construction — fresh module
  import). No hands-on RAM measurement exists yet for a flow with
  several of these at once on the real 400KB-SRAM floor — every real
  number so far (POC-A) is a 2-coroutine toy program, not representative
  of what a flow with a handful of stateful nodes actually costs.
- **Whether `variable_get`/`variable_set` are still pulling their
  weight now that `function` has direct `context`/`flow` access.**
  Flagged as an explicit open question when context/flow landed
  (`mvp-feature-priorities.md`'s 2026-08-14 addendum: "revisit only if
  that turns out wrong in practice"). Worth an actual call now rather
  than leaving it open indefinitely: keep both as a GUI-convenience path
  alongside the code path (Node-RED's own Change-node/Function-node
  duality), or simplify.
- **The Node-RED visual/interaction fidelity policy just written down
  this session** (`mvp-feature-priorities.md`, same date). Worth
  sanity-checking against the live system rather than leaving it as pure
  theory — does click-to-insert actually feel bad in practice, or was
  that a hypothetical worry that doesn't hold up once you're actually
  using it.
- **CBOR-over-JSON (§13)**, resolved provisionally "revisit once real
  payload sizes are measured." Real §13 messages (HELLO, DEPLOY,
  DEPLOY_ACK, NODE_ERROR) have now actually flowed over a real
  connection this session — worth checking whether that's enough data
  to close this out, or whether it still needs a deliberate look with
  real numbers.

Not on this list because they're already-closed §11 items or
already-tracked open work, not fresh candidates: Litegraph vs. Drawflow,
MicroPython vs. CircuitPython, no-sandboxing for the function node,
single-flow-per-device. Don't relitigate those without a specific new
reason — if hands-on use surfaced real friction with one of them, that's
new information worth naming explicitly, not an excuse to reopen
everything §11 already settled.

## Conventions to keep following (unchanged, see `CLAUDE.md`)

Prompt for commits at natural checkpoints. Flag any new npm/Python
package before installing. Update `docs/third-party-licenses.md` in the
same change as any new dependency. Git writes (`add`/`commit`) get
handed to Mike as exact commands for a real Terminal, never run from the
sandbox — reads (`status`/`log`/`diff`) are fine. No direct hardware or
real-browser access from the sandbox; hands-on confirmation is always
Mike's, reported back.

## Not in scope for this chat

New node types, new editor features, picking up an item from
`mvp-feature-priorities.md`'s open list — unless the review itself
concludes one needs an immediate fix, in which case say so explicitly
before doing it rather than sliding from discussion into a build
silently.
