# Writing a custom node for Thingstudio

This is a self-contained guide to building your own Thingstudio node type
— no other project documentation required. If you already know Thingstudio
well, the short version is: a custom node is two files (a JSON descriptor
and a Python behavior file) sharing a base name, loaded into the editor
through the palette sidebar, compiled straight into the deployed flow like
any other node. The rest of this document is the detail behind that
sentence.

## What a custom node is

Every node type in Thingstudio — built-in or custom — is two things: a
small description the editor uses to draw it on the canvas and let you
configure it, and a piece of code that runs on the device when the flow
executes. For built-in nodes, both halves are written in TypeScript and
compiled into the editor itself. A custom node gets the same two halves,
but as plain files you write and load into a running editor, no rebuild
required:

- `<name>.node.json` — the descriptor: what the node is called, what it
  looks like, what inputs/outputs it has, and what properties can be
  configured on it.
- `<name>.node.py` — ordinary MicroPython: what the node actually does.

Both files must share a base name before their respective suffixes, e.g.
`dht22.node.json` and `dht22.node.py`. You load them together, as a pair,
through the palette sidebar's "Load custom node…" button, which opens your
browser's file picker — select both files at once (shift-click or
ctrl/cmd-click to multi-select). Once loaded, the node appears in a
"custom nodes" section of the palette, exactly like a built-in node: click
or drag it onto the canvas, wire it up, and it compiles and deploys the
same way everything else does.

Loading is scoped to your current editor session. If you reload the page,
you'll need to load the package again before a flow using that node type
can be reopened or recompiled — there's no project-wide auto-discovery or
persistence yet. This is a deliberate, documented limitation, not a bug.

## The descriptor: `<name>.node.json`

A minimal example — a node that doubles a numeric payload:

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

Field by field:

**`type`** (required, string) — the node's unique identifier, shaped
`namespace/name` (lowercase letters, digits, underscores only — e.g.
`custom/doubler`, `myproject/dht22`). Pick your own namespace; `type`
must **not** start with `thingstudio/` — that prefix is reserved for
Thingstudio's own built-in node types, and a package that uses it will be
rejected when loaded.

**`kind`** (required, one of `"source"`, `"transform"`, `"sink"`) —
what shape of node this is, and it fixes how many ports you're allowed to
declare:

- `"source"` — generates messages on its own (like `timer` or `inject`).
  Must declare **zero** input ports and **exactly one** output port. Must
  also declare a numeric property named `intervalMs` (see below) — this
  is what drives how often the node runs.
- `"transform"` — takes a message in, produces a (possibly different)
  message out (like `function`). Must declare **exactly one** input port
  and **exactly one** output port.
- `"sink"` — takes a message in, produces no output (like `gpio_out` or
  `debug`). Must declare **exactly one** input port and **zero** output
  ports.

**`label`** (required, string) — the name shown on the canvas and in the
palette.

**`color`** / **`bgcolor`** (optional, CSS color strings) — the node's
outline and fill color on the canvas. If omitted, a default gray is used.

**`icon`** (optional, string) — a short glyph shown in the node's icon
chip, matching the built-in nodes' style (`▶` for inject, `ƒ` for
function, and so on). One or two characters looks best; longer text will
be clipped.

**`ports.inputs`** / **`ports.outputs`** (arrays of `{ name, type }`) —
subject to the cardinality rules under `kind` above. `type` must be one of
Thingstudio's six fixed payload types: `int`, `number`, `bool`, `string`,
`bytes`, `any`. These are the same types built-in nodes use, and they get
the same wire-connect-time compatibility checking on the canvas (e.g. an
`int` output can feed a `number` input; `bytes` and `string` can't connect
without an explicit conversion node). When in doubt, `any` is the safe
default and matches what most built-in nodes with loosely-typed payloads
use.

A note on why only one output port is supported right now, since it's a
real and deliberate limitation, not an oversight: Thingstudio doesn't yet
have a way for *any* node type — built-in or custom — to route different
messages to different named outputs (a "send to output A or output B"
node). That's real, planned work, just not built yet. When it lands,
custom nodes will be able to use it too without this file's format
changing — it's a limitation of what the generated code can currently do,
not of what the descriptor can say.

**`properties`** (optional array of field descriptors) — the configurable
values shown in the node's property panel when it's selected on the
canvas. Each entry:

```json
{ "name": "factor", "label": "factor", "kind": "number", "default": 2 }
```

- **`name`** (required) — a valid identifier (letters, digits,
  underscores, not starting with a digit). This is the dict key your
  Python code reads the value from (see below).
- **`label`** (required) — shown next to the input field in the property
  panel.
- **`kind`** (required, one of `"text"`, `"number"`, `"boolean"`,
  `"select"`) — which kind of input widget to show, and what type the
  value must be.
- **`default`** (required) — the value used when a node instance doesn't
  set this property explicitly. Must match `kind`: a real number for
  `"number"`, a real boolean for `"boolean"`, a string for `"text"`/
  `"select"`.
- **`options`** (required when `kind` is `"select"`, an array of
  `{ value, label }`) — the fixed set of choices. `default` must be one of
  the declared `value`s.

If your node's `kind` is `"source"`, you **must** declare a property named
`intervalMs` with `kind: "number"` — see the worked example below for why
and how it's used.

## The behavior: `<name>.node.py`

This file is ordinary MicroPython. You write exactly one top-level
function, named according to your node's `kind`:

- `kind: "transform"` or `"sink"` → `async def run(msg, properties):`
- `kind: "source"` → `async def emit(properties):`

`msg` is Thingstudio's standard message envelope — a plain dict with a
`payload` key (the primary value), a `topic` key (a routing string, often
just `''`), and room for whatever extra keys you want to attach.
`properties` is a plain dict of your node instance's configured property
values, keyed by the `name` you gave each field in the descriptor.

**For a `transform`**, `run` must return the (possibly modified) `msg`
dict, or `None` to stop the message from propagating further:

```python
async def run(msg, properties):
    msg['payload'] = msg['payload'] * properties['factor']
    return msg
```

**For a `sink`**, `run`'s return value is ignored — its job is the side
effect:

```python
async def run(msg, properties):
    print('got:', msg['payload'])
```

**For a `source`**, `emit` is called once per interval (driven by your
declared `intervalMs` property) and must return the `msg` dict for that
iteration:

```python
async def emit(properties):
    return {'payload': 42, 'topic': ''}
```

Anything above and beyond that one function — imports, helper functions,
module-level setup code (initializing a pin, opening a sensor driver) — is
ordinary Python, written exactly as you'd write it anywhere else. See the
worked example below for what that looks like in practice.

### A worked example: a temperature sensor source node

`temp_sensor.node.json`:

```json
{
  "type": "myproject/temp_sensor",
  "kind": "source",
  "label": "temp sensor",
  "color": "#1f6e6e",
  "bgcolor": "#123f3f",
  "icon": "🌡",
  "ports": {
    "outputs": [{ "name": "msg", "type": "number" }]
  },
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
    msg['humidity'] = _sensor.humidity()  # extra envelope field -- see "the msg envelope" note below
    return msg
```

Two things worth noticing here, both load-bearing, not incidental:

**The sensor is constructed once, outside `emit`, using the outer
`properties` — not the one `emit` receives as its own argument.** This
works because your whole file's top-level code (the `_sensor = ...` line)
and `emit` both see the same `properties` dict — your file is wrapped by
the compiler in a way that makes that true. Constructing the sensor object
once at setup time rather than on every call is exactly what you want:
opening a driver on every single read would be wasteful and, for some
sensor types, outright wrong.

**The msg envelope isn't limited to just `payload`.** `topic` and
`payload` are the two fields every node should expect, but a dict can
carry more — `msg['humidity']` rides along on the wire to whatever this
node connects to. This is how you can expose more than one piece of data
from a single-output node without needing a second output port.

### The `nonlocal`, not `global`, gotcha

If your node needs to remember something across calls — a running count,
a cached value, anything mutable — reach for `nonlocal`, not `global`.

```python
_count = 0

async def emit(properties):
    nonlocal _count
    _count += 1
    return {'payload': _count, 'topic': ''}
```

This is the single most common mistake writing a custom node, so it's
worth understanding *why*, not just memorizing it: your file's top-level
code doesn't actually run at Python's true module scope — behind the
scenes, Thingstudio wraps each node *instance* in its own private function
so that dropping two of the same custom node type on one canvas never
means they secretly share state. That's a real feature (see "resource
conflicts between instances" below for the flip side of it), but it means
`_count = 0` is really a local variable of that wrapper function, and
`global` only ever looks for a true module-level name — it won't find one,
and you'll get a `NameError`. `nonlocal` correctly reaches the enclosing
function's variable, which is what you want.

### Resource cleanup

If your node opens something that needs closing on redeploy — a socket is
the common case — call `runtime.register_cleanup(key, fn)` from your
setup code, the same primitive Thingstudio's own network nodes use:

```python
import socket

_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
runtime.register_cleanup('my_node_socket', lambda: _sock.close())

async def run(msg, properties):
    _sock.sendto(str(msg['payload']).encode(), ('192.168.1.50', 9000))
```

`runtime` is already available — you don't need to import it. Give your
cleanup key something reasonably unique (it doesn't need to be globally
unique across every node in a flow, just distinct from any other resource
your own node claims); without this, a redeployed flow that replaces this
node's code won't reliably close the old socket, and you'll eventually hit
an `EADDRINUSE`-style error on the next deploy.

### If your node's job is naturally "do nothing until something else
happens" (event-driven)

Not supported yet. Every custom source node is driven by `intervalMs` —
`emit` gets called on a fixed schedule, not in response to an external
event like a hardware interrupt. If your sensor or use case genuinely
needs an interrupt-driven trigger rather than periodic polling, that's a
real gap, not something to work around by writing something clever in
`emit` — flag it rather than fighting the model.

## Errors and how to read them

**When you try to load the package**, the editor validates your
`.node.json` immediately and refuses to load it if something's wrong —
you'll see a specific message (in the device console panel) naming
exactly what's invalid: a bad `type` namespace, the wrong number of ports
for your `kind`, a missing `intervalMs` on a source node, and so on. Fix
the file and load it again.

**When you compile a flow using your node**, a problem with a specific
node *instance's* configured property (say, a `number` field that
somehow ended up non-numeric) surfaces as a compile error naming that
node and property.

**When you deploy**, your `.node.py` is spliced into the generated flow
code as-is — Thingstudio doesn't parse or type-check it. A typo (say, you
named your function `Run` instead of `run`, or misspelled a variable) is
syntactically valid Python from the compiler's point of view, so it won't
be caught until the device actually tries to run it. It shows up as a
`NameError` (or whatever Python exception your mistake produces) reported
back from the device, attributed to your node — the same error-reporting
path every other node's runtime failure goes through. If you're not sure
your Python is even syntactically valid, the fastest way to check is to
open a plain Python (or MicroPython) REPL and try defining your function
there directly — nothing about this file format requires Thingstudio's
own tooling to sanity-check basic syntax.

## Limitations, stated plainly

- **Session-scoped loading.** No persistence across a page reload, no
  automatic re-discovery. Reload the package before reopening a flow that
  uses it.
- **One output port.** See the "ports" section above for why, and that
  it's not a permanent ceiling.
- **No event-driven sources.** `intervalMs`-driven polling only, for now.
- **No resource-sharing between instances of the same custom type.** Two
  built-in `gpio_out` nodes both wired to physical pin 12 share one
  `machine.Pin` object under the hood — the compiler recognizes they're
  claiming the same resource and only sets it up once. Two instances of
  *your* custom node type get no such recognition: each gets its own
  fully independent setup code, run separately. If you drop two instances
  of the same custom sensor node on one canvas and configure them with the
  same physical pin or address, you'll get two separate driver objects
  contending for one piece of hardware, which will likely misbehave.
  Give each instance a genuinely distinct resource, or avoid duplicating a
  stateful custom node on one canvas for now.
- **No sandboxing.** Your node's Python runs with exactly the same trust
  as every other node in the flow, first-party or not — there's no
  restriction on what it can import or do. This matches how Thingstudio
  already treats the `function` node: anyone who can deploy a flow to a
  device already has full run-of-the-device access regardless of which
  node types they use, so a custom node doesn't create a new risk, it just
  makes using that access more convenient. What this does *not* cover:
  there's no mechanism for installing someone else's custom node package
  from anywhere — no registry, no URL install, nothing beyond a file you
  picked yourself off your own disk. Don't build one, and don't load a
  package from someone else without reading it first, for exactly the
  reason you wouldn't run someone else's `function` node code unread
  either.
