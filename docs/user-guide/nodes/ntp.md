# ntp

Sets the board's clock from the internet and sends the time, as text for a display or as Unix time.

## Properties

- **NTP server** — default `pool.ntp.org`.
- **UTC offset (hours)** — for standard time in your zone, for example `1` for central Europe or `5.5` for India.
- **daylight saving** — **UK / EU: automatic** adds an hour from 01:00 UTC on the last Sunday of March to 01:00 UTC
  on the last Sunday of October. **none** leaves the offset alone. For other countries' rules, set the offset
  yourself.
- **format** — what goes in `payload`. Each message also carries every format as a field of the same name.
- **WiFi** — the flow's WiFi network, shared by every WiFi node.

| format | `payload` |
| --- | --- |
| `time` | `14:05` |
| `time_seconds` | `14:05:09` |
| `time_12h` | `2:05 pm` |
| `date` | `Wed 14 Oct` |
| `date_iso` | `2026-10-14` |
| `iso` | `2026-10-14T14:05:09+01:00` |
| `unix` | `1791983109`, an int: seconds since 1970 UTC, whatever the offset |

## Wiring

- **Input** — any message asks for the time now. Wire a [timer](timer.md) in for a clock that ticks: 1 second with
  seconds shown, otherwise 1 to 5 seconds.
- **Output** — one message after each sync, and one for each input once the board has the time. Nothing is sent
  before the first sync, so a [label](gui.md) shows `--` rather than a wrong time.

To show the time and the date on one screen, use two ntp nodes, one with format `time` and one with `date`.

## Behavior

The ntp node joins the flow's WiFi itself. Once WiFi is up it asks the NTP server for the time, tries again every 30
seconds until it works, and then every hour. Between syncs the board's own clock keeps time. The request takes up
to a second and holds up the flow while it runs.

The board's clock is kept in UTC. The offset and summer time are added to each message, so the hour changes on
time.

## Errors

The node's status shows **waiting for WiFi**, **synced**, or **NTP from *server* failed**. The first failure in a
row also goes to the console. A board whose MicroPython has no `ntptime` module says so instead of failing at
start. A flow with no WiFi network doesn't compile.
