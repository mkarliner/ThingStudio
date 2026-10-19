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
