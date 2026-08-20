# Briefing: interrupt/pin-change node — implementation

> **Status: fully resolved as of 2026-08-19 — see
> `docs/working-notes/outstanding-items.md`.** The interrupt node, event-
> driven source codegen, debounce, and `gpio_in` removal all landed and
> were hardware-confirmed (`git log`: "Add interrupt node ... remove
> gpio_in"). Kept for historical reference, not active reading.

For the next chat. Read `CLAUDE.md` in full, as always — it gained a new
section this session ("No premature optimization, but don't paint into an
architectural dead end") that's directly relevant to how debounce and the
TCP connection cache (not this session's job, see below) got scoped.

**Check `git log` before assuming anything below is committed.** This
session's resolution was written to disk but handed to Mike as an
uncommitted diff (sandbox can't write git objects on the live-mounted
repo, per `CLAUDE.md`'s standing note) — commit message starts "Resolve
Tier 1 item 5: node candidate prioritization". If it's not in the log yet,
the content is still there on disk, just read it as an uncommitted
working-tree state rather than assuming a clean `git diff`.

Then read `docs/working-notes/mvp-feature-priorities.md`'s Tier 1 item 5
**in full — decision-complete as of 2026-08-17, this session implements
against it, doesn't re-derive it.** `docs/thingstudio-design-doc.md` §6's
two 2026-08-17 addenda (right after the node-categories paragraph and
after the deferred-features paragraph) are the design-level version of the
same decisions — targeted read is fine, item 5's working-note entry has
the fuller reasoning trail. `docs/working-notes/node-definition-model.md`
and `editor/src/compiler/node-definition.ts` for the current
node-authoring contract (the `source`/`transform`/`sink` three-pattern
split, `SourceCodegenResult`'s `repeatMs` shape, how `runtime.spawn()`
already wraps every source node's coroutine in the fault boundary).

## What kind of session this is

Implementation, the first real code against item 5's resolution. **Scoped
deliberately to just interrupt/pin-change + its debounce property +
removing `gpio_in`** — not all of item 5. Filter/event-compression and the
four UDP/TCP nodes are real, separately-sized chunks of work in their own
right (the UDP/TCP batch especially — `asyncio.start_server`, a lazy-expiry
connection cache, a `maxConnections` bound — is arguably a bigger session
than this one on its own). Splitting this way rather than attempting all of
item 5 in one chat is a judgment call, made explicitly rather than
assumed — matches how items 1–4 originally split across
`tier1-node-set-briefing.md` and `tier1-sensors-network-briefing.md` rather
than landing as one session.

This is genuinely new technical territory for the project, not just
"another node like the last several": it's the first node needing a
different source-coroutine shape (wait-on-event, not poll-or-sleep), and
the first new vendored dependency since `mqtt_as`. Take the model choice
seriously — Sonnet is probably fine since the design work happened in this
session's own conversation, not left for the implementer to invent, but
the hard-IRQ-to-asyncio boundary is exactly the kind of correctness-matters
code `CLAUDE.md`'s fault-handling priority is about, not a place to rush.

## What to actually do

1. **Vendor Peter Hinch's `ThreadSafeEvent`** from
   `peterhinch/micropython-async` (MIT). Follow `mqtt_as`'s own vendoring
   rigor as the template (`device-runtime/src/vendor/mqtt_as/README.md`):
   source/version pin, SHA-256 of the vendored file, an honest caveat about
   how it was verified (not assumed byte-identical without saying how).
   Update `docs/third-party-licenses.md` in the same change, per
   `CLAUDE.md`'s tracking rule — not batched for later.
2. **A new node-definition shape for event-driven sources.** `repeatMs`'s
   contract (0 = run once, N = sleep N ms then repeat) doesn't fit "wait
   until an IRQ fires" at all. This session designs and names that shape
   for real — `node-definition-model.md`'s three codegen patterns are the
   reference point, but this is a genuine fourth one, not a variant of an
   existing one forced to fit. Every `source`-kind node already gets its
   own `runtime.spawn()`-wrapped coroutine automatically (confirmed against
   `compile.ts`/`runtime.py` in the scoping session) — the gap is only in
   what that coroutine's body does, not in spawn/task-registration
   machinery, which needs no changes.
3. **`editor/src/node-library/interrupt.ts`** (naming TBD) — new
   `NodeDefinition`, `kind: "source"`. Properties: `pin` (validated 0–39,
   same bound as the existing GPIO nodes), edge-trigger mode
   (rising/falling/both — `machine.Pin.irq()`'s `trigger` flag), and
   `debounce` (bool + ms). Debounce is the **cooldown algorithm** —
   ignore an edge within N ms of the last *accepted* one — deliberately
   the cheap version over settle-and-confirm, decided this session per
   `CLAUDE.md`'s new premature-optimization principle; reuse
   `timer.ts`'s per-instance module-level state pattern
   (`ctx.uniqueName` + `global`) rather than inventing a new one. Codegen:
   `machine.Pin.irq(handler, trigger=...)` where `handler` does the
   minimum safe thing in hard-IRQ context (signal the `ThreadSafeEvent`),
   paired with the spawned coroutine that awaits it and builds/emits
   `msg`. Getting the actual hard-IRQ→asyncio handoff right is the
   load-bearing part of this whole node — treat it that way.
4. **Remove `editor/src/node-library/gpio-in.ts` and its `registry.ts`
   entry.** A real deletion of shipped code, not a soft deprecation flag —
   `gpio_in` already landed (Tier 1 item 2, 2026-08-13/14) and is
   architecturally redundant with `timer` + `function` once ADC's
   equivalent redundancy was confirmed this session (see item 5's
   "Confirmed not v1 node types at all" entry). Check
   `editor/test/node-gpio-in.test.ts` too — delete or repurpose once the
   new node's actual shape is known. Grep the rest of the repo for
   `gpio_in`/`gpioInNode` before calling this done; leave historical
   mentions in dated working notes/validation results alone, those are
   records, not live code pointers.

## Worth flagging explicitly, not resolving silently

- **`ThreadSafeEvent`'s actual API and hard-IRQ-context safety haven't
  been checked against real code yet** — that's real research this
  session does, not something to assume works because §11 name-dropped it
  two months ago. In particular: MicroPython disallows heap allocation in
  hard-IRQ context on some ports — confirm `ThreadSafeEvent.set()` is
  actually safe to call from there specifically, don't infer it from the
  primitive's name.
- **Debounce interacts with "both edges" trigger mode in a way `timer.ts`'s
  simple counter doesn't have to think about** — a both-edges debounce
  needs to reason about which edge was last accepted, not just "was there
  any edge recently." Work this out for real rather than copying the
  counter pattern verbatim and hoping it generalizes.

## Stop conditions

- `ThreadSafeEvent` turns out unsafe to call from a hard IRQ handler on
  this project's actual target chips — that's the premise the whole
  approach rests on; stop and reconsider rather than working around it.
- Any of the existing test suites needs modifying (same standing condition
  every prior session has used).
- `gpio_in` removal surfaces call sites this note didn't anticipate.

## Real costs and traps to respect

- **Git writes go to Mike as exact commands, always** — standing sandbox
  bug, unchanged.
- **New vendored dependency → `docs/third-party-licenses.md` updated in
  the same change**, not batched for later.
- **`npm test`/`vite build`/`npm run dev` still can't run from the
  sandbox** (Mac-only native bindings). `tsc --noEmit` is the sandbox-side
  check; Mike's own build-and-run pass is the real one.
- **A real hardware pass matters more here than for most prior sessions** —
  this is the first hard-IRQ code anywhere in the project, and no
  off-device test can actually fire a real interrupt. Don't treat
  off-device green tests as sufficient.
- **Prompt Mike to commit at the natural boundary** — vendoring landed,
  node built, `gpio_in` removed, tests passing.

## Not in scope for this chat

- Filter/event-compression node — its own future session.
- UDP send/receive, TCP send/listen-receive — its own future session(s),
  likely warranting its own briefing given it's also genuinely new ground
  (`asyncio.start_server`, the lazy-expiry connection cache, the
  `maxConnections` bound).
- TCP send's proactive (closes-even-if-idle) connection expiry — explicitly
  v2, not this session regardless of how the UDP/TCP batch gets scheduled.
- mDNS, file ops — resolved away or deferred to v2 this session already;
  not this session's job to revisit.
- Further `§6`/`CLAUDE.md` doc changes beyond what already landed
  2026-08-17 — this session builds against those, doesn't add to them
  unless something built here genuinely forces a design-doc correction.

## Success criteria

`ThreadSafeEvent` vendored, licensed, and tracked in
`third-party-licenses.md`. The new event-driven source-coroutine codegen
shape exists, is honestly named (not shoehorned into `SourceCodegenResult`
if it doesn't actually fit), and is used by the interrupt node.
Interrupt/pin-change node built, with the debounce property using the
cooldown algorithm. `gpio_in` fully removed — node file, registry entry,
and its test, with the rest of the repo checked for stale references.
`tsc --noEmit` clean. Mike's hands-on hardware pass: a real button/switch
wired to a pin fires the node reliably, debounce actually suppresses bounce
on a real mechanical switch, and a redeploy doesn't leak the IRQ handler or
crash the device.

## Git

Same standing rule as every other session: git writes (`add`/`commit`) go
to Mike as exact commands to run himself in a real Terminal, not run from
the sandbox. Read-only git commands are fine.
