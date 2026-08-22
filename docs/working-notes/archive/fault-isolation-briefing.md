# Briefing: fault isolation + witness/DUT rig (§5) implementation

> **Status: fully resolved as of 2026-08-19 — see
> `docs/working-notes/outstanding-items.md`.** Both halves of §5 fault
> isolation and the witness+DUT rig itself are built and hardware-confirmed
> (`git log`: "Fault isolation (§5) confirmed on real hardware -- Tier 0
> complete"). Kept for historical reference, not active reading.

For the next chat. Read `CLAUDE.md` and `../thingstudio-design-doc.md` in
full before starting — this is a pointer/summary, not a replacement for
either. As of commit `c083b25`.

## Where things stand

Three of Tier 0's four foundations are done: the general compiler, the
`msg` envelope, and the real wire protocol (§13) — the last one on the
browser/JS side only (`editor/src/protocol/`: framing, CBOR codec,
message types, version handshake, all tested off-device, 76 tests
passing). See `docs/working-notes/wire-protocol-briefing.md` and its
dated Results entry in `validation/mvp-validation-plan.md` for that
piece's detail.

This briefing is the fourth and last Tier 0 foundation: **fault
isolation, both halves (§5)**, plus a real prerequisite that doesn't
exist yet — **the witness+DUT hardware-in-the-loop rig** itself.
Genuinely different from every prior piece of this project: this is the
first task that needs two physical boards wired together and cannot be
meaningfully progressed off-device beyond writing the listener code
itself. Mike is physically setting the boards up now (same class as
POC-A/D's LuatOS CORE-ESP32-C3, per the validation plan's rig design) —
whoever picks this up next should confirm that's done and the boards are
reachable before starting.

Full detail, don't re-derive any of this from scratch:
- `docs/working-notes/validation/mvp-validation-plan.md` — "Hardware-in-
  the-loop rig: witness + DUT" (pin map, witness firmware contract, the
  I2C/SPI slave-mode spike) and the "Fault isolation" section under Tier
  0 (the actual per-task/listener validation bar). Both sections already
  written, this task's job is to make them true, not redesign them.
- `docs/working-notes/mvp-feature-priorities.md` — Tier 0's fault-
  isolation bullet, for the one-paragraph version.
- `docs/working-notes/repo-structure-and-conventions.md` — where this
  code lives (`device-runtime/src/`, `test/hil/`), naming ("listener"
  and "runtime", not "harness" — that name is retired, see the note
  there), CI split (this is explicitly **not** CI-automatable; it's a
  manual, documented local gate).

## The task: fault isolation (§5), both halves

### Half 1 — per-task exception boundary (deployed flow coroutines)

An uncaught exception inside a node's coroutine is caught at the
per-task boundary (`uasyncio` surfaces exceptions on task completion)
instead of crashing the whole event loop. The failing subgraph's task
stops and reports a structured error back over the transport — this is
where §13's real `NODE_ERROR` message (node ID + exception type/message,
already implemented and tested on the JS decode side) finally gets a
real device-side sender — while the rest of the flow keeps running.

### Half 2 — listener/transport task hardening

A different property, for a different reason, added after POC-D
(§15.5) hit exactly this gap on real hardware: the listener task owns
the raw transport stream and (per §9) disables the normal interrupt-
character escape hatch while it does, so if the listener itself dies
from an unhandled exception, there's no REPL fallback and no way to
attempt another `DEPLOY` — only a physical reflash recovers it. Two
mitigations, both already validated conceptually by POC-D's hardware
run and worth carrying into the real listener as first-class design,
not bolted on after:

- The listener's own dispatch loop must never exit on an unhandled
  exception — every phase wrapped, logged as a structured error, loop
  continues.
- Every blocking read within it must be time-bounded, never able to
  hang indefinitely on a partial/garbled transfer.
- No protocol code path may assume a specific-byte-count read
  (`read(n)`/`readexactly(n)`) is safe — POC-D's actual bug was exactly
  this hanging the event loop outright on this port. Verify per-port;
  ride binary payloads on `readline()` (base64-encoded) the way POC-D's
  fix does, unless a given port proves otherwise.
- A boot-time window where the interrupt character is still live (a few
  seconds before the runtime commits to taking over the transport) is a
  second, physical-access-independent fallback layer on top of the
  above, not a replacement for it.

This is also where the real device-side wire-protocol listener actually
gets built — `device-runtime/src/runtime.py` is currently just the
`spawn()`/`asyncio` stub the compiler's generated code imports, per the
wire-protocol briefing's own "not in scope" note. Building the real
listener against §13's framing (2-byte big-endian length, covering
type+body; message type bytes 1–8 per `editor/src/protocol/messages.ts`
— **that exact table is the only source of truth for these values
right now and the device side must match it**) is part of this task,
not a separate one — fault isolation without a real listener to harden
isn't testable.

## Prerequisite: the witness+DUT rig

Doesn't exist yet (`test/hil/` is empty per the repo layout doc). Two
ESP32-C3 boards, each with its own independent USB connection to the
host: one (**DUT**) runs the actual runtime/listener under test, the
other (**witness**) runs small, purpose-built, reusable test firmware
that stimulates/observes the DUT's pins and reports back over its own
serial link — a channel that stays alive even if the DUT's own
transport doesn't. This directly closes the gap POC-A/D's hardware
checks had: trusting a human watching an LED, or trusting the DUT's own
printed output, which POC-D's worst bug (the whole event loop wedging,
taking its own heartbeat print down with it) proved can't be trusted for
exactly this kind of test.

### Pin map (from the validation plan, don't re-derive)

| DUT side | Witness side | Used for |
|---|---|---|
| GPIO out pin | GPIO in, IRQ + `ticks_us()` edge capture | `gpio_out` validation |
| GPIO in pin | GPIO out, witness drives a known signal | `gpio_in` validation |
| PWM out pin | GPIO in, edge-capture across N cycles | duty-cycle/frequency measurement |
| I2C SDA/SCL | I2C SDA/SCL, witness in slave mode (pending spike) | sensor-node protocol testing |
| Dedicated heartbeat pin | GPIO in, continuous watch | independent liveness signal during soak tests |
| GND | GND | common reference |

### Witness firmware contract

One small, reusable, configurable firmware image on the witness board —
not one-off code per test — driven over its own USB serial link with a
simple line-based text protocol (this is test infrastructure, not the
product's own runtime, so it deliberately does **not** need §13's real
CBOR protocol — same spirit as the POCs' own ad hoc harness protocols).
Commands: `WATCH_EDGES <pin>`, `MEASURE_PWM <pin> <n_cycles>`,
`DRIVE_GPIO <pin> <value>`, `HEARTBEAT_WATCH <pin> <timeout_ms>`, and
(pending the spike below) `I2C_SLAVE_EMULATE <addr> <register_map>`.
Worth its own README once built (pin map, command protocol, setup
instructions), matching the README-per-component convention every POC
already follows.

### I2C/SPI slave-mode spike (gated, not a blocker)

Before the rig is load-bearing for sensor-node validation, confirm
MicroPython on the actual target board supports slave/peripheral-mode
I2C — controller/master mode is the well-trodden path, slave-mode
exposure varies by port and isn't something to assume. If it doesn't
pan out cleanly: not a blocker, just a scope limit — the rig still
covers digital GPIO/PWM/timer node classes regardless, and I2C/SPI
sensor nodes (Tier 1, not this task) keep needing at least one pass
against the real physical part either way. This spike is genuinely
optional for *this* task (fault isolation doesn't need I2C slave mode)
— only run it now if it's cheap to fold in alongside the rig build;
otherwise it's fine to leave `(pending)` and let Tier 1's sensor-node
work trigger it later.

## Validation plan's Tier 0 bar for this (already written, don't re-derive)

From `mvp-validation-plan.md`'s "Fault isolation" section:

- **Per-task boundary**: deploy a multi-node flow containing one
  deliberately broken node; confirm `NODE_ERROR` reports the correct
  node ID and exception info, and confirm every other node/task keeps
  running unaffected. Real hardware test — inherently about `uasyncio`
  task behavior under real scheduling, not something off-device
  testing can substitute for.
- **Listener/transport hardening regression tests** against POC-D's
  actual historical bugs, not just new scenarios: send a malformed
  frame mid-transfer, confirm the listener logs and recovers rather
  than dying (the exact incident that used to require a full `esptool`
  reflash); confirm no protocol code path reintroduces a
  `read(n)`/`readexactly(n)` call without re-verifying it against this
  port's known hang.
- **Fault-injection soak test**: 50 consecutive malformed/garbled
  frames sent to a running device, confirm the listener task survives
  all 50 — direct analog to POC-A's 50-redeploy stress run, testing
  survivability instead of cleanliness. Liveness during this test must
  be confirmed via the witness rig's `HEARTBEAT_WATCH`, not the DUT's
  own printed heartbeat — POC-D's actual bug was the event loop
  wedging entirely, taking its own heartbeat print down with it, so
  self-reported liveness can't be trusted for exactly this test.
- **Results:** currently `(pending)` in the validation plan — this
  task's job is to turn that into a dated entry, honest about what
  isn't covered, same convention every prior piece has followed.

### Also close out, while hardware is set up anyway

The wire protocol's own still-pending hardware pass (from this
project's most recent commit): "real device round-trips real messages
over real WebSerial, confirming the off-device expectations actually
hold." Same listener code is what carries that traffic, so doing both
in one hardware session is more efficient than two separate ones — but
they're tracked as separate Results entries in the validation plan
(wire protocol's own section vs. fault isolation's), don't conflate the
write-ups.

## Conventions to keep following (all established this repo — don't relitigate)

- `CLAUDE.md`: prompt for commits at natural checkpoints; flag any new
  npm/Python package before installing; update
  `docs/third-party-licenses.md` in the same change as any new
  dependency.
- Off-device first, with adversarial/malformed input, before any claim
  of "done" — already true for the listener's parsing logic itself
  (reuse/extend the JS-side adversarial framing tests' *scenarios*,
  `editor/test/framing.adversarial.test.ts`, as the source of cases to
  port to the Python side's own off-device tests, even though the
  actual verification has to be on-device for the reasons above).
  `tsc --noEmit` / ruff clean, full test suite green before every
  commit.
- Dated Results entries appended to `mvp-validation-plan.md`'s relevant
  sections once actually verified — honest about what isn't covered.
- "Harness" is retired as a name (repo-structure-and-conventions.md) —
  use "listener" and "runtime", matching §5's own vocabulary. Doesn't
  touch `pocs/poc-a`/`poc-d`'s `harness.py`, which stays frozen/
  historical.
- This is a **manual, local hardware gate, not CI** — don't try to wire
  `test/hil/` into `.github/workflows/ci.yml`; that's an explicit,
  already-made call in repo-structure-and-conventions.md, revisit only
  if self-hosted runners with real attached hardware ever become worth
  it.

## Not in scope for this chat

- Tier 1 (the node set) — Tier 0 isn't finished until this task lands,
  but don't start Tier 1 nodes here even once it does.
- I2C/SPI sensor-node validation itself (as opposed to the slave-mode
  spike that's optionally part of rig setup) — that's Tier 1, gated on
  having actual sensor hardware per part number.
- The OTA-capable-partition-table hedge (separate Tier 0 item, build-
  config only, no dependency on this task).
- Multi-flow node-ID-uniqueness bookkeeping (§6, explicitly v2-scope).
