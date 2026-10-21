# Writing a custom node for Thingstudio

A custom node is two files sharing a base name: `<name>.node.json` (the
descriptor) and `<name>.node.py` (the behavior), placed in the backend's
`~/.thingstudio/custom-nodes/` directory. Thingstudio loads it for you,
and you drag it onto the canvas like any built-in node.

## Loading a custom node

Put both files in `~/.thingstudio/custom-nodes/` on the computer running
Thingstudio.

The editor loads every package in that folder when it starts, and again
when you switch back to its window. After changing a file, you can also
click **Reload custom nodes** at the bottom of the palette. The console
lists what loaded. Each node appears in the palette under its `group`.

A package with a problem isn't loaded, and the console says which file
and why. The others still load. If two packages use the same `type`, the
first one by file name is loaded and the other is reported.

The folder starts with two examples, `doubler` and `dht22`, under
**examples** in the palette. Read them, change them or delete them.
Thingstudio adds them only the first time it runs, so deleted examples
stay deleted.

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
sets the poll interval. An `eventSource` or `runOnce` source does not need one.

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
clash is reported, not silently shared. (Network configs — WiFi, MQTT — expose only the
credential's name, not the secret, so a custom node can't make a WiFi connection from one.)

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

A source that runs once, at flow start, sets `"runOnce": true` instead. It defines only `emit`; Thingstudio calls
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

**Deploy time** — `.node.py` is spliced into the flow as-is;
Thingstudio doesn't check it. A typo surfaces as a runtime error (e.g.
`NameError`) reported from the device, attributed to your node.

## Limitations

A polled `source` node's `emit` runs on a fixed `intervalMs` schedule; an `eventSource` source waits on `wait` instead.

Two instances of the same custom node get independent setup. For a `pin` field that declares `pinUse`,
Thingstudio checks it against the board and claims it at compile time; a pin you build in Python yourself (or
read from a plain `number` field) it can't see, so use `runtime.shared()` for those, and a clash is caught when
the flow starts.

Custom node Python runs with the same trust as any other node, including Thingstudio's `function` node. Loading a
package only adds it to the palette; its Python runs on a board only when you place the node and deploy. Only files
you place in the folder are loaded — there's no registry and no URL install — so don't put a package there that you
haven't read.
