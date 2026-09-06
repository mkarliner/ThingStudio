# Decisions — Node authoring / extensibility

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

- **2026-08-20 — Custom nodes: two-file package (`<name>.node.json` +
  `<name>.node.py`), no new wire protocol.** Inlined into the existing
  DEPLOY-compiled flow module via a generic `NodeDefinition` builder
  (`buildCustomNodeDefinition`, `node-library/custom-node.ts`) that wraps
  user Python in a per-instance closure — `compile.ts` itself needs zero
  changes; a custom node's `NodeDefinition` is indistinguishable from a
  first-party one to the compiler. Distribution mechanism deliberately
  narrower than design doc §11's module-push sketch — that stays
  deferred until a real need (shared-across-flows, size) forces it, per
  `CLAUDE.md`'s no-premature-optimization principle.
  `custom-node-authoring-scoping.md`.
- **2026-08-20 — No sandboxing for custom node Python — same trust
  boundary as the `function` node, and doesn't reopen §11's dormant
  sandboxing question.** Custom nodes don't cross the existing
  deploy-access trust perimeter (§9). Mike's explicit call: "go with the
  trust-boundary call (until it bites us)." Loading is session-scoped only
  (browser File System Access API multi-file picker) — no persistence,
  file-watching, registry, or URL-install mechanism built or planned.
  Same note.
- **2026-08-20 — Custom node output ports capped at 1 by codegen
  validation, not by the package format.** The `.node.json` schema itself
  places no limit on `ports.outputs`; `validateCustomNodeDescriptor` is
  what enforces ≤1 for v1, specifically so this doesn't compromise the
  higher-priority multi-output-routing roadmap item — confirmed as the
  right framing directly with Mike ("multiple outputs is fairly high on
  the priority list... just don't do anything to compromise it"). Same
  note.
- **2026-08-21 — Custom node package persistence across app runs: waits
  for the backend, resolving Decision 4's "future work" either/or in favor
  of its backend-owned half.** Not a browser-side File System Access
  handle-persistence build — see the `Backend` section entry above for the
  reasoning and the MVP-priority consequence. `local-persistence-scoping.md`.
