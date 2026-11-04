# wifi status

Reports the board's WiFi connection state. In a flow with no other WiFi node, it also brings the connection up.

## Properties

- **poll interval (ms)** — how often to check the connection. Default 5000.
- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow (see
  [Editor in depth](../working-in-the-editor.md#config-nodes)). Pick **unmanaged** to stop this node connecting: use it
  when something else manages the connection, or to leave the network out of the flow and enter it on the board. See
  [WiFi provisioning](../wifi-provisioning.md).

## Wiring

**Output** — a message when the connection changes:

| Field | Value |
| --- | --- |
| `payload` | `True` when connected, `False` when disconnected |
| `ip`, `subnet`, `gateway`, `dns` | the connection's addresses; empty strings when disconnected |
| `rssi` | signal strength in dBm; `None` when disconnected, or when the board can't read it (ESP32 only) |

A [debug](debug.md) node prints only `payload`. Tick **full message** on it to see the other fields.

## Behavior

This node is optional: other network nodes don't need it. In a flow with MQTT nodes, MQTT manages the WiFi connection
and this node only reports on it.

It sends a message when the connection changes: a connect or disconnect, or a new `ip`, `subnet`, `gateway` or `dns`.
It doesn't send on every poll, except the first, which always reports.

`rssi` drifts constantly, so a change in it sends nothing by itself. It is included, as read at that poll, whenever a
message goes out for another reason. It is a snapshot, not a live reading.

If no connection is ever made, the node reports disconnected, as for any failed connect. Provisioning changes how the
board gets its credentials, not what this node reports.

Once the board is connected, the node shows a status dot on the canvas (see
[node status](../working-in-the-editor.md#node-status)). While the node has the board on a network, the editor can
connect to the board over WiFi. See [Connecting over WiFi](../wifi-connection.md).
