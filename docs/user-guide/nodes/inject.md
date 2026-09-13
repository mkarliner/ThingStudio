# inject

Fires once, with a fixed payload, when you click its "▶" icon while connected to a board. Click anywhere else on the node to open its property panel instead.

## Properties

- **payload type** — `bool`, `number`, or `string`.
- **value** — the fixed value to send, matching the chosen type.

## Behavior

The "▶" icon and the rest of the node are two separate click targets. The icon fires — only while live-connected, and only that one message; there's no periodic firing and no automatic fire-at-boot. The node body opens the property panel, live or not, so you can edit a flow's inject values without disconnecting first. A freshly deployed flow with only `inject` sources does nothing until you click one. There's currently no dedicated node for "run automatically when a flow starts."
