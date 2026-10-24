# Wire protocol as a state machine — follow-up to the 2026-10-24 audit

The same day's audit (`2026-10-24-protocol-audit.md`) found the board ↔ editor *messages* well specified,
but not the *conversation*. Board state was a few module globals, and editor state was wherever an async
function in `main.ts` happened to be waiting. The gaps between them could leave a board refusing every
deploy, or overwrite its saved flow. Mike's call: implement the conversation as an explicit state machine,
**as data that is the ground truth**, run by both sides, with illegal transitions raising alerts. Done on the
`protocol-state-machine` branch. This records what changed, and what the audit's checks say now.

A first pass wrote the state machine as code: a class whose branches mirrored the spec's table. Mike pointed
out that this was not what he had asked for. The table should be data, the code should be smaller, and the
whole thing should be easy to audit. The second pass, below, replaced it.

## What changed

| Where | What |
|---|---|
| `interfaces/protocol/states.json` (new) | **The ground truth.** Three machines: `board.listener` (every message the board can receive), `board.stream` (a file arriving in pieces, for the flow and each library file), `editor.transfer` (the editor's pieces, resends and commit). States, events, named guards and actions, an ordered transition table, an `illegal` rule. |
| `tools/protocol_states.py` (new) | Validates the table and generates `STATES.md` (diagrams and tables for people), the board's `protocol_states.py` and the editor's `states.generated.ts`. `make test` checks they are current. |
| `SPEC.md` §7 (new), §4, §5, §6 | Who answers what; the table is the ground truth; commit order; the editor's waits; codes; §7.6 illegal transitions and their alerts. One line holds one frame. Two overclaims corrected. |
| `device-runtime/src/statemachine.py` (new) | The board's interpreter (four functions) and `board.stream`'s guards and actions. `listener.py` dispatches every line through `board.listener`; its old `if/elif` dispatcher is gone. Runtime **13.1.0**. |
| `editor/src/protocol/machine.ts`, `transfer.ts` (new) | The editor's interpreter, and a `TransferSession` that sees every message from the board and runs `editor.transfer`. Deploy and library sending moved out of `main.ts`. |
| `transport.ts`, `backend-transport.ts` | Each line decoded on its own (`protocol.decodeLineFrame`). |
| `interfaces/protocol/vectors/exchanges.json` (new) | 14 whole conversations, run by both sides, saying where an alert must and must not happen. |

**Alerts.** On the board an illegal move prints `PROTOCOL_ILLEGAL <machine> <state> <event>: <detail>`, which
reaches the editor's console. A reply type the table doesn't allow for the current transition raises the same
alert. In the editor an illegal move is a red `[protocol] illegal: <event> while <state> (<detail>)` line.
Examples: a board-only message sent to the board, a piece after a gap, a `DEPLOY_ACK` mid-transfer, an answer for
a piece never sent. The user docs (`debugging.md`) say to report it.

## The audit's findings now

| # | Finding | Now |
|---|---|---|
| 1 | Resent flow piece, or any refused commit, left every later deploy refused | **fixed**: any piece may be resent; offset 0 starts over; a commit ends its stream |
| 2 | Resent library piece refused, and the library stuck refused | **fixed**: same machine, one stream per library file |
| 3 | Refused chunked deploy replaced the saved flow | **fixed**: checks before the rename (SPEC §7.3) |
| 4 | An early `DEPLOY_ERROR` became the deploy's result | **fixed**: the commit's answer is only taken while committing |
| 5 | No request ids; USB and WiFi share replies | **open**: SPEC §7 states one editor at a time; ids are an interface change |
| 6 | Unknown type answered as a garbled piece | **fixed**: logged, never answered |
| 7 | The spec had no exchanges | **fixed**: SPEC §7, `states.json`, exchange vectors |
| 8 | The backend leg isn't specified | **open** (`outstanding-items.md`) |
| 9 | Two spec overclaims | **fixed** |
| 10 | `FLOW_PUT` had no bounds check | **fixed**: illegal in the table |
| 11 | *New, found by the exchange vectors:* a damaged line that is still valid base64 went unanswered, its bytes kept until five lines later | **fixed**: each line decoded on its own; answered `Garbled` at once |
| 12 | *New, found by writing the table:* a `Garbled` answer to a commit was never resent | **fixed**: a transition in `editor.transfer` |

## Board RAM

Measured on MicroPython's unix port, which is 64-bit; an ESP32 needs roughly half. The runtime before this branch
is compared with the runtime now.

| Runtime installed as | Held after boot | Smallest heap that boots |
|---|---|---|
| Frozen into the firmware image | 25.1 → 28.8 KB | 31 → 33 KB |
| Precompiled `.mpy` (normal install) | 95.3 → 108.2 KB | 112 → 125 KB |
| `.py` source (fallback) | — | 146 → 155 KB |

Frozen, the table itself costs 160 bytes, because it is a flat tuple of strings that stays in flash. Earlier forms
cost far more: a dict of dicts was 8 KB as `.mpy`, and nested tuples 11 KB. The interpreter is four functions
rather than a class. One finding came out of the measuring: importing the state machine early fragmented the heap
when booting from `.py` source, so a 200 KB heap no longer booted. It is now imported after the other modules,
with a collect first.

## Test evidence

Run in a scratch workspace: a fresh `npm ci`, plus MicroPython's unix port and `mpy-cross` built from upstream.

- **Editor:** 1,235 tests pass, and the typecheck is clean. `protocol-transfer.test.ts` has 22 tests, and
  `protocol-exchanges.test.ts` runs the editor's 6 exchanges. Mutating the editor so that one illegal move goes
  unreported fails the exchange test, and so does turning resends off.
- **Board:** every MicroPython suite passes. `test_transfer.py` checks each legal move (no alert), each illegal
  move (exactly one alert), and a table this side can't run. `test_listener_integration.py` passes 26/26, and
  `test_exchanges.py` passes 13/13, including the alert checks.
- **Backend:** `pytest` passes.
- **Generated files:** `tools/protocol_states.py --check` and `tools/protocol_coverage.py --check` find no
  problems.
- **Audit script:** `device-runtime/test/audit_protocol_exchanges.py` prints "fixed" for every board-side finding.

**On hardware, 2026-10-24:** the 13.1.0 image was flashed to the CYD, HELLO reported 13.1.0 with 34 frozen
libraries, and the dummy GUI flow deployed twice in one session over the running flow. A `FLOW_PUT` piece and a
`DEP_PUT` piece were each sent twice: both ACKs succeeded, and `DEP_COMMIT` installed the library (`DEP_OK`) --
the resends that used to end in `BadPiece`. No `PROTOCOL_ILLEGAL`.

## Re-running

1. `python3 tools/protocol_states.py --check` and `python3 tools/protocol_coverage.py --check`.
2. `test_exchanges.py` and `protocol-exchanges.test.ts` (the shared conversations), and
   `audit_protocol_exchanges.py`.
3. Read `STATES.md`. Each row is one legal move; anything not there is illegal.

A new fault in a conversation belongs in `exchanges.json` first. That is how finding 11 was found.
