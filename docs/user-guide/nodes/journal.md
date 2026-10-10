# journal

Keeps the recent history of a number, as rows of average, minimum and maximum, the way RRDtool and Cacti do. Wire
it to a [trend](gui.md#trend) to see the history, and to another journal for a longer time scale.

## Wiring

- **Input** — `msg.payload` is a number. `None` records a gap. A message that carries `min` and `max` (the
  roll-up of another journal) is folded in with them, so a longer time scale keeps the spikes.
- **Output 1, series** — sent each time a row is added. The payload is the journal itself, to wire to a trend. It is
  the live history, not a copy, so it costs no memory per row.
- **Output 2, roll-up** — sent every **rows per roll-up** rows: `payload` the average, `min`, `max`, and the input's
  `topic`. Wire it to another journal, a readout or MQTT.

## Properties

- **rows kept** — how many rows the history holds, 1 to 256. At 12 bytes a row, 156 rows is under 2 KB.
- **seconds per row** — a row is closed once this much time has passed, and holds the average, min and max of the
  readings in it. **0** makes every message one row, which is what a journal fed by another journal wants.
- **rows per roll-up** — 0 sends no roll-up.
- **gaps allowed in a roll-up** — from 0 to 1, default 0.5. If more than this fraction of the rows in a roll-up
  are gaps, the roll-up is a gap too (`payload` of `None`). Averages use the known rows only; a gap is never
  counted as zero.

## Behavior

A gap is empty, never a copy of the last value. The history starts empty each time the flow starts.

With **seconds per row** set, a row closes when a message arrives after its time is up, so a sensor that has gone
quiet adds no gaps until it speaks again. Set the trend's **stale after** to dim it meanwhile. Choose a row longer than
your sensor's interval (10 seconds for a reading every 5): a row that happens to catch no reading is a gap.

A payload that isn't a number is dropped. The first time that happens, the node reports an error; the flow keeps
running.

## Example: minutes and hours

A sensor reads every 5 seconds.

1. Journal A: rows 156, **seconds per row** 10, **rows per roll-up** 6. Its first output goes to a trend: the
   last 26 minutes.
2. Journal B, fed from A's second output: rows 156, **seconds per row** 0. Its first output goes to a second
   trend: the last 2.6 hours, one bar a minute, each with its min to max line.

`test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json` does this with a BME280.
