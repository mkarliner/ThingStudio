# Step 6: Blink an LED

Your first flow: make an LED blink once a second, using three nodes.

Your board should be connected, with the runtime installed: steps [4](connecting.md) and [5](installing-runtime.md).

## Find your LED's pin

Many boards have an LED wired to a GPIO pin. To find it, click **Pins…** next to the **Board** menu. Pins that the
board names, such as `LED`, are listed first. [Supported hardware](supported-hardware.md) lists the boards Thingstudio
has definitions for. For any other board, check its documentation.

The Pico W and Pico 2 W LEDs are wired through the WiFi chip, not a GPIO pin, so `gpio out` can't reach them. On
those boards, or any board without an LED, wire an LED and a 330 Ω resistor from a free GPIO pin to GND. The LED's
longer leg goes towards the GPIO pin.

Don't leave out the resistor. Without it, the LED draws too much current and can damage the board.

## Build the flow

1. Drag a **timer** onto the canvas. Set **interval (ms)** to `500`.
2. Drag a **function** onto the canvas. Replace its **code** with:

    ```python
    msg['payload'] = msg['payload'] % 2
    return msg
    ```

3. Drag a **gpio out** onto the canvas. Set **pin** to your LED's GPIO number.
4. Wire **timer** → **function** → **gpio out**.

## Deploy

Click **Compile → Deploy**. A successful deploy ends like this in the console:

```text
[deploying "my flow" as 3f2a…]
[deploy OK -- flow is running on the device]
```

The flow name and ID will differ. Set the console's **Show** menu to **Info** or **Debug** to see each stage,
including the board's free memory.

The LED now blinks: on for half a second, off for half a second.

The flow keeps running on the board after you unplug it from your computer and power it another way.

## How it works

The **timer** sends a message every 500 ms. Its payload is a count: 1, 2, 3, and so on.

**gpio out** turns the pin on for any payload that isn't zero. Wired straight to the timer, the LED would switch on
and stay on.

The **function** node turns the count into 1, 0, 1, 0 with `% 2`. That gives on, off, on, off.

## Next, pick:

Each version the function above could take holds the LED's state somewhere different: in the timer's count, on the
hardware, or with `context` in the node (see
[Context, flow and settings](nodes/function.md#context-flow-and-settings)). A flow keeps state only where you put
it: in a message, on the hardware, or in a node.

- [More blinking](tutorials/more-blinking.md) — three changes to this flow, one at a time: the blink's speed, which
  half is lit, and reading the LED's pin instead of counting.
- [A sensor display](sensor-display.md) — the next job past blinking: read a sensor and show it on a screen.

## If it doesn't blink

Each symptom below has its own fix:

- **Deploy is grayed out:** you aren't connected, so click **Connect**. Deploy is also grayed out after a deploy
  until you change the flow, while the flow is stopped at the Python prompt (**Stop flow & open prompt**), and while
  the board restarts.
- **Compile fails:** usually a mistake in the function node's code, such as a missing quote or wrong
  indentation. The console shows the Python error in red, with its line, and highlights the node. Fix the code and
  deploy again.
- **Deploy works, then the console shows `[NODE_ERROR]`:** the code ran on the board and failed, for example on a
  misspelt name. The message names the error, and the node is highlighted.
- **Deploy fails:** the console says why. See [Board won't connect](debugging.md#board-wont-connect).
- **Deploy works but the LED stays dark:** check the pin number against **Pins…**. Some boards' LEDs light when
  the pin is off; the LED still blinks, the other way round.

For anything else, see [Debugging & troubleshooting](debugging.md).
