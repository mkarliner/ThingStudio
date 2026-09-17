# eswitch

Reports when a debounced switch opens or closes. Polling-based, not the hard-IRQ `interrupt` node — use this when a
simple debounced switch is all you need.

## Properties

- **pin** — GPIO pin number (0–39). Default 4.
- **pull** — `none` (default), `up`, or `down`. Enables the board's own internal pull resistor on this pin.
- **open level (lopen)** — which electrical level means "open": `1` (default, switch to ground, pulled up) or
  `0` (switch to 3V3, pulled down).
- **debounce (ms)** — how long a level must hold before it's accepted as real. Default 50ms.

## Behavior

Fires once per transition: `topic` is `close` or `open`, `payload` is `true` when closed. A downstream node that
only cares about current state can read `payload` alone and ignore `topic`.

No internal pull is enabled by default — wire an external pull resistor, use a switch module with one built in,
or set **pull** if the switch instead relies on the board's own internal pull-up/pull-down.

Two `eswitch` nodes on the same pin share one underlying driver instance rather than each polling independently —
the first node's `lopen`/debounce/pull settings win, matching `interrupt`'s own same-pin behavior.
