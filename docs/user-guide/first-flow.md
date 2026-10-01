# Step 5: Blink an LED

Your first flow: make an LED blink once a second. It takes three nodes.

Your board should be connected, with the runtime installed: steps [3](connecting.md) and [4](installing-runtime.md).

## Find your LED's pin

Many boards have an LED you can drive from a GPIO pin. Check your board's documentation for its number. Two common ones:

| Board | LED pin |
| --- | --- |
| LOLIN S2 Mini | 15 |
| Raspberry Pi Pico (RP2040) | 25 |

The Pico W and Pico 2 W LEDs are wired through the WiFi chip, not a GPIO pin, so `gpio out` can't reach them. On those boards, or any board without an LED, wire an LED and a 330 Ω resistor from a free GPIO pin to GND.

Don't forget the resistor. Without it, the LED draws too much current and can damage the board. The LED's longer
leg goes towards the GPIO pin.

## Build the flow

1. Drag a **timer** onto the canvas. Set **interval (ms)** to `500`.
2. Drag a **function** onto the canvas. Replace its **code** with:

    ```python
    msg['payload'] = msg['payload'] % 2
    return msg
    ```

3. Drag a **gpio out** onto the canvas. Set **pin** to your LED's pin.
4. Wire **timer** → **function** → **gpio out**.

## Deploy

Click **Compile → Deploy**. The console shows each stage. A successful deploy ends like this:

```text
[compiled -- 1840 bytes of bytecode]
[deploying "my flow" as 3f2a…]
[deploy OK -- flow is running on the device]
[memory] MicroPython 180 KB free
```

The numbers and names will differ. The LED now blinks: on for half a second, off for half a second.

The flow keeps running on the board after you unplug it from your computer and power it another way.

## How it works

The **timer** sends a message every 500 ms. Its payload is a count: 1, 2, 3, and so on.

**gpio out** turns the pin on for any payload that isn't zero. Wired straight to the timer, the LED would switch on and stay on.

The **function** node turns the count into 1, 0, 1, 0 — the remainder after dividing by 2. That gives on, off, on, off.

## If it doesn't blink

- **Deploy is greyed out:** you aren't connected. Click **Connect**.
- **Compile fails:** usually a mistake in the function node's code, such as a missing quote or wrong
  indentation. The console shows the Python error in red, with its line, and highlights the node. Fix the code and
  deploy again.
- **Deploy works, then the console shows `[NODE_ERROR]`:** the code ran on the board and failed, for example on a
  misspelt name. The message names the error, and the node is highlighted.
- **Deploy fails:** the console says why. See [Board won't connect](debugging.md#board-wont-connect).
- **Deploy works but the LED stays dark:** check the pin number. **Pins…** next to the Board menu shows your board's LED pin, if its definition names one. Some boards' LEDs light when the pin is off; the LED still blinks, just the other way round.
