# adc

Reads an ADC pin and sends a message when the reading moves outside (or back inside) the set bounds, and on a poll
interval if one is set. Pin numbers are checked against your [board](../boards.md).

## Properties

- **pin** — the ADC pin. On ESP32 an ADC2 pin can't be used while WiFi is up, so Deploy refuses one when the flow
  also uses the network.
- **mode** — `relative` (the reading moved by **delta** since the last message) or `absolute` (**lower**..**upper**).
- **delta** — for `relative`. The smallest change that sends a message.
- **lower** / **upper** — for `absolute`.
- **sense** — `outside` (send when the reading leaves the bounds) or `inside` (send when it returns to them).
- **poll (ms)** — also send at least this often; `0` sends only on a bounds crossing.

## Wiring

**Output** — one reading:

```python
msg = {'payload': {'raw': 0, 'volts': 0.0, 'percent': 0.0}, 'topic': ''}
```

`raw` is the 16-bit reading (0–65535), `volts` the pin voltage, and `percent` 0–100 of the full range.

## Behavior

The reading is noisy, so `relative` mode with a few thousand counts is the common setup; `absolute` suits an alarm
or a threshold. With `inside`, a message arrives when the reading comes back within the bounds, so a flow can see
both leaving and returning.
