# Live console output shows raw node IDs only, and nothing is clickable

Logged as a priority bug, 2026-08-19, in `mikes-questions-and-points.md`'s "Bugs -- priority" section.

**Corrected, 2026-09-04 -- this file's original claim ("Unstarted") was wrong.** `main.ts`'s `highlightNode()`/`highlightNodeFromNodeError()`/`highlightNodeFromMpyError()` already exist and are wired to real `NODE_ERROR` messages and mpy-cross compile errors -- a matching node already turns red on the canvas automatically, no session ever built that path from scratch. What's actually still open, narrowed by that audit:

- **`DEBUG node=X` console lines have no attribution at all.** They arrive as raw print text (`onDebugLine`), never parsed -- unlike `NODE_ERROR`, which is a structured §13 message with its own `nodeId` field. `debug.ts`'s codegen already emits a parseable `DEBUG node=<id> payload=...` line, so this is a regex away (`main.ts`'s `highlightNodeFromMpyError` already does the equivalent line-number parse for compile errors, same pattern).
- **Nothing is clickable.** Highlighting today only ever fires automatically on a live error; there's no way to click any console line (a past `NODE_ERROR`, a `DEBUG` line, anything) and jump to/select/pan-to its node. This was the actual original ask (Mike, 2026-09-04, mid-conversation about the MQTT hardware validation session).

Both are still open, deferred to phase 2 of the same 2026-09-04 session that fixed the id-stability issue below -- kept separate on purpose so each could be `tsc`/`vitest`-verified independently.

**Also fixed as a side effect, 2026-09-04 (`decisions.md`'s "Stable node IDs" entry):** the id-mapping `highlightNode()` used (`lastReteIdByNodeId`, recomputed fresh on every compile) carried a real staleness risk -- an edit made after a deploy but before a device response arrived could point a `NODE_ERROR` at the wrong live node, not just fail to resolve one. Node ids are now each node's own stable Rete identity end-to-end (compiler, wire protocol already was, flow file), so `highlightNode()` is now a direct `editor.getNode(nodeId)` lookup with no mapping to go stale. This is also what makes the still-open click-to-navigate UI a small addition rather than a new mechanism -- see `decisions.md` for the full reasoning and file list.
