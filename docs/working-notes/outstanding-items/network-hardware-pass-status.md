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

**Update, 2026-10-19: the package-conversion pass ran clean on an ESP32-C3.** Board: ESP32-C3, runtime 11.0.0
(build `b149a3d`, which has no `device-runtime/src` changes after it), WiFi `mihome` at 192.168.10.246, broker
`192.168.10.22:1883` (`guest`). After `wifi_status`, `wifi_gate`, `udp_send`, `udp_receive`, `http_request` and
`ntp` were flipped to core packages and all WiFi bring-up moved to `ts_wifi.ensure_station`, all five flows in
`test-flows/network-packages-pass.py` passed (mqtt, ntp, http, udp, gate) after a clean reset at 40s per flow.
The MQTT soak ran 605.6s: `wifi_status` reported connected once, no disconnect, publish and subscribe round-tripped
throughout. The flapping bug the pass targeted did not reproduce.

Two follow-ups were recorded from the same run:

- **`http_request` fails on a response larger than free memory.** A 56 KB page produced
  `MemoryError allocating 56722 bytes`; a 48-byte page passed. Needs a decision on the fix:
  `outstanding-items/http-response-size-limit.md`.
- **20s per flow is too short on a C3 after prior deploys.** The same flows failed at 20s and passed at 40s; before
  the run the board showed `freeIdfHeapBytes: 8668`, `largestIdfHeapBlockBytes: 5632`. Reset the board and allow
  40s. `test-flows/network-packages-pass.md` now says so.

The broker was not probe-able from the host machine (`.22:1883` resets on any bytes, MQTT or TLS) but worked from
the board, so broker reachability must be checked from the board or its console, not by connecting from the host.
