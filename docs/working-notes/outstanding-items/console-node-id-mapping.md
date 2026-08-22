# Live console output shows raw numeric node IDs only

No way to map `NODE_ERROR node=4`/`DEBUG node=2` back to a canvas node without reading the flow file's JSON by hand. Logged as a priority bug, 2026-08-19, in `mikes-questions-and-points.md`'s "Bugs -- priority" section. The editor already tracks a node-id↔canvas-node mapping internally (`graph-adapter.ts`'s `reteIdByNodeId`/`nodeIdByReteId`) for other reasons, so this should be a small, contained fix. Unstarted.
