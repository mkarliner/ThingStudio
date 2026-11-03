# BLE

The board's Bluetooth name, shared by every ble node in a flow. Optional: without it, the board is called
`thingstudio`.

Each ble node has a **BLE** field. Pick the flow's BLE config, or add one with **+**. A flow has one, since a board
has one radio.

## Settings

- **name** — what phone apps show, up to 26 bytes. A [ble advertise](ble-advertise.md) node shares the 31 bytes of
  an advertisement between the name and its payload, so a shorter name leaves more room.

## Errors

A name over 26 bytes, or two BLE configs in a flow, stops the compile.
