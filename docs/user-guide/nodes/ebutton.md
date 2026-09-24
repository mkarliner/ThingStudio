# ebutton

Reports press, release, long-press, and double-click events from a single debounced button.

## Properties

- **pin** — GPIO pin number. Default 5. Checked against your [board](../boards.md).
- **pull** — `none` (default), `up`, or `down`. Enables the board's own internal pull resistor on this pin.
- **sense** — which electrical level means "pressed": `auto` (default, reads the pin's own boot state as
  "not pressed"), `0`, or `1`.
- **suppress** — off by default. When on, `press`/`release` are held back until it's clear the click isn't the
  first half of a double — a plain single click still reports `press` then `release`, just delayed by up to the
  double-click window; an actual double-click reports only `double`, not `press`/`release` for the first click too.
- **debounce (ms)** — default 50ms.
- **long press (ms)** — how long a press must hold to count as `long`. Default 1000ms.
- **double click (ms)** — the window a second press must land in to count as `double`. Default 400ms. Must be
  less than long press.

## Behavior

`topic` is one of `press`, `release`, `long`, `double`. `payload` is the button's state at the moment the event
fired (`true` = currently pressed) — always `true` for `press`, always `false` for `release`, and whatever the
button is doing right now for `long`/`double`.

With `suppress` off (the default), a press always reports immediately, whether or not a second press follows —
so a rapid double-click reports both a `press` and a `double`, not `double` alone. Turn `suppress` on if a plain
single press should never be reported when it turns out to be part of a double-click.

No internal pull is enabled by default — wire an external pull resistor, use a button module with one built in,
or set **pull** if the button instead relies on the board's own internal pull-up/pull-down (a common case for
boards with buttons wired straight to a GPIO with no resistor of their own — e.g. most of an EMF 2022 TiDAL
badge's buttons).

Two `ebutton` nodes on the same pin share one underlying driver instance rather than each polling independently —
the first node's settings win, matching `eswitch`/`interrupt`'s own same-pin behavior.
