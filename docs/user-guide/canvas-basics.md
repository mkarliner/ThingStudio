# Canvas basics

## Palette

The left sidebar lists every node type you can drag onto the canvas, grouped the same three ways as this guide's [node reference](nodes/index.md): **General**, **Network**, **Hardware**. Custom nodes you've loaded (see [Writing custom nodes](custom-nodes.md)) get their own group below the built-ins.

Drag a node onto the canvas, or click it to add it at a default position. Filter the list by typing in the search box above it.

## Wiring

Drag from one node's output port to another's input to connect them. Every port has a type — `int`, `number`, `bool`, `string`, `bytes`, or `any`.

The editor refuses a connection that doesn't make sense: a `bool` input accepts a wire from anything (Python's `bool()` never fails), and a `number` input accepts an `int` (safe widening) but not the other way around. An `any` output can't connect straight into a concrete typed input without an explicit conversion in between. A refused connection is the editor catching a real mismatch, not a bug.

An input can take any number of wires — connect several outputs to the same input and the node fires once per incoming message, whichever one arrives. An output can already fan out to several inputs the same way.

## Property panel

Select a node to see its property panel on the right — every configurable field for that node type. Properties are read when you Compile → Deploy; nothing needs a redeploy just to preview a change.

## Config nodes

Some properties are shared across multiple nodes rather than typed into each one separately — WiFi credentials and MQTT broker details. These live in **config nodes**: a WiFi config (a saved credential, plus a security mode — password, open, or [unmanaged](wifi-provisioning.md)) and an MQTT broker config (a saved credential holding host, port, and optional username/password). Reference one from a node's property panel instead of retyping the same SSID into five different nodes.

**The real secret values live in a saved credential, not in the config node or the flow file.** A config node's own credential field is a dropdown of your saved credentials, plus a pencil icon to edit one and a "+" to save a new one — pick an existing WiFi network or MQTT broker, or create one on the spot. Credentials are saved by name on the backend (not in the flow file), so a flow you commit to git never has a real SSID or password in it, and picking the same saved credential from two different flows reuses the one value — editing it in one place updates every flow that references it. This needs a backend connection; the direct/WebSerial-only connection mode doesn't support saved credentials.

**A flow needs exactly one `wifi_status` node if it uses any other network node type.** `wifi_status` is the flow's sole source of WiFi credentials — `udp_send`, `udp_receive`, `http_request`, `http_in`, `mqtt_publish`, and `mqtt_subscribe` all derive their connection from it rather than carrying a WiFi config of their own. Zero, or more than one, is a compile error. This trips people up before they know it's a rule, so it's worth knowing up front.

## Node status

`wifi_status`, `mqtt_publish`, and `mqtt_subscribe` show a small colored dot and a line of text below the node while connected to a device — green for connected, amber for connecting, red for error, grey for disconnected. This reflects what the device is actually doing right now (a real push from the running flow), not the editor's own guess — it only appears once you're connected and the device has reported at least once, and it resets to nothing on every redeploy until the new flow reports its own state.

Other node types don't show this yet — it's currently limited to connection-oriented nodes; `http_request` doesn't get one since it isn't a persistent connection.

## Deleting

Click a node or a wire to select it, then press Delete or Backspace to remove it. Ctrl-click to select several nodes at once and delete them together. Deleting a node also removes any wires attached to it.

## Current limitations

- **No resizable panes**, beyond collapsing the palette and property panel to a thin rail.
