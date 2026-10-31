# Read and set a pin

How to read the LED's pin and switch it from your own MicroPython — the `function` node running `machine.Pin`
directly — and then keep the state in the node with `context`.

The flow you built in [Blink an LED](../first-flow.md) is the starting point: timer → function → gpio out, with the
function turning the timer's count into on and off. Lost it? Download
[read-and-set-a-pin.flow.json](https://github.com/mkarliner/ThingStudio/blob/main/test-flows/tutorials/read-and-set-a-pin.flow.json)
and open it with **File → Open…**.

If a step misbehaves on the way, start at [Debugging & troubleshooting](../debugging.md).

## Read the pin, write it back

Each message so far decides the LED by counting. Let the pin say where it is instead. Replace the function's code
with this, using your LED's GPIO number in place of `PIN`:

```python
import machine
msg['payload'] = 0 if machine.Pin(PIN).value() else 1
return msg
```

Deploy. The LED blinks as before, but the reason has changed: each message now reads the pin and writes back the
opposite of what it found. The state — what the LED is actually showing — lives on the board between messages, so
the flow can't contradict it. A lost message doesn't leave the blink waiting to recover; the next message reads
where the LED is and carries on.

`machine.Pin` is MicroPython's own pin API. Constructed with a number and no other settings, it takes the pin as it
is and `.value()` reads the level the `gpio out` node has written. The write itself goes out of the function's
output, through to `gpio out`.

One limit to know: the pin fields on a `gpio out` node are checked against your board at compile time, but code
inside a function is not. If `PIN` isn't a pin number your board has, the compile check passes and the error arrives
when the flow runs, as a `[NODE_ERROR]` in the console. See [Reading a node error](../debugging.md#reading-a-node-error);
**Pins…** next to the **Board** menu lists your board's pins.

## Keep the state in the node

The pin was one place for the state. Replace the function's code with this and the state moves into the function
node itself, in `context`:

```python
on = not context.get('on', False)
context.set('on', on)
msg['payload'] = on
return msg
```

Deploy again: the same blink. Nothing outside the node holds the state now. `context.get('on', False)` reads this
function node's own memory; `context.set('on', on)` writes it; the `False` is what `.get` answers when nothing is
stored yet, which is why the first message turns the LED on. A `function` node keeps nothing between messages on
its own — `context` is the part of it that does.

For state kept without code, the [change](../nodes/change.md) node stores a flow variable, the same store a
`function`'s `flow.get()`/`flow.set()` reads. Making it the opposite of its old value needs the old value read, and
`change`'s one rule doesn't do that — so a toggle stays in `context`.

## Next, pick:

- [Tutorials](index.md) — what comes next: the same LED, driven by an `http in` node from anywhere on your WiFi.
- [A sensor display](../sensor-display.md) — the next job: read a sensor and show it on a screen.
- [gpio out](../nodes/gpio-out.md) — what else the node that drives the LED can do.
- [function](../nodes/function.md) — `context`, `flow` and `settings`, and several outputs from one function node.
