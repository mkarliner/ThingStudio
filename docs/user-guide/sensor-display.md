# A sensor display

Build a three-page touch display: the room's temperature, humidity and pressure with their recent history, and a
clock. The flow also publishes the readings over MQTT.

The finished flow is
[`test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json`](https://github.com/mkarliner/ThingStudio/blob/main/test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json)
in the Thingstudio repository. Download it and open it with **File → Open…** to see it, then pick your own WiFi
and MQTT credentials in its config nodes. Or follow the steps below to build it.

## What you need

The steps use this hardware and setup:

- A Freenove ESP32-S3 4.0" touch display (FNK0104S), with MicroPython and the runtime installed
  ([steps 3 to 5](installing-micropython.md) of Getting started). Pick it by hand in the **Board** menu. Other
  boards work too; the pins below are this board's.
- A BME280 sensor board. A BMP280 also works, without humidity. Wire it to 3V3, GND, **SCL 15** and **SDA 16**,
  the touch panel's I2C bus.
- A WiFi network for the clock and MQTT, and an MQTT broker. See [Connecting over WiFi](wifi-connection.md).

## 1. Read the sensor

1. Drag a **bme280** onto the canvas. In its **I2C bus** field, click **+** and make a bus: bus `0`, SCL `15`,
   SDA `16`.
2. Set the bme280's **address** to `0x76`, or `0x77` if your sensor board ties SDO high, and **interval (ms)** to
   `5000`.
3. Drag a **function** node, set **outputs** to `5`, wire the bme280 to it, and use this code:

    ```python
    p = msg['payload']
    t = {'topic': 'temperature', 'payload': p['temperature']}
    h = None
    if p['humidity'] is not None:   # a BMP280 has no humidity
        h = {'topic': 'humidity', 'payload': p['humidity']}
    pr = {'topic': 'pressure', 'payload': p['pressure']}
    ok = {'topic': 'sensor', 'payload': True}
    return [t, h, pr, pr, ok]
    ```

    Each reading goes out on its own output, so each widget gets only its own number. Output 4 is a second copy of
    the pressure, for its journal. Output 5 says the sensor is alive.

To test the sensor first, wire the bme280 to a **debug** node and deploy. A reading appears every 5 seconds. See
[bme280](nodes/bme280.md).

## 2. Show it on the display

1. Drag a **display spi** onto the canvas and set it for the Freenove panel:

    | Property | Value |
    | --- | --- |
    | controller | `st7796` |
    | frame format | `rgb565` |
    | SPI bus | `1` |
    | baudrate | `40000000` |
    | sck, mosi, dc, cs pin | `12`, `11`, `46`, `10` |
    | reset pin | `-1` |
    | backlight pin | `45` |
    | width, height | `320`, `480` |
    | rotation | `1` |
    | orientation | `90° clockwise` |
    | color order | `BGR` |
    | invert colors, data latch order | on |

    Click 💾 to save these as a [preset](working-in-the-editor.md#presets) for next time.
2. Drag a **gui screen**. Set its **width** and **height** to the panel's own size, `320` and `480`, and its
   **frame format** to `rgb565`. Wire it to the display spi.
3. In the gui screen's **touch panel** field, click **+** and make a Touch panel: controller FT6336U, the same I2C
   bus, address `0x38`, width `320`, height `480`.
4. Drag three **gui readout** nodes (temperature, humidity, pressure) and a **gui light** for the sensor. Wire the
   function's outputs 1, 2, 3 and 5 to them. In each readout, set **units**, **decimals**, **lowest value** and
   **highest value**.
5. Lay out the pages: select the gui screen and use the page outline in its properties to add rows of text and
   readouts. See [Laying out pages](nodes/gui.md#laying-out-pages).

Set **stale after** on the readouts and the light. A reading that stops arriving is then dimmed, so a dead sensor
looks different from a steady room.

## 3. Add the history

A [journal](nodes/journal.md) keeps the recent readings, and a **gui trend** draws them.

1. Wire the temperature output to a journal with **seconds per row** `10`, **rows kept** `156` and **rows per
   roll-up** `6`. Wire its first output to a gui trend. That trend shows the last 26 minutes.
2. Wire the journal's second output, one summary per minute, to a second journal with **seconds per row** `0`. Wire
   that journal to a second gui trend, which shows the last 2.6 hours.
3. Wire output 4, the pressure copy, to a journal with **seconds per row** `60`, and that to a third gui trend.

Each bar is the average of its row, and the thin line runs from the row's min to its max. Set each trend's
**bottom at** and **top at** to the range you expect, for example 15 to 30 for temperature. See
[Trend](nodes/gui.md#trend).

## 4. Add the clock

1. Drag a **timer** with **interval (ms)** `1000`, and a **clock** node. Wire the timer to the clock.
2. In the clock, set **UTC offset (hours)** for your zone's standard time. Set **daylight saving** to **UK / EU:
   automatic** if that's where you are, otherwise **none**. See [clock](nodes/clock.md).
3. Add two **gui label** nodes, one for the time with **room for (characters)** `5`, and one for the date with
   `10`. Wire the clock's first output to the time and its second to the date.
4. On a new page, give the time label the font `font_seg764` (seven-segment digits) and the date `font_body24`.

The clock node doesn't join WiFi itself. In this flow the mqtt publish nodes do. Without them, add a
[wifi status](nodes/wifi-status.md) node. Until the board has the time, the clock shows `--`.

## 5. Turn the pages

Add a **gui button** with **mode** `navigate` to each page, so you can turn the pages by touch. See
[Buttons](nodes/gui.md#buttons).

The example flow also turns the pages every 8 seconds with a **gui navigator** node, which isn't in the palette.
See [GUI nodes](nodes/gui.md#the-nodes).

## 6. Publish the readings

Drag three **mqtt publish** nodes, one per reading, with topics such as `thingstudio/headliner/temperature`. Wire
outputs 1 to 3 of the function to them, and pick your MQTT broker and WiFi. See
[mqtt publish](nodes/mqtt-publish.md).

## Deploy

Click **Compile → Deploy**. The display lights, the readings appear within 5 seconds, the trends fill as the minutes
pass, and the clock starts once the board has the time.

## If it doesn't work

Each symptom below has its own fix:

- **The picture is scrambled:** the gui screen's and display spi's width and height must be the panel's own size,
  `320` and `480`, even when the picture is turned. Deploy checks this and says so.
- **Touches land in the wrong place:** see [Touch panels](nodes/touch-panel.md).
- **No readings:** check the wiring and the address (`0x76` or `0x77`), and test with a debug node.
- **The clock stays at `--`:** the board has no WiFi, or can't reach the NTP server. It tries again every 30
  seconds.
- **Compile says a node is "disconnected from any source":** a widget has nothing wired to it. Wire it, or reload
  the editor if the wires are there.
