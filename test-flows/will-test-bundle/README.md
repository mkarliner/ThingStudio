# will-test bundle (Home Assistant phase 0 hardware check)

A custom-node bundle that exercises ts_mqtt's Last Will and connect callback, the one "uses MQTT" rule and bundle
libraries on a real board, before any Home Assistant code exists.

- `ts-will-test/` is the bundle: the `will test` node (`custom/will_test`), its compile hook (which resolves the
  WiFi and broker credentials; a custom node's Python only sees a config's name) and `lib/tswill.py`.
- `will-test.flow.json` is the flow: `will test` into `debug`, no WiFi node. Its configs name the credentials
  `mihome` and `lan-mqtt-broker`; pick your own in the editor if yours differ.

## Run it

1. Copy `ts-will-test/` into `~/.thingstudio/custom-nodes/` and click **Reload custom nodes**.
2. Open `will-test.flow.json`, check the WiFi and broker, deploy to a WiFi board.
3. On the Mac: `mosquitto_sub -h <broker> -v -t 'tstest/#'`.

## What to expect

- Deploy: the broker shows a retained `tstest/avail online`, and the debug pane shows `online #1`. No WiFi node, so
  MQTT joined WiFi on its own.
- Unplug the board: about 90 s later (1.5 x mqtt_as's 60 s keepalive) the broker publishes `tstest/avail offline`.
- Plug it back in: `online` again, and `online #1` (a fresh start).
- Restart the broker while the board runs: once mqtt_as reconnects, `online` again and `online #2` in the debug
  pane (a reconnect, not a restart).
- `mosquitto_sub -v -t tstest/avail` started later still shows the last state at once (both are retained).

Clear the retained message afterwards with `mosquitto_pub -h <broker> -t tstest/avail -r -n`.
