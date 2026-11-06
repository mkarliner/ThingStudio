# Kitchen-sink board

How to wire a test board for the input and output nodes: a potentiometer, a push button and a NeoPixel on a LuatOS
ESP32C3-CORE. Tutorials that need hardware beyond an LED use these parts on these pins, so a flow from one tutorial
runs on a board wired for another. Wire all of it, or only the parts a tutorial needs.

## What you need

- A LuatOS ESP32C3-CORE, the version with a USB-serial chip (CH343). The version with native USB works too, but
  needs GPIO 18 and 19 left free.
- A 10 kΩ potentiometer. Any value from 1 kΩ to 100 kΩ works.
- A push button.
- One WS2812 (NeoPixel) LED, on a breakout or as part of a strip.
- Hookup wire, and a breadboard or stripboard.

## Wiring

The parts connect to these pins. The header pin is the number on the board's pin list; **Pins…** in the editor
shows where each one is.

| Part | Connection | GPIO | Header pin | Name in the editor |
| --- | --- | --- | --- | --- |
| Potentiometer | one end | — | 13 (3V3) | |
| | wiper (middle) | 0 | 2 | `POT` |
| | other end | — | 1 (GND) | |
| Push button | one side | 3 | 20 | `BUTTON` |
| | other side | — | 17 (GND) | |
| WS2812 | DIN | 6 | 22 | `PIXEL` |
| | 5V | — | 16 or 31 (5V) | |
| | GND | — | 14 or 32 (GND) | |

The button needs no resistor: set the `ebutton` node's **pull** to `up`. The board also has two LEDs of its own,
`LED_D4` (GPIO 12) and `LED_D5` (GPIO 13), and the `BOOT` button (GPIO 9), so a flow can use those with nothing
wired.

## Pick the board

Choose **Kitchen sink (LuatOS ESP32C3-CORE)** from the **Board** menu. The board reports itself as a generic ESP32-C3,
so Auto can't find it. Pin fields then show `POT`, `BUTTON` and `PIXEL` next to their numbers.

## Check each part

Wire one node to a `debug` node, or to a `neopixel` node, and deploy:

- **Potentiometer**: an `adc` node on pin 0. Turning the knob sends readings to the console.
- **Button**: an `ebutton` node on pin 3, **pull** `up`. Pressing it sends `press` and `release`.
- **NeoPixel**: a `startup` node with **payload type** `number` and **value** `8192` (`0x002000`), into a
  `neopixel` node on pin 6 with **count** 1. The LED lights dim green.

## Other pins

To put the parts on other pins, keep these points in mind:

- **Potentiometer**: GPIO 0–4 can read a voltage. GPIO 5 can too, but not while WiFi is on.
- **Avoid** GPIO 2, 8 and 9: they decide how the board starts. GPIO 11 powers the flash chip.
- **Rename pins** by saving a copy of the board's file under a new name: see
  [Adding a board](boards.md#adding-a-board).
