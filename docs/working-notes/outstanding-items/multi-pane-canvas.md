# Multiple panes for one large flow (still one flow)

Mike's clarification, 2026-09-13, of the "Allow multiple panes (still one flow)" bullet in
`mikes-questions-and-points.md`: the goal is letting a large flow be split visually across multiple panes/areas
for organization -- e.g. one pane per logical subsystem (network setup, sensor readings, actuator control) --
while it stays one single flow underneath: one canvas graph, one compile/deploy unit. Not Node-RED's
separate-tabs-are-separate-flows model.

## Not scoped yet

Real design questions once this gets picked up:

- How a node's pane membership is represented -- a property on the node itself, or a separate visual-only
  grouping layer that the compiler never sees at all?
- Whether panes are simultaneously visible (a tiled/split view) or one-at-a-time (tabs, Node-RED-style, but all
  backed by the same one flow rather than Node-RED's independent-flows-per-tab model).
- Whether wires are allowed to cross pane boundaries -- almost certainly yes, since it's still one flow, which
  means some "this wire continues in another pane" visual affordance is needed. Node-RED's own link-node
  convention (a virtual in/out pair standing in for an off-screen wire) is the obvious reference point.

**Priority: P1 (Mike, 2026-09-13).**
