# Briefing: runtime context model — scoped, awaiting Mike's calls

Written 2026-10-17, continuation of `node-parity-remaining-nodes-briefing.md`. This session changed **no code** — it
scoped the Node-RED-style runtime context model and stopped for Mike's decisions. Read `context-model-scoping.md`
first; it is the whole artifact. It **supersedes** the prior briefing's "portable now: `variable-set`" line.

## What landed

- `docs/working-notes/context-model-scoping.md` — the scoping pass `outstanding-items/context-model-node-red-style.md`
  had been waiting for since 2026-09-06. Inventories the existing stores, separates the two axes (scope vs durability),
  proposes a shape, ends with six open questions for Mike (§12). Proposes; does not commit.
- Pointed the outstanding item's "Not scoped" section, and its index entry in `outstanding-items.md`, at it.
- Committed `257aa56`. Nothing else touched.

## Why now, and what it blocks

- `variable_get`/`variable_set` **are** the flow-context accessor. Porting the pair 1:1 into core packages would cement
  the narrow design Mike hid on 2026-09-06, so the model is decided first. `variable-set` is off the portable list
  until §8 (the no-code-node question) is answered.
- The flash-backed state store (design doc §5/§11) is meant to sit on this same API — the other reason not to build
  either piece ad hoc.
- Not the same "context" as `node-context-parity-scoping.md` (that one is compile-time `CodegenContext`; phase 2a
  landed). Two different things that share a word.

## State of play (don't re-derive)

All compiler-emitted today; the device runtime knows nothing about it:

- **flow** — `_flow_vars`, module-level dict, name-keyed (`variable-{get,set}.ts`, function-node `flow.get/set`).
- **context** — per-instance dict, **function node only** (`ctx.uniqueName`).
- **`_Store`** — 6-line class emitted by function codegen (`function-node.ts:52`).
- Wiped on redeploy (the flow module re-imports). No `global`, no persistence. `STATE_READ`/`STATE_WRITE` reserved on
  the wire and ignored.

Key finding: **only `function` can reach context.** A built-in or package using context is not reproducible as a
package — the parity gap that motivates this.

## The six open questions (Mike's call — scoping §12)

Load-bearing: **1–3**.
1. Scope set: node + flow only, `global` reserved?
2. Mechanism: runtime-owned accessor vs compiler-emitted? (proposed runtime-owned; it is a **major** runtime bump and
   the only shape a package can reach.)
3. No-code path: revive `variable_get`/`variable_set`, build a generic Change-style node, or function-code-only?
   (This also decides whether the parity work ports the two nodes at all.)
4. Timing: pre-MVP or after the current parity push?
5. Persistence boundary: design the API to leave room for a per-entry persist flag / storage backend, build neither?
6. `STATE_*`: device-internal persistence, or use the wire messages?

## Suggested next order

1. Get Mike's answers to **1–3**; 2 and 3 gate everything else.
2. If approved, land the volatile model per scoping §13: runtime store accessor (node + flow, memory only), migrate
   `function` codegen and the `variable_*` nodes onto it, update `interfaces/runtime-api/`
   (`SPEC.md` + `api.json` + conformance), **major** runtime version bump, verify "no loss" targets 1–2.
3. `timer` is genuinely portable and independent of all this — safe to do while the context questions are open.
4. Leave `variable_get`/`variable_set` unported until §8 is answered.

## Constraints and gotchas

- Interface changes (runtime API, descriptor, wire) need Mike's explicit OK; run the conformance tests; keep the SPEC
  readable.
- A `runtime.py` addition this change reaches is a **major** bump of both `_RUNTIME_VERSION` and
  `EDITOR_TARGET_VERSION`, same change (root `AGENTS.md`).
- Any `device-runtime/src` change: run the real MicroPython suite, not `py_compile`.
- `find editor/src editor/test -name "*.js" -delete` before trusting any `tsc`/`vitest` run; prefer
  `./node_modules/.bin/tsc --noEmit`.
- Working-notes line width <120.

## Git state

`HEAD = 257aa56`, 26 commits ahead of `origin/main`, **not pushed**. All docs-only; no `.js` regeneration needed.
