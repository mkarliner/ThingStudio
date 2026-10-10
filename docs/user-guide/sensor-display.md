# A sensor display

Build a three-page display: the room's temperature, humidity and pressure with their recent history, and a
clock. The readings are also published over MQTT. It is the kind of flow you would put on a desk or a wall.

The finished flow is `test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json`. Open it from **File → Open** to
see it, or follow the steps below to build your own.

## What you need

- A Freenove ESP32-S3 4.0" touch display (FNK0104S), connected and with the runtime installed
  ([steps 2 to 4](installing-micropython.md)). Other boards work; the pins below are this board's.
- A BME280 sensor board (a BMP280 works too, without humidity). Wire it to 3V3, GND, **SCL 15** and **SDA 16**,
  the touch panel's I2C bus. Its address is usually `0x76`, or `0x77`.
- WiFi set up for the board ([Connecting over WiFi](wifi-connection.md)). The clock needs it for the time, and
  MQTT needs it for the broker. Skip the MQTT part and you need WiFi only for the clock.

## 1. Read the sensor

1. Add an **I2C bus** (in the **bme280** node's I2C bus field, **new**): bus `0`, SCL `15`, SDA `16`.
2. Drag a **bme280** onto the canvas. Pick the I2C bus, set the address (`0x76` is `118`), and **interval (ms)**
   to `5000`.
3. Drag a **function** node, set **outputs** to `5`, wire the sensor to it, and use this code. It sends each
   reading on its own output, so each widget gets only its own number (output 4 is a second copy of the pressure,
   for its journal, and output 5 says the sensor is alive):

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

Test it first: wire the sensor to a **debug** node and deploy. You should see a reading every 5 seconds. See
[bme280](nodes/bme280.md).

## 2. Show it on the display

1. Drag a **display spi** onto the canvas and pick the Freenove 4.0" **preset** (a st7796 panel,
   `320 × 480`). Set **orientation** to `90` so the screen is turned the way you want it.
2. Drag a **gui screen**. Set its width and height to the panel's own size (`320 × 480`), its frame format to
   `rgb565` (colour) and pick the touch panel. Wire it to the display.
3. Drag three **readout** nodes (temperature, humidity, pressure) and a **light** for the sensor. Wire the function's
   outputs to them. In each readout's properties set the units, decimals, and a range.
4. Lay out the pages: select the gui screen and use its **Properties** outline to add a column with a row of text
   and readouts. See [GUI nodes](nodes/gui.md#laying-out-pages).

A reading that stops arriving dims the number after its **stale after** time, and the light goes grey, so you can
tell a dead sensor from a steady room.

## 3. Add the history

A [**journal**](nodes/journal.md) keeps the recent readings; a **trend** draws them.

- Wire the temperature to a journal with **seconds per row** `10`, **rows kept** `156` and **rows per roll-up**
  `6`. Wire its first output to a **trend**: the last 26 minutes.
- Wire its **second** output (one summary per minute, with min and max) to a second journal with **seconds per
  row** `0`, then to a second trend: the last 2.6 hours.
- Pressure is one journal at 60 seconds a row and one trend.

Each bar is the average of its row, and the thin line the min to max. The range of a trend is fixed: set its
**low** and **high** to what you expect to see (for temperature, 15 to 30). See [trend](nodes/gui.md#trend).

## 4. Add the clock

1. Drag a **timer** with **interval (ms)** `1000`, and a **clock** node. Wire timer → clock.
2. In the clock, set the **UTC offset** for your zone's standard time. Leave **daylight saving** on UK / EU if
   that is where you are. See [clock](nodes/clock.md).
3. Add two **text** nodes (gui label), one for the time (**max characters** `5`) and one for the date (`10`).
   Wire the clock's first output to the time and the second to the date.
4. On a new page, use `font_seg764` for the time label (seven-segment digits) and `font_body24` for the date.

Until the board has the time from the internet, the clock shows `--`.

## 5. Change pages by themselves

A **timer** of `8000` ms, wired to a **function** that sets `msg['payload'] = 'next'`, wired to a **gui navigator**,
turns the page every 8 seconds. Or add a *navigate* button to each page so you can turn them by touch
([Buttons](nodes/gui.md#buttons)).

## 6. Publish the readings

Drag three **mqtt publish** nodes, one per reading, with topics like `thingstudio/headliner/temperature`. Wire each
function output to its publisher and pick your broker. See [mqtt publish](nodes/mqtt-publish.md).

## Deploy

**Compile → Deploy**. The display lights, the readings appear within 5 seconds, the trends fill as the minutes
pass and the clock starts when the time arrives.

## If it doesn't work

- **The picture is scrambled:** the screen's width and height must be the panel's own size, `320 × 480`, even
  when you turn it. The deploy checks this and says so.
- **Touches land in the wrong place:** see [Touch panels](nodes/touch-panel.md).
- **No readings:** check the wiring and the address (`0x76` or `0x77`), and test with a debug node first.
- **The clock stays at `--`:** the board has no WiFi yet, or can't reach the NTP server. It tries again every 30 seconds.
- **A compile error says a node is "disconnected from any source":** a widget has nothing wired to it. Wire it, or
  reload the editor if the wires are there.
