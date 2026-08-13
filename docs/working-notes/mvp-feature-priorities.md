# Working note: MVP feature list, prioritized

Status: working note, 2026-08-11. Task 1 from `mvp-planning-briefing.md`.
Builds on `../thingstudio-design-doc.md` §10's rough v1 sketch, §15.5's
pipeline-proven-vs-v1-done gap list, and this session's §11 resolutions
(see design doc for the resolved text). Tiered by dependency and by how
central each piece is to §1's actual bet, not just copied from §10's list
in its original order. See `validation/mvp-validation-plan.md`
for how each tier actually gets confirmed done, not just built.

## Already decided, no work required

This session closed six of §11's open questions in a way that shrinks v1
scope rather than adding to it — worth stating plainly so they don't
resurface as work items: no CircuitPython spike (MicroPython, closed), no
function-node sandboxing, no simulation mode (out of the project entirely,
not just deferred), no node distribution/versioning system (node set ships
fixed inside the runtime image), no OTA mechanism (USB reflash only).
Generated code is human-readable Python (already the natural choice, just
now explicit).

## Tier 0 — foundations (block everything else; do first)

Everything here is "the real thing" replacing a POC shortcut. Building any
of the Tier 1 node set against the old shortcuts means redoing it once
these land, so this has to come first even though it produces nothing
end-user-visible on its own.

- **General graph → Python compiler (§6).** Replaces POC-D's
  `compiler.js`, which only knows exactly one hardcoded 3-node shape.
  Needs: a topological walk over arbitrary graphs, and a per-node-type
  codegen registry instead of one function that already knows every node
  type by name — the contract sketched in `node-definition-model.md`
  (type ID, ports, properties, a codegen hook emitting one of the three
  patterns already demonstrated: native-primitive call, folded-into-
  control-flow, or verbatim user code). Cheapest validation step: port
  POC-D's exact `inject → function → gpio_out` flow onto the new general
  compiler first, as a regression check, before adding new node types.
- **Real `msg` envelope + type system (§6).** The typed `payload`
  (`int`/`number`/`bool`/`string`/`bytes`/`any`), `topic`, and extra
  properties, plus wire-connect-time type checking in the editor. §6 is
  explicit this isn't a v1-only shortcut — every node built after this
  point depends on the envelope shape, and changing it later breaks every
  node already written. Has to be right before Tier 1 starts, not after.
- **Real wire protocol (§13).** Length-prefixed, CBOR-framed messages
  (`HELLO`, `DEPLOY`, `DEPLOY_ACK`/`DEPLOY_ERROR`, `VALUE_STREAM`,
  `NODE_ERROR`, `STATE_READ`/`STATE_WRITE`), replacing POC-A/D's ad hoc
  text/base64 protocol. `HELLO`'s major.minor.patch version check should
  gate whether the editor even attempts a `DEPLOY`, per §5/§13's own
  reasoning about avoiding a version-mismatch DEPLOY the device can't
  parse.
- **Fault isolation, both halves (§5).** Per-task exception boundary for
  deployed flow coroutines (catch at task completion, report via
  `NODE_ERROR`, rest of flow keeps running) — and, separately, the
  listener/transport task hardening POC-D's hardware run actually forced:
  the dispatch loop must never die from an unhandled exception, every
  blocking read must be time-bounded, and no protocol design should assume
  a specific-byte-count read (`read(n)`/`readexactly(n)`) is safe on an
  arbitrary port — verify per-port, ride binary payloads on `readline()`
  the way POC-D's fix does unless a given port proves otherwise. This is
  called out in the design doc as something to build in from day one, not
  bolt on later, precisely because POC-D hit it by surprise on real
  hardware after extensive off-device testing missed it.
- **Reserve an OTA-capable partition table on the ESP32 build.** Not
  implementing OTA in v1 (§11 — USB reflash only) is fine, but the
  partition layout is a one-way door: ESP-IDF's OTA mechanism needs two
  OTA-capable app partitions (`ota_0`/`ota_1` plus OTA-data) laid out from
  the very first flash. Shipping v1 without them means every device
  already in the field needs a manual USB reflash later just to become
  OTA-capable, before OTA itself is even turned on. Laying out OTA-capable
  partitions now is a build-config choice, not new engineering — cheap
  insurance against a future stranding cost. RP2040/RP2350 has no
  equivalent standard scheme in the Pico SDK, so this hedge is ESP32-only;
  Pico-family OTA remains a separate, harder problem for whenever it's
  scoped.

## Tier 1 — the v1 node set (§6/§10), built on Tier 0

Sequenced by risk and dependency, not just copied from §6's list order:

1. **Software-only nodes** — boolean/arithmetic logic, comparators/
   thresholds, variable get/set, inject, debug, the function node. No
   physical I/O, so they're the cheapest way to exercise the new general
   compiler against real variety (multiple types, non-trivial wiring)
   before anything hardware-dependent is in the mix. **Done as of
   2026-08-13** — inject/function were already ported from POC-D; boolean,
   arithmetic, comparator, variable get/set, and debug landed this
   session (`docs/working-notes/validation/mvp-validation-plan.md`'s
   dated Results entry). Variable get/set's state is in-RAM only for
   now, not yet the flash-backed store §5 describes — that's still Tier
   2's unbuilt "flow persistence" work, noted in each node file's own
   header rather than silently assumed done.
2. **GPIO/timers** — GPIO in/out + PWM, timers/intervals. Real I/O, but on
   exactly the mechanism POC-A/D already proved reliable on hardware.
3. **I2C/SPI sensor nodes** — a handful of common sensors, each wrapping
   an existing MicroPython driver per §7. Gated on having the actual
   sensor hardware on hand for each one, not just a codegen exercise.
4. **Network nodes** — WiFi status/HTTP request, then MQTT publish/
   subscribe. Last within this tier since they carry the most external
   moving parts (radio bring-up, broker availability) relative to the
   node-authoring work itself.

## Tier 2 — the "feels like Node-RED" layer

This is half of §1's actual bet, not polish — worth pulling forward rather
than letting it trail behind finishing every node type in Tier 1. Live
values in particular can and should start as soon as Tier 0's protocol and
a handful of Tier 1 nodes exist, in parallel with the rest of Tier 1, not
strictly after it.

- **Live value streaming (§5/§13 `VALUE_STREAM`).** Throttled sampling of
  tagged node outputs back over the transport so wires light up with real
  data in the editor. POC-D explicitly deferred this ("success is 'it runs
  on-device,' not 'the editor shows live values'") — reasonable for a
  pipeline spike, not reasonable to defer to the end of v1.
- **Flow persistence (§5).** Two distinct stores: the last-deployed flow's
  bytecode/static data in flash (resumes after power loss with no editor
  attached — matches MicroBlocks' baseline behavior), and a separate
  flash-backed key/value store for runtime state (variable values,
  calibration constants), keyed by node ID, surviving redeploy by default
  with a per-node opt-out.

## Tier 3 — product shell

Makes this an actual tool someone can use end to end, versus a proven
pipeline driven by hardcoded buttons.

- **Git-friendly flow file format (§6).** The `nodes`/`edges` vs. `layout`
  split, deterministic serialization (stable ordering, zero-diff on an
  untouched re-save). Not built in any POC yet.
- **File save/load (§4).** File System Access API where available
  (Chrome/Edge), manual export/import fallback elsewhere (Safari/Firefox).
- **Real editor shell.** Connect + `HELLO` handshake, a Deploy flow that
  runs the pre-flight version/space check before sending `DEPLOY`, and the
  status/log/inspector panel from §8 — connection state, per-node errors
  surfaced from `NODE_ERROR`, live values from `VALUE_STREAM`. Replaces
  POC-D's "couple hardcoded buttons," which was correctly out of scope for
  a pipeline spike but isn't a v1 deliverable as-is.

## Explicitly still out of v1 (§10, unchanged by this session)

Incremental/diffed redeploy (full-flow redeploy only), BLE and WiFi
transport, config nodes with per-device override, a catch/error node, Home
Assistant auto-discovery, a self-hosted dashboard, multi-device flows, a
companion server. All v2/v3 per §10's existing phasing — nothing here
changes that.

Added 2026-08-13, flagged during Tier 1 node-set planning rather than
built: **stateful nodes and cross-message synchronization** — a
Node-RED-style `join` node that buffers messages arriving on separate
wires and fires once N of them have arrived (or once a
correlating key's whole set has), and the broader class of node holding
state *across separate trigger events within one deployed flow's
lifetime* (not to be confused with §5's already-real flash-backed
variable store, which persists a single node's value across redeploys
and power cycles, keyed by node ID -- this is a different thing: e.g. "AND
of live wire A's last value and live wire B's last value," or "don't fire
until both a motion sensor and a door sensor have each reported once").
Real fan-in (this session, see `node-definition-model.md`) makes the
wiring shape expressible -- multiple upstream nodes CAN already feed one
downstream node -- but the downstream node re-firing once per independent
arrival, with no memory of what arrived before, is Node-RED's own basic
fan-in semantics, not a join. A real join/synchronization primitive is
its own design problem (buffering semantics, timeout/partial-set
behavior, what "N" means when wiring is edited) worth scoping properly
whenever it's picked up, not bolted onto a single node type ad hoc. Not
blocking Tier 1's software-only node batch (boolean/arithmetic/
comparator/variable-get-set/debug all ship stateless for now), but worth
tracking here so it doesn't get rediscovered from scratch later.

## One sequencing call worth flagging rather than assuming

Tier 1 and Tier 2 are written as separate tiers for clarity, but they
shouldn't be strictly serial in practice — live value streaming only needs
Tier 0 plus a handful of working node types to start being useful, and
building it early gives every subsequent Tier 1 node type a working
inspector to validate against as it's added, rather than validating nodes
blind until Tier 2 finally lands.
