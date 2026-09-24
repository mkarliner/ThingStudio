# "Init node triggered by start of flow?" — raw open question, never discussed

From `mikes-questions-and-points.md`'s "Nodes - to be prioritised" list, never discussed even in the Tier 1 prioritization session that triaged every other item on that list. Whether `inject`'s manual/repeat semantics already cover this is unconfirmed — resolve alongside the inject-node review, not separately.

**Resolved 2026-09-24.** Answered by the `startup` node (`thingstudio/startup`,
`inject-node-live-fire-and-startup-node.md`): fires once per flow start, after DEPLOY and after a reset that resumes
the saved flow. Its codegen and test landed 2026-09-17 but it was never registered or put on the canvas; this session
added it to `registry.ts`, `nodes.ts` (`StartupNode`), `palette.ts` (olive, "⏻", general group after inject),
`PropertyPanel.vue` (payload fields), `verify-flow-file.ts`, and `docs/user-guide/nodes/startup.md`. The two stale
test expectations (`codegenFireableSource`, `register_fireable`, both from the pre-2026-09-02 design) were updated.
Not yet checked on hardware: deploy a `startup` → `gpio_out` flow, then press reset with the editor disconnected.
