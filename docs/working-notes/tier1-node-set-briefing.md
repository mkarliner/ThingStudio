# Briefing: Tier 1 — the v1 node set

For the next chat. Read `CLAUDE.md` and `../thingstudio-design-doc.md` in
full before starting — this is a pointer/summary, not a replacement for
either. As of commit `8827a65`.

## Where things stand

**Tier 0 is done.** All four foundations from
`docs/working-notes/mvp-feature-priorities.md` are built and verified:
the general graph → Python compiler, the real `msg` envelope/type system,
the real §13 wire protocol (both the browser/JS side and, as of this
session, the real device-side listener), and fault isolation (§5, both
halves). Fault isolation is the one that needed hardware, and it now has
a real hardware pass, not just off-device verification — see
`docs/working-notes/validation/mvp-validation-plan.md`'s "Fault
isolation" section's dated Results entries (there are two: one
code-complete/off-device-verified, one from the actual hardware run) for
the full detail, including three test-methodology bugs and one real
witness-firmware bug found and fixed getting there. Don't re-derive any
of this, it's already written up.

Full detail, don't re-derive any of this from scratch:
- `docs/working-notes/mvp-feature-priorities.md` — the tiered feature
  list. Tier 0 is now entirely checked off; Tier 1 (this task) is next.
- `docs/working-notes/validation/mvp-validation-plan.md` — Tier 0's
  closed-out Results entries (a model for how this task's own entries
  should read), and Tier 1's own bar (quoted below, don't re-derive).
- `docs/working-notes/node-definition-model.md` — the node-authoring
  contract, written from POC-D's evidence. Its "proposed contract" section
  is now real code, not just a proposal — see
  `editor/src/compiler/node-definition.ts` (the `NodeDefinition` /
  `SourceCodegenResult` / `TransformCodegenResult` / `SinkCodegenResult` /
  `CodegenContext` interfaces) and `editor/src/node-library/registry.ts`.
  Read the node-definition-model note for the *why*, the actual
  `.ts` files for the *current, real* contract — they've moved on from
  "for discussion" since that note was written.
- `docs/working-notes/repo-structure-and-conventions.md` — where things
  live, naming, CI split (unchanged by this task).

## What already exists (don't rebuild)

Three node types are already ported onto the real compiler contract,
from POC-D: `editor/src/node-library/{inject,function-node,gpio-out}.ts`,
registered in `registry.ts`. These are Tier 1 items too (inject, the
function node, and `gpio_out` are explicitly named in
`mvp-feature-priorities.md`'s Tier 1 list) — don't re-port them, extend
the registry with the rest.

One thing worth knowing before writing a new node type: every
transform/sink node's generated call is now automatically wrapped in a
per-node fault-isolation boundary by the compiler
(`editor/src/compiler/compile.ts`'s `nodeCallWithFaultBoundary`, added
this session) — an exception anywhere in a node's generated call gets
tagged with that node's own ID and reported as `NODE_ERROR` with the
correct attribution, not just blamed on the whole chain. New node types
don't need to do anything special for this; it's automatic at the
compiler level for every `transform`/`sink` node. It doesn't apply to
`source` nodes' `buildMsg` construction itself (falls back to the chain's
own source-node ID if something goes wrong there — see `runtime.py`'s
header comment).

## The task: Tier 1 (design doc §6/§10), per `mvp-feature-priorities.md`

Sequenced by risk and dependency, quoted from that doc:

1. **Software-only nodes** — boolean/arithmetic logic, comparators/
   thresholds, variable get/set, inject ✅, debug, the function node ✅.
   No physical I/O, cheapest way to exercise the compiler against real
   variety before anything hardware-dependent. **This is where to start**
   — boolean/arithmetic/comparator logic, variable get/set, and debug are
   the remaining pieces here.
2. **GPIO/timers** — GPIO in/out (`gpio_out` ✅, `gpio_in` still needed) +
   PWM, timers/intervals. Real I/O, on the mechanism POC-A/D already
   proved reliable, and now with a real witness rig to validate against
   (see below) instead of visual LED inspection.
3. **I2C/SPI sensor nodes** — a handful of common sensors, each wrapping
   an existing MicroPython driver. Gated on having the actual sensor
   hardware on hand, *and* on the I2C/SPI slave-mode spike (still
   `(pending)` — see "Witness rig status" below) if witness-rig-based
   adversarial sensor testing is wanted; real physical parts are required
   either way per the validation plan.
4. **Network nodes** — WiFi status/HTTP request, then MQTT publish/
   subscribe. Last within this tier — most external moving parts (radio
   bring-up, broker availability) relative to the node-authoring work
   itself. Test against a local, controllable MQTT broker/HTTP server per
   the validation plan, not live external services.

## Validation plan's Tier 1 bar (already written, don't re-derive)

From `mvp-validation-plan.md`'s "Tier 1 — node set" section:

- Per node type: an off-device unit test of its codegen (given known
  properties, does it emit the expected Python; does that Python behave
  correctly against sample `msg` dicts) — the pymock fixture
  (`editor/test/fixtures/pymock/`) or the real headless MicroPython
  unix-port build (`device-runtime/test/README.md` has the build recipe,
  now confirmed working end-to-end this session) both apply — then one
  real hardware pass confirming physical behavior. Hardware pass is
  non-negotiable for I2C/sensor and network nodes specifically.
- GPIO in/out, PWM, and timer nodes: hardware pass runs through the
  witness rig (edge-capture or duty-cycle measurement, or the witness
  driving a known stimulus into a `gpio_in`-class node) — see "Witness rig
  status" below, this is now a real, confirmed-working option, not
  aspirational.
- I2C/SPI sensor nodes: record which specific sensor part numbers were
  actually validated against.
- Network nodes: test against a local, controllable MQTT broker and HTTP
  test server.
- Tier-level gate: one combined "kitchen sink" flow wiring every v1 node
  type together, soak-run for an extended period — per-node tests won't
  catch cross-node interaction bugs, and POC-A/D's own bug lists were
  disproportionately this kind of issue.

## Witness rig status (confirmed working, use it)

Wired: `gpio_out`, `gpio_in`, PWM, and heartbeat rows + GND, per
`test/hil/pin-map.md`. I2C is **not** wired yet (pin-map.md's own
fallback recommendation — needed before I2C/SPI sensor node work in item
3 above, whenever that spike is scheduled). Both boards are flashed and
confirmed working end-to-end (`test/hil/run_fault_isolation_checks.py`,
2026-08-13 hardware Results entry in the validation plan) —
`test/hil/witness_firmware.py`'s `WATCH_EDGES`/`MEASURE_PWM`/
`DRIVE_GPIO`/`HEARTBEAT_WATCH` commands are real and working, not just
unit-tested.

One physical-rig limitation worth knowing before trusting `MEASURE_PWM`
numbers specifically: this is a breadboard setup with fairly long patch
wires between the two boards, which produces real electrical ringing on
fast GPIO edges (confirmed in the fault-isolation hardware run — a
`WATCH_EDGES` capture returned ~2418 edges in a 36ms burst from what
should have been one clean transition). Harmless for "did *a* transition
happen" checks; would corrupt anything relying on precise edge *counts*
(PWM duty-cycle measurement, timer-node validation) until the wiring is
cleaned up (shorter leads, or a series resistor) — worth doing before
Tier 1's GPIO/PWM hardware passes, not after a confusing result.

## Also still open, not blocking Tier 1 but worth knowing about

- Whether base64/`readline()` framing (the device transport's current,
  working default) is strictly *necessary* on this port vs. a
  provably-safe raw-binary read was never tested either way — this
  session validated the default works, not that the alternative doesn't.
  Not a Tier 1 blocker.
- `editor/src/protocol/transport.ts` (the WebSerial client) is built and
  unit-tested against fake in-memory streams, and the *device* side of
  the same protocol is now hardware-confirmed via a Python/`pyserial`
  driver script — but nobody has driven `transport.ts` from an actual
  Chrome/Edge tab against real hardware yet. Relevant once Tier 3's "real
  editor shell" work starts, not this task.

## Conventions to keep following (all established this repo — don't relitigate)

- `CLAUDE.md`: prompt for commits at natural checkpoints; flag any new
  npm/Python package before installing (`--ignore-scripts` for npm); update
  `docs/third-party-licenses.md` in the same change as any new dependency.
- Off-device first, with adversarial/malformed input, before any claim of
  "done" — `tsc --noEmit` / the real MicroPython unix-port build (not just
  CPython mocking, now that the build recipe is proven — see
  `device-runtime/test/README.md`) / the full test suite green before
  every commit.
- Dated Results entries appended to `mvp-validation-plan.md`'s relevant
  section once actually verified — honest about what isn't covered, same
  convention this session's own entries model.
- `test/hil/` is a manual, local hardware gate, not CI — unchanged.
- "Harness" stays retired; "listener" and "runtime" are the real names.

## Not in scope for this chat

- Tier 2 (live value streaming + persistence) and Tier 3 (product shell,
  git-friendly flow file format, real editor shell) — Tier 1 comes first,
  though the feature-priorities doc flags live value streaming as
  reasonable to pull forward in parallel once a handful of Tier 1 nodes
  exist, not strictly serial.
- The OTA-capable-partition-table hedge (separate Tier 0 item, actually
  still not done — build-config only, no dependency on this task, but
  worth someone picking up).
- Multi-flow node-ID-uniqueness bookkeeping (§6, v2-scope).
- The I2C/SPI slave-mode spike and I2C wiring — optional, gated, only
  relevant once I2C/SPI sensor nodes (item 3) are actually being built.
