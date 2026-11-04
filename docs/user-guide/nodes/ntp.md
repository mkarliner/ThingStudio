# ntp

Sets the board's clock from the internet and sends the time, as text for a display or as Unix time.

## Properties

- **NTP server** — a host name. Default `pool.ntp.org`.
- **UTC offset (hours)** — your standard time, from -12 to 14 in half hours: `1` for central Europe, `5.5` for India.
  Default 0.
- **daylight saving** — `UK / EU: automatic` adds an hour from 01:00 UTC on the last Sunday of March to 01:00 UTC on
  the last Sunday of October. `none` adds nothing. Default `UK / EU: automatic`. For other countries' rules, choose
  `none` and change the offset yourself.
- **format** — what goes in `payload`. Default `time`. Every message also carries all seven formats, as fields of
  the same names.
- **WiFi** — the flow's WiFi network, shared by every WiFi node in the flow (see
  [Config nodes](../working-in-the-editor.md#config-nodes)). Required.

The seven formats, for 14:05:09 on 14 October 2026 at UTC+1:

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

**Input** — any message asks for the time now. Wire a [timer](timer.md) in for a clock that ticks: every second for a
format with seconds, otherwise every 1 to 5 seconds.

**Output** — a new message, not the input one: one after each sync, and one for each input once the board has the
time. Nothing is sent before the first sync, so a [label](gui.md) shows `--` rather than a wrong time. To show the
time and the date on one screen, use two `ntp` nodes, one with `time` and one with `date`.

## Behavior

The node joins the flow's WiFi itself. Once WiFi is up it asks the server for the time, tries again every 30 seconds
until that works, then syncs every hour. Between syncs the board's own clock keeps time. A sync takes up to a second
and holds up the flow while it runs.

The board's clock is kept in UTC. The offset and summer hour are added to each message, so the hour changes on time.

The status dot shows **waiting for WiFi** until the first sync, then **synced**.

## Errors

- **The sync fails.** The dot shows **NTP from pool.ntp.org failed**, and the first failure in a row also goes to the
  console as a `[NODE_ERROR]` with the reason. A board whose MicroPython has no `ntptime` module gives the reason
  `this firmware has no ntptime module`.
- **No WiFi network, a server that isn't a host name, or an offset outside -12 to 14.** Deploy stops and says which.
- **The output isn't wired.** Deploy warns `sends the time nowhere: wire its output to something`.
