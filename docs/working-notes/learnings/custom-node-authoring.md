# Learnings — Custom node authoring

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **A custom node's top-level `.node.py` code runs inside a generated
  per-instance wrapper function, not at true module scope — `nonlocal`,
  not `global`, is the correct idiom for persistent state.** First-party
  node codegen (e.g. `timer.ts`) inlines its code directly at true
  module/coroutine scope, where `global` is correct; a custom-node author
  following that same familiar pattern would hit a `NameError` at deploy
  time instead, since no module-level name exists inside the wrapper.
  Self-caught while writing `custom-node.test.ts`'s closure-isolation
  test, not by a real deploy failure — documented prominently in
  `custom-node.ts`'s header comment and in `docs/user-guide/custom-nodes.md` (its own
  dedicated section) given the project's fault-handling-first priority.
  `custom-node-authoring-scoping.md`.
