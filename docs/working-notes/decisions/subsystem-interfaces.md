# Decisions — Subsystem interfaces

Status: detail file, started 2026-10-14 (architecture-review continuation). See `decisions.md` for the index, the
log's scope boundary, and its maintenance rule. Context: `../architecture-review-continuation-briefing.md`.

- **2026-10-14 — The wire protocol is a shared, language-neutral artifact, not prose held together by convention.**
  New top-level `interfaces/` holds the cross-subsystem specs; its first member is `interfaces/protocol/` —
  `SPEC.md` (authoritative for the bytes), `messages.json` (append-only id/name/direction table + `NODE_STATUS`
  states), and `vectors/` (conformance cases). The editor (`editor/test/protocol-conformance.test.ts`), device
  runtime (`device-runtime/test/test_conformance.py`) and backend (`backend/test/test_conformance.py`) all run the
  same vectors, so the three implementations can no longer drift from each other without a red test. This is the
  first concrete **subsystem-interface boundary** the architecture review called for; it is a step toward the
  planned `thingstudio-protocol` component, and is reversible (it adds no new runtime dependency). Rule: change the
  protocol by editing `interfaces/protocol/` first, then every implementation. Checks are semantic (map key order is
  irrelevant); byte-exactness is required only for framing.
- **2026-10-14 — The device runtime API and dependency manifest are specified too.** `interfaces/runtime-api/`
  (`SPEC.md` + `api.json`) documents the `runtime` module surface generated flow code may call
  (`spawn`, `shared`, `NodeError`, `register_cleanup`, `register_trigger`, `report_status`, `start_reason`,
  `_report_error`, `asyncio`, plus the listener-facing `fire_trigger`/`cancel_running`/`on_node_*` hooks), the
  module manifest (`runtime_manifest.py`'s `CORE_FILES`/`LISTENER_FILE`/`DEPENDENCIES`), and the dependency-catalog
  entry shape. Conformance keeps the four copies honest: `editor/test/runtime-api-conformance.test.ts` (real
  `runtime.py` has every documented name; the editor's `pymock/runtime.py` fixture has every codegen-facing name,
  so editor tests can't pass against a fictional API; no `editor/src` codegen references an undeclared
  `runtime.<name>`) and `device-runtime/test/test_runtime_api.py` (the real module's surface under MicroPython).
  Fixed drift found by the check: `pymock` was missing `start_reason`.
- **2026-10-14 — The node descriptor and the board/processor descriptor are specified.** `interfaces/board-descriptor/`
  (`SPEC.md` + `board.schema.json` + `processor.schema.json`) is the format of `~/.thingstudio/{boards,processors}/*.json`
  and the built-ins; `editor/test/board-descriptor-schema.test.ts` asserts the schemas' key sets equal the parser's
  (`PROCESSOR_KEYS`/`BOARD_KEYS`, now exported from `definitions.ts`), so the published schema can't drift from the
  code that enforces it. `interfaces/node-descriptor/` (`SPEC.md` + `custom-node.schema.json`) is the node-type
  contract in both forms — built-in (TypeScript `NodeDefinition` + palette + property panel + codegen) and custom
  (`.node.json` + `.node.py`); `editor/test/node-descriptor-schema.test.ts` keeps the schema's enums/pattern in step
  with `custom-node.ts` (whose validator constants are now exported). §4 of the node spec names the review's
  built-in/custom divergence explicitly and points at the new `outstanding-items/node-descriptor-unification.md`.
- **2026-10-14 — The boundaries are enforced mechanically, not just documented.** `editor/test/module-boundaries.test.ts`
  (dependency-free; scans the real import graph, run by `npm test` and CI) fails a forbidden editor cross-layer edge:
  only `app/` and `cli/` may import `app/`; `protocol/` imports no other subsystem; `compiler/` imports neither
  `node-library/` nor `app/`; nothing escapes `editor/src`. Each subsystem gets its own `AGENTS.md` (`editor/`,
  `backend/`, `device-runtime/`, `interfaces/`); `.github/CODEOWNERS` routes every interface and conformance test to
  Mike; and a `backend` CI job now runs `pytest` (including the wire-protocol conformance vectors). The
  device-runtime conformance suite is still not in CI — `outstanding-items/enforce-interface-conformance-in-ci.md`.
- **2026-10-14 — Conformance found a real cross-implementation bug, now fixed.** The editor's cborg encodes a CBOR
  float as the canonical double (`fb` + 8 bytes); the device's hand-rolled `cbor.py` emitted the non-canonical
  "f8 1b" simple-value form and its decoder read info 27 as an 8-byte integer length, so **neither side could decode
  the other's float** — in either direction. Latent because the reserved `VALUE_STREAM` is the only "any CBOR"
  field and nothing emits it. Fixed by making `cbor.py` encode and accept canonical doubles
  (`device-runtime/src/cbor.py`), with a float vector restored to `interfaces/protocol/vectors/` and a pinned unit
  test (`device-runtime/test/test_cbor.py`). No runtime version bump: no codegen emits a float today, so no
  `decideDeploy`-visible change — but the fix is in a pushed file (`learnings/micropython-device-runtime.md`).
  Separately, Mike's verdict on the feature the field exists for: **do not build `VALUE_STREAM`** — live value
  streaming targets real-time events and would slow flows; Node-RED has no equivalent. It stays reserved.
- **2026-10-14 — `AGENTS.md` gains two sections, and `CLAUDE.md` echoes them.** "Architecture first at subsystem
  interfaces: MVP-ready is not tester-ready" (a known architectural problem is fixed in the change that names it, not
  deferred into technical debt — the one-way-door rule applied to structure), and "Interface specs: read before you
  implement, change only with permission" (read the spec and run its conformance test before touching code that
  emits/parses/stores/transmits what an interface defines; the interface itself changes only with Mike's explicit
  permission, with blast radius stated). Claude Code already imports `AGENTS.md`; `CLAUDE.md` now states the rule
  explicitly so it can't be missed. Recorded in `AGENTS.md`/`CLAUDE.md` themselves.
- **2026-10-14 — Multi-repo decomposition is under investigation, not decided.** The 2026-08-12 "single monorepo"
  decision (`repo-tooling.md`) stands. The review's position: define the interfaces as artifacts first (this file),
  then split repos only where the lifecycle genuinely differs (`device-runtime`, then `protocol`); a repo boundary
  without a spec artifact is worse than the monorepo. No repo has been split.
- **2026-10-24 — The wire protocol's conversation layer is specified and tested, not just its messages.** A
  protocol audit (`reviews/2026-10-24-protocol-audit.md`) found the exchanges lived only in code: board state was
  loose module globals, editor state was wherever an async function was waiting, and the gaps left a board refusing
  every deploy after one lost ack or refused commit. Mike: implement it as an explicit state machine. `SPEC.md` §7
  ("Exchanges") now says who answers what, gives the piece-stream state machine (idle / receiving / failed: any
  piece may be resent, offset 0 always starts over, a commit ends its streams), the commit order (checks before
  anything under a real name changes), the editor's waits and resends, and the codes the editor acts on; §4 states
  that one line holds exactly one frame and is decoded on its own. Implemented as `device-runtime/src/transfer.py`
  and `editor/src/protocol/transfer.ts`; `interfaces/protocol/vectors/exchanges.json` holds whole conversations
  that both sides run, so the two can't each pass while disagreeing. One editor at a time is assumed (no request
  ids). Runtime 13.1.0. `reviews/2026-10-24-protocol-state-machine.md`.
- **2026-10-24 — The state machines are data, and the data is the ground truth (Mike).** Mike expected a table, not
  rules written as code: `interfaces/protocol/states.json` defines `board.listener`, `board.stream` and
  `editor.transfer` (states, events, named guards and actions, ordered transitions, an `illegal` rule).
  `tools/protocol_states.py` validates it and generates `STATES.md` (diagrams and tables for people) and each
  side's table; both sides run it with a small interpreter (`device-runtime/src/statemachine.py`,
  `editor/src/protocol/machine.ts`). Any (state, event) with no row is illegal and raises an alert on the side
  running the machine: `PROTOCOL_ILLEGAL ...` on the board, `[protocol] illegal ...` in the editor (SPEC §7.6); the
  exchange vectors say where alerts must and must not happen. Board RAM matters, the editor's code size doesn't:
  the board's table is a flat tuple of strings, a constant in flash when frozen into a custom image (the intended
  route for constrained boards).
- **2026-10-30 — "MVP-ready is not tester-ready" renamed to "MVP-ready is not tester-hardened".** Mike's call, so
  the `AGENTS.md` heading no longer collides with the tester-ready milestone's name, which is what people will say
  out loud (`decisions/launch-scope.md`, same date: a tester-ready deliverable now sits before the MVP,
  `docs/tester-ready.md`). Rule text unchanged. Dated entries above keep the old wording — history, not current
  rule; the 2026-10-14 `decisions.md` index line records the name the rule shipped under.
