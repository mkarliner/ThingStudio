# Boards and processors

Thingstudio checks every pin in a flow against the board the flow is for. If a pin doesn't exist on that board, or using it would crash the board, the compile stops and says why.

Each board has a definition file, and so does each processor. Thingstudio comes with definitions for the boards and processors below. You can [change them or add your own](#your-definition-files).

## Picking the board

Pick the board a flow is for from the **Board** menu in the toolbar. The default, **Auto**, uses the connected board. Auto recognises a board by the name MicroPython reports for it, and the menu shows what it found, for example **Auto: LOLIN S2 Mini**.

Some boards report only their processor. The CYD, for example, reports itself as a generic ESP32. Pick those boards from the menu by hand. You can also pick a processor without a board, for example **ESP32 (any board)**.

A board picked by hand stays picked when you reconnect. If you then connect a board with a different processor, the menu goes back to **Auto** and the console says so.

If no board is connected and none is picked, pins are only checked against the range 0–48.

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

In the properties panel, a pin field shows the board's name for that pin, such as `LED`. It also flags reserved pins and pins to avoid.

## Built-in boards

| Board | Processor | Notes |
| --- | --- | --- |
| Raspberry Pi Pico | RP2040 | LED on GPIO 25 |
| Raspberry Pi Pico W | RP2040 | GPIO 23, 24, 25 and 29 go to the WiFi chip. The LED isn't on a GPIO. |
| Raspberry Pi Pico 2 | RP2350 | GPIO 0–29. LED on GPIO 25. |
| LOLIN S2 Mini | ESP32-S2 | LED on GPIO 15, button on GPIO 0 |
| CYD (ESP32-2432S028, ST7789) | ESP32 | Pick by hand. Display, touch, SD, RGB LED and speaker pins are labelled. |

## Built-in processors

| Processor | GPIO | Reserved |
| --- | --- | --- |
| ESP32 | 0–19, 21–23, 25–27, 32–39 (34–39 input only) | 1, 3 (USB serial), 6–11 (flash) |
| ESP32-S2 | 0–21, 26–46 (46 input only) | 27–32 (flash) |
| ESP32-S3 | 0–21, 26–48 | 27–32 (flash) |
| ESP32-C3 | 0–21 | 12–17 (flash) |
| RP2040 | 0–29 | none |
| RP2350 | 0–47 (0–29 on the RP2350A) | none |

The ESP32 runs SPI at up to 27 MHz on most pins. Faster speeds need the bus's own fast pins (SCK 14 and MOSI 13 on bus 1, SCK 18 and MOSI 23 on bus 2).

On the RP2040 and RP2350, each SPI and I2C bus can only use certain pins. The compile error lists the pins that work.

The definition files list every pin to avoid, with the reason.

## Your definition files

Definition files live in `~/.thingstudio/boards/` and `~/.thingstudio/processors/`. When Thingstudio starts, it copies in any built-in file that's missing, so you can read and edit them there.

To change a built-in board, edit its file. To get the original back, delete the file and restart Thingstudio. A newer version of Thingstudio doesn't update a file you already have. Delete it to get the new one.
For example, the built-in Pico files now say `"wifi": false`; an older copy without that line still offers WiFi.

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

| Field | Meaning |
| --- | --- |
| `name` | Name shown in the Board menu. Required. |
| `processor` | Id of the processor, such as `esp32` or `rp2040`. Required. |
| `match` | Board names MicroPython reports, for Auto. Use `[]` to pick the board by hand. Required. |
| `pins` | Names for GPIO pins, shown in the properties panel. Required, can be `{}`. |
| `gpio` | The pins this board has, if fewer than its processor. For example `["0-29"]`. |
| `reserved` | Pins that must not be used, each with a reason. |
| `avoid` | Pins that give a warning, each with a reason. |
| `notes` | Anything else worth knowing. |
| `wifi` | `false` if the board has no WiFi. Hides [connecting over WiFi](wifi-connection.md) for it. Leave it out if unsure. |

Pin lists take numbers and ranges: `[0, 2, "4-7"]`. In `reserved` and `avoid`, the key is a pin or a range: `{ "6-11": "Wired to the flash chip." }`.

To find the name MicroPython reports, connect the board and look for `chipType` in the console's `[HELLO]` line. The board name is the part before " with ".

## Adding a processor

Save a JSON file in `~/.thingstudio/processors/`, named the same way as a board file. The built-in files in that folder are good examples.

| Field | Meaning |
| --- | --- |
| `name` | Name shown in the Board menu. Required. |
| `match` | Text in the processor name MicroPython reports, such as `ESP32S3`. Case, spaces and `-` are ignored. Required. |
| `nativeArch` | The mpy-cross `-march` value, such as `xtensawin`. Required. |
| `gpio` | Every GPIO pin the processor has. Required. |
| `inputOnly` | Pins that can't drive an output. |
| `noPull` | Pins without internal pull resistors. |
| `reserved`, `avoid` | As for boards. |
| `spi`, `i2c` | Bus numbers, pins each bus can use, and SPI speed limits. |
