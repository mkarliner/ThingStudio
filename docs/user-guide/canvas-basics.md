# Canvas basics

## Palette

The left sidebar lists every node type you can drag onto the canvas, grouped the same three ways as this guide's [node reference](nodes/index.md): **General**, **Network**, **Hardware**. Custom nodes you've loaded (see [Writing custom nodes](custom-nodes.md)) get their own group below the built-ins.

Drag a node onto the canvas, or click it to add it at a default position. Filter the list by typing in the search box above it.

## Wiring

Drag from one node's output port to another's input to connect them. Every port has a type — `int`, `number`, `bool`, `string`, `bytes`, or `any`.

The editor refuses a connection that doesn't make sense: a `bool` input accepts a wire from anything (Python's `bool()` never fails), and a `number` input accepts an `int` (safe widening) but not the other way around. An `any` output can't connect straight into a concrete typed input without an explicit conversion in between. A refused connection is the editor catching a real mismatch, not a bug.

## Property panel

Select a node to see its property panel on the right — every configurable field for that node type. Properties are read when you Compile → Deploy; nothing needs a redeploy just to preview a change.

## Config nodes

Some properties are shared across multiple nodes rather than typed into each one separately — WiFi credentials and MQTT broker details. These live in **config nodes**: a WiFi config (SSID, password, and a security mode — password, open, or unmanaged) and an MQTT broker config (host, port, optional username/password). Reference one from a node's property panel instead of retyping the same SSID into five different nodes.

**A flow needs exactly one `wifi_status` node if it uses any other network node type.** `wifi_status` is the flow's sole source of WiFi credentials — `udp_send`, `udp_receive`, `http_request`, `mqtt_publish`, and `mqtt_subscribe` all derive their connection from it rather than carrying a WiFi config of their own. Zero, or more than one, is a compile error. This trips people up before they know it's a rule, so it's worth knowing up front.

## Deleting

Click a node or a wire to select it, then press Delete or Backspace to remove it. Ctrl-click to select several nodes at once and delete them together. Deleting a node also removes any wires attached to it.

## Current limitations

- **No resizable panes**, beyond collapsing the palette and property panel to a thin rail.
