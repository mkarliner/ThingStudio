# Reviews

Point-in-time reviews of a subsystem or a goal: what was examined, what was found, and what is recommended. A review
records findings, not decisions. Anything Mike decides on the back of one goes into `decisions/<topic>.md` as usual,
and open work it surfaces goes into `outstanding-items.md`.

Files are named `YYYY-MM-DD-<topic>.md`, so the folder sorts by date. A review is not updated in place once the work
it reviewed has moved on; write a new one and link back.

- `2026-10-18-node-parity-architecture.md` -- node-format parity (built-in vs custom nodes) as of v0.3.0: progress,
  and why the descriptor-vocabulary approach works against the extensibility goal.
- `2026-10-19-compile-hooks-response.md` -- review of the compile-hook implementation and the network conversions
  that answered the 2026-10-18 review: direction confirmed, robustness/test-evidence findings.
- `2026-10-19-compile-hooks-response-reply.md` -- the author's response to that review, for a further cycle:
  per-finding agreement, the 7/8 single-flight proposal, the interpreter plan, and the proposed order. A response,
  not a review.
- `2026-10-19-reply-review-and-smoke-test.md` -- review of that reply, the browser smoke test
  (`tools/compile_hook_smoke.py`) and its results, the "two compilers" concern, and recommendations for the remaining
  blocked nodes (two-faced `ntp`, the shared MQTT client, `http_in`, and the rest).
- `2026-10-23-architecture-and-status.md` -- what is still wrong with the architecture (memory on small boards,
  editor as single point of failure, hand-mirrored versions, the unmerged WASI interpreter, parity leftovers,
  no user-authored GUI widgets) and overall launch status.
- `2026-10-24-protocol-audit.md` -- board ↔ editor wire protocol: message layer sound; deploy exchanges can
  leave the board refusing every deploy, or overwrite the saved flow. Diagrams in
  `interfaces/protocol/SEQUENCES.md`; re-run with `device-runtime/test/audit_protocol_exchanges.py`.
