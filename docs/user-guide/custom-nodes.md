# Writing a custom node for Thingstudio

A custom node is two files sharing a base name: `<name>.node.json` (the
descriptor) and `<name>.node.py` (the behavior). Load them through the
palette sidebar, then drag the node onto the canvas like any built-in
node. This document is complete on its own — no other Thingstudio docs
needed.

## Loading a custom node

Click "Load custom node…" in the palette sidebar. Select both files at
once (shift-click or ctrl/cmd-click). The node appears under "custom
nodes" in the palette.

Loading is scoped to the current editor session. Reload the page and
you'll need to load the package again before reopening or recompiling a
flow that uses it.

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
  port. Must declare a numeric `intervalMs` property (below).
- `transform` — one message in, one out. 1 input port, 1 output port.
- `sink` — consumes a message, produces nothing. 1 input port, 0 output
  ports.

**`label`** (required) — name shown on the canvas and in the palette.

**`color`** / **`bgcolor`** (optional) — CSS colors for the node's
outline and fill. Default is gray.

**`icon`** (optional) — one or two characters shown in the icon chip.

**`ports.inputs`** / **`ports.outputs`** — arrays of `{ name, type }`.
`type` is one of `int`, `number`, `bool`, `string`, `bytes`, `any` — the
same types built-in nodes use, with the same wire-compatibility checks.
Use `any` when unsure.

Only one output port is supported. Thingstudio doesn't yet support
routing to multiple named outputs, for any node type. That's planned,
not built — the limit is in the compiler, not this file format.

**`properties`** (optional) — fields shown in the property panel when
the node is selected:

```json
{ "name": "factor", "label": "factor", "kind": "number", "default": 2 }
```

- **`name`** — identifier. Your Python reads the value by this key.
- **`label`** — shown in the property panel.
- **`kind`** — `text`, `number`, `boolean`, or `select`.
- **`default`** — used when a node instance doesn't set the property.
  Type must match `kind`.
- **`options`** — required for `select`: array of `{ value, label }`.
  `default` must be one of the values.

A `source` node must declare a numeric property named `intervalMs` — it
sets the poll interval.

## The behavior: `<name>.node.py`

Ordinary MicroPython. Define exactly one top-level function, named for
your node's `kind`:

- `transform` / `sink` → `async def run(msg, properties):`
- `source` → `async def emit(properties):`

`msg` is a dict with a `payload` key, a `topic` key, and room for any
extra keys you add. `topic` is a routing/identification string — the
`mqtt_subscribe` built-in node, for instance, fills it with the real
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

_sensor = dht.DHT22(machine.Pin(properties['pin']))

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

### Event-driven sources

Not supported. A `source` node's `emit` runs on a fixed `intervalMs`
schedule, not in response to an external event like an interrupt.

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

- **Session-scoped loading** — no persistence across a page reload.
- **One output port** — a current compiler limit, not a format limit.
- **No event-driven sources** — `intervalMs` polling only.
- **No resource-sharing between instances.** Two built-in `gpio_out`
  nodes on the same pin share one `Pin` object; two instances of your
  custom node don't — each gets its own independent setup. Don't put
  two instances of the same stateful custom node on the same physical
  resource (e.g. the same pin).
- **No sandboxing.** Custom node Python runs with the same trust as any
  other node — the same trust Thingstudio's `function` node already
  has. There's no install-from-elsewhere mechanism: no registry, no URL
  install, only files you load yourself. Don't load a package you
  haven't read.
