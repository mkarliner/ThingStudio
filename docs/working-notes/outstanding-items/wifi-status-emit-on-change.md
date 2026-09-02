# `wifi_status` should only emit on change, not every poll

**Implemented 2026-09-02, not yet verified by Mike** (compiler/codegen change only -- `npm test`/`tsc --noEmit`/build not run from the sandbox, per CLAUDE.md's npm rule; real hardware retest still owed).

Mike's ask, 2026-09-02. Confirmed by direct read of `wifi-status.ts`: `buildMsg` unconditionally emits `{'payload': _wifi_connected, ...}` every `pollMs` (default 5000ms), with no comparison against the previous reading at all.

Fix needs a persisted "last known state" global (per-node, `ctx.uniqueName`-scoped state, matching other stateful nodes' pattern -- e.g. `interrupt.ts`'s cooldown state) and a compare-then-emit-or-skip in `buildMsg`. `compile.ts`'s existing `if msg is not None:` downstream-fan-out guard (already used to let a source's `buildMsg` skip a cycle, e.g. interrupt's debounce) looks like the right mechanism to reuse for "no change, skip this cycle" rather than inventing a new one.
