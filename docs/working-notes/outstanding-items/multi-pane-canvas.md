# Multiple panes for one large flow (still one flow)

Mike's clarification, 2026-09-13, of the "Allow multiple panes (still one flow)" bullet in
`mikes-questions-and-points.md`: the goal is letting a large flow be split visually across multiple panes/areas
for organization -- e.g. one pane per logical subsystem (network setup, sensor readings, actuator control) --
while it stays one single flow underneath: one canvas graph, one compile/deploy unit. Not Node-RED's
separate-tabs-are-separate-flows model.

## Resolved, 2026-09-13

- **Tabbed, not tiled.** One pane visible at a time, navigated via tabs -- not a simultaneous split/tiled view.
- **Cross-pane wires deferred to post-MVP.** The MVP build of this feature does not need a visual affordance for
  a wire that crosses a pane boundary. Mike noted Node-RED has only just landed its own version of this (virtual
  named link-in/link-out node pairs standing in for an off-screen wire) -- that's the reference model for
  whenever this gets picked up, not something to design from scratch. For MVP, wires stay within a single pane.
  This is enforced structurally rather than by any new validation code: since only one pane's nodes are ever on
  screen at a time (tabbed, not tiled, above), there's never a node from another pane to drag a wire to in the
  first place.
- **Pane membership: a separate layer, not a node property.** Matches `flow-file.ts`'s existing `layout` map
  (`Record<nodeId, {pos, size}>`), kept fully split from the `nodes` array for exactly the same reason
  `flow-file.ts`'s own header comment gives -- Node-RED's `flows.json` mixes position into the node object, so
  rearranging the canvas and a real behavior change look identical in a `git diff`. Pane membership is the same
  category of thing (visual/organizational, not behavioral), so it follows the same shape: a `panes:
  Record<nodeId, paneId>` map alongside `layout` in the flow file, regenerated fresh from the live node set on
  every save the same way `buildFlowFile()` already regenerates `layout` -- no separate persisted store to drift
  out of sync. The one piece with no existing library doing it for free: live in-editor pane-membership state
  needs its own upkeep on node delete, the way Rete's `AreaPlugin` already handles position for free -- there's
  no `AreaPlugin` equivalent for pane assignment, so that bookkeeping is bespoke Thingstudio code. A new node
  defaults into whichever pane is currently open when it's created, following directly from that same model.
- **Pane naming.** Each pane's default name is "Flow nn" (sequentially numbered as panes are added). Renamed by
  double-clicking the pane's tab label, same inline-edit pattern as a browser tab or spreadsheet sheet tab. Note:
  this is a separate name from the whole document's own `flowName` (`flow-file.ts`'s `DEFAULT_FLOW_NAME`,
  `"untitled flow"`, edited via the existing flow-name field in the UI) -- worth double-checking in practice that
  having both a document-level name and per-pane "Flow nn" names on screen at once doesn't read as confusing,
  but not a blocker.
- **Add / remove / reorder.** A "+" at the pane-tab-bar level adds a new pane. Each pane's own tab carries an "X"
  alongside its name to remove it. No reordering for MVP -- panes stay in creation order; reordering is
  post-MVP, tracked here for when it's picked back up alongside the cross-pane wire affordance.
- **Removing a pane deletes its nodes.** Hitting a pane's "X" deletes every node it contains, not just the pane
  itself (Mike, 2026-09-13). Since this discards live flow content in one click, the implementation should have
  it go through a confirmation prompt first, the same way any other destructive single-click action would -- an
  implementation detail, not a further design question.

## Not scoped yet

No open design questions remain -- this is buildable as scoped.

**Priority: P1 (Mike, 2026-09-13). Post-MVP: cross-pane wire affordance (link-node style) and pane reordering,**
**tracked here for when they're picked back up.**
