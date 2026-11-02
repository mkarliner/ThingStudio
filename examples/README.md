# Examples

Working flows to open with **File → Open…** and make yours: each one runs as shipped, and each shows a thing
Thingstudio does. Pins in them are examples: set your own board's pin before deploying (the property panel, or
**Pins…** next to the **Board** menu). The tutorials in the [user guide](https://docs.thingstudio.net/) walk the
first four step by step.

- `blink.flow.json` — the three-node first flow: timer, function, gpio out. Walked by
  [Blink an LED](https://docs.thingstudio.net/getting-started/).
- `two-more-blinks.flow.json` — the same blink two ways: the LED's state on the hardware, or in the node with
  `context`. Walked by [Two more blinks](https://docs.thingstudio.net/tutorials/two-more-blinks/).
- `http-blink.flow.json` — the same LED, toggled from a browser over WiFi. Needs a WiFi credential of your own
  (the flow names one; nothing in it). Walked by
  [Web Blink](https://docs.thingstudio.net/tutorials/blink-from-your-network/).
- `blink-from-anywhere.flow.json` — the same LED through an MQTT broker: publish from the board, subscribe to switch
  it. The topics start `thingstudio/change-this-number/`; replace the number first, since the broker is public. Walked
  by [Blink from anywhere](https://docs.thingstudio.net/tutorials/blink-from-anywhere/).
- `basic-http-request.flow.json` — call a web service from the board and take a value out of the answer.
- `basic-mqtt.flow.json` — publish and subscribe on a broker.
- `bmp280-test-flow.flow.json` — a BME280/BMP280 sensor over the I2C bus.
- `gui-headliner-sensor-freenove-s3-4in.flow.json` — a sensor on a display, with histograms, a clock and MQTT
  (a Freenove S3 display board).
- `gui-touch-freenove-s3-4in.flow.json` — GUI touch buttons (the same board).

Thingstudio ships this folder with every release (`tools/build_assets.py` copies it into the app), so an install
carries the examples beside it. Test flows for hands-on node checks live in `test-flows/`; this folder is not
that.
