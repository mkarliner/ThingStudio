# Wire protocol as a state machine — follow-up to the 2026-10-24 audit

The same day's audit (`2026-10-24-protocol-audit.md`) found the board ↔ editor *messages* well specified,
but not the *conversation*. Board state was a few module globals, and editor state was wherever an async
function in `main.ts` happened to be waiting. The gaps between them could leave a board refusing every
deploy, or overwrite its saved flow. Mike's call: implement the conversation as an explicit state machine,
specified, and tested on both sides. Done on the `protocol-state-machine` branch. This records what changed,
and what the audit's checks say now.

## What changed

| Where | What |
|---|---|
| `interfaces/protocol/SPEC.md` §7 (new) | Who answers what; the piece-stream state machine; commit order; the editor's waits and resends; the codes the editor acts on. One editor at a time is assumed. |
| `SPEC.md` §4 | One line holds exactly one frame, and each line is decoded on its own. |
| `SPEC.md` §5, §6 | Two overclaims corrected; an unknown type is never answered. |
| `device-runtime/src/transfer.py` (new) | The stream: idle / receiving / failed. Used for the flow and each library file. |
| `listener.py`, `deps.py` | Hand pieces to the stream. `FLOW_COMMIT` checks libraries before replacing the saved flow. Each line is decoded on its own. Runtime **13.1.0**. |
| `editor/src/protocol/transfer.ts` (new) | Deploy and library sending, moved out of `main.ts`, each ending in one named outcome. The commit's answer is waited for from the commit on. |
| `transport.ts`, `backend-transport.ts` | Each line decoded on its own (`protocol.decodeLineFrame`). |
| `interfaces/protocol/vectors/exchanges.json` (new) | 12 whole conversations, run by both sides. |
| `interfaces/protocol/SEQUENCES.md` | Redrawn for the new behaviour, with a state diagram of the stream. |

## The audit's findings now

| # | Finding | Now |
|---|---|---|
| 1 | Resent flow piece, or any refused commit, left every later deploy refused | **fixed**: any piece may be resent; offset 0 starts over; a commit ends its stream |
| 2 | Resent library piece refused, and the library stuck refused | **fixed**: same rules, one stream per library file |
| 3 | Refused chunked deploy replaced the saved flow | **fixed**: checks before the rename (SPEC §7.3) |
| 4 | An early `DEPLOY_ERROR` became the deploy's result | **fixed**: the commit's wait starts at the commit |
| 5 | No request ids; USB and WiFi share replies | **open**: SPEC §7 states one editor at a time; ids are an interface change (`outstanding-items.md`) |
| 6 | Unknown type answered as a garbled piece | **fixed**: logged, never answered |
| 7 | The spec had no exchanges | **fixed**: SPEC §7, and exchange vectors |
| 8 | The backend leg isn't specified | **open** (`outstanding-items.md`) |
| 9 | Two spec overclaims | **fixed** |
| 10 | `FLOW_PUT` had no bounds check | **fixed**: part of the stream table |
| 11 | *New, found by the exchange vectors:* a damaged line that is still valid base64 went unanswered, its bytes kept in the decoder until five lines later, so the resend was read as its continuation (both sides) | **fixed**: each line decoded on its own; the board answers it `Garbled` at once |

`device-runtime/test/audit_protocol_exchanges.py` prints "fixed" for every board-side finding (1a, 1b, 1c,
2a, 2b, 3, 6). It printed PRESENT for each before the change.

## Test evidence

Run in a scratch workspace: a fresh `npm ci`, and MicroPython's unix port and `mpy-cross` built from upstream.

- Editor: the full suite passes, including `protocol-transfer.test.ts` (17 tests) and `protocol-exchanges.test.ts`
  (the editor's 5 exchanges and a guard). Typecheck is clean. With resends switched off, exactly the four resend
  exchanges fail, which shows the runner can catch drift.
- Board: every MicroPython suite passes, including `test_transfer.py` (the spec table, 15 tests) and `test_deps.py`
  (3 new tests); `test_listener_integration.py` 26/26; `test_exchanges.py` 12/12.
- Backend: `pytest` passes.
- `tools/protocol_coverage.py --check` finds no problems.

Not yet on hardware: see the `outstanding-items.md` entry for the CYD pass.

## Re-running

Steps 1–2 of the audit's own re-run list, plus `test_exchanges.py` and `protocol-exchanges.test.ts`. A new
fault in a conversation belongs in `exchanges.json` first. That is how finding 11 was found.
