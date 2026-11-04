# Tutorial flows

The flows for the tutorials, to open with **File → Open…** and make yours: each one runs as shipped once you set your own
pin, WiFi network and broker. [Tutorial flows](https://docs.thingstudio.net/tutorial-flows/) in the user guide says what each
one shows and what to change first.

- `blink.flow.json` — the three-node first flow: timer, function, gpio out. Walked by
  [Blink an LED](https://docs.thingstudio.net/getting-started/).
- `two-more-blinks.flow.json` — the same blink two ways: the LED's state on the hardware, or in the node with
  `context`. Walked by [Two more blinks](https://docs.thingstudio.net/tutorials/two-more-blinks/).
- `http-blink.flow.json` — the same LED, toggled from a browser over WiFi. Walked by
  [Web Blink](https://docs.thingstudio.net/tutorials/blink-from-your-network/).
- `blink-from-anywhere.flow.json` — the same LED through an MQTT broker: publish from the board, subscribe to switch
  it. The topics start `thingstudio/change-this-number/`; replace the number first, since the broker is public. Walked
  by [Blink from anywhere](https://docs.thingstudio.net/tutorials/blink-from-anywhere/).

Thingstudio ships this folder with every release, so an install carries these flows beside it. Only tutorial flows
belong here. Flows for hands-on node checks live in `test-flows/`, which stays in the repository.
