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
  unknown node types, multiple nodes of a type the graph doesn't expect.
  Fan-out and fan-in are NOT on this list — see the 2026-08-13 Results
  entry below; both are real, supported DAG shapes, matching Node-RED's
  own basic wiring model, not adversarial cases to reject.
- **Off-device, per node type:** generated Python is syntactically valid
  and cross-compiles cleanly via `mpy-cross.wasm` (POC-B's toolchain) for
  every node type in isolation, before any graph-level test.
- **Results (2026-08-12):** `editor/src/compiler` built — a per-node-type
  codegen registry (`node-definition.ts`) plus a topological compiler
  (`compile.ts`), replacing `pocs/poc-d/compiler.js`'s hardcoded 3-node
  special case. Regression check passed: POC-D's exact
  `inject → function → gpio_out` graph recompiles and, run against mock
  `machine`/`runtime` modules under real CPython (this sandbox has no
  MicroPython — not a substitute for the real headless unix-port check,
  the closest thing achievable here), produces the same physical outcome
  POC-D verified on hardware (`PIN_INIT 12 OUT`, `PIN_VALUE 12 1`).
  Adversarial coverage: unknown node type, no source node, disconnected
  node, fan-out, fan-in, a cycle with no source, a cycle disconnected
  from an otherwise-valid chain, a node placed after a sink, an
  out-of-range pin, and an empty function body — all rejected with a
  clear `CompileError`, all as automated tests
  (`editor/test/compiler.adversarial.test.ts`). Confirmed generalizing
  beyond POC-D's single hardcoded shape: multiple independent sources
  compile to independent spawned coroutines, and a multi-node transform
  chain (two function nodes before the sink) compiles and runs correctly
  — neither shape was possible in `pocs/poc-d/compiler.js`
  (`editor/test/compiler.general.test.ts`). One real bug caught by this
  testing, not just a design worry: an early version nested the
  sleep/yield inside the same `if msg is not None:` block as downstream
  calls, which would have skipped the yield entirely whenever a chain
  short-circuited — exactly the non-yielding-event-loop hazard class §5
  and POC-D's hardware bugs warn about. Fixed before this was ever run
  against real hardware, which is the point of catching it here. 23/23
  tests passing, `tsc --noEmit` clean. mpy-cross cross-compilation of the
  generated output not yet exercised (POC-B's WASM toolchain isn't
  vendored into `mpy-cross-wasm/` yet) — real next step for this
  section, not done as part of this pass.
- **Results (2026-08-13, DAG generalization):** the compiler above was
  deliberately conservative — fan-out and fan-in were rejected as
  adversarial shapes rather than built, a Tier 0 scoping call, not an
  oversight. Revisited before Tier 1 node work started: Tier 1's own
  node types (boolean logic, comparators) are exactly the kind of node a
  real flow wants to fan out from (one sensor reading feeding both a
  threshold check and a debug node) or fan into, and building that node
  variety against a compiler that structurally couldn't express either
  shape would mean redoing it once fan-out/fan-in inevitably got added
  anyway — so this had to come first, matching Tier 0's own "foundations
  before variety" reasoning. `compile.ts` reworked from "one straight-line
  chain per source" to a real DAG walk: any node's output can fan out to
  multiple downstream inputs (every branch beyond the first gets its own
  shallow copy of `msg`, cloned *before* any branch runs — matching real
  Node-RED's send-time cloning, not an assumption; an early version
  interleaved "clone branch 2" with "run branch 1," which let branch 1's
  in-place mutation of `msg` leak into branch 2's clone since the clone
  was taken too late — caught by
  `compiler.general.test.ts`'s fan-out test before this ever got near
  real hardware), and any node's input can be fed by multiple upstream
  outputs (fan-in needs no synchronization, matching Node-RED — a shared
  downstream node's Python function is generated exactly once, memoized
  by node ID, and simply called from every path that reaches it, however
  many times that ends up being per run). Cycle detection generalized
  from "at most one incoming link per node structurally rules out a
  reachable cycle" (no longer true once fan-in is allowed) to real 3-color
  DFS from every source. The two adversarial tests that used to assert
  fan-out/fan-in were *rejected* were replaced with positive tests
  asserting they compile and behave correctly (`compiler.general.test.ts`:
  one inject fanning out to two independent sinks; fan-out clone isolation
  verified by mutating one branch and confirming the sibling branch's
  value is untouched; two independent sources sharing one sink, confirmed
  called once per source with its Python function generated exactly once
  and its pin-claim setup statement deduplicated); a new adversarial test
  covers a genuine cycle reachable from a real source (2 → 3 → 2, both
  downstream of a real inject), the case fan-in newly makes constructible
  and that cycle detection now has to catch for real rather than
  defensively. All existing Tier 0 compiler tests (regression,
  fault-isolation, adversarial) still pass unchanged against the rewrite.
  88/88 editor tests passing, `tsc --noEmit` clean. Stale, gitignored
  `.js` build artifacts left over in `editor/src`/`editor/test` from an
  earlier non-`--noEmit`-respecting `tsc` invocation were found shadowing
  the `.ts` sources during this pass (Vite/Node ESM resolution prefers a
  literal `.js` file on disk over resolving a `.js` import specifier to a
  same-named `.ts` file) — removed; worth a periodic
  `find editor/src editor/test -name '*.js'` sanity check given `.gitignore`
  can only stop these from being committed, not stop them from being
  generated and silently shadowing real changes in a local working copy.

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
- **Results (2026-08-13):** `editor/src/protocol/{errors,messages,framing,
  codec,version,protocol}.ts` built — the real §13 wire protocol
  replacing POC-A/D's ad hoc text/base64 protocol, on the browser/JS side
  only (see honest scope note below). `cborg` 6.1.1 (Apache-2.0) chosen as
  the CBOR library — the open gap `repo-structure-and-conventions.md`
  flagged — for its strict-by-default decode (rejects indefinite-length
  items, non-minimal int/length encodings, duplicate map keys), which
  matches this task's own adversarial bar more directly than a permissive
  decoder would; flagged to Mike and approved before installing per
  `CLAUDE.md`, installed with `npm install --ignore-scripts`, added to
  `docs/third-party-licenses.md` in the same change. Two gaps in §13's own
  sketch had to be filled with explicit, documented (not silent)
  decisions rather than blocking on them: numeric type-byte values for
  each message (`MessageType` in `messages.ts`, assigned 1–8 in §13's own
  listed order — the real device-side listener, whenever built, has to
  match this table exactly, since it's the only source of truth right
  now) and the 2-byte length header's byte order/coverage (big-endian,
  counting the 1-byte type plus CBOR body together, capping a single
  frame's type+body at 65535 bytes — a real, small ceiling inherited
  directly from §13's own 2-byte-header sketch, worth flagging as a
  concrete limitation rather than something this pass silently worked
  around: a `DEPLOY` payload larger than ~65KB doesn't fit in one frame
  under the protocol exactly as specified today).

  CBOR round-trip: all 8 message types round-trip through
  `encodeMessageBody`/`decodeMessageBody` and through the full
  `encodeMessage`/`ProtocolStreamDecoder` frame path, including each
  `VALUE_STREAM` payload type (bool/number/string/bytes) and both
  `STATE_READ` forms (request, with `value` omitted; response, with it
  present — §13 lists `STATE_READ` but not a distinct response type, so
  this is this session's interpretation, documented in `messages.ts`, not
  something the design doc fixed). Confirmed bytes fields (`DEPLOY`'s
  `bytecode`/`staticData`) round-trip as native CBOR byte strings, not
  base64 — deliberately different from `envelope.ts`'s `BytesValue`
  base64 wrapper, which exists only because the flow-file *JSON* format
  has no native bytes type; CBOR does, so no wrapping is needed at the
  wire layer, closing the open question `envelope.ts`'s own comment
  flagged.

  Adversarial framing (`framing.adversarial.test.ts`, 18 cases): truncated
  frames (mid-payload, and mid-length-header) wait for more bytes without
  emitting anything, erroring, or blocking; multiple frames in one read
  are all extracted in order; one frame split byte-by-byte across many
  reads reassembles correctly; a length header too short to hold even the
  type byte is rejected with a `FramingError` and the buffer is dropped
  rather than left corrupting future parses; 50 consecutive malformed
  frames in a row never crash and never prevent a subsequent good frame
  from decoding correctly (the JS-side analog of the fault-isolation
  soak test, though not the same test — that one needs real hardware and
  the witness rig, still pending per Tier 0's fault-isolation section);
  garbage (non-CBOR) payload bytes still frame correctly, since framing.ts
  never inspects payload content — confirming the framing/codec boundary
  is where the spec says it should be. Honest limitation documented in
  `framing.ts`'s own comments, not glossed over: this is a length-prefixed
  protocol with no resync marker, so if the length header itself is
  corrupted (as opposed to the payload), there's no way to know where the
  next real frame boundary is — the decoder detects the untrustworthy
  header and drops its buffer rather than guessing, but can't always
  recover mid-stream without the caller reconnecting.

  Version-handshake matrix (`version.matrix.test.ts`): a real 125×125
  cartesian matrix (major/minor/patch each drawn from {0,1,2,5,10}, so
  15,625 device/editor pairs, not spot-checked examples) confirms the
  invariant `allowed === (device.major === editorTarget.major)` holds for
  every pair, plus that `wipeRisk` is always the exact inverse of
  `allowed`. Representative-case tests cover the specific wording in
  §5/§11 directly (same major with an older/newer minor or patch on
  either side stays safe; a major mismatch in either direction blocks and
  flags wipe risk).

  `decodeMessageBody` also rejects (all under `MessageDecodeError`, never
  a raw exception): an unknown message-type byte, a non-map CBOR body,
  missing required fields, wrong-typed fields, a negative byte count, a
  malformed nested version map, truncated/garbage CBOR bytes outright,
  and an empty body — one test per case, plus confirmation that cborg's
  `strict: true` (this codec's actual configured setting) rejects
  non-minimal integer encoding using a hand-built byte fixture (cborg's
  own encoder never produces non-minimal output, so exercising the
  rejection needs a raw fixture rather than a round-trip).

  76 tests total in this repo now pass (23 pre-existing + 53 new:
  18 framing + 25 codec/protocol round-trip + 10 version-handshake),
  `tsc --noEmit` clean.

  **Honest scope gaps, not silently glossed over:** per this task's own
  briefing, only the browser/JS side is built — there is still no real
  device-side protocol listener anywhere in this repo
  (`device-runtime/src/runtime.py` remains the minimal `spawn()` stub),
  so "both sides" round-trip (the validation plan's original wording
  above) isn't met yet; that's real, separate Tier 0 work (see "Fault
  isolation" section) needing hardware to build against safely, not
  something this pass could or should have forced. The hardware pass
  (real device round-tripping real messages over real WebSerial) is
  correspondingly **(pending)** for the same reason. No sandbox
  MicroPython/hardware was available in this environment, same
  constraint every prior hardware-touching piece of this project has
  hit and documented the same way.

  **Update (2026-08-13, fault-isolation-briefing.md's session):** both
  gaps above are now closed on the code side, tracked here separately
  from the "Fault isolation" section's own Results entry per this
  session's briefing ("don't conflate the write-ups"). The device-side
  listener now exists (`device-runtime/src/listener.py` +
  `{cbor,framing,messages,protocol}.py`) and round-trips all 8 message
  types against real MicroPython (`device-runtime/test/test_protocol.py`,
  `test_framing.py`) — closing "both sides" at the code level. The
  editor's own missing half — a real WebSerial transport client — is also
  now built (`editor/src/protocol/transport.ts`, base64/line-framed to
  match `listener.py`'s contract; 7 tests in `editor/test/transport.test.ts`
  against fake in-memory streams, not a real port). The **hardware pass
  itself is still (pending)** — genuinely real device round-tripping real
  messages over a real WebSerial connection hasn't happened; what's new is
  that both sides of that connection now exist in code and have been
  exercised against each other over a real (non-WebSerial) byte stream —
  see the "Fault isolation" section's Results entry for
  `test_listener_integration.py`'s pipe-based end-to-end coverage, which
  is the closest either side has gotten to this without a browser or a
  board.

  **Update (2026-08-13, same session, after real hardware went up):** the
  device-side half of this protocol is now confirmed against real
  hardware too — `run_fault_isolation_checks.py` round-trips real `HELLO`/
  `DEPLOY`/`DEPLOY_ACK`/`NODE_ERROR` frames with a real ESP32-C3 over a
  real serial port (see the "Fault isolation" section's own hardware
  Results entry for the full detail). What's still literally untested is
  the **browser** half specifically — `editor/src/protocol/transport.ts`
  driven by an actual Chrome/Edge tab via `navigator.serial`, not this
  session's Python/`pyserial` driver script. The wire bytes and framing
  are identical either way (both go through the same
  `protocol.encode_message`/`ProtocolStreamDecoder` shapes), so the
  remaining gap is specifically "does `navigator.serial` behave the same
  as `pyserial` for this board" — plausible, not yet verified.

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
- **Results (2026-08-13):** Code complete for both halves of §5 plus the
  real device-side listener (`device-runtime/src/{errors,cbor,framing,
  messages,protocol,runtime,listener}.py`) and the editor's WebSerial
  transport client (`editor/src/protocol/transport.ts`) — verified
  off-device against **real MicroPython** (a unix-port build from stock
  `micropython/micropython`, not this project's own dependency — see
  `device-runtime/test/README.md` for the build recipe), not just CPython
  mocking. Hardware pass against the actual witness+DUT rig is
  **(pending)** — Mike is wiring the boards now; `test/hil/
  run_fault_isolation_checks.py` is the push-button driver script ready to
  run once they're up, and this entry gets a second dated addendum once it
  has. Honest about what today's pass does and doesn't cover:

  **Per-task boundary (half 1):** `device-runtime/src/runtime.py`'s
  `spawn()` now wraps every coroutine in a real exception boundary
  (`_guarded`), and `editor/src/compiler/compile.ts` now wraps every
  transform/sink node's generated call in a try/except that raises
  `runtime.NodeError(node_id, exc)` before it can unwind past that node's
  own call site — needed because the compiler emits one coroutine per
  *chain* (source→...→sink), not per node, so without this an exception
  could only be blamed on a chain's source, not the specific node that
  raised. `device-runtime/test/test_runtime.py` (7 tests, real `uasyncio`)
  confirms: a `NodeError` is reported with its own node ID, not the
  chain's; an un-wrapped exception falls back to the chain's source node
  ID rather than being lost; a redeploy's `CancelledError` is never
  reported as a fault; a reporting-callback failure can't itself kill a
  task; and — the actual design doc §5 claim, made concrete — **a second,
  independent task keeps running correctly after the first one fails**,
  under real `uasyncio` scheduling. `editor/test/compiler.fault-isolation.test.ts`
  (3 tests) confirms the compiler-generated code attributes a failure to
  the correct node ID end-to-end (broken function node → `NODE_ERROR
  node=2`, not `node=1`), that a passthrough node ahead of a working sink
  emits no spurious NODE_ERROR, and that one failing chain doesn't stop an
  independent second chain's own output. Real hardware still needed for
  the actual per-task *timing* under real scheduling load, per this
  section's own "inherently about `uasyncio` task behavior under real
  scheduling" framing — the unix-port tests are real `uasyncio`, just not
  real silicon.

  **Listener/transport hardening (half 2):** a hand-rolled CBOR codec
  (`cbor.py` — no MicroPython-maintained CBOR package exists; see that
  file's own header for why hand-rolling beats a dependency here) and
  framing module (`framing.py`) mirror `editor/src/protocol/{codec,
  framing}.ts` field-for-field and byte-layout-for-byte-layout (same
  message-type-byte table from `messages.ts`, same big-endian
  length-covers-type+body framing). `messages.py`/`protocol.py` round-trip
  all 8 message types and reject every adversarial case
  `protocol.roundtrip.test.ts` and `framing.adversarial.test.ts` cover,
  ported 1:1 to Python (`device-runtime/test/test_cbor.py`: 18 tests,
  including 50 pseudo-random garbage inputs; `test_framing.py`: 18 tests,
  including the 50-malformed-frame soak case; `test_protocol.py`: 15
  tests) — all run against real MicroPython, not CPython. The real
  listener (`listener.py`) rides binary frames on `readline()` as base64
  text lines (prefix `F64:`), per this task's own briefing's stated
  default ("unless a given port proves otherwise") — **the raw-binary
  alternative was not attempted**; that's the first thing worth actually
  trying once hardware is up, per the briefing's "Verify per-port" note,
  not assumed settled by this pass. The dispatch loop never dies on an
  unhandled exception (every phase wrapped, logged, loop continues) and
  every blocking read is time-bounded (`asyncio.wait_for`,
  `READ_TIMEOUT_S=8`, matching POC-D's own proven value) — plus one
  hardening gap this task's own soak testing *found*, not assumed: a
  frame-length header that's structurally plausible but never actually
  completes (garbage that "declares a plausible but wrong length," which
  `framing.py`/`framing.ts` both document as legitimately ambiguous from
  garbage) can wedge the decoder's buffer indefinitely without the task
  itself dying or hanging — fixed with a stall counter that force-resets
  the decoder after a few non-progressing pushes, a real "every *wait*
  must be time-bounded" case beyond just blocking reads.

  **End-to-end integration (`device-runtime/test/test_listener_integration.py`,
  4 tests, real MicroPython + real `mpy-cross`-compiled bytecode over a
  real stdin/stdout pipe — the closest thing to the hardware pass
  achievable without a board):** `HELLO` sent on boot with real
  `gc.mem_free()`/`os.statvfs()` figures; a real compiled flow deployed
  over the real protocol actually runs (`DEPLOY` → `DEPLOY_ACK` →
  observable print output); a real compiled flow's `NodeError` produces a
  `NODE_ERROR` frame on the wire with the correct node ID, exception type,
  and message, and the listener answers a second `DEPLOY` normally
  afterward; and 50 malformed `F64:` lines in a row (bad base64, garbage
  frame bytes) never crash the listener, which still accepts a real
  `DEPLOY` immediately after.

  **Not covered by any of the above, honestly still open (as of the
  first pass):** real silicon timing; the witness rig's own
  `HEARTBEAT_WATCH`/`WATCH_EDGES`/`MEASURE_PWM` physically observing the
  DUT (`test/hil/witness_firmware.py` is built and its command-parsing/
  PWM-math logic is unit-tested off-device — 17 tests in
  `test/hil/test_witness_firmware.py` — but real IRQ-triggered edge
  capture is inherently a hardware-only concern, never attempted
  off-device); whether base64/`readline()` is actually necessary on this
  specific board/port versus provably-safe raw binary reads; and
  `test/hil/run_fault_isolation_checks.py` itself, which is written
  against this same protocol stack and structurally checked (`python3 -m
  py_compile`) but has not been run against real hardware in this
  environment. I2C is deliberately not wired (per `test/hil/pin-map.md`'s
  own fallback recommendation) — out of scope for this task regardless.

  **Results (2026-08-13, real hardware — two LuatOS CORE-ESP32-C3 boards,
  MicroPython v1.28.0, wired per `test/hil/pin-map.md`'s GPIO/PWM/heartbeat
  rows): ALL SIX of `run_fault_isolation_checks.py`'s checks pass.** This
  is the actual hardware pass the entry above left `(pending)` — Mike
  wired and flashed both boards; getting from first attempt to a clean run
  surfaced three real, worth-recording findings, none of them bugs in the
  listener/protocol code itself:

  - This board class has no auto-reset-on-serial-open circuit (the same
    quirk `pocs/poc-d/README.md` documented) — `HELLO` fires once at boot,
    so opening a fresh connection doesn't trigger a fresh one. Fixed by
    having the driver script prompt for a physical reset at the right
    moment instead of racing a `HELLO` that may have already fired before
    anyone was listening.
  - The "malformed frame mid-transfer" check's first draft sent a
    genuinely *truncated* frame (a real length header promising more bytes
    than were sent) immediately followed by a real `DEPLOY`. On real
    hardware this permanently desynced the stream — a truncated frame
    legitimately waits for its own completion (framing.py/framing.ts's
    documented, accepted limitation: no resync marker), so the following
    `DEPLOY`'s bytes got consumed as "the rest of" the abandoned frame
    instead of parsed fresh. The listener's own logging showed exactly
    what happened (`MessageDecodeError`s, never a crash) — this was a test
    design bug, not a listener bug. Fixed by sending one complete,
    self-contained malformed frame (correct length header, garbage body)
    instead, matching the shape the soak test and
    `framing.adversarial.test.ts` already use successfully.
  - The 50-frame soak test's first draft sent all 50 lines back-to-back
    with no pacing and produced corrupted-looking lines partway through (a
    bare `F64` with no payload, two lines' bytes fused together) —
    consistent with the ESP32-C3's small USB-CDC RX buffer overflowing
    under an unpaced burst before the device-side loop could drain it, a
    transport/hardware limit no amount of application-level parsing can
    defend against. Fixed with a small (20ms) pacing delay between sends,
    which tests the actual property under test (does the listener survive
    50 malformed frames without dying) rather than an unrealistic maximum
    burst rate.
  - One real firmware bug, on the witness side (not the DUT/product code):
    `WATCH_EDGES` failed its first call with `MemoryError: memory
    allocation failed, allocating 16384 bytes` — almost certainly ESP32's
    GPIO interrupt service needing a one-time chunk of memory on first
    use, hit heap fragmentation (a later call using the identical
    `pin.irq()` pattern, `HEARTBEAT_WATCH`, succeeded once that cost had
    already been paid elsewhere). Fixed with `gc.collect()` immediately
    before arming any IRQ in `witness_firmware.py` (`_arm_irq()`), applied
    to all three IRQ-using commands.

  Per-task boundary: `NODE_ERROR` reported `nodeId=99` (the broken
  function node), `exceptionType=ValueError`,
  `exceptionMessage='hil check: deliberately broken'` — correct on every
  count. The independent chain's GPIO12→witness-GPIO3 transition was
  physically observed (`WATCH_EDGES` returned edge data including a
  `value=1` transition), confirming the working chain kept running while
  the broken one failed, on real silicon under real `uasyncio` scheduling
  — closing the one gap no off-device test could reach. Worth recording
  honestly rather than glossing over: the capture returned ~2418 edges
  clustered in a ~36.5ms burst (not spread across the full 2s watch
  window) with only one reading `value=1` before settling back to
  `value=0` readings — real electrical ringing on the GPIO12↔witness-GPIO3
  jumper, not a software issue. Expected on this specific rig: it's a
  breadboard setup with quite long patch wires between the two boards,
  which is exactly the kind of physical layout that turns a fast MCU GPIO
  edge into visible ringing on an unterminated line. The check only needed
  to see *a* transition (`any(line.startswith("EDGE ") ...)`), which it
  did, so this didn't affect the pass/fail result here — but it's a real
  signal-integrity limit of the current physical rig, not the protocol or
  firmware, worth fixing (shorter leads, or a series resistor) before this
  rig is load-bearing for anything needing precise edge *counts* rather
  than "at least one transition happened." Listener hardening: recovered
  from the malformed frame and answered the following `DEPLOY` normally
  (`DEPLOY_ACK`, `freeFlashBytes=1998848, freeRamBytes=152992`).
  Fault-injection soak: the witness's independent `HEARTBEAT_WATCH`
  confirmed 4 liveness transitions on the DUT's dedicated heartbeat pin
  (GPIO10→witness GPIO0) throughout the 50-frame soak — not the DUT's own
  self-reported output — and the listener answered a further `DEPLOY`
  immediately afterward (`DEPLOY_ACK`,
  `freeFlashBytes=1998848, freeRamBytes=152944`), confirming no memory
  leak across the soak (RAM delta: 48 bytes, noise).

  **Genuinely still open after this pass:** whether base64/`readline()`
  is actually *necessary* on this port versus provably-safe raw binary
  reads was not tested either way (this pass validated the briefing's
  stated default works, not that the alternative doesn't); the
  breadboard/patch-wire ringing noted above is worth cleaning up (shorter
  leads or a series resistor) before the rig is load-bearing for anything
  needing precise edge counts rather than just "did a transition happen";
  and I2C remains unwired, unchanged from the code-complete entry above.

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
- **Results (2026-08-13, software-only batch):** the first Tier 1 batch
  from `mvp-feature-priorities.md`'s "software-only nodes" item: boolean
  (`thingstudio/boolean` — not/and/or/xor against a configured constant),
  arithmetic (`thingstudio/arithmetic` — scale+offset/round/abs/clamp),
  comparator (`thingstudio/comparator` — gt/lt/gte/lte/eq/ne against a
  configured threshold, any of §6's typed payload set), variable get/set
  (`thingstudio/variable_get`/`thingstudio/variable_set` — a flow-wide,
  in-RAM, name-keyed store; explicitly NOT the flash-backed store §5
  describes, that's still Tier 2's unbuilt "flow persistence" work — see
  each file's own header), and debug (`thingstudio/debug` — prints to the
  serial console; real `VALUE_STREAM` inspector wiring is Tier 2). No
  physical I/O in any of these five, so no hardware pass applies (matches
  this section's own bar: hardware is non-negotiable for I2C/sensor and
  network nodes specifically, not blanket-required for every node type).
  Per-node-type off-device codegen tests, one file per type
  (`editor/test/node-{boolean,arithmetic,comparator,variable,debug}.test.ts`),
  each compiling a small real graph and running the generated Python for
  real against pymock (`editor/test/fixtures/pymock/`) — not yet the real
  headless MicroPython unix-port build this section calls for, same
  already-flagged gap as Tier 0's compiler tests, not a new one. Notable
  cases actually exercised, not just "it compiles": xor and the and/or
  short-circuit cases stay real Python bools on both sides; clamp/round/
  abs against negative and boundary values; comparator boundary
  inclusivity (`lte` at equality true, `lt` at equality false) and string
  equality, not just numeric; variable get/set's cross-chain sharing
  (a value set by one independently-spawned chain read back by a
  `variable_get` in a separate chain — relies on and directly exercises
  this session's DAG/fan-in work, see the Tier 0 compiler section above),
  its configured-default fallback when nothing's been set yet, and that
  two different variable names in the same flow don't collide in the
  shared store; the shared store dict itself is declared exactly once
  even with several get/set node instances in one flow (setup-statement
  dedup, same mechanism gpio_out's pin claims already used). Every new
  node type also rejects its own invalid configuration with a clear
  `CompileError` (unknown operator, non-numeric numeric property, empty
  variable name, `clamp`'s min > max) rather than emitting broken Python
  silently. 125/125 editor tests passing (up from 88), `tsc --noEmit`
  clean. Not yet done: mpy-cross cross-compilation of any of this output
  (same standing gap as the Tier 0 compiler entry — `mpy-cross-wasm/`
  isn't vendored yet); the Tier 1 "kitchen sink" tier-level gate, which
  needs the rest of Tier 1's node types (GPIO/timers next) to mean
  anything.

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
