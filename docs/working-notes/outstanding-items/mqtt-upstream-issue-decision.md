# Whether to file an upstream issue for the `mqtt_as` WiFi-reconnect race — undecided, Mike's call

Undecided, Mike's call. Real bug in
[peterhinch/micropython-mqtt](https://github.com/peterhinch/micropython-mqtt)'s `wifi_connect()` (ESP32 branch),
confirmed against the current `master`, not just an old version — but Mike found this same class of fix already
raised more than once
([#59](https://github.com/peterhinch/micropython-mqtt/issues/59),
[#61](https://github.com/peterhinch/micropython-mqtt/issues/61),
[#57](https://github.com/peterhinch/micropython-mqtt/pull/57)) without landing, and that history is exactly why
Thingstudio fixed this on its own side instead of carrying a local patch (`decisions.md`). Whether a fourth report
(with a real hardware reproduction, no patch attached this time) is worth his time to file is his call, not decided
this session.
