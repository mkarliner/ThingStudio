# Example flows

Flows to open with **File → Open…** and make your own. Open the file rather than copying a flow from a page: pick it
from the examples folder, change what is yours (the pin, the credentials, the board), and deploy. This is a map of
what each one shows and what to change first; the tutorials walk the first four step by step.

## Where the folder is

Every install has an `examples` folder. Where it is depends on how you installed:

| Install | Examples folder |
| --- | --- |
| Installer script, macOS and Linux | `~/.local/share/thingstudio/current/examples` |
| Installer script, Windows | `%LOCALAPPDATA%\Thingstudio\versions\thingstudio-VERSION-windows-x86_64\examples` |
| Package | `examples`, inside the folder you unpacked |
| From source | `examples`, in the repository folder |

The Windows path contains the version, so it changes when you upgrade.

## Before you deploy

- **Pins are examples.** Set your board's pin in the property panel. **Pins…** next to the **Board** menu lists the
  pins your board has.
- **WiFi and MQTT flows name a saved network or broker** that your computer doesn't have. The **WiFi** or **MQTT
  Broker** field's ✎ form says so; saving it with your own details creates it. Credentials stay on your computer,
  not in the flow ([The Thingstudio folder](thingstudio-folder.md#credentials)).

## The flows

In the order that builds up. Each entry lists what to try changing first, and where to read about the node.

### `blink.flow.json`

A `timer` counts, a `function` turns the count into on and off, and `gpio out` drives the LED. Walked by
[Blink an LED](first-flow.md).

- **pin** on [gpio out](nodes/gpio-out.md): your LED's GPIO number. The file has 15.
- **interval (ms)** on [timer](nodes/timer.md): each tick toggles the LED, so the blink rate follows.
- The [function](nodes/function.md) node's **code**, which keeps the count's parity with `% 2`.

### `two-more-blinks.flow.json`

The same blink with the state kept elsewhere. This file reads the LED's pin back with `machine.Pin` to decide the
next level. Walked by [Two more blinks](tutorials/two-more-blinks.md), which also swaps in the `context` version.

- The pin number, in two places: the [gpio out](nodes/gpio-out.md) node's **pin** and the function's
  `machine.Pin(15)`. They have to agree.
- The [function](nodes/function.md) node's **code**: replace it with the `context` version from the tutorial.

### `http-blink.flow.json`

The same LED, toggled from a browser. An `http in` node serves `/toggle` on port 9999, a `function` flips the LED
and builds the reply, and `http response` answers the browser. `wifi status` and `debug` show the connection. It
names a WiFi network, `tutorial wifi`. Walked by [Web Blink](tutorials/blink-from-your-network.md).

- **path** and **port** on [http in](nodes/http-in.md).
- The reply text in the function's **code** (`'LED on'` and `'LED off'`).
- **poll interval (ms)** on [wifi status](nodes/wifi-status.md).

### `blink-from-anywhere.flow.json`

The same LED through an MQTT broker. Clicking `inject` publishes `pressed` to a `button` topic, and `mqtt subscribe`
on an `led` topic feeds a `function` that turns `on`, `1` or `true` into true for `gpio out`; `debug` prints what
arrives. The file names a WiFi network (`tutorial wifi`) and a broker (`test-mosquitto`). Its topics start
`thingstudio/change-this-number/`: replace that number in both before you deploy, because the broker is public. Walked
by [Blink from anywhere](tutorials/blink-from-anywhere.md).

- The number in both **topic** fields, on [mqtt publish](nodes/mqtt-publish.md) and
  [mqtt subscribe](nodes/mqtt-subscribe.md).
- **host** and **port** in the broker form, to use a broker on your own network.
- The [function](nodes/function.md) node's **code**, which decides which messages count as on.

### `basic-http-request.flow.json`

Fetches a web page from the board: clicking the `inject` node makes `http request` GET the URL, and `debug` prints
the answer in the console. The file's URL is `http://localhost:8000/index.html`, and on a board `localhost` is the
board itself, so point it at a server your network reaches.

- **url**, **method** and **timeout (ms)** on [http request](nodes/http-request.md).
- A [function](nodes/function.md) node between `http request` and `debug`, to pick one part out of the answer.

### `basic-mqtt.flow.json`

Publish and subscribe on one broker. Clicking `inject` publishes a message to the topic `foobar`; `mqtt subscribe`
on the same topic receives it and `debug` prints it. A second `debug` prints `wifi status`. The file names a WiFi
network and an MQTT broker.

- **topic** on [mqtt publish](nodes/mqtt-publish.md) and [mqtt subscribe](nodes/mqtt-subscribe.md): keep the two the
  same. On a public broker such as `test.mosquitto.org`, anyone can read a topic, so use one nobody else will.
- **value** on [inject](nodes/inject.md), the message that is published.
- **QoS** and **retain** on mqtt publish.

If nothing arrives, see [MQTT broker unreachable](debugging.md#mqtt-broker-unreachable).

### `bmp280-test-flow.flow.json`

Reads a BME280 or BMP280 sensor over I2C and prints the temperature. A `bme280` node reads every 5 seconds, a
`function` takes the temperature out of the reading, and `debug` prints it. A `filter` also passes it on only when it
changes by at least 0.1. The sensor is on I2C bus 0, SCL 5 and SDA 4.

- **address** on [bme280](nodes/bme280.md): the file has 118, which is `0x76`; use 119 for `0x77`.
- The bus pins, in the **I2C bus** config ([I2C bus](nodes/i2c-bus.md)).
- **mode** and **threshold** on [filter](nodes/filter.md).

### `gui-touch-freenove-s3-4in.flow.json`

A touch display on the Freenove ESP32-S3 4.0" board, with no sensor wired: a `timer` and a `function` make slow
triangle-wave readings for three readouts, a pressure bar and a status light. Buttons turn the pages, and a toggle
button switches a smart plug over MQTT, publishing to `cmnd/plug/POWER` and following `stat/plug/POWER` as a Tasmota
plug does. It needs that board, and WiFi and MQTT credentials. The [GUI nodes](nodes/gui.md) are provisional.

- The plug topics on [mqtt subscribe](nodes/mqtt-subscribe.md) and [mqtt publish](nodes/mqtt-publish.md).
- The range of a readout, and its caption and units: [GUI nodes](nodes/gui.md).

### `gui-headliner-sensor-freenove-s3-4in.flow.json`

The sensor display from [A sensor display](sensor-display.md): a BME280 on a touch display, with pressure and
temperature histories, a clock from `ntp`, and the readings published over MQTT. It needs the Freenove ESP32-S3 4.0"
board, a BME280 on I2C bus 0 (SCL 15, SDA 16), and WiFi and MQTT credentials. That tutorial is being reworked.

- **UTC offset (hours)** and **daylight saving** on [ntp](nodes/ntp.md).
- The topics on [mqtt publish](nodes/mqtt-publish.md).
- **rows kept** and **seconds per row** on [journal](nodes/journal.md), which feed the histories.

## Flows written by an AI assistant

An assistant can write a flow file for you to open the same way. See [Writing flows with an AI assistant](ai-authoring.md).
