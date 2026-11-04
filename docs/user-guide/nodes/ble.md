# BLE

The board's Bluetooth name, shared by every ble node in a flow. Optional: without it, the board is called
`thingstudio`.

Each ble node has a **BLE** field. Pick the flow's BLE config, or add one with **+**. A flow has one, since a board
has one radio.

## Settings

- **name** — what other devices show when they find the board, up to 26 bytes. Default `thingstudio`. A [ble advertise](ble-advertise.md) node shares the 31 bytes of
  an advertisement between the name and its payload, so a shorter name leaves more room.

## Behavior

Once a ble node has started the radio, it stays on until the board resets, through every redeploy. A deploy stops
the old flow's scans, advertising and connections, not the radio. It keeps some ESP-IDF memory meanwhile: a hard
reset gives it back.

## Errors

A name over 26 bytes, or two BLE configs in a flow, stops the deploy.
