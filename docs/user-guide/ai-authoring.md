# Writing flows with an AI assistant

This page is for an AI assistant (or a person) writing a Thingstudio flow file or a custom node in the user's folder,
without the editor. It is complete on its own, with two companions: the generated [node catalog](nodes-catalog.md), and
the `thingstudio-compile` command ([Check a flow without the editor](check-a-flow.md)). The whole docs set is also
one file at `/llms-full.txt` on the docs site, with an index at `/llms.txt`.

## The loop

1. Write the flow as a `.flow.json` file.
2. Run `node dist-cli/thingstudio-compile.mjs --board board:lolin-s2-mini my.flow.json` (the board ids are `board:cyd`, `board:freenove-s3-4in`,
   `board:lolin-s2-mini`, `board:pico`, `board:pico-2` and `board:pico-w`, or `processor:esp32`, `esp32-c3`, `esp32-s2`,
   `esp32-s3`, `rp2040`, `rp2350` for a bare chip; `--list-boards` shows the current list). Read every error: it names the node and
   says what is wrong. Fix them all and run it again until it prints `OK`.
3. Tell the user to open the file in the editor (**File → Open**), choose the board, and deploy.

The check is the same compile the editor runs, so a flow that passes it opens and compiles in the editor. It can't
check credentials, custom node packages or the hardware. Don't claim a flow works on the board; say it passes the check.

## The flow file

A JSON object. These keys matter:

| Key | What |
| --- | --- |
| `formatVersion` | `1` |
| `flowName` | A name for the flow. |
| `nodes` | `[{ "id", "type", "properties" }]`. `id` is any unique string. `type` is `thingstudio/<kind>`. |
| `edges` | `[[fromId, outputNumber, toId, inputNumber]]`. Numbers start at 0, in the order the [catalog](nodes-catalog.md) lists the ports. |
| `configs` | `[{ "id", "type", "properties" }]`: shared settings (I2C bus, WiFi, MQTT broker, touch panel). |
| `screens` | The pages of any GUI screen, keyed by that node's id. See [GUI](#gui-screens). |
| `panes`, `paneOf` | Optional. Tabs in the editor and which tab each node is on; leave them out and everything lands on one tab. When you edit a file that has them, put new nodes in `paneOf` too (copy the pattern). |
| `layout` | `{ "<nodeId>": { "pos": [x, y] } }`. Optional, but give positions: without them every node lands at 0,0. |
| `notes` | Optional text shown in the editor's Notes panel. Say what the flow is for and how it is wired. |

A property you leave out gets the default listed in the [catalog](nodes-catalog.md). Use the catalog's names and types
exactly: `intervalMs`, not `interval`. Values and ranges are checked by the compile, which says what is allowed.

Place the nodes left to right, sources on the left and sinks on the right, about 220 px apart, so the user can read
the flow when they open it.

A complete flow, a blinking LED on a LOLIN S2 Mini (its LED is pin 15):

```json
{
  "formatVersion": 1,
  "flowName": "blink",
  "nodes": [
    { "id": "tick", "type": "thingstudio/timer", "properties": { "intervalMs": 500 } },
    { "id": "flip", "type": "thingstudio/function",
      "properties": { "code": "msg['payload'] = msg['payload'] % 2\nreturn msg", "outputCount": 1 } },
    { "id": "led", "type": "thingstudio/gpio_out", "properties": { "pin": 15 } }
  ],
  "edges": [["tick", 0, "flip", 0], ["flip", 0, "led", 0]],
  "layout": { "tick": { "pos": [80, 200] }, "flip": { "pos": [300, 200] }, "led": { "pos": [520, 200] } },
  "configs": []
}
```

## Which node

| To... | Use |
| --- | --- |
| send a message every so often, or once at start | `timer`, `startup`, `inject` |
| read a BME280 / BMP280 | `bme280` (payload is a dict with `temperature`, `humidity`, `pressure`; pick one out in a `function`) |
| read another I2C chip | `i2c` on a shared `i2c-bus` config |
| react to a switch or button | `eswitch` (a debounced switch: open and close events); `ebutton` for press, release, long-press and double-click; `interrupt` for raw edges |
| drive a pin | `gpio_out` (on/off), `pwm_out` |
| change or route a message | `function`; `filter` to pass only changes; `delay` |
| keep a number's history | `journal`, shown by a `gui_trend` |
| show the time | `clock` |
| talk MQTT / HTTP / UDP | `mqtt_publish`, `mqtt_subscribe`, `http_request`, `http_in` and `http_response`, `udp_send`, `udp_receive` |
| draw on a screen | `gui_screen` with `gui_*` widgets, wired to `display_spi` |

## Messages and the function node

Every message is a dict: `msg = {'payload': ..., 'topic': ...}`. `payload` is what nodes read; `topic` is a string, `''`
when there is nothing to say. Other keys ride along.

A function node's `code` is the body of a function in MicroPython (a subset of Python with a small standard library). Return `msg` to pass it on, or `None` to stop. With `outputCount` above 1, return a list with one
entry per output (`None` for nothing, a list of messages for several). `context` keeps state for the node, `flow` for
the whole flow. See [function](nodes/function.md). A syntax error in the code is caught by the check.

A wire is refused if the payload types can't meet (for example a `bool` into a `bytes` input). The check reports it.
Numbers go into `bool` inputs (zero is off), and an `int` into a `number`; a `number` into an `int` is refused.

Addresses are written two ways, because the nodes differ: the `bme280` `address` is a plain number (`118` is `0x76`);
a touch panel config's `address` is text (`"0x38"`). The [catalog](nodes-catalog.md) notes which.

A node that uses the network (`mqtt_publish`, `http_request`, and so on) uses the flow's WiFi: add a WiFi config to
`configs` and it is picked up; the node has no WiFi property of its own.

## Pins: take them from the board

Never guess a pin. List the boards with `--list-boards`, run `--board-info board:<id>` for what each pin does (the
LED, the buttons, the display, the I2C pins) and which to avoid, and check the finished flow with `--board board:<id>`. If the user's board is not listed, say so, ask for the pins, and point them to the MicroPython documentation
for their board (docs.micropython.org). Don't pretend a board is supported.

Things the pin check cannot catch: a pin that exists but is wired to something else on the user's board. When the
user has told you the wiring, use it; when they haven't, say what you assumed.

## Config nodes and credentials

A node that needs shared settings names a config by id: `"i2cConfigId": "cfg-i2c"`, with the config in `configs`:

```json
{ "id": "cfg-i2c", "type": "thingstudio/config/i2c-bus", "properties": { "bus": 0, "scl": 15, "sda": 16, "freq": 100000 } }
```

The [catalog](nodes-catalog.md) lists each config type's fields. WiFi and MQTT configs hold a **credential name**:

```json
{ "id": "cfg-wifi", "type": "thingstudio/config/wifi", "properties": { "credentialName": "home", "security": "password" } }
```

**Never write a password, SSID or broker secret into a flow file.** Write a `credentialName` and tell the user which
names to create in the editor's credential store (they are saved there, not in the file). The check uses stand-ins
for them and says so.

## GUI screens

A touch or plain display is two nodes wired together, `gui_screen` then `display_spi`, plus widget nodes (`gui_label`,
`gui_readout`, `gui_bar`, `gui_trend`, `gui_led`, `gui_button`) that you wire data into. Where each widget sits is in
`screens`:

```json
"screens": { "<screenId>": { "pages": [
  { "name": "main", "root": { "kind": "column", "gap": 6, "padding": 4, "children": [
    { "kind": "text", "text": "Living room", "font": "font_body20" },
    { "kind": "widget", "node": "<readoutId>", "font": "font_digits48", "unitsFont": "font_body24", "alignSelf": "center" },
    { "kind": "spacer", "grow": 1 },
    { "kind": "pagedots", "alignSelf": "center" }
  ] } }
] } }
```

Rules that cause most failures:

- The screen's `width` and `height` are the **panel's own size** (320 × 480 for the Freenove 4") whatever the orientation.
  Portrait needs nothing more: leave `orientation` empty and use the board's `rotation` (1 for the Freenove). To turn
  the picture, set the `orientation` property of `display_spi` to `"90"`, `"180"` or `"270"` (clockwise), not the
  screen's size.
- A navigate button's `target` is `next`, `prev`, `back`, `home` or the `name` of a page in `screens`; when you edit an
  existing flow, read the page names from its `screens` section.
- Fonts: `font_body12/16/20/24`, `font_digits16/24/32/48/64` (digits and a few symbols only), `font_seg748/64/96`
  (seven-segment: `0-9 : . -` and space). A character a font doesn't have is an error.
- A widget is placed once per page, drawn the same on every page it is on. A label shows a value up to `maxChars` wide.
- A page that doesn't fit gives an error that names the widget and page and how many pixels it needs. Use a smaller
  font or fewer things per row. Rows need the screen width minus the container's padding (in landscape on a
  320-wide panel that is under 312 px).
- Orientation with a CYD: `xstart` and `ystart` must be `-1` (the CYD example flow uses 0, which an orientation refuses).
- A trend takes a journal's first output, and a journal takes numbers: `sensor → journal → trend`.

Placement keys, in `screens`:

| Element | Keys |
| --- | --- |
| `row`, `column` | `children`, `gap`, `padding`, `align`, `justify`, `grow`, `alignSelf` |
| `widget` | `node` (the widget node's id), `font`, `unitsFont` (readout), `align` and `maxChars` (label), `height` and `minWidth` (bar, trend), `diameter` (light), `grow`, `alignSelf` |
| `text` | `text`, `font`, `align` |
| `pagedots`, `spacer` | `diameter`, `gap`; `width`, `height`, `grow` |

A button widget takes `font`, `grow` and `alignSelf` like the others. The button's own behaviour (`mode`, `target`,
`onValue`, ...) is on the node: see the [catalog](nodes-catalog.md). For a toggle that follows a real device (a smart
plug), `gui.md` has the wiring.

Read [GUI nodes](nodes/gui.md) for the details, and copy from `test-flows/`:
`gui-headliner-sensor-freenove-s3-4in.flow.json` (a sensor display with trends, a clock and MQTT),
`gui-touch-freenove-s3-4in.flow.json` (buttons), `gui-orientation-test-freenove-s3-4in.flow.json`.

## Custom nodes

If no node does the job and a function node is not enough, write a custom node: `<name>.node.json` and
`<name>.node.py`. [Writing custom nodes](custom-nodes.md) is complete on its own. The two files go in `~/.thingstudio/custom-nodes/` on the
computer running Thingstudio. The check command can't check them: read them against that page, and test the
Python body on its own with sample messages.

## Examples to copy

| Task | File in `test-flows/` |
| --- | --- |
| Blink an LED | `blink.flow.json` |
| Publish to MQTT | `basic-mqtt.flow.json` |
| Call a web service | `basic-http-request.flow.json` |
| A BME280 reading | `bmp280-test-flow.flow.json` |
| A sensor on a display, with trends and a clock | `gui-headliner-sensor-freenove-s3-4in.flow.json` |
| Touch buttons | `gui-touch-freenove-s3-4in.flow.json` |

## When you hand the flow back

Tell the user, briefly: that it passes the check (and with which `--board`), which credential names to create, which
board to choose in the editor, what you assumed about wiring, and what you could not check.
