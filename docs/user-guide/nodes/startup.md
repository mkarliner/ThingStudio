# startup

Sends one message with a fixed payload each time the flow starts.

## Properties

- **payload type** — `bool`, `number`, `string` or `start reason`. Default `bool`.
- **value** — the value to send, read as the payload type (see
  [Typed values](../working-in-the-editor.md#typed-values)). Default `true`. Hidden with `start reason`.

## Wiring

**Input** — none. `startup` is a source.

**Output** — a message with `payload` set to the value, `topic` set to an empty string, and `reason` saying why the
flow started. With payload type `start reason`, the payload is that same string.

| reason | the flow started because |
| --- | --- |
| `deploy` | you clicked Deploy |
| `power_on` | the board was powered up |
| `hard_reset` | the reset button was pressed |
| `watchdog` | a watchdog timer reset the board |
| `deep_sleep` | the board woke from deep sleep |
| `soft_reset` | software restarted the board, for example `machine.reset()` |
| `unknown` | the board can't tell |

Not every board reports every reason. ESP32 boards report the reset button as `power_on`, because on those
chips the button cuts power to the core.

## Behavior

The flow starts after every deploy and each time the board starts (see [Deploy](../flow-lifecycle.md#deploy)), so
`startup` fires even when the editor isn't connected. Use it for setup work, such as setting an output to a known
state or drawing a first screen.

It fires once per start and never repeats. For a message you send by hand, use [inject](inject.md). For a repeating
one, use [timer](timer.md).

## Errors

- **The value isn't a number,** with payload type `number`. The deploy goes through; when the flow starts, the
  console shows a `[NODE_ERROR]` naming this node and `startup value 'abc' is not a valid number`.
