# Flows, nodes and messages

A Thingstudio program is a **flow**: a set of **nodes** joined by **wires**. You build it by dragging nodes onto
a canvas and wiring them together, rather than writing a program top to bottom.

## Nodes

A node does one job. Most fall into three kinds:

- **Sources** start things off: `timer` fires on an interval, `interrupt` fires when a pin changes,
  `mqtt subscribe` fires when a message arrives.
- **Transforms** change or filter what passes through: `function`, `filter`, `delay`.
- **Sinks** do something at the end: `gpio out` switches a pin, `display spi` draws, `mqtt publish` sends.

Each node has properties, set in the editor's property panel: a pin number, an interval, a topic.

## Messages

Nodes pass **messages** along wires. A message is a Python dict with two standard keys:

- `payload`: the main value, such as a reading, a count or a string
- `topic`: a short label saying what the message is about

```python
{'payload': 21.5, 'topic': 'kitchen/temperature'}
```

Nodes may add other keys. A node reads the ones it needs and passes the rest on.

## Wires

A wire joins an output to an input. One output can feed several inputs, and each gets its own copy of the
message. Several outputs can feed one input, and the node runs once per message, whichever wire it came in on.

Each port has a type, such as `int`, `number`, `bool`, `string` or `any`. The editor refuses a wire between ports
whose types don't fit.

## Config nodes

Settings that several nodes share, like a WiFi network or an MQTT broker, live in a **config node**. You set it up
once and pick it from each node that uses it. See [canvas basics](../canvas-basics.md#config-nodes).

## Background

Node-and-wire programming has a long history, from J. Paul Morrison's
[flow-based programming](https://jpaulm.github.io/fbp/) to tools like LabVIEW, Max and Node-RED. Thingstudio
follows [Node-RED](node-red.md)'s version of the idea, with the same message shape and very similar nodes.
