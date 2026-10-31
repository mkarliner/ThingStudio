# More blinking

Three changes to the flow from [Blink an LED](../first-flow.md): change its speed, swap which half of the blink is
lit, and read the LED's pin instead of counting. Each change edits the flow you have. Open it, change one thing,
deploy again.

You'll want that flow blinking first: timer → function → gpio out, as in Step 6 of Getting started. Lost the flow?
Download [blink.flow.json](https://github.com/mkarliner/ThingStudio/blob/main/test-flows/blink.flow.json) and open
it with **File → Open…**.

If a step misbehaves on the way, start at [Debugging & troubleshooting](../debugging.md).

## Change the speed

Set the timer's **interval (ms)** to `2000`. The LED blinks once every two seconds: on a second, off a second. Try
`100` for a fast flutter. The board runs the last flow you sent, so deploy after each change you want to keep.

## Swap which half is lit

Some boards wire the LED so it lights when the pin is off, not on — a board's own LED can be like this. The blink
still blinks; what changes is which half of the cycle is lit. To have the LED light while the pin is on, replace the
function's code with:

```python
msg['payload'] = (msg['payload'] + 1) % 2
return msg
```

This belongs with the counting version of the function (`msg['payload'] = msg['payload'] % 2`): `% 2` keeps the
count's low bit, and `+ 1` before it flips that bit. Skip this change if you'd rather move on — the next change
blinks under either wiring.

## Read the pin instead of counting

The function node tracks on and off by counting. Stop counting, and let the hardware say where the LED is. Replace
the function's code with this, using your LED's GPIO number in place of `PIN`:

```python
import machine
msg['payload'] = 0 if machine.Pin(PIN).value() else 1
return msg
```

Each message now reads the pin and writes the opposite of what it read. The state — the LED's actual level — lives
on the board between messages, so the flow can't drift from it: a lost message doesn't put the blink out of rhythm,
because the next message reads where the LED really is.

The pin fields on a `gpio out` node are checked against your board at compile time. Code inside a function is not:
if `PIN` isn't a pin number your board really has, the compile check passes and the error arrives when the flow
runs, as a `[NODE_ERROR]` in the console. See [Reading a node error](../debugging.md#reading-a-node-error), and
**Pins…** next to the **Board** menu lists your board's pins.

## Next, pick:

- [A sensor display](../sensor-display.md) — the next job past blinking: read a sensor and show it on a screen.
- [function](../nodes/function.md) — everything else a `function` node can do, from several outputs to state kept
  for the whole flow.
- [Debugging & troubleshooting](../debugging.md) — what the console's lines mean when a change misbehaves.
