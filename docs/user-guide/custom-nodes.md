# Writing a custom node for ThingStudio

A custom node is two files sharing a base name: `<name>.node.json` (the
descriptor) and `<name>.node.py` (the behavior), placed in the backend's
`~/.thingstudio/custom-nodes/` directory. ThingStudio loads it for you,
and you drag it onto the canvas like any built-in node.

## Loading a custom node

Put both files in `~/.thingstudio/custom-nodes/` on the computer running
ThingStudio.

The editor loads every package in that folder when it starts, and again
when you switch back to its window. After changing a file, you can also
click **Reload custom nodes** at the bottom of the palette. The console
lists what loaded. Each node appears in the palette under its `group`.

A package with a problem isn't loaded, and the console says which file
and why. The others still load. If two packages use the same `type`, the
first one by file name is loaded and the other is reported.

The folder starts with six examples. Under **examples** in the palette:
`doubler`, `dht22`, and `roster`, which keeps the latest message from each
sender (such as each Bluetooth device nearby). Under **hardware**:
`lsm6ds3`, `lsm6ds3_int` and `rm68090`. Read them, change them or delete
them. ThingStudio adds them only the first time it runs, so deleted
examples stay deleted. An example added in a later release doesn't reach
an existing folder: copy its two files from
[the repository](https://github.com/mkarliner/ThingStudio/tree/main/backend/src/thingstudio_backend/example_nodes).

## The descriptor: `<name>.node.json`

Example — a node that doubles a numeric payload:

```json
{
  "type": "custom/doubler",
  "kind": "transform",
  "label": "doubler",
  "color": "#6e3b8a",
  "bgcolor": "#3f1f4a",
  "icon": "×2",
  "ports": {
    "inputs": [{ "name": "msg", "type": "any" }],
    "outputs": [{ "name": "msg", "type": "any" }]
  },
  "properties": [
    { "name": "factor", "label": "factor", "kind": "number", "default": 2 }
  ]
}
```

**`type`** (required) — unique id, shaped `namespace/name` (lowercase
letters, digits, underscores). Must not start with `thingstudio/` —
reserved for built-in nodes.

**`kind`** (required) — one of:

- `source` — generates messages on its own. 0 input ports, 1 output
  port. Must declare a numeric `intervalMs` property (below) — unless
  `eventSource` is true (it waits on an event) or `runOnce` is true (it
  runs once at flow start).
- `transform` — one message in, one or more out. 1 input port, 1+ output
  ports.
- `sink` — consumes a message, produces nothing. 1 input port, 0 output
  ports.

**`label`** (required) — name shown on the canvas and in the palette.

**`title`** (optional) — the canvas title, when it should differ from
`label`.

**`hidden`** (optional) — hide the node from the palette (a flow file can
still use it).

**`description`** (optional) — a short line shown at the top of the
property panel, like a built-in node's own description.

**`presetType`** / **`screenOutline`** (optional) — show a save/load-preset
control or the screen-layout outline in the property panel, as the relevant
built-in nodes do.

**`color`** / **`bgcolor`** (optional) — CSS colors for the node's
outline and fill. Default is gray.

**`icon`** (optional) — one or two characters shown in the icon chip.

**`group`** (optional) — which palette section the node sorts into.
Defaults to "general". Any name works; a new one gets its own section,
added after the built-in ones.

**`priority`** (optional) — a number controlling order within `group`,
lower first. Omit it and the node sorts after every built-in node in
that group.

**`ports.inputs`** / **`ports.outputs`** — arrays of `{ name, type }`.
`type` is one of `int`, `number`, `bool`, `string`, `bytes`, `any` — the
same types built-in nodes use, with the same wire-compatibility checks.
Use `any` when unsure.

A port type can follow a select property instead of being fixed:

```json
{ "name": "msg", "type": { "property": "payloadType", "map": { "bool": "bool", "number": "number" }, "default": "bool" } }
```

The value of `property` picks the wire type; an unset or unmapped value uses `default`. The property must be a
`select` field, and every key in `map` must be one of its options.

A `transform` may declare more than one output. Return a list to route
messages across them, Node-RED style (e.g. `return [msg, None]` sends to
output 1 only). A `source` has one output; a `sink` none.

**`properties`** (optional) — fields shown in the property panel when
the node is selected:

```json
{ "name": "factor", "label": "factor", "kind": "number", "default": 2 }
```

- **`name`** — identifier. Your Python reads the value by this key.
- **`label`** — shown in the property panel.
- **`kind`** — `text`, `textarea`, `number`, `boolean`, `select`, `configRef`, `pin`, or `target`.
- **`default`** — used when a node instance doesn't set the property.
  Type must match `kind`.
- **`options`** — required for `select`: array of `{ value, label }`.
  `default` must be one of the values.
- **`configType`** — required for `configRef`: the config type the picker
  offers (e.g. `thingstudio/config/i2c-bus`). At compile time the picked
  config's own properties become a dict the node reads — see below.
- **`singleton`** — optional, on a `configRef`: resolve the flow's one
  config of `configType` at compile time instead of an id you store (how a
  built-in uses the shared WiFi setting). Zero or two such configs is a
  compile error.
- **`pinUse`** / **`pinPull`** — optional, on a `pin`: `input` or `output`,
  and the pull (`none`/`up`/`down`). Adding `pinUse` makes the compiler
  claim the pin, so two nodes can't quietly set the same pin up two ways. A
  `pin` without `pinUse` is just a value (checked to exist on the board) —
  use that for a bus line like SCL/SDA.
- **`target`** — a kind for a board-specific node. Its value in Python is a
  dict of the board/processor this flow is compiled for — `boardId`,
  `boardName`, `processorId`, `processorName`, `label`, `capabilities` —
  or `None` if no board is chosen, so guard for that. Use it to identify
  your exact board (e.g. a XIAO nRF52840's own IMU).
- **`nodeId`** — a kind whose Python value is this node's own id (a string).
  Use it to report status about yourself:
  `runtime.report_status(properties['id'], 'connected')`.
- **`help`** / **`placeholder`** / **`min`** / **`max`** / **`step`** /
  **`optional`** / **`rows`** — optional, the same panel hints a built-in
  field has. `rows` sets a `textarea`'s height (default 4). `pin` fields
  take a `number` default; `optional` marks one where
  `-1`/blank means "not wired".
- **`visibleWhen`** — optional: show the field only when another property
  satisfies a condition, e.g.
  `{ "field": "mode", "equals": "deadband" }`. Operators: `equals`,
  `notEquals`, `in` (an array), `gt`, `gte`, `lt`, `lte`.

A polled `source` node must declare a numeric property named `intervalMs` — it
sets the poll interval, a whole number of milliseconds, 1 or more. An `eventSource` or `runOnce` source does not need one.

**`requires`** (optional) — hardware the node needs, as `{ "capabilities": ["ble"] }`. The words are the board
definitions' capabilities (`wifi`, `ble`, `espnow`, `pio`, see [Boards](boards.md)). On a board without one, the
palette grays the node out and the compile refuses it, naming the missing capability.

## The behavior: `<name>.node.py`

Ordinary MicroPython. Define exactly one top-level function, named for
your node's `kind`:

- `transform` / `sink` → `async def run(msg, properties):`
- `source` → `async def emit(properties):`

`msg` is a dict with a `payload` key, a `topic` key, and room for any
extra keys you add. `topic` is a routing/identification string — the
`mqtt subscribe` built-in node, for instance, fills it with the real
MQTT topic a message arrived on. Most nodes have no natural topic of
their own; set it to `''` rather than a real value. The key is
required either way — don't leave it out. `properties` is a dict of
the node instance's configured values.

Transform — return the (possibly modified) `msg`, or `None` to stop it
propagating:

```python
async def run(msg, properties):
    msg['payload'] = msg['payload'] * properties['factor']
    return msg
```

Sink — return value is ignored:

```python
async def run(msg, properties):
    print('got:', msg['payload'])
```

Source — called once per `intervalMs`, must return a `msg`:

```python
async def emit(properties):
    return {'payload': 42, 'topic': ''}
```

Anything else — imports, helper functions, setup code — is ordinary
Python.

### Example: a temperature sensor source

`temp_sensor.node.json`:

```json
{
  "type": "myproject/temp_sensor",
  "kind": "source",
  "label": "temp sensor",
  "ports": { "outputs": [{ "name": "msg", "type": "number" }] },
  "properties": [
    { "name": "pin", "label": "data pin", "kind": "number", "default": 4 },
    { "name": "intervalMs", "label": "read interval (ms)", "kind": "number", "default": 5000 }
  ]
}
```

`temp_sensor.node.py`:

```python
import dht
import machine

_pin = properties['pin']
_sensor = dht.DHT22(runtime.shared('pin', _pin, ('dht22',), lambda: machine.Pin(_pin)))

async def emit(properties):
    _sensor.measure()
    msg = {'payload': _sensor.temperature(), 'topic': ''}
    msg['humidity'] = _sensor.humidity()
    return msg
```

The sensor is built once, at setup, not on every `emit()` call —
top-level code and `emit` share the same `properties`.

Temperature goes in `payload`, not humidity, because `payload` is the
field the port's declared type (`number`, here) checks against, and
the field a generic downstream node reads — `debug` prints
`msg['payload']` and nothing else, whatever else is in `msg`. Put
whichever value you want wired and type-checked that way in `payload`.
Anything else is a passenger: `humidity` rides along in the same `msg`,
but only a node written to look for it specifically will ever read it.

### `nonlocal`, not `global`

Your file's top-level code doesn't run at true module scope — each node
instance gets its own wrapper function, so two instances of the same
custom type never share state. To keep a value across calls, use
`nonlocal`:

```python
_count = 0

async def emit(properties):
    nonlocal _count
    _count += 1
    return {'payload': _count, 'topic': ''}
```

`global` raises `NameError` here — there's no module-level name to find.

### Pins and buses

Get a pin or bus with `runtime.shared(kind, key, settings, make)`, not by building it yourself. The first node to
ask builds it with `make()`; every later node gets the same object. If a later node asks with different `settings`,
the flow stops with an error naming both, instead of one node quietly changing the pin under another.

```python
_pin = runtime.shared('pin', 5, ('in', 'up'), lambda: machine.Pin(5, machine.Pin.IN, machine.Pin.PULL_UP))
_i2c = runtime.shared('i2c', 0)  # fetch a bus another node in the flow set up
```

The built-in nodes use these settings: `('in', 'none' | 'up' | 'down')` and `('out', 'none')` for pins, and `()`
for an ADC (`runtime.shared('adc', 26, (), lambda: machine.ADC(machine.Pin(26)))`). Pins, ADC, PWM, I2C and SPI all
work this way: see [Hardware is shared](nodes/index.md#hardware-is-shared).

### Sharing a config (I2C bus, touch panel)

A `configRef` property lets your node pick one of the flow's config nodes. Its value in
`properties` is that config's own properties as a dict (or `None` if none is picked), so a custom
I2C node can join the same bus a built-in `i2c`/`bme280` node uses:

```json
{ "name": "bus", "label": "I2C bus", "kind": "configRef", "configType": "thingstudio/config/i2c-bus", "default": "" }
```

```python
_i2c = runtime.shared('i2c', properties['bus']['bus'])  # the flow's shared bus, by its number
```

The bus/pins come from the config; keep the same `runtime.shared` key a built-in would use so a
clash is reported, not silently shared. A network config (WiFi, MQTT broker) gives Python only
the credential's name: [The flow's WiFi](#the-flows-wifi-ts_wifi) says how a node reaches the network.

### Cleanup

If your node opens something that needs closing on redeploy — a socket,
typically — register it:

```python
import socket

_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
runtime.register_cleanup('my_node_socket', lambda: _sock.close())

async def run(msg, properties):
    _sock.sendto(str(msg['payload']).encode(), ('192.168.1.50', 9000))
```

`runtime` is already available — no import needed. Without cleanup, a
redeployed flow can leave the old socket open and fail with
`EADDRINUSE` on the next deploy.

### Libraries you can import

When a node imports one of these, ThingStudio sends it to the board with the flow:

| Library | For |
| --- | --- |
| `ts_ble` | the board's Bluetooth LE radio, shared with the ble nodes (below) |
| `ts_wifi`, `ts_mqtt`, `ts_http_server` | the flow's WiFi, MQTT client and HTTP server, shared with the network nodes |
| `threadsafe_event` | waking a coroutine from a hardware interrupt (see Event-driven sources) |
| `events`, `delay_ms`, `encoder`, `aadc` | Peter Hinch's asyncio switch, button, timer, encoder and ADC drivers |
| `ssd1306`, `st7789py`, `st7796py` | display drivers |
| `bme280_float`, `ft6336u` | the BME280 sensor and FT6336U touch drivers |
| `mqtt_as` | Peter Hinch's asyncio MQTT client |

Your own libraries are sent the same way (below).

For Bluetooth, use `ts_ble.radio()`, not `bluetooth.BLE()`: the board has one radio, and the ble nodes use the same
one. `radio().scan(...)` and `radio().advertise(...)` share it as `ble scan` and `ble advertise` do, and
`ts_ble.decode(adv)` and `ts_ble.build_adv(...)` read and build advertising data. The radio is turned off on each
redeploy.

#### The flow's WiFi: `ts_wifi`

A node that uses the network joins the flow's one WiFi network, as the built-in network nodes do. Give it a WiFi
field:

```json
{ "name": "wifi", "label": "WiFi", "kind": "configRef", "configType": "thingstudio/config/wifi", "singleton": true, "default": "" }
```

In Python that field holds only the credential's name. The SSID and password reach your node through a
[compile hook](#compile-time-namecompilepy), which reads the WiFi config from `ctx["referencedConfigs"]` and returns
the values as properties. The WiFi config has `ssid`, `password` and `security` (`password`, `open` or
`unmanaged`). This hook returns them the way the built-in nodes do:

```python
def compile(ctx, properties):
    configs = ctx['flow']['configs']
    wifi_ids = [c['id'] for c in configs if c['type'] == 'thingstudio/config/wifi']
    broker_ids = [c['id'] for c in configs if c['type'] == 'thingstudio/config/mqtt-broker']
    wifi = (ctx.get('referencedConfigs') or {}).get(wifi_ids[0]) if len(wifi_ids) == 1 else None
    if wifi is None:
        return {'errors': ['needs the flow\'s WiFi -- set "WiFi" in its properties']}
    security = wifi.get('security')
    if security not in ('open', 'unmanaged'):
        security = 'password'
    mqtt = any(isinstance(v, str) and v in broker_ids
               for n in ctx['flow']['nodes'] for v in (n.get('properties') or {}).values())
    return {'properties': {
        'ssid': str(wifi.get('ssid') or '').strip(),
        'password': str(wifi.get('password') or ''),
        'security': security,
        'deferToMqtt': mqtt,
    }}
```

Then, in your node's setup:

```python
import ts_wifi

_sta = ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])
```

`ts_wifi.ensure_station(ssid, password, security='password', defer_to_mqtt=False)` returns the board's WiFi station,
a `network.WLAN`. It starts the join and doesn't wait for it, so check `_sta.isconnected()` before sending, or treat
a failed send as the network being down. Every node in a flow passes the same four values: the first call joins, and
later calls return the same station. Different values raise `ValueError`, naming both sets. A redeploy forgets the
values and leaves the board on the network.

The four values are:

- `security`: with `unmanaged`, the station is turned on but not joined, and
  [WiFi provisioning](wifi-provisioning.md) joins it instead.
- `defer_to_mqtt`: `True` when any node in the flow holds the flow's MQTT broker config, otherwise `False`. Work it
  out as the hook above does, or your node's values won't match the built-in nodes'. With `True`, the MQTT client
  keeps the connection up.
- `ssid` and `password`: as the WiFi config holds them, with the SSID trimmed.

While the network is down, socket calls such as `sendto` and `getaddrinfo` raise `OSError`. Uncaught, it is
reported against your node, like any error. Catch it to say what failed, as `udp send` does:
`udp_send to <host>:<port> failed: ...`.

#### The flow's MQTT client: `ts_mqtt`

An MQTT node holds the flow's broker as well as its WiFi, and a `nodeId` field for the client to report under:

```json
{ "name": "broker", "label": "MQTT Broker", "kind": "configRef", "configType": "thingstudio/config/mqtt-broker", "singleton": true, "default": "" },
{ "name": "nodeId", "label": "node id", "kind": "nodeId", "default": "" }
```

Holding the broker makes your node an MQTT node, so the hook above gives it `deferToMqtt` `True`. The broker config
has `broker`, `port` (default `1883`), `username` and `password`. Extend the hook to return them, with the broker
password under a name of its own such as `brokerPassword`. The hook should also refuse `unmanaged` WiFi, as the mqtt
nodes do: the MQTT client needs the WiFi password to rejoin.

Then, in setup:

```python
import ts_wifi
import ts_mqtt

ts_wifi.ensure_station(properties['ssid'], properties['password'], properties['security'], properties['deferToMqtt'])
_client = ts_mqtt.ensure_client(
    properties['broker'], properties['port'], properties['ssid'], properties['password'],
    properties['security'], properties['username'], properties['brokerPassword'])
_node_id = properties['nodeId']
```

`ts_mqtt.ensure_client(broker, port, ssid, wifi_password, security='password', username='', password='')` returns
the flow's one client for that broker and port, the client the mqtt nodes use. Different settings for the same broker
raise `ValueError`. A redeploy stops the client and leaves WiFi up.

Every client call except `set_will` and `on_connect` takes your node's id first. The client reports your node's
status (`connected`, `disconnected` or `error`) under that id, and keeps each node's subscriptions and messages
separate. The client's calls are:

| Call | What it does |
| --- | --- |
| `await client.ensure_connected(node_id)` | The first call connects: it waits up to 15 s for WiFi, then tries the broker 3 times, 1 s apart. If all fail, it reports `error` and raises `OSError`: `mqtt connect to <broker>:<port> failed after 3 attempts (...)`. Later calls don't raise: the client reconnects by itself, and the call reports `connected` or `disconnected` when that changes. |
| `await client.publish(node_id, topic, payload, retain=False, qos=0)` | Publishes `payload`, as bytes (encode a `str` first). It calls `ensure_connected` first. While the broker is unreachable, it waits and publishes after the reconnect. |
| `await client.subscribe(node_id, topic, qos=0)` | Subscribes your node to `topic`; `+` and `#` work. Call `ensure_connected` first: before the first connect, `subscribe` waits. |
| `await client.unsubscribe(node_id, topic)` | Drops your node's subscription. The broker is told when no node on the client still holds the topic. |
| `await client.wait_message(node_id)` | The next message for your node, as `(topic, payload, retained)`. `topic` and `payload` are bytes. |
| `client.set_will(topic, msg, retain=False, qos=0)` | Sets the message the broker publishes if the board drops off without saying goodbye. Call it in setup, before anything connects: later raises `ValueError`, and so does a different will on the same broker. |
| `client.on_connect(callback)` | Runs `callback` after the first connect and after each reconnect, for example to publish `online` over a retained `offline` will. It can be a plain or an `async` function. Register it in setup. |

QoS is 0 or 1; 2 raises `ValueError`.

A node receives the messages whose topic matches one of its own subscriptions, and no others. A message that matches
two nodes goes to both, and a message no node subscribed to is dropped. Each node's messages wait in its own queue
from the moment it subscribes, up to 20; past that, the oldest is dropped.

After a reconnect, the client subscribes every node's topics again, then runs the `on_connect` callbacks. It notices a
reconnect only inside `ensure_connected`. `wait_message` checks about once a second and `publish` on each call, so a
node that subscribes or publishes is covered.

On the first connect, the `on_connect` callbacks finish before `ensure_connected` returns, so a `publish` waiting for
that connect goes out after them. A callback can publish too. A reconnect has no such order: a `publish` waiting for
the broker can go out as soon as the link is back, before the callbacks run.

An event source that receives on the shared client:

```python
_state = {'ready': False, 'last': None}

async def wait(properties):
    if not _state['ready']:
        await _client.ensure_connected(_node_id)
        await _client.subscribe(_node_id, 'home/light/set', 1)
        _state['ready'] = True
    _state['last'] = await _client.wait_message(_node_id)

async def emit(properties):
    topic, payload, retained = _state['last']
    return {'payload': payload.decode(), 'topic': topic.decode(), 'retained': retained}
```

### Your own libraries

Put a Python module of your own in `~/.thingstudio/libraries/`: a file `<name>.py`, or a package as a folder with
an `__init__.py`. When a node or a function node imports it, ThingStudio sends it to the board on deploy, like the
libraries above. The editor reads the folder when it loads custom nodes, and **Reload custom nodes** reads it again.

A library can `import runtime` for the calls above, such as `runtime.shared` and `runtime.register_cleanup`. A node
has `runtime` without importing it.

A library is refused, with a line in the console, when its name is already taken: by a library in the table above,
by a module of ThingStudio's own runtime such as `runtime`, or by a module MicroPython provides such as `machine` or
`json`. A name that isn't a plain Python name (letters, digits and `_`) is refused too. Two libraries with the same
name, one in this folder and one in a bundle say, are both refused: rename one. A library that doesn't compile stops
the deploy that needs it, and the console names the file.

Libraries aren't available in ThingStudio Web.

### Bundles

Nodes that belong together, and the libraries they share, can go in one folder inside `custom-nodes/`:

```
custom-nodes/
  home-assistant/
    ha_sensor.node.json
    ha_sensor.node.py
    lib/
      ts_ha.py
```

Install a bundle by copying its folder in. Its nodes load like any others, and the modules in its `lib/` work like
your own libraries. Other folders in a bundle, such as `examples/`, are ignored, and a bundle can't hold another.

A bundle loads whole or not at all. If one of its nodes has a problem, one of its libraries is refused, or one of its
node names is already used, none of it loads, and the console says why. Edit a bundle's files directly: the editor
doesn't change them. A folder whose name starts with `.` or `_` is ignored, so `_drafts/` is a safe place for work
in progress.

### Persisting values

`runtime.settings` keeps a value across reboots and redeploys of the same flow. Use it for an application
setting a user changes on the device — units, a colour scheme — not for per-message state, which belongs in a
closure local.

```python
async def run(msg, properties):
    units = runtime.settings.get('units', 'kg')   # the default is yours, not the store's
    runtime.settings.set('units', msg['payload'])
    msg['payload'] = units
    return msg
```

Values are namespaced by the deployed flow's name, so a different flow cannot read or overwrite them. Renaming
the flow starts a fresh namespace. A missing key returns your default. `set` raises `SettingsError` if the board
cannot save (full or read-only flash) — let it surface as a node error rather than assuming the write worked.
`delete(key)` and `keys()` round out the surface.

The store is a plain key/value; it does not know what a value means. Save only what the user changed, and supply
the default at the read. To clear stored values, see [debugging](debugging.md#commands-and-the-python-prompt).

### Event-driven sources

A `source` that reacts to something other than the clock sets `"eventSource": true` and defines a
second function, `async def wait(properties)`, alongside `emit`. `wait` is awaited, so it blocks
until your event fires; then `emit` builds the message. No `intervalMs` is needed.

```json
{
  "type": "custom/button",
  "kind": "source",
  "label": "button",
  "eventSource": true,
  "ports": { "outputs": [{ "name": "msg", "type": "bool" }] },
  "properties": [{ "name": "pin", "label": "pin", "kind": "pin", "default": 11, "pinUse": "input" }]
}
```

A hardware interrupt (`machine.Pin.irq`) is the usual reason to use `eventSource`. Bridge it into `asyncio`
with the vendored `ThreadSafeEvent` — its `set()` is the one call safe in a hard-IRQ handler — and
register the handler:

```python
import machine
from threadsafe_event import ThreadSafeEvent   # pushed with the flow because you import it

_evt = ThreadSafeEvent()

def _irq(_pin):
    _evt.set()          # a hard-IRQ handler may only do this: no allocation, no print, nothing else

_pin = runtime.shared('pin', properties['pin'], ('in', 'up'),
                      lambda: machine.Pin(properties['pin'], machine.Pin.IN, machine.Pin.PULL_UP))
_pin.irq(trigger=machine.Pin.IRQ_RISING, handler=_irq)

async def wait(properties):
    await _evt.wait()
    _evt.clear()

async def emit(properties):
    return {'payload': True, 'topic': ''}
```

`runtime.asyncio.Event()` is fine when the event is set from other asyncio code; for a real IRQ use
`ThreadSafeEvent`, which survives the hard-IRQ context.

Keep any state the two share at the top of the file (both functions come from one per-instance
closure, so `nonlocal` works across them).

### Run-once sources

A source that runs once, at flow start, sets `"runOnce": true` instead. It defines only `emit`; ThingStudio calls
it once, with no `intervalMs` and no `wait`.

```json
{
  "type": "custom/boot",
  "kind": "source",
  "label": "boot",
  "runOnce": true,
  "ports": { "outputs": [{ "name": "msg", "type": "string" }] }
}
```

### Two-faced nodes

A `sink` with `"eventSource": true` both consumes and produces: one input, one output, and three functions in
`.node.py`. `run(msg, properties)` handles the input; `wait(properties)` then `emit(properties)` produce the
output. All three come from the same per-instance closure, so they share state through `nonlocal`.

```json
{
  "type": "custom/gateway",
  "kind": "sink",
  "label": "gateway",
  "eventSource": true,
  "ports": {
    "inputs": [{ "name": "msg", "type": "any" }],
    "outputs": [{ "name": "msg", "type": "string" }]
  }
}
```

Use it when the node has to react to messages and also act on its own (a clock that echoes a message and then
ticks, or a subscription you can change at run time). A `transform` cannot be two-faced.

The two faces are independent: a message into `run` never comes out of the output, like a Node-RED Dashboard switch
with pass-through off. So `run` must never make `wait` return; the output fires only on something from outside, such
as a press, a command or a tick. That is what lets a flow wire the output round to the node's own input, to report
the real state back, without the message going round forever.

## Compile time: `<name>.compile.py`

A package can also include an optional compile-time hook, `<name>.compile.py`, defining one function:

```python
def compile(ctx, properties):
    return {"properties": {...}, "errors": [...]}
```

It runs in the editor when the flow is compiled — never on the board. `properties` is what the flow file holds
for this node; `ctx` describes the flow:

- `ctx["node"]` — this instance: `id`, `type`, `properties`, and `wired` (a boolean per input/output).
- `ctx["flow"]["nodes"]` / `["configs"]` — every node and config, with non-secret properties only.
- `ctx["nodesOfType"]` — every node of this node's type in the flow, including this one: `id`, `type`, and
  non-secret `properties`. Use it when the nodes share a decision (for example, a port's set of routes).
- `ctx["referencedConfigs"]` — the full properties (including credentials) of the configs this node's `configRef`
  fields point at.
- `ctx["target"]` — the board/processor being compiled for, or `None`.

Return a dict (or `None`). Everything is optional:

| Key | Meaning |
|---|---|
| `properties` | Extra values merged into what `.node.py` receives. Keys your descriptor doesn't declare are allowed. |
| `claims` | `[{"resource": "GPIO 22", "use": "my device"}]`, checked like a `pin` field. |
| `warnings` | Strings shown in the compile warnings. |
| `errors` | Strings that stop the compile, naming the node. |

The hook is sandboxed: no files, network, clock or randomness. Its result is data only — it cannot return Python
or change the generated code's shape. Limits: 64 KB of properties, 64 claims, 32 warnings and 32 errors, and one
second per hook; a hook that runs too long is stopped.

`wifi status` is an example: its hook derives the flow's WiFi config and whether an MQTT node is present, so its
Python never asks you for the network twice.

## Errors

**Load time** — a malformed `.node.json` is rejected immediately, with
a message naming what's wrong: bad `type`, wrong port count, missing
`intervalMs`, and so on.

**Compile time** — a bad property value on a specific node instance
(e.g. a non-numeric `number` field) errors out naming that node and
property.

**Without the editor** — the [check command](check-a-flow.md) loads the same folder (or `--custom-nodes <dir>`).
Check a flow that uses your node and it reports load and compile errors the same way:

```sh
node dist-cli/thingstudio-compile.mjs --board board:cyd my.flow.json
```

**Deploy time** — `.node.py` is spliced into the flow as-is;
ThingStudio doesn't check it. A typo surfaces as a runtime error (e.g.
`NameError`) reported from the device, attributed to your node.

## Limitations

A polled `source` node's `emit` runs on a fixed `intervalMs` schedule; an `eventSource` source waits on `wait` instead.

Two instances of the same custom node get independent setup. For a `pin` field that declares `pinUse`,
ThingStudio checks it against the board and claims it at compile time; a pin you build in Python yourself (or
read from a plain `number` field) it can't see, so use `runtime.shared()` for those, and a clash is caught when
the flow starts.

Custom node Python runs with the same trust as any other node, including ThingStudio's `function` node. Loading a
package only adds it to the palette; its Python runs on a board only when you place the node and deploy. Only files
you place in the folder are loaded — there's no registry and no URL install — so don't put a package there that you
haven't read.
