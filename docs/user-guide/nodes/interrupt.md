# interrupt

Fires immediately when a GPIO pin changes state — genuinely event-driven, not polled.

## Properties

- **pin** — GPIO pin number. Checked against your [board](../boards.md).
- **edge** — `rising`, `falling`, or `both`.
- **debounce** — on by default. Ignores further transitions within the debounce window after an accepted one.
- **debounce (ms)** — the debounce window, shown when debounce is on. Default 50ms.

## Behavior

The payload is the pin's level (`true`/`false`) at the moment the node wakes, not a record of every intermediate change — a burst of bounces inside the debounce window collapses into one report of the settled state, by design.

No internal pull resistor is configured. Wire an external pull resistor, or use a button module with one built in.

Two `interrupt` nodes configured for the same pin silently share the first one's edge/debounce settings rather than erroring — a real limitation, not a crash, but worth knowing if a second interrupt node on the same pin doesn't seem to behave the way its own property panel says.
