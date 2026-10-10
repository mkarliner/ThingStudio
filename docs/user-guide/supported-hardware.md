# Supported hardware

The boards, processors, displays, touch panels and sensors below have built-in support. "Tested" means flows have
been deployed and run on that hardware. Pin details for boards and processors are in
[Boards and processors](boards.md).

## Boards

| Board | Processor | Tested |
| --- | --- | --- |
| Raspberry Pi Pico | RP2040 | Yes |
| Raspberry Pi Pico W | RP2040 | Yes, including WiFi |
| Raspberry Pi Pico 2 | RP2350 | Yes |
| LOLIN S2 Mini | ESP32-S2 | Yes |
| CYD (ESP32-2432S028, ST7789) | ESP32 | Yes, with the display. Touch, SD card, RGB LED and speaker not yet. |
| Freenove ESP32-S3 Display 4.0" (FNK0104S) | ESP32-S3 | Yes, with the display and touch |

## Processors without a board definition

Any board with one of these processors can be used by picking the processor from the **Board** menu, for example
**ESP32-C3 (any board)**. Its board-specific pins, such as an LED, aren't labelled.

| Processor | Tested |
| --- | --- |
| ESP32 | Yes, on the CYD |
| ESP32-S2 | Yes, on the LOLIN S2 Mini |
| ESP32-S3 | Yes, on the Freenove board |
| ESP32-C3 | Yes, on a generic ESP32-C3 board, over USB and WiFi |
| RP2040 | Yes, on the Pico and Pico W |
| RP2350 | Yes, on the Pico 2 |

## Displays

| Chip | Panel sizes | Node | Tested |
| --- | --- | --- | --- |
| ST7789 | 240x240, 135x240, 240x320 | [display spi](nodes/display-spi.md) | Yes, on the CYD |
| ST7796 | 320x480 | [display spi](nodes/display-spi.md) | Yes, on the Freenove ESP32-S3 4.0" |
| SSD1306 (I2C only) | 128x64, or set width and height | [display i2c](nodes/display-i2c.md) | Not yet confirmed |

## Touch panels

| Chip | Node | Tested |
| --- | --- | --- |
| FT6336U | [touch](nodes/touch-i2c.md) | Yes, on the Freenove ESP32-S3 4.0" |

## Sensors

| Chip | Node | Tested |
| --- | --- | --- |
| BME280 | [bme280](nodes/bme280.md) | Yes, on a Pico |
| BMP280 | [bme280](nodes/bme280.md) | Not yet confirmed |

Other I2C devices can be read with a [function](nodes/function.md) node and the chip's datasheet.

## Other boards

Other boards that run MicroPython may work. Thingstudio needs a processor definition for the chip, and a board
definition if you want the board's own pins labelled. See [Adding a board](boards.md#adding-a-board) and
[Adding a processor](boards.md#adding-a-processor).

An AI assistant can draft a definition file. Give it the board's pinout or the chip's datasheet, and one of the
existing files in `~/.thingstudio/boards/` or `~/.thingstudio/processors/` as an example. Check the result against
the datasheet. A missing reserved pin means the compile won't stop a flow that crashes the board.

## Reporting hardware

Reports on any board, display or sensor, listed or not, are welcome. Open an issue on
[GitHub](https://github.com/mkarliner/ThingStudio/issues) with:

- the board, processor and any display or sensor
- the MicroPython version
- what worked and what didn't

A definition file for a new board can be attached to the issue.
