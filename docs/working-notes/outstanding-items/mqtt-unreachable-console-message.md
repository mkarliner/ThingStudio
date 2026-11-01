# A plain console line when the MQTT broker can't be reached

Status: open, 2026-11-01. Mike's call in the user guide review (`reviews/2026-11-01-user-guide.md`, remark 2: "docs
plus a plainer console line"). The docs half is that review's Gaps, item 1.

When the board is on WiFi but can't reach the broker, the console shows only the raw error, for example:

```text
mqtt connect to HOST:1883 failed after 3 attempts (1: OSError('Timeout on socket write'), wifi status 1010; 2: …; 3: …)
```

The first real tester (2026-10-29) couldn't tell from this that the board's network couldn't reach the broker (board
on a phone hotspot, broker on the home LAN), and blamed the `[memory]` line instead.

`device-runtime/src/vendor/thingstudio_mqtt/ts_mqtt.py` already adds plain text for the broker's refusal codes
(`0x1`–`0x5`, such as "bad username or password -- check the broker config"). It adds nothing for a timeout, a refused
connection or no route while the station is connected.

Wanted: for those failures with WiFi up, one added line in plain words, keeping the raw error in brackets, along the
lines of "the board is on WiFi but can't reach the broker from its network -- see Debugging: MQTT broker unreachable",
with a doc link once that section exists.

Where: suggested in the editor's error-help layer, as `editor/src/app/connect-error-help.ts` does for board connects,
so no runtime change or reinstall is needed. The runtime is the alternative, next to the existing reason codes (it
ships with the library on deploy).
