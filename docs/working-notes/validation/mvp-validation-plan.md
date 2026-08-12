# Working note: MVP validation plan

Status: working note, 2026-08-11 — likely to grow as each tier is actually
built (dated Results appended per section, same convention as the POCs),
which is why this lives in its own folder rather than as one more section
bolted onto `../mvp-feature-priorities.md`. Companion to that
document — read it first for what each tier contains; this is how each
tier gets confirmed done rather than assumed done.

## Philosophy (carried over from the POC convention, not reinvented)

Per `../mvp-planning-briefing.md`'s "conventions worth
continuing": verify off-device first, against real artifacts, with
adversarial/malformed input where relevant, before touching hardware —
cheap, and it caught real bugs every time it was done. Hardware is still
authoritative regardless — POC-D's thorough off-device verification still
missed five real issues only a real board surfaced, so no tier is "done"
on off-device evidence alone if it touches hardware at all. Success
criteria should be concrete and measurable (a number, a pass/fail
adversarial case, a byte-identical comparison) rather than "seems to
work," matching how §15's POC success criteria were written. Each
section below gets a dated Results subsection appended once actually
verified, same as a POC's README.

## Hardware-in-the-loop rig: witness + DUT

Two ESP32-C3 boards (same class as POC-A/D's LuatOS CORE-ESP32-C3, for
continuity), wired together with a defined pin map, each with its own
independent USB connection to the host. One (**DUT**) runs the actual
flow/runtime under test; the other (**witness**) runs small,
purpose-built test firmware that stimulates or observes the DUT's pins
and reports back over its own serial link — a channel that stays alive
even if the DUT's own transport doesn't.

This directly closes a gap in how the POCs measured "success": POC-A/D's
hardware checks came down to a human watching an onboard LED, or trusting
the DUT's own printed output (`DEPLOY_OK`, `MPY_OK`, its `_mem_monitor`
heartbeat). POC-D's worst bug was a case where that self-reporting
couldn't be trusted — the entire event loop wedged, silently, taking its
own heartbeat print down with it. A witness board watching a GPIO pin
directly doesn't depend on the DUT's transport or print output being
alive at all.

### Prerequisite: I2C/SPI slave-mode spike

Before this rig is load-bearing for sensor-node validation, confirm
MicroPython on the actual target board supports slave/peripheral-mode I2C
(and ideally SPI) — controller/master mode is the well-trodden path in
MicroPython, and slave-mode exposure varies by port and isn't something
to assume. Spike scope: configure the witness as an I2C peripheral at a
fixed address responding with a defined byte sequence, confirm a
controller (the DUT board is fine for this) reads it back correctly, then
confirm the witness can be reconfigured to NACK or return garbage on
demand — the actual point, since those are the failure cases a real
sensor won't let you provoke on demand. If this doesn't pan out cleanly,
it's not a blocker, just a scope limit: the rig covers digital GPIO/PWM/
timer node classes regardless, and I2C/SPI sensor nodes keep needing at
least one pass against the real physical part, which the plan already
required anyway.

**Results:** _(pending — run before committing to this for Tier 1 sensor
nodes)_

### Pin map

Needs to be an explicit table, not "some wires," since different node
classes need different physical setups on the witness side:

| DUT side | Witness side | Used for |
|---|---|---|
| GPIO out pin | GPIO in, IRQ + `ticks_us()` edge capture | `gpio_out` node validation — exact transition timestamps instead of eyeballing an LED |
| GPIO in pin | GPIO out, witness drives a known signal | `gpio_in` node validation — confirm the DUT reads a witness-driven stimulus correctly |
| PWM out pin | GPIO in, edge-capture across N cycles | duty-cycle/frequency measurement for PWM nodes |
| I2C SDA/SCL | I2C SDA/SCL, witness in slave mode (pending spike) | sensor-node protocol-level testing, including adversarial responses a real sensor won't produce on demand |
| Dedicated heartbeat pin | GPIO in, continuous watch | independent liveness signal during fault-injection soak tests (see Tier 0 below) |
| GND | GND | common reference — easy to forget, breaks everything subtly if missed |

External I2C pull-ups (~4.7kΩ) may be needed on the shared bus rather than
relying on either board's internal pull-ups — worth checking bus signal
integrity once the spike above is running, not assuming it's fine.

### Witness firmware contract

A single small, reusable, configurable firmware image on the witness
board — not one-off code per test — driven over its own USB serial link
with a simple line-based text protocol, in the same spirit as the POCs'
own ad hoc harness protocols (this is test infrastructure, not the
product's own runtime, so it doesn't need §13's real protocol): commands
like `WATCH_EDGES <pin>`, `MEASURE_PWM <pin> <n_cycles>`, `DRIVE_GPIO
<pin> <value>`, `HEARTBEAT_WATCH <pin> <timeout_ms>`, and (pending the
spike) `I2C_SLAVE_EMULATE <addr> <register_map>`. Worth its own README
once built — pin map, command protocol, setup instructions — matching
the README-per-component convention.

### What this changes in the tiers below

- **Tier 0 fault-isolation soak test:** the heartbeat-liveness check
  should use the witness's independent `HEARTBEAT_WATCH`, not the DUT's
  own printed heartbeat.
- **Tier 1 GPIO/PWM/timer nodes:** hardware pass runs through the witness
  rig instead of visual inspection, giving exact timestamped, automatable
  pass/fail rather than a human watching an LED.
- **Tier 1 I2C/SPI sensor nodes:** conditional on the slave-mode spike
  landing; if it does, enables adversarial sensor-protocol testing this
  plan couldn't otherwise do; if not, no change from the original plan —
  real physical parts remain required.
- **Network nodes are unaffected** — WiFi/MQTT/HTTP still validate
  against a local, controllable broker/HTTP server as already planned;
  the witness rig doesn't reach into the radio stack.

## Tier 0 — foundations

### General graph → Python compiler

- **Regression, not just new coverage:** recompile POC-D's exact
  `inject → function → gpio_out` graph through the new general compiler;
  output must be behaviorally identical to POC-D's hand-verified result
  (§15.5). This is the cheapest possible check that generalizing the
  compiler didn't lose anything the hardcoded version already proved.
- **Adversarial graph shapes**, each expected to fail with a clear compile
  error rather than misbehave silently: cycles, disconnected nodes,
  unknown node types, multiple nodes of a type the graph doesn't expect,
  fan-out (one output wired to multiple inputs).
- **Off-device, per node type:** generated Python is syntactically valid
  and cross-compiles cleanly via `mpy-cross.wasm` (POC-B's toolchain) for
  every node type in isolation, before any graph-level test.
- **Results:** _(pending — fill in once built)_

### Real `msg` envelope + type system

- Editor-side: wire-connect-time type check accepts every valid pairing
  across the full payload type set (`int`/`number`/`bool`/`string`/
  `bytes`/`any`) and rejects every invalid one — exhaustive over the type
  matrix, not spot-checked.
- Compiler + runtime: for each payload type, compile a small flow that
  constructs and reads that type through the envelope, run it in a
  headless MicroPython unix-port build, assert the value round-trips
  correctly. Off-device, no hardware needed for this part.
- **Results:** _(pending)_

### Real wire protocol (§13)

- CBOR encode/decode round-trip for every message type (`HELLO`,
  `DEPLOY`, `DEPLOY_ACK`/`DEPLOY_ERROR`, `VALUE_STREAM`, `NODE_ERROR`,
  `STATE_READ`/`STATE_WRITE`), both sides (browser JS and device Python),
  off-device.
- **Adversarial framing**, the specific convention POC-D's own README
  calls out as worth continuing: truncated frames, oversized length
  headers, garbage bytes, one frame split across multiple reads, multiple
  frames in one read. Every case should degrade to a logged, recoverable
  error, never a hang or a crash.
- Version-handshake matrix: every combination of device/editor
  major.minor.patch pairs produces the right outcome (safe deploy allowed,
  or blocked with the correct wipe warning per §5/§11).
- Hardware pass: real device round-trips real messages over real
  WebSerial, confirming the off-device expectations actually hold — the
  "hardware is still authoritative" check.
- **Results:** _(pending)_

### Fault isolation

- Per-task boundary: deploy a multi-node flow containing one deliberately
  broken node; confirm `NODE_ERROR` reports the correct node ID and
  exception info, and confirm every other node/task keeps running
  unaffected. Real hardware test — this is inherently about `uasyncio`
  task behavior under real scheduling.
- Listener/transport hardening — regression tests against POC-D's actual
  historical bugs, not just new scenarios: send a malformed frame
  mid-transfer, confirm the listener logs and recovers rather than dying
  (the exact incident that used to require a full `esptool` reflash);
  confirm no protocol code path reintroduces a `read(n)`/`readexactly(n)`
  call without re-verifying it against this port's known hang (§15.5).
- Fault-injection soak test: 50 consecutive malformed/garbled frames sent
  to a running device, confirm the listener task survives all 50 — direct
  analog to POC-A's 50-redeploy stress run, testing survivability instead
  of cleanliness. Liveness during this test should be confirmed via the
  witness rig's `HEARTBEAT_WATCH` (see "Hardware-in-the-loop rig" above),
  not the DUT's own printed heartbeat — POC-D's actual bug was the event
  loop wedging entirely, taking its own heartbeat print down with it, so
  self-reported liveness can't be trusted for exactly this test.
- **Results:** _(pending)_

## Tier 1 — node set

- Per node type: an off-device unit test of its codegen (given known
  properties, does it emit the expected Python; does that Python behave
  correctly against sample `msg` dicts under a headless MicroPython
  unix-port), then one real hardware pass confirming physical behavior.
  Hardware pass is non-negotiable for I2C/sensor and network nodes
  specifically — bus timing, real chip behavior, and radio realities are
  exactly the class of thing off-device testing has already been shown
  not to catch.
- GPIO in/out, PWM, and timer nodes: hardware pass runs through the
  witness rig (edge-capture or duty-cycle measurement, or the witness
  driving a known stimulus into a `gpio_in`-class node) rather than
  visual LED inspection — automatable and timestamped, see
  "Hardware-in-the-loop rig" above.
- I2C/SPI sensor nodes: record which specific sensor part numbers were
  actually validated against — "a handful of common sensors" (§6) isn't
  a testable claim until the parts are named. Witness-rig sensor
  emulation (adversarial NACKs, garbage responses) is available only if
  the slave-mode spike above lands; either way, at least one pass against
  each real physical part is still required.
- Network nodes: test against a local, controllable MQTT broker and HTTP
  test server, not live external services, so results are repeatable.
- Tier-level gate: one combined flow wiring every v1 node type together
  ("kitchen sink"), soak-run for an extended period. Per-node tests won't
  catch cross-node interaction bugs; POC-A/D's own bug lists were
  disproportionately this kind of issue.
- **Results:** _(pending — likely one dated entry per node type as they land)_

## Tier 2 — live values + persistence

- Live value streaming: inject a known value sequence, confirm the
  editor's inspector shows that exact sequence in order — not just "some
  value changed." Measure throttling actually bounds bandwidth/CPU cost
  as intended. Test behavior across a connection drop and reconnect.
- Flow persistence: power-cycle a device with a deployed flow N times
  (target: on the order of POC-A's 50-cycle convention) with no editor
  attached; confirm the flow resumes correctly every time.
- State store: deploy a flow with a stateful node (counter or running
  average), redeploy repeatedly, confirm the value survives by default;
  confirm a node's opt-out flag actually clears its state on redeploy
  when set; confirm the state store is preserved across power cycles too,
  independent of the flow-bytecode persistence above (§5 treats these as
  two distinct stores — test them as two distinct claims).
- **Results:** _(pending)_

## Tier 3 — product shell

- Flow file format: save an untouched flow twice, diff must be empty
  (the entire point of deterministic serialization in §6 — directly
  testable). Move a node on the canvas and save; confirm only the
  `layout` section's diff is non-empty, `nodes`/`edges` unchanged.
- Save/load round-trip, on **both** code paths — File System Access API
  and the manual export/import fallback — since Chrome/Edge and
  Safari/Firefox are genuinely different implementations (§4), not a
  cosmetic difference. Confirm reloaded graph is structurally identical
  to the original, not just "doesn't crash."
- Closing check for the whole v1 effort, not just this tier: re-run
  POC-A's original stopwatch test (§15.1 — deploy-to-observable-behavior,
  target comfortably under a second) through the real product shell
  instead of hardcoded buttons. This confirms none of Tier 0–3's "replace
  the POC shortcut with the real thing" work quietly regressed §1's
  actual central bet.
- **Results:** _(pending)_

## Standing regression suite

Once Tier 0 lands, POC-A's, POC-B's, and POC-D's original success
criteria (deploy latency, `mpy-cross` compile latency and byte-identical
output, end-to-end hardware run) are cheap to keep as a standing
regression check, re-run at minimum at the end of Tier 0 and again at the
end of Tier 3. The goal is catching a quiet regression in the numbers
that originally justified §1's central bet, not just confirming new
features work in isolation.
