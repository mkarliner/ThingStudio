# BLE peer

Another Bluetooth LE device the board connects to, such as a sensor or another board. The
[ble read](ble-read.md), [ble write](ble-write.md) and [ble notify](ble-notify.md) nodes name one.

Each of those nodes has a **BLE peer** field. Pick a peer, or add one with **+**. A flow can have several, one per
device. Nodes that name the same peer share one connection.

## Settings

- **address** — the device's address, `aa:bb:cc:dd:ee:ff`. Default blank. A [ble scan](ble-scan.md) node into a debug node shows
  the addresses nearby.
- **name starts with** — default blank. Used when the address is blank: the first device whose advertised name starts with this.
  Phones change their address every few minutes, so find a phone by name; most sensors and boards keep theirs.
- **timeout (ms)** — how long finding the device and connecting to it may each take. Default 10000.

## Behavior

The board finds the device, connects, finds the services and characteristics the flow's nodes use, and turns on
notifications for the ble notify nodes. The nodes' status follows each step: **finding**, **connecting**,
**discovering**, **connected**. If a step fails or the link drops, the status says why, and the board starts again
from finding after 10 seconds. It never connects to a different device instead.

## Errors

A peer with neither an address nor a name, a malformed address, or a timeout outside 1000 to 60000 ms stops the
deploy. A step that fails on the board, such as the device not being found or a service it doesn't have, is
reported once on the console, naming the device and the step.
