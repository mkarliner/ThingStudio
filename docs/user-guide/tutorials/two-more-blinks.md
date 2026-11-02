# Two more blinks

You have a blinking LED from [Blink an LED](../first-flow.md): timer, function, gpio out, with the function
turning the timer's count into on and off. Two more ways to produce the same blink:

- **Read the pin, write it back:** the blink's state lives on the board, in the pin, and the `function` node runs
  your own MicroPython to reach it.
- **Keep the state in the node:** the state lives inside the `function` node itself, in `context`.

The flow stays the same; only the function's code changes. To start from the finished flow, open
[two-more-blinks.flow.json](https://github.com/mkarliner/ThingStudio/blob/main/examples/two-more-blinks.flow.json),
in the [examples folder](../examples.md#where-the-folder-is), with **File → Open…**. Open the file; don't copy
it from this page. It carries the first of the two blinks: change `15` in `machine.Pin(15)` to your LED's GPIO
number.

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
opposite of what it found. The state, what the LED is actually showing, lives on the board between messages, so
the flow can't contradict it.

`machine.Pin` is MicroPython's own pin API. Constructed with a number and no other settings, it takes the pin as it
is and `.value()` reads the level the `gpio out` node has written. The write itself goes out of the function's
output, through to `gpio out`.

The pin fields on gpio nodes are checked against your board at compile time, but code inside a function isn't. If
`PIN` isn't a pin number your board has, the compile check passes and the error arrives when the flow runs, as a
`[NODE_ERROR]` in the console. See [Reading a node error](../debugging.md#reading-a-node-error); **Pins…** next to
the **Board** menu lists your board's pins.

## Keep the state in the node

!!! note "An important point to understand"

    A flow is stateless: each event is handled on its own, without regard to what came before. In general this is
    a good thing:

    - An error shows up with the message that caused it, not in some state built over earlier operations.
    - Recovery is doing nothing: the next message starts clean. A crashed stateful component needs its data
      restored to an acceptable earlier version, with nothing to say which that is.

    When a flow does need to remember, Thingstudio's answer is a **context** — state held between messages, either
    private to one node (`context`) or shared across the whole flow (`flow`). This blink's LED level belongs to one
    function node, so its private store is the one to use. All three stores, `context` and `flow` among them, are
    in [Context, flow and settings](../nodes/function.md#context-flow-and-settings); `settings` even survives a
    reboot.

The pin held the state on the board. The other place is inside the function node itself:

```python
on = not context.get('on', False)
context.set('on', on)
msg['payload'] = on
return msg
```

Deploy again: the same blink. Nothing outside the node holds the state now. `context.get('on', False)` reads this
function node's own memory; `context.set('on', on)` writes it; the `False` is what `.get` answers when nothing is
stored yet, which is why the first message turns the LED on.

For state kept without code, the [change](../nodes/change.md) node stores a flow variable, the same store a
`function`'s `flow.get()`/`flow.set()` reads. A `change` node can store a flow variable but can't flip it, so a toggle
needs a function node.

## Next

The next tutorial, the next job, and the node pages behind the code:

- [Web Blink](blink-from-your-network.md) — the next tutorial: the same LED, driven by an `http in`
  node from anywhere on your WiFi.
- [A sensor display](../sensor-display.md) — the next job: read a sensor and show it on a screen.
- [gpio out](../nodes/gpio-out.md) — what else the node that drives the LED can do.
- [function](../nodes/function.md) — `context`, `flow` and `settings`, and several outputs from one function node.
