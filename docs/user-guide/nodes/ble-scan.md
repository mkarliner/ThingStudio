# ble scan

Listens for Bluetooth LE advertisements, such as beacons and BLE sensors, and sends one message per advertisement.

## Properties

- **name starts with** — only devices whose advertised name starts with this. Many devices send their name only
  in reply to an active scan.
- **address** — only this device, as `aa:bb:cc:dd:ee:ff`.
- **manufacturer id** — only advertisements with this manufacturer id, in decimal or hex (`0x0499` is Ruuvi).
- **service UUID** — only advertisements that list this service or carry data for it: 16-bit (`fcd2` is BTHome)
  or 128-bit.
- **active scan** — also ask each device for its scan response, which usually holds its name.
- **repeat window (ms)** — drops an advertisement identical to the same device's last one within this time.
  Default 1000. `0` sends every one; a changed advertisement is always sent.
- **scan interval (ms)** / **scan window (ms)** — the radio listens for the window once every interval. Default
  30 ms every 320 ms. A longer window misses fewer advertisements and leaves WiFi less time.

The filters combine: an advertisement must pass every one that is set.

With **active scan** on, a device's scan response arrives as a second message, usually a few milliseconds after its
advertisement, with `scanResponse` set. That's where most devices put their name. Empty scan responses are
dropped.

## Wiring

- **Output** — `payload` is the advertising data as bytes. The message also carries:

| field | |
| --- | --- |
| `addr` | the sender's address, `aa:bb:cc:dd:ee:ff` |
| `addrType` | `public` or `random` (phones use random addresses that change) |
| `rssi` | signal strength in dBm, such as `-60` |
| `connectable` | whether the device accepts connections; `None` for a scan response |
| `scanResponse` | `True` for a device's reply to an active scan, sent as its own message |
| `name` | the advertised name, or `''` |
| `mfrId`, `mfr` | the manufacturer id and the bytes after it, or `None` and `b''` |
| `svcData` | service data, by UUID: `{'fcd2': b'...'}` |
| `services` | the service UUIDs it lists |

Decode the bytes in a [function](function.md) node, with `struct.unpack`.

## Behavior

Every ble scan node in a flow shares one scan, so they must have the same scan interval, scan window and active
scan settings. Each node applies its own filters. A node keeps up to 20 advertisements waiting; if they come faster
than the flow handles them, the oldest are dropped.

The radio is shared with WiFi on an ESP32. A long scan window slows WiFi and MQTT.

Needs a board with Bluetooth LE: ESP32, ESP32-S3, ESP32-C3 or ESP32-C5. The ESP32-S2 has none.

## Errors

A bad address, manufacturer id, UUID or scan setting stops the compile, naming the value. So do two ble scan
nodes with different scan settings, and a board without Bluetooth LE. The status shows **scanning**, or **scan
stopped by the radio** if the radio ends the scan. If the radio can't start, often because the board is short of
memory, the console says so: hard-reset the board.

An advertisement is untrusted input: anyone nearby can send one, with any name or address.
