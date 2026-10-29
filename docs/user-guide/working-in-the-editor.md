# Editor in depth

How the editor's wiring, node labels, presets, config nodes and node status work.

## Wiring

Every port has a type: `int`, `number`, `bool`, `string`, `bytes` or `any`. The editor refuses a wire between
types that don't fit. What each input type accepts:

| Input | Accepts wires from |
| --- | --- |
| `any` | any output |
| `bool` | any output. The value is tested with Python's `bool()`. |
| `number` | `number`, `int`, `string` |
| `int` | `int`, `string` |
| `string` | `string` |
| `bytes` | `bytes`, `any` |

A `string` that isn't a number fails on the board when it reaches a `number` or `int` input, with a `NODE_ERROR`.
An `any` output, such as the output of a [function](nodes/function.md) node, connects only to `any`, `bool` and
`bytes` inputs.

An input can take any number of wires. The node runs once for each message that arrives, whichever wire it came
on. An output can feed any number of inputs.

## Giving a node a flow label

Every node has a **flow label** field at the top of its property panel. Type something, say `Fire!`, and the canvas
shows it instead of the node's name. Leave it blank to show the name again. Console messages and errors that name
the node use the flow label too.

A `gui button` also has a **board label**, the text drawn on the button. If the board label is blank, the button
shows the flow label.

## Presets

A preset is a named set of property values, such as the pins and size of one display panel. `display spi`,
`display i2c` and the Touch panel config have a **preset** menu at the top of their property panel:

- Pick a preset to copy its values into the node's properties.
- Click 💾 to save the current values as a preset, under a name you choose.
- Click ↻ to read the preset files again.

Applying a preset copies the values once. Later changes to the node or the preset don't affect each other.

Each preset is a JSON file in `~/.thingstudio/presets/<node type>/`, which you can also write by hand. A file that
isn't valid JSON appears in the menu disabled, with the file named. See
[The Thingstudio folder](thingstudio-folder.md#presets).

## Config nodes

A config node holds settings that several nodes share. A node's property panel has a field to pick one; ✎ edits it
and **+** makes a new one. The config nodes are:

- **WiFi:** a saved credential and a security mode: password, open, or [unmanaged](wifi-provisioning.md).
- **MQTT Broker:** a saved credential holding the host, port and optional username and password. One per flow.
- **I2C bus:** the bus number, SCL and SDA pins, and frequency. See [I2C bus](nodes/i2c-bus.md).
- **Touch panel:** the touch controller, its I2C bus and address, and its size and orientation. See
  [Touch panels](nodes/touch-panel.md).

The WiFi and MQTT Broker configs hold only the name of a saved credential. The SSID, passwords and broker address
are saved by name in `~/.thingstudio/credentials/`, not in the flow file, so a flow you share or commit holds no
secrets. Two flows that use the same credential share its values: edit it once and both change.

Pick a saved WiFi network or broker from the field's list. ✎ opens the saved values, such as a broker's host, port
and login, with the config's other settings; **Save** stores them and **Cancel** discards the changes. **+** makes a
new one: give it a name, fill it in and save. If a flow names a credential that isn't saved on this computer, ✎ says
so, and saving creates it. See [The Thingstudio folder](thingstudio-folder.md#credentials).

A flow has one WiFi network and one MQTT broker. Every node that uses WiFi has a **WiFi** field, and every MQTT node
an **MQTT Broker** field. They all show the flow's one setting: change it on one node and it changes on all. A flow
doesn't need a `wifi status` node to use the network.

## Node status

Some nodes show a colored dot and a line of text under the node while the editor is connected to the board:

| Dot | Meaning |
| --- | --- |
| Green | connected |
| Amber | connecting |
| Gray | disconnected |
| Red | error |

The dot shows what the board reports, not the editor's guess. It appears once the running flow first reports, and
clears on every deploy until the new flow reports.

The nodes with a status are `wifi status`, `mqtt publish`, `mqtt subscribe`, `i2c device`, `bme280`, `touch`, and a
`gui screen` with a touch panel.

## Notes

The **Notes** panel on the right is free text about the flow: what it does, what to wire up, how to use it. It's
saved in the flow file, and opens by itself when you open a flow that has notes. **File → New flow** clears it.
