# The `[wifi] ... reachable over WiFi` console line misleads

Status: open, 2026-11-01. From discussion #5 (clharting, CYD on Ubuntu). Same family as
`mqtt-unreachable-console-message.md`: a console line a user reads as meaning something it doesn't.

While debugging a broken first MQTT flow, his console repeatedly showed:

```text
[wifi] ts-le0810 reachable over WiFi while its flow is on a network
```

His reading: "the message doesn't tell you that you are connected or not, it would lead one to believe that there
is a connection" -- and at that point the board had not joined his network (his flow's MQTT nodes went on to fail
with `wifi status 202`). The line reports an mDNS/network-visibility fact (the editor can see the board's name)
at a moment when the reader takes it as "the board's WiFi is up". He spent his patience budget distinguishing
those two things by hand.

Wanted: the line reworded so what it asserts is unambiguous -- what it knows (the board announced itself / is
reachable by name), said so it can't be read as "your flow's WiFi config worked". Keep it one line, per the
console-messages rule. Product wording (editor/backend), not docs; where the line is emitted is part of the fix.
