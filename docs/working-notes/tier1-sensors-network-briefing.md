# Briefing: Tier 1 remainder — I2C/SPI sensors + network nodes

For the next chat. Read `CLAUDE.md` and `../thingstudio-design-doc.md` in
full before starting — this is a pointer/summary, not a replacement for
either. As of commit `d58e506`.

## Where things stand

**Tier 0 is done** (compiler, `msg` envelope, wire protocol, fault
isolation — all hardware-confirmed). **Tier 1's first two batches are
now both done, including their hardware passes:**

- Software-only nodes (boolean, arithmetic, comparator, variable get/set,
  debug, plus inject/function/gpio_out already in from POC-D) —
  off-device verified, `mvp-validation-plan.md`'s 2026-08-13 Results
  entry.
- GPIO/timers (`gpio_in`, `pwm_out`, `timer`, plus `gpio_out` already in)
  — off-device verified 2026-08-14, **and now hardware-confirmed**
  (2026-08-14 "real hardware — ALL PASS" Results entry, same section).
  Don't re-run this pass; it's done.

Don't re-derive any of this — it's all written up in
`mvp-validation-plan.md`'s Tier 1 section, dated Results entries in
order.

Full detail, don't re-derive:
- `docs/working-notes/mvp-feature-priorities.md` — the tiered feature
  list. Tier 1 items 1–2 are checked off; items 3–4 (this task) are next.
- `docs/working-notes/validation/mvp-validation-plan.md` — Tier 1's own
  bar (quoted below) and every closed-out Results entry so far — a model
  for how this task's entries should read.
- `docs/working-notes/node-definition-model.md` — the node-authoring
  contract (real code now, see `editor/src/compiler/node-definition.ts`
  and `editor/src/node-library/registry.ts`).
- `docs/working-notes/tier1-node-set-briefing.md` — the briefing that
  covered items 1–2 (now done); useful for how that work was sequenced
  and what pitfalls came up, but stale on current status — this doc
  supersedes it for what's next.
- `docs/working-notes/repo-structure-and-conventions.md` — where things
  live, naming, CI split (unchanged).

## What already exists (don't rebuild)

Twelve node types are live, registered in
`editor/src/node-library/registry.ts`: `inject`, `function`, `gpio_out`,
`boolean`, `arithmetic`, `comparator`, `variable_get`, `variable_set`,
`debug`, `gpio_in`, `pwm_out`, `timer`. Every transform/sink node's
generated call is automatically wrapped in a per-node fault-isolation
boundary by the compiler (`nodeCallWithFaultBoundary` in `compile.ts`) —
new node types don't need to do anything special for this.

**The compiler now supports a real DAG** (fan-out and fan-in), not just
linear chains — see `compile.ts` and the 2026-08-13 "DAG generalization"
Results entry. This matters for network nodes in particular: an HTTP
response or MQTT message can reasonably fan out to multiple downstream
nodes, and this is no longer a compiler limitation.

## The task: Tier 1 items 3 and 4 (design doc §6/§10)

Quoted from `mvp-feature-priorities.md`:

3. **I2C/SPI sensor nodes** — a handful of common sensors, each wrapping
   an existing MicroPython driver per §7. **Gated on having the actual
   sensor hardware on hand for each one, not just a codegen exercise** —
   check with Mike what's physically available before starting. Also
   gated on the I2C/SPI slave-mode spike if witness-rig-based adversarial
   sensor testing is wanted (see "Witness rig status" below — I2C is not
   wired on the rig yet).
4. **Network nodes** — WiFi status/HTTP request, then MQTT publish/
   subscribe. Last within this tier — most external moving parts (radio
   bring-up, broker availability) relative to the node-authoring work
   itself. Test against a local, controllable MQTT broker/HTTP server per
   the validation plan, not live external services.

## Validation plan's bar for these two (already written, don't re-derive)

From `mvp-validation-plan.md`'s "Tier 1 — node set" section:

- Per node type: off-device unit test of codegen (pymock or the real
  headless MicroPython unix-port build, `device-runtime/test/README.md`
  has the build recipe) — then a real hardware pass. **Hardware pass is
  non-negotiable for I2C/sensor and network nodes specifically**, no
  off-device-only exception the way some GPIO work briefly had.
- I2C/SPI sensor nodes: record which specific sensor part numbers were
  actually validated against.
- Network nodes: test against a local, controllable MQTT broker and HTTP
  test server, not live external services.
- Tier-level gate, once all of Tier 1 is done: one combined "kitchen
  sink" flow wiring every v1 node type together, soak-run for an
  extended period — per-node tests won't catch cross-node interaction
  bugs.

## Witness rig status (confirmed working for digital I/O, use it)

Wired and hardware-confirmed working: `gpio_out`, `gpio_in`, PWM, and
heartbeat rows + GND, per `test/hil/pin-map.md`. **I2C is not wired yet**
— pin-map.md's own fallback recommendation was to wire the digital rows
first and decide I2C's pins when the slave-mode spike is actually
scheduled, i.e. now, if item 3 is being picked up. `I2C_SLAVE_EMULATE` in
`witness_firmware.py` is a stub (`ERR ... not implemented`) — needs real
implementation before it can emulate a sensor for adversarial testing.

A real noise/reliability lesson from this session worth carrying
forward: the witness's `_pin_in()` (used by every watching command —
`WATCH_EDGES`, `MEASURE_PWM`, `HEARTBEAT_WATCH`) now takes a `pull`
argument and defaults the watching pins to `PULL_DOWN`. A floating
witness input pin was picking up what looked like ambient EMI (a steady
~27–29µs-spaced edge burst, present even with nothing driving the DUT
side yet) — diagnosed by the burst's suspicious regularity and by it
persisting after physically separating jumpers ruled out simple wire
crosstalk. If wiring an I2C pin to the witness for slave-mode emulation,
this same floating-pin failure mode is worth designing around from the
start, not rediscovering. Separately, `WATCH_EDGES`/`MEASURE_PWM` now cap
at `_MAX_WATCH_EDGES = 2000` and return a clear `EDGES_ERR`/`PWM_ERR`
instead of exhausting the heap on a noise storm — keep this pattern if
adding new witness commands that accumulate an unbounded list from an
IRQ.

Breadboard ringing on fast edges (documented previously, still true —
long patch wires): harmless for "did *a* transition happen," would
corrupt precise edge-count-dependent measurements. The GPIO/timer
hardware pass's clean `PWM_RESULT`/timer numbers this session suggest
it's within tolerance for what's been measured so far, but hasn't been
stress-tested at higher frequencies.

## Also still open, not blocking this task but worth knowing about

- Stateful nodes / cross-message synchronization (a Node-RED-style
  `join` node) — flagged in `mvp-feature-priorities.md`'s "Explicitly
  still out of v1" section, added 2026-08-13. Not needed for sensor or
  network nodes as currently scoped (they're stateless per-message
  transforms/sources), but network nodes are the most likely place this
  gets requested next (e.g. "fire once both an HTTP response and an MQTT
  message have arrived") — worth rereading that note if a network node's
  design starts wanting memory across separate trigger events.
- Whether base64/`readline()` framing is strictly necessary on this port
  vs. a provably-safe raw-binary read — still untested either way, not a
  blocker.
- `editor/src/protocol/transport.ts` (WebSerial client) — unit-tested
  against fake streams, never driven from a real browser tab against
  hardware. Relevant at Tier 3, not this task.
- The OTA-capable-partition-table hedge (Tier 0 item, still not done —
  build-config only, no dependency on this task).

## Conventions to keep following (all established this repo — don't relitigate)

- `CLAUDE.md`: prompt for commits at natural checkpoints; flag any new
  npm/Python package before installing (`--ignore-scripts` for npm);
  update `docs/third-party-licenses.md` in the same change as any new
  dependency — MicroPython sensor drivers vendored from third parties
  count as this too, not just npm packages.
- Off-device first (pymock / real MicroPython unix-port build), with
  adversarial/malformed input, before any hardware claim of "done" —
  `tsc --noEmit` and the full test suite green before every commit.
- Dated Results entries appended to `mvp-validation-plan.md`'s Tier 1
  section once actually verified — be explicit about what is and isn't
  covered (e.g. "off-device only, hardware pending" was used honestly
  twice this session before the real pass landed).
- `test/hil/` is a manual, local hardware gate, not CI.
- No direct hardware access in a fresh chat's sandbox — HIL work is
  iterative: propose a script/change, hand it to Mike to run on the real
  rig, read back the pasted output, diagnose, repeat. Expect several
  rounds; this session's GPIO/timer pass took three hardware runs plus a
  physical wiring fix (jumper separation) and two firmware fixes before
  going green.

## Not in scope for this chat

- Tier 2 (live value streaming + persistence) and Tier 3 (product shell)
  — though `mvp-feature-priorities.md` flags live value streaming as
  reasonable to pull forward in parallel once a handful of Tier 1 nodes
  exist.
- The join/synchronization node design (see above) — track it, don't
  design it here unless network nodes' own requirements force the issue.
- Multi-flow node-ID-uniqueness bookkeeping (§6, v2-scope).
