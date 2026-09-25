# startup

Sends one message with a fixed payload each time the flow starts.

## Properties

- **payload type** — `bool`, `number`, `string`, or `start reason`.
- **value** — the fixed value to send, matching the chosen type. Not used with `start reason`.

## Output

Every message has a `reason` field saying why the flow started. With payload type `start reason`,
the payload is that same string.

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
chips the button cuts power to the core. A board running a runtime older than 5.1.0 always sends `unknown`.

## Behavior

The flow starts after every Deploy, and again whenever the board resets or powers up with a saved flow.
So `startup` runs even when the editor isn't connected. Use it for setup work, such as setting an output
to a known state or drawing a first screen.

It fires once per start and never repeats. For a message you trigger by hand, use [inject](inject.md).
For a repeating one, use [timer](timer.md).
