# Blink an LED

Your first flow: make an LED blink once a second. It takes three nodes.

Before you start, [connect a board](getting-started.md#connect-a-board) that has the Thingstudio runtime installed.

## Find your LED's pin

Many boards have an LED you can drive from a GPIO pin. Check your board's documentation for its number. Two common ones:

| Board | LED pin |
| --- | --- |
| LOLIN S2 Mini | 15 |
| Raspberry Pi Pico (RP2040) | 25 |

The Pico W and Pico 2 W LEDs are wired through the WiFi chip, not a GPIO pin, so `gpio out` can't reach them. On those boards, or any board without an LED, wire an LED and a 330 Ω resistor from a free GPIO pin to GND.

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

Click **Compile → Deploy**. The LED blinks: on for half a second, off for half a second.

The flow keeps running on the board after you unplug it from your computer and power it another way.

## How it works

The **timer** sends a message every 500 ms. Its payload is a count: 1, 2, 3, and so on.

**gpio out** turns the pin on for any payload that isn't zero. Wired straight to the timer, the LED would switch on and stay on.

The **function** node turns the count into 1, 0, 1, 0 — the remainder after dividing by 2. That gives on, off, on, off.

## If it doesn't blink

- **Deploy is greyed out:** you aren't connected. Click **Connect**.
- **Deploy fails:** the console says why. See [Board won't connect](debugging.md#board-wont-connect).
- **Deploy works but the LED stays dark:** check the pin number. **Pins…** next to the Board menu shows your board's LED pin, if its definition names one. Some boards' LEDs light when the pin is off; the LED still blinks, just the other way round.
