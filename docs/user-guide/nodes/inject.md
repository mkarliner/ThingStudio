# inject

Fires once, with a fixed payload, when you click its node on the canvas while connected to a board.

## Properties

- **payload type** — `bool`, `number`, or `string`.
- **value** — the fixed value to send, matching the chosen type.

## Behavior

`inject` only fires on a click while live-connected — there's no periodic firing and no automatic fire-at-boot. A freshly deployed flow with only `inject` sources does nothing until you click one. There's currently no dedicated node for "run automatically when a flow starts."
