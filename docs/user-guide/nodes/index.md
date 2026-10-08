# Node reference

Every built-in node has its own page, covering what it does, its properties and its output. This page lists them
all, grouped as in the editor's palette: General, Network and Hardware.

## Kinds of node

Each node is one of three kinds. The kind decides where it can sit in a flow.

- **Source**: starts a message. Has no input. Every chain in a flow begins with one.
- **Transform**: takes a message in, and passes it on, changed, delayed or not at all.
- **Sink**: takes a message in and acts on it. Has no output.

See [flows, nodes and messages](../background/flows-and-nodes.md) for how they fit together.

## Which node do I need?

| To… | Use |
| --- | --- |
| do something at a fixed interval | [timer](timer.md) |
| do something once, when the flow starts | [startup](startup.md) |
| send a test message by hand | [inject](inject.md) |
| respond to a pin changing | [interrupt](interrupt.md), [eswitch](eswitch.md) |
| respond to presses, long presses and double clicks | [ebutton](ebutton.md) |
| switch an LED or relay | [gpio out](gpio-out.md) |
| dim an LED or set a motor's speed | [pwm out](pwm-out.md) |
| read a temperature, humidity or pressure sensor | [bme280](bme280.md) |
| talk to another I2C device, or find its address | [i2c](i2c.md) |
| draw on a display | [display spi](display-spi.md), [display i2c](display-i2c.md) |
| show readings as pages on a display | [GUI nodes (preview)](gui.md) |
| change a message, or decide where it goes | [function](function.md) |
| send only changes, or limit the rate | [filter](filter.md) |
| wait before passing a message on | [delay](delay.md) |
| see what's in a message | [debug](debug.md) |
| send or receive MQTT messages | [mqtt publish](mqtt-publish.md), [mqtt subscribe](mqtt-subscribe.md) |
| call a web API | [http request](http-request.md) |
| serve a web page or API from the board | [http in](http-in.md) and [http response](http-response.md) |
| send or receive UDP packets | [udp send](udp-send.md), [udp receive](udp-receive.md) |
| know when WiFi connects or drops | [wifi status](wifi-status.md) |
| stop messages while WiFi is down | [wifi gate](wifi-gate.md) |

## General

| Node | Kind | What it does |
| --- | --- | --- |
| [inject](inject.md) | source | Sends one message with a fixed payload when you click it in the editor. |
| [startup](startup.md) | source | Sends one message each time the flow starts. |
| [timer](timer.md) | source | Sends a rising count at a fixed interval. |
| [function](function.md) | transform | Runs your own MicroPython on each message. |
| [delay](delay.md) | transform | Passes each message on after a set wait. |
| [filter](filter.md) | transform | Passes a message on only if it changed enough, or enough time has passed. |
| [debug](debug.md) | sink | Prints a message to the editor's console. |

## Network

These nodes share the flow's WiFi network. A flow has one, set on any WiFi node's **WiFi** field.

| Node | Kind | What it does |
| --- | --- | --- |
| [wifi status](wifi-status.md) | source | Reports when the WiFi connection comes up or goes down. |
| [wifi gate](wifi-gate.md) | transform | Passes a message on only while WiFi is connected. |
| [mqtt subscribe](mqtt-subscribe.md) | source | Sends a message for each MQTT message on a topic. |
| [mqtt publish](mqtt-publish.md) | sink | Publishes a message's payload to an MQTT topic. |
| [http request](http-request.md) | transform | Makes an HTTP request per message and passes on the response. |
| [http in](http-in.md) | source | Serves HTTP from the board, sending a message for each request. |
| [http response](http-response.md) | sink | Answers a request that arrived through `http in`. |
| [udp receive](udp-receive.md) | source | Sends a message for each UDP packet received on a port. |
| [udp send](udp-send.md) | sink | Sends a message's payload as a UDP packet. |

## Hardware

Pin numbers are checked against your board before a deploy. See [boards and processors](../boards.md).

| Node | Kind | What it does |
| --- | --- | --- |
| [interrupt](interrupt.md) | source | Fires the moment a pin changes. |
| [eswitch](eswitch.md) | source | Reports a debounced switch opening or closing. |
| [ebutton](ebutton.md) | source | Reports presses, releases, long presses and double clicks. |
| [gpio out](gpio-out.md) | sink | Sets a pin high or low. |
| [pwm out](pwm-out.md) | sink | Drives a pin with a variable duty cycle. |
| [bme280](bme280.md) | source | Reads a BME280 or BMP280 sensor at a fixed interval. |
| [i2c](i2c.md) | transform | Reads, writes or scans an I2C device that has no node of its own. |
| [display spi](display-spi.md) | sink | Sends a frame to an SPI color display (ST7789). |
| [display i2c](display-i2c.md) | sink | Sends a frame to an I2C OLED display (SSD1306). |

## Shared settings

Some settings are set once and shared by the nodes that use them:

- **WiFi network** and **MQTT broker**: config nodes, with the real passwords kept outside the flow file. See
  [config nodes](../canvas-basics.md#config-nodes).
- **I2C bus**: the pins and clock for a bus, shared by every I2C node on it. See [I2C buses](i2c-bus.md).

## Something missing?

A few lines in a [function](function.md) node cover most gaps: a comparison, a sum, reading an ADC pin. For
something you'll use again, [write a custom node](../custom-nodes.md).
