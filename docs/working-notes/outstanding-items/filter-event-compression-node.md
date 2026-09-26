# Filter / event-compression node — built 2026-09-26

Tier 1 item 5 point 2, pulled into v1 alongside interrupt/pin-change but never implemented. Buildable with zero new compiler capability (reuses `timer.ts`'s per-instance state pattern) — just not done yet.

**2026-09-26: built.** Spec and decisions: `../filter-node-spec.md`. Code: `editor/src/node-library/filter.ts`,
tests `editor/test/node-filter.test.ts`, user page `docs/user-guide/nodes/filter.md`. Still owed: a real-hardware
run (a deadband on an MQTT sensor value is the obvious check).

