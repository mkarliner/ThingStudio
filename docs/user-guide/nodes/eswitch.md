# eswitch

Reports when a debounced switch opens or closes. Polling-based, not the interrupt-driven `interrupt` node.

## Properties

- **pin** — GPIO pin number. Default 4. Checked against your [board](../boards.md).
- **pull** — `none` (default), `up`, or `down`. Enables the board's own internal pull resistor on this pin.
- **open level (lopen)** — which electrical level means "open": `1` (default, switch to ground, pulled up) or
  `0` (switch to 3V3, pulled down).
- **debounce (ms)** — how long a level must hold before it's accepted as real. Default 50ms.

## Behavior

Each transition sends one message, a dict with two keys:

```python
msg = {'payload': True, 'topic': ''}
```

- **`payload`** — the switch state: `true` when closed, `false` when open.
- **`topic`** — empty.

`payload` is a bool, so it wires straight to `gpio out` to mirror the switch.

No internal pull is enabled by default — wire an external pull resistor, use a switch module with one built in,
or set **pull** if the switch instead relies on the board's own internal pull-up/pull-down.

Two `eswitch` nodes on the same pin share one underlying driver instance rather than each polling independently —
the first node's `lopen`/debounce/pull settings win, matching `interrupt`'s own same-pin behavior.
