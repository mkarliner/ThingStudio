# Context model decisions

- **2026-10-21 — the no-code path (Q3) is a generic `change` node, not the narrow pair.** Mike chose option (b)
  from `context-model-scoping.md` §8, with no legacy flows to preserve. v1 is one rule per node: `set` or `delete`,
  targeting a **msg property** or a **flow variable**; a set copies a literal (string/number/bool) or another
  msg/flow value. Node context stays function-code only in v1 because a one-rule node could set its own context but
  never read it; revisit if multiple rules are built. Built as a core package (`core-packages/change.ts`) on the
  existing `runtime.shared('flow_vars')` store, so a custom package could express the same fields. The hidden
  `variable_get`/`variable_set` nodes are removed, not deprecated: Mike confirmed nobody but him has used a
  TypeScript-era flow.
