# If you know Node-RED

Most of what you know carries over. You drag nodes onto a canvas, wire them, set properties and click Deploy.
Messages carry `payload` and `topic`. Config nodes hold shared settings like an MQTT broker. The differences come
from where the flow runs: on a microcontroller, not on a server.

## Where the flow runs

The editor runs on your computer, but the flow runs on the board. Deploy compiles the flow to MicroPython and sends
it to the board, which then runs on its own. Close the editor, unplug the USB cable, and the flow carries on.

## Function nodes are Python

Function nodes run MicroPython, not JavaScript. A message is a Python dict, so write `msg['payload']`, not
`msg.payload`.

```python
if msg['payload'] > 30:
    msg['topic'] = 'alarm'
    return msg
```

Much else is the same. `return msg` passes the message on, and returning nothing stops it. Return a list to route
to several outputs. `context.get()`/`context.set()` and `flow.get()`/`flow.set()` work as you'd expect. There's no
`global`, since there's only one flow. See the [function node](../nodes/function.md).

Don't use `time.sleep()` in a function node. It stops the whole board, not only that node. Use `await asyncio.sleep()` or a `delay` node
instead. See [event-driven programming](../background/event-driven.md).

## Messages

A message carries a `payload` and usually a `topic`; the built-in nodes that start a flow set `topic` to an empty
string. Ports also have types, such as `int`, `bool` and `string`, and
the editor refuses a wire between types that don't fit. See [Editor in depth](../working-in-the-editor.md#wiring).

## Nodes

The palette is smaller, and made for hardware. `timer`, `interrupt`, `gpio out`, `pwm out` and the sensor and
display nodes work with the board directly. `inject`, `debug`, `function` and `delay` will look familiar, and so will
the network nodes: `mqtt publish`, `mqtt subscribe`, `http request`, `http in`, `http response`, `udp send` and
`udp receive`.

A flow has one MQTT broker and one WiFi network, set on any MQTT or WiFi node and shared by all of them. Node-RED's
broker per node doesn't carry over. See [Config nodes](../working-in-the-editor.md#config-nodes).

You add node types by writing a JSON file and a Python file. See
[writing custom nodes](../custom-nodes.md).

## Debugging

`debug` output appears in the editor's console, not a sidebar. An error in one node is reported in the console,
saying which node, and the rest of the flow keeps running. See [debugging](../debugging.md).

## Using both

Node-RED is the better place for dashboards, databases and cloud services. A common setup is ThingStudio
boards publishing over MQTT to a Node-RED flow on a server or Raspberry Pi.

Next: [getting started](../getting-started.md).
