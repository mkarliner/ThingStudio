# Briefing: Tier 1 node candidates — prioritization

For the next chat. Read `CLAUDE.md` in full, as always. As of commit
`2787fde`.

## What kind of session this is

Scoping/prioritization, not implementation — no code changes expected.
Same relationship `wire-type-system-scoping.md` had to
`wire-type-system-implementation-briefing.md`: this session should
produce a decision-complete note a later session can implement against
without re-litigating, not code itself. Sonnet is fine for this.

## Where this comes from

Mike raised a list of candidate node types during a 2026-08-16 review
(`docs/working-notes/mikes-questions-and-points.md`, the whole file is
his own raw notes-to-discuss across several unrelated topics — read the
"# Nodes - to be prioritised" section specifically, but see "Not in
scope" below for why the rest of that file isn't this session's job).
`docs/working-notes/mvp-feature-priorities.md`'s Tier 1 item 5 already
folded that list in, verbatim close to Mike's own wording, but explicitly
did **not** do the actual prioritization work — quoting its own words:

> New candidates, folded in from Mike's 2026-08-16 review... deliberately
> not sequenced within this tier yet — reprioritize as a whole once these
> are weighed against items 1–4 above, not slotted in ad hoc: interrupt/
> pin-change (GPIO edge-triggered events, distinct from item 2's
> poll-driven `gpio_in`), ADC (analog read — check whether this is
> genuinely separate from `gpio_in` or the same node with a mode flag
> before treating it as new surface), debounce, UDP/TCP (beyond the HTTP
> request node item 4 already has), mDNS (device/service discovery), file
> ops (flash filesystem access from a flow), filter/event compression
> (rate-limiting or change-only forwarding on a wire). Not yet checked
> against §6's node category list or against whether each is a new node
> type versus a property on an existing one — that review is part of the
> reprioritization this item is waiting on, not done here.

**That reprioritization is this session's job.** Tier 1 items 1–4 (the
original v1 node set — software-only, GPIO/timers, I2C/SPI sensors,
network) are done or off-device-verified; see
`docs/working-notes/tier1-node-set-briefing.md` and
`tier1-sensors-network-briefing.md` for that history if useful context,
but don't re-derive it — this session is specifically about item 5's
unsequenced candidate list.

## Reading list before starting

- `docs/thingstudio-design-doc.md` §6 (node categories, the already-decided
  v1 list) and §10 (phased roadmap) — targeted read is fine, the relevant
  passages are quoted below where it matters.
- `docs/working-notes/mvp-feature-priorities.md` in full — Tier 1 item 5
  (quoted above) is the direct target, but the whole tiered structure
  matters for judging where a candidate should slot in.
- `docs/working-notes/mikes-questions-and-points.md`'s "# Nodes - to be
  prioritised" section — the raw source list, in Mike's own words. Notice
  it doesn't map 1:1 onto item 5's wording above (see "HTTP in/out" below)
  — reconcile the two, don't just treat item 5 as a complete paraphrase.
- `docs/working-notes/node-definition-model.md` — the node-authoring
  contract. Needed to judge, per-candidate, what it actually costs to add
  as a genuinely new node type (a new `NodeDefinition`, ports, a codegen
  hook, a registry entry, an editor-side class) versus a property/mode
  flag on an existing one.

## The task

For each candidate — interrupt/pin-change, ADC, debounce, UDP/TCP, mDNS,
file ops, filter/event compression, plus HTTP in/out (see below) — decide
three things, and record the reasoning, not just the answer:

1. **New node type, or a property/mode on an existing one?** The
   feature-priorities note already names the concrete example: is ADC
   genuinely separate from `gpio_in`, or the same node with a mode flag?
   The same question applies to interrupt/pin-change against `gpio_in`'s
   existing poll-driven model, and arguably debounce as a property on
   whichever GPIO-reading node it modifies rather than its own node type.
2. **Does it fit inside design doc §6's already-decided v1 node category
   list, or does it need a §6 amendment?** §6's actual v1 list (worth
   rereading directly, not from memory) is: "GPIO in/out and PWM,
   timers/intervals, boolean and arithmetic logic, comparators/thresholds,
   I2C/SPI peripheral nodes..., simple state (variable get/set), WiFi
   status and basic HTTP request, and MQTT publish/subscribe." None of
   this session's candidates are literally on that list — MQTT itself sets
   the precedent for "promoted to a firm v1 node" needing its own stated
   reasoning in §6, not a silent addition. Decide, per candidate, whether
   it's a natural extension of an existing category (interrupt/pin-change
   as GPIO), a new category needing the same kind of explicit §6
   reasoning MQTT got, or out of scope for v1 entirely.
3. **Rough priority** — pull into v1 (and roughly where, relative to the
   now-done items 1–4), defer to v2/v3, or reject. Doesn't need to be
   more precise than that; item 5's own list didn't ask for effort
   estimates, just a decided order.

## Worth flagging explicitly, not resolving silently

**"HTTP in/out"** (`mikes-questions-and-points.md`'s own phrase) is not
just an unsequenced candidate the way the rest of this list is — "HTTP
in" (an inbound, on-device HTTP server) directly overlaps with something
§6 *already explicitly defers past v1*, worth quoting exactly:

> a self-hosted mini dashboard, gauge/switch/chart served from the
> device's own HTTP stack (needs an on-device HTTP server and a new
> UI-node category, both additive to the node-category and native-module
> extensibility model in §7 rather than requiring rework — deferred
> because it's a genuinely larger chunk of work than the rest of this
> list)

Item 5's own wording only names "UDP/TCP (beyond the HTTP request node
item 4 already has)" — it doesn't separately call out "HTTP in" the way
Mike's raw note does, so this is a real gap between the two documents,
not just a paraphrase. Don't fold "HTTP in" into this session's
prioritization pass as if it's the same size as debounce or mDNS. Either
confirm with Mike whether he means something narrower (e.g. a small
inbound webhook-receiver node — reasonably scoped, distinct from serving
a UI) or treat reversing §6's dashboard deferral as its own explicit
decision this session should raise, not quietly absorb.

## Also worth noting, not this session's job

- **The I2C stuck-device fault-handling question** (`mvp-feature-
  priorities.md` Tier 1 item 3, also present in `mikes-questions-and-
  points.md`'s node list) is a different kind of question — a
  fault-handling gap on a node category *already* scoped for v1, not a
  "should this exist in v1 at all" call. Already flagged as "resolve
  while building the first I2C sensor node, not after," per CLAUDE.md's
  fault-handling priority. Don't fold it into this session's
  prioritization pass; it's tracked separately and doesn't block on this
  decision.
- **Security surface, one-line awareness only.** Several candidates here
  — UDP/TCP, mDNS, file ops especially — touch network/filesystem
  exposure directly. `mikes-questions-and-points.md` has its own separate
  "# Security" section (board-transport password) that's a related but
  distinct concern, its own future session per the menu Mike picked from
  to start this one. Not this session's job to resolve, but whatever this
  session produces should say a sentence about attack-surface impact per
  candidate where it's non-trivial (file ops especially — arbitrary flash
  read/write from a flow is a real capability, not a small addition),
  rather than silently scoping it in as if it were as safe as, say,
  debounce.
- **Everything else in `mikes-questions-and-points.md`** (Security, Port
  mapping [now tracked separately —
  `mvp-feature-priorities.md`'s 2026-08-17 addendum under "Explicitly
  still out of v1"], Documentation, CI, App Platform) — each gets its own
  session, not this one.

## Deliverable

A decision-complete working note, or an update to
`mvp-feature-priorities.md`'s Tier 1 item 5 itself with the actual
resolved order and reasoning — whichever shape fits better once the real
decisions are in hand is a judgment call for that session to make, not
pre-decided here. If a new node category needs a §6 amendment (per point
2 above), that's a design-doc edit, not just a working-note entry — don't
skip it if it's actually warranted.

## Not in scope for this chat

- Actually implementing any of these node types — a future session, once
  this scoping is decision-complete, same relationship
  `wire-type-system-scoping.md` had to its own implementation session.
- The I2C stuck-device fault-handling design itself.
- Everything else in `mikes-questions-and-points.md` outside the node
  list.

## Stop conditions / real judgment calls

- HTTP in/out's overlap with §6's dashboard deferral — don't resolve
  silently either direction (don't fold it in as small, don't drop it
  without asking). Raise it.
- Any candidate that turns out to need a real §9 security-perimeter
  change (not just "a new node exists") — flag for Mike's explicit call
  rather than assuming "just add the node."

## Git

Same standing rule as every other session: git writes (`add`/`commit`) go
to Mike as exact commands to run himself in a real Terminal, not run from
the sandbox. Read-only git commands are fine.
