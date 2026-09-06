# Network nodes' real hardware pass — partially closed

`wifi_status` still off-device verified only (`mvp-validation-plan.md`'s 2026-08-14 Results entry). (UDP
send/receive got a real hardware pass earlier, via the echo-tester flow — that part was already closed.)

**`http_request` got its first real hardware pass 2026-09-06**, on ESP32, against a new local test peer
(`test-flows/http_test_server.py`) — both GET and POST confirmed, response body/status landing in `msg` correctly.
Full detail: `mvp-validation-plan.md`'s 2026-09-06 Results entry. RP2040 not yet tested for this node specifically.

**`mqtt_publish`/`mqtt_subscribe` got their first real hardware pass 2026-08-21**, via Mike's own
`mqtttest.flow.json` against a real local broker — and it surfaced a real bug, not just confirmed the happy path: a
WiFi station-interface reconnect race (`E (...) wifi:sta is connecting, cannot set config`) inside the vendored
`mqtt_as`'s `wifi_connect()`. Root-caused the same day; fixed on Thingstudio's own side
(`mqttWifiPrecheckStatement()`, `mqtt-shared.ts`), not by patching the vendored file — see `decisions.md`'s
2026-08-21 entry for the full story, including why an initial patch to `mqtt_as` was reverted.

Worth a second hardware pass once the fix is deployed, to confirm it actually holds under the same conditions that
surfaced the bug (a board with stale NVS-cached WiFi credentials from a prior deploy) rather than just trusting the
code-reading diagnosis + off-device compile check. This is exactly what the mqtt-hardware-validation item (Next up)
is now doing.

**Update, 2026-09-04: that second pass happened and did NOT hold.** Testing `basic-mqtt.flow.json` with invalid
credentials hit a real, confirmed variant of this same class of race -- not the mqtt-vs-mqtt case the 2026-08-21 fix
targeted, but a wifi_status-vs-mqtt_as cross-node version the fix was never validated against. See
`wifi-status-mqtt-connect-ordering-race.md` for the full root cause (a compile-time statement-ordering bug, not
just a timing/timeout tuning issue) and status. Not fixed yet.
