# adc

Reads an analog pin, and sends the reading when it moves past the set bounds, and at a fixed interval if one is set.

## Properties

- **pin** — the ADC pin. Default 34.
- **mode** — what counts as a change. Default `relative`.
    - `relative` — the reading has moved more than **delta** from the last one sent.
    - `absolute` — the reading is outside **lower** to **upper**.
- **delta (counts)** — for `relative`. Default 2000. Must be 1 or more.
- **lower** / **upper** — for `absolute`, in counts from 0 to 65535. Defaults 0 and 50000. **lower** must be less
  than **upper**.
- **sense** — `outside` to send when the reading is outside the bounds, `inside` to send when it is back inside them.
  Default `outside`.
- **poll (ms)** — also send the reading at least this often. Default 0, which sends only on a change.

## Wiring

**Input** — none. `adc` is a source.

**Output** — a message with `payload` a dict, and `topic` an empty string:

```python
{'raw': 31250, 'volts': 1.572, 'percent': 47.7}
```

`raw` is the reading, 0 to 65535. `volts` is the pin voltage, to 3 decimal places; on a board that can't measure it,
it is worked out as `raw` over 65535 times 3.3 V. `percent` is `raw` as a percentage of 65535, to 1 decimal place.

## Behavior

A raw reading is noisy, so `relative` with a delta of a few thousand counts suits most sensors. `absolute` suits an
alarm or a threshold.

In `absolute` mode the node sends for as long as the reading stays on the **sense** side of the bounds, not once
when it crosses: an `outside` node whose reading stays outside keeps sending. To get one message per crossing, follow
it with a [filter](filter.md), or use `relative`.

## Errors

- **The pin can't be read.** The node's status dot turns red with the error, and the reading is dropped. See
  [Node status](../working-in-the-editor.md#node-status).
- **An ESP32 ADC2 pin in a flow that uses WiFi.** Deploy stops: ADC2 can't be read while WiFi is on. Use an ADC1
  pin.
- **lower is not less than upper**, in `absolute` mode. Deploy stops with `adc lower (100) must be less than upper
  (50)`.
- **A pin the board can't use, or one another node sets up differently.** Deploy stops and says why. See
  [What gets checked](../boards.md#what-gets-checked) and [Hardware is shared](index.md#hardware-is-shared).
