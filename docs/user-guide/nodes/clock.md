# clock

The time and date, from the internet, as text for a display. Wire a [timer](timer.md) in, and the time and date out to
two [labels](gui.md) to make a clock page.

## Wiring

- **Input** — any message; each one is a look at the clock. Use a timer of 1 second (or a few seconds if you show
  no seconds).
- **Output 1, time** — `payload` such as `14:05` (or `14:05:09`, or `2:05` in 12-hour). Sent only when the text changes.
- **Output 2, date** — `payload` such as `Sat 10 Oct`. Sent when the day changes.

Nothing is sent until the first sync, so a label shows `--` rather than a wrong time.

## Properties

- **NTP server** — default `pool.ntp.org`.
- **UTC offset (hours)** — for standard time in your zone, for example `1` for central Europe or `5.5` for India.
- **daylight saving** — **UK / EU: automatic** adds an hour from 01:00 UTC on the last Sunday of March to 01:00 UTC
  on the last Sunday of October. **none** leaves the offset alone. Other countries' rules are not built in: set the
  offset yourself.
- **12-hour**, **show seconds**, **blink the colon** — the colon is steady unless you turn blinking on.

## Behavior

The board asks the NTP server once WiFi is up, tries again every 30 seconds until it works, and then every hour. The
clock node doesn't join WiFi itself. The flow needs a node that does, such as [wifi status](wifi-status.md) or any
MQTT, HTTP or UDP node. Between syncs the board's own clock keeps time. The
request takes up to a second and holds up the flow while it runs. A failure while WiFi is up shows on the node
once. Boards whose firmware has no `ntptime` module report that on the node instead of failing at start.

## Seven-segment digits

The `seg7` fonts (`font_seg748`, `font_seg764`, `font_seg796`) have only `0-9 : . -` and a space. On a 320-pixel-wide
screen `font_seg764` fits `14:05` (221 px) and `font_seg748` fits `14:05:09` (254 px). `font_seg796` is for wider
screens. The font is DSEG by Keshikan (SIL Open Font License 1.1); see
[third-party licences](https://github.com/mkarliner/ThingStudio/blob/main/docs/third-party-licenses.md).
