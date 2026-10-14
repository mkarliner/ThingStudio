# Boards and processors

Each board and processor has a definition file that says which pins a flow may use. This page covers picking a board, seeing its pins, what gets checked, and writing your own definition files.

Thingstudio checks every pin in a flow against the board the flow is for. If a pin doesn't exist on that board, or using it would crash the board, the compile stops and says why.

Each board has a definition file, and so does each processor. Thingstudio comes with definitions for the boards and processors below. You can [change them or add your own](#your-definition-files).

## Picking the board

Pick the board a flow is for from the **Board** menu in the toolbar. The default, **Auto**, uses the connected board. Auto recognises a board by the name MicroPython reports for it, and the menu shows what it found, for example **Auto: LOLIN S2 Mini**.

Some boards report only their processor. The CYD, for example, reports itself as a generic ESP32. Pick those boards from the menu by hand. You can also pick a processor without a board, for example **ESP32 (any board)**.

A board picked by hand stays picked when you reconnect. If you then connect a board with a different processor, the menu goes back to **Auto** and the console says so.

If no board is connected and none is picked, pins are only checked against the range 0–48.

## Seeing a board's pins

Click **Pins…** next to the **Board** menu. It opens a page, in its own tab, for the board or processor picked
there. The page lists, in order:

- the pins the board names, such as its LED
- for boards whose definition has a `header`, such as the Pico family, the physical pins, laid out like the board,
  with power and ground marked
- every pin, with whether it's free, reserved or best avoided, and why
- which pins each SPI and I2C bus can use

The page is read from the definition files each time you click. After changing a file, click **Pins…** again.

If Thingstudio knows the board's processor but not the board, the page shows the processor's pins and says the
board's own ones, like its LED, are missing. It gives a starter file to add them: see
[Adding a board](#adding-a-board). If it doesn't know the processor either, the page says what the board reports:
see [Adding a processor](#adding-a-processor).

## What gets checked

These stop the compile:

- a pin the board or processor doesn't have
- a reserved pin, such as a pin wired to the flash chip
- an output on an input-only pin
- an SPI or I2C bus the processor doesn't have, or a pin that bus can't use
- an SPI speed the processor can't run on those pins

These give a warning, but the flow still compiles:

- a pin to avoid, such as a strapping pin that changes how the board starts
- a pull-up or pull-down on a pin that has no internal pull resistor

Warnings appear in the console when you deploy, and at the end of the compiled source.

In the properties panel, a pin field shows the board's name for that pin, such as `LED`. It also flags reserved pins and pins to avoid. On a board whose pins are named rather than numbered, the field is a dropdown of the board's pins. See [Pins that aren't numbers](#pins-that-arent-numbers).

## Built-in boards

| Board | Processor | Notes |
| --- | --- | --- |
| Raspberry Pi Pico | RP2040 | LED on GPIO 25 |
| Raspberry Pi Pico W | RP2040 | GPIO 23, 24, 25 and 29 go to the WiFi chip. The LED isn't on a GPIO. |
| Raspberry Pi Pico 2 | RP2350 | GPIO 0–29. LED on GPIO 25. |
| LOLIN S2 Mini | ESP32-S2 | LED on GPIO 15, button on GPIO 0 |
| LuatOS ESP32C3-CORE | ESP32-C3 | Pick by hand. LEDs on GPIO 12 and 13, button on GPIO 9. |
| CYD (ESP32-2432S028, ST7789) | ESP32 | Pick by hand. Display, touch, SD, RGB LED and speaker pins are labelled. |
| Freenove ESP32-S3 Display 4.0" (FNK0104S, ST7796) | ESP32-S3 | Pick by hand. Display and touch pins are labelled. 320x480, SPI bus 1. Rotation 1 is portrait. For landscape, set the display's `orientation` to 90 (or 270 for the other way up) and keep the screen and display at 320x480. Display and touch (FT6336U) work. |
| Pyboard v1.0 | STM32F405 | Pins are named `X1`–`X22` and `Y1`–`Y12`. The four onboard LEDs are on `A13`, `A14`, `A15` and `B4` (labelled `LED_RED`–`LED_BLUE`); the user switch `SW` is on `X17`. |

## Built-in processors

| Processor | GPIO | Reserved |
| --- | --- | --- |
| ESP32 | 0–19, 21–23, 25–27, 32–39 (34–39 input only) | 1, 3 (USB serial), 6–11 (flash) |
| ESP32-S2 | 0–21, 26–46 (46 input only) | 27–32 (flash) |
| ESP32-S3 | 0–21, 26–48 | 27–32 (flash) |
| ESP32-C3 | 0–21 | 12–17 (flash) |
| RP2040 | 0–29 | none |
| RP2350 | 0–47 (0–29 on the RP2350A) | none |
| STM32F405 | X1–X22, Y1–Y12 (named pins, not numbers) | none |

The ESP32 runs SPI at up to 27 MHz on most pins. Faster speeds need the bus's own fast pins (SCK 14 and MOSI 13 on bus 1, SCK 18 and MOSI 23 on bus 2).

On the RP2040 and RP2350, each SPI and I2C bus can only use certain pins. The compile error lists the pins that work.

The definition files list every pin to avoid, with the reason.

## Your definition files

Definition files live in `~/.thingstudio/boards/` and `~/.thingstudio/processors/`. When Thingstudio starts, it copies in any built-in file that's missing, so you can read and edit them there.

To change a built-in board, edit its file. To get the original back, delete the file and restart Thingstudio. A newer
version of Thingstudio doesn't update a file you already have, so delete a file to pick up its new built-in version.

Thingstudio reads these files when the editor starts, when you connect, and when you deploy. If a file has a mistake, it isn't loaded and the built-in is used instead. The console says what's wrong, and the Board menu lists the file under **Invalid files**.

## Adding a board

Save a JSON file in `~/.thingstudio/boards/`. The file name, without `.json`, is the board's id. Use lowercase letters, digits, `-` and `_`.

```json
{
  "name": "My weather station",
  "processor": "esp32-c3",
  "match": [],
  "pins": { "LED": 8, "SENSOR_SDA": 4, "SENSOR_SCL": 5 },
  "avoid": { "9": "Wired to the BOOT button." },
  "notes": "Hand-built, rev 2."
}
```

The fields are:

| Field | Meaning |
| --- | --- |
| `name` | Name shown in the Board menu. Required. |
| `processor` | Id of the processor, such as `esp32` or `rp2040`. Required. |
| `match` | Board names MicroPython reports, for Auto. Use `[]` to pick the board by hand. Required. |
| `pins` | Names for pins, shown in the properties panel. Required, can be `{}`. |
| `gpio` | The pins this board has, if fewer than its processor. For example `["0-29"]`. |
| `reserved` | Pins that must not be used, each with a reason. |
| `avoid` | Pins that give a warning, each with a reason. |
| `free` | Pins the processor reserves or warns about that are fine on this board. For example `["12-13"]` on an ESP32-C3 board whose flash doesn't use them. |
| `notes` | Anything else worth knowing. |
| `wifi` | `false` if the board has no WiFi. Hides [connecting over WiFi](wifi-connection.md) for it. Leave it out if unsure. |
| `headerOrder` | `"down"` if the right-hand row is numbered top to bottom, like the left. Leave it out for a header numbered down the left and back up the right, like the Pico's. |
| `usb` | Where the USB connector is, with pin 1 at the top left: `"top"` or `"bottom"`. Shown on the **Pins…** page. Needs `header`. |
| `header` | What each physical pin carries: a pin (a GPIO number, or a named pin), or a label such as `"GND"` or `"3V3"`. Shown on the **Pins…** page. For example `{ "1": 0, "3": "GND", "40": "VBUS" }`. A string that's one of the board's pins is that pin; any other string is a label. |

Numbers in `header` are physical pin numbers, as printed on the board or its datasheet. A header numbered 1 to N
is drawn in two columns, like the Pico's. For a board with several connectors, name the pins `"P3-1"` and so on.

Pin lists take numbers and ranges: `[0, 2, "4-7"]`. In `reserved` and `avoid`, the key is a pin or a range: `{ "6-11": "Wired to the flash chip." }`. A processor whose pins are named uses the names in the same places: see [Pins that aren't numbers](#pins-that-arent-numbers).

To find the name MicroPython reports, connect the board and look for `chipType` in the console's `[HELLO]` line. The board name is the part before " with ".

## Adding a processor

Save a JSON file in `~/.thingstudio/processors/`, named the same way as a board file. The built-in files in that folder are good examples.

The fields are:

| Field | Meaning |
| --- | --- |
| `name` | Name shown in the Board menu. Required. |
| `match` | Text in the processor name MicroPython reports, such as `ESP32S3`. Case, spaces and `-` are ignored. Required. |
| `nativeArch` | The mpy-cross `-march` value, such as `xtensawin`. Required. |
| `gpio` | Every pin the processor has. Numbers, or names on a processor whose pins aren't numbered. Required. |
| `inputOnly` | Pins that can't drive an output. |
| `noPull` | Pins without internal pull resistors. |
| `reserved`, `avoid` | As for boards. |
| `spi`, `i2c` | Bus numbers, pins each bus can use, and SPI speed limits. |

## Pins that aren't numbers

Some processors, such as the STM32 on a pyboard, name their pins (`X1`, `A13`) instead of numbering them. In a definition file, a pin is either a number, a range `"4-7"`, or a name: a string that starts with a letter and contains only letters, digits, `_` and `-`. Names go wherever numbers do — `gpio`, `pins`, `reserved`, `avoid`, a bus's pins — and a list can mix both. Ranges work for numbers only; list named pins one by one.

```json
{
  "name": "Pyboard",
  "match": ["STM32F405"],
  "nativeArch": "armv7emsp",
  "gpio": ["X1", "X2", "X3", "X4", "Y1", "Y2", "Y3", "Y4"]
}
```

In the editor, a pin field on a named-pin board is a dropdown of the board's pins rather than a number input.
