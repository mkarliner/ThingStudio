# journal

Keeps the recent history of a number, as rows of average, minimum and maximum, the way RRDtool and Cacti do. Wire
it to a [histogram](gui.md#histogram) to see the history, and to another journal for a longer time scale.

## Properties

- **rows kept** — how many rows the history holds, 1 to 256. Default 60. At 12 bytes a row, 156 rows is under 2 KB.
- **seconds per row** — a row closes once this much time has passed, and holds the average, minimum and maximum of
  the readings in it. Default 60. **0** makes every message one row, which is what a journal fed by another journal
  wants.
- **rows per roll-up** — how many rows go into each roll-up on output 2. Default 0, which sends no roll-up.
- **gaps allowed in a roll-up** — shown when **rows per roll-up** is above 0. From 0 to 1, default 0.5. If more
  than this fraction of the rows in a roll-up are gaps, the roll-up is a gap too. Averages use the known rows only;
  a gap is never counted as zero.

## Wiring

**Input** — `msg.payload` is a number. Text such as `"21.5"` is read as a number, and `True` and `False` as 1 and 0.
A message that also carries `min` and `max`, such as another journal's roll-up, is folded in with them, so a longer
time scale keeps the spikes. With **seconds per row** at 0, a payload of `None` records a gap.

**Output 1, series** — sent each time a row is added. The payload is the journal itself, to wire to a histogram. It
is the live history, not a copy, so it costs no memory per row.

**Output 2, roll-up** — sent every **rows per roll-up** rows: `payload` the average, `min`, `max`, and the input's
`topic`. A gap roll-up has `None` in all three. Wire it to another journal, a readout or MQTT.

## Behavior

A gap is empty, never a copy of the last value. A row with no readings in it is a gap, so choose a row longer than
your sensor's interval: 10 seconds for a reading every 5.

With **seconds per row** set, a row closes when a message arrives after its time is up. A sensor that has gone quiet
adds no rows until it sends again; then the rows it missed are added as gaps, at most one full history's worth. Set
the histogram's **stale after** to dim it meanwhile.

[A sensor display](../sensor-display.md#3-add-the-history) wires two journals in a row, for a 26-minute and a
2.6-hour history.

## Errors

- **The payload isn't a number.** The message is dropped and the console shows a `[NODE_ERROR]` naming this node and
  `journal needs a number, got str 'abc'`. It is reported once, then again only after a number has arrived. The
  chain keeps running.
- **Rows kept outside 1 to 256, or a negative seconds per row.** Deploy stops, naming the node and the property.
