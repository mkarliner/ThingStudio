# Network packages hardware pass (2026-10-19)

A hands-on pass for the network nodes converted to core packages and for the shared `ts_wifi` bring-up. Every WiFi
node's generated setup now goes through `ts_wifi.ensure_station(...)`, and `wifi_status`, `wifi_gate`, `udp_send`,
`udp_receive`, `http_request` and `ntp` are packages with compile hooks. None of that has run on a board yet.

The critical case is **ESP32 + MQTT**: that is where the original WiFi-flapping bug lived, and the unification
replaced the compile-time `wifi-sta` dedup with an on-device idempotent call. A regression would look like
`wifi_status` reporting connected then disconnected (or repeatedly re-reporting) with no real signal problem.

## Prerequisites

- Runtime installed on the board (`device_cli.py hello` works, runtime 11.x).
- `editor/dist-cli` built: `cd editor && npm run build:cli`.
- A native `mpy-cross` (`device-runtime/test/README.md`), unless it is already on `PATH`.
- An MQTT broker the board can reach (LAN address, not `localhost`).
- A plain-`http://` URL the board can reach for the HTTP case (a LAN page is more reliable than the internet).
- Python 3 with `pyserial` for `device_cli.py`.

## Run it

```sh
cd editor && npm run build:cli && cd ..

python3 test-flows/network-packages-pass.py \
  --ssid MyNetwork --wifi-password secret \
  --broker 192.168.1.10 --broker-port 1883 \
  --http-url http://192.168.1.10/ \
  --mpy-cross ~/micropython/mpy-cross/build/mpy-cross
```

- `--port /dev/ttyACM0` (or `THINGSTUDIO_PORT`) if more than one serial port exists.
- `--only mqtt,ntp` to run a subset.
- `--seconds 15` per flow by default; use `--seconds 60` for a longer MQTT soak.
- `--keep DIR` keeps the generated flow files. **They contain the WiFi/broker credentials you passed**, so keep
  them out of git.
- **Reset the board before the run, and use `--seconds 40` on an ESP32-C3.** After a few deploys the board's largest
  free IDF heap block drops to a few KB; the next deploy can then miss `DEPLOY_ACK` within the CLI's 20s wait. A
  DTR/RTS reset restores it. Use 40s per flow so the first MQTT connect and the NTP sync have room.

The script generates the flows in a temporary folder, deploys each with `device_cli.py flow deploy`, reads the
console, and prints one PASS/FAIL per flow. It fails a flow if the console shows `NODE_ERROR`, a traceback, a
compile error or a deploy failure, or if the expected output never arrived.

## What each flow checks

| Flow | Expected |
|---|---|
| `mqtt` | `wifi_status` reports `payload=True` (once) and never `False`; a message published by `mqtt_publish` comes back through `mqtt_subscribe` and prints via `debug`. |
| `ntp` | After a sync, `debug` prints a `HH:MM:SS` time. The status dot shows synced. |
| `http` | `debug` prints the response body from the configured URL. |
| `udp` | `udp_send` sends to the configured port; `udp_receive` on the board receives it (default loopback `127.0.0.1:9918`) and prints the bytes. |
| `gate` | Timer messages pass through `wifi_gate` while connected and print via `debug`. |

## The MQTT soak (do this one twice, ESP32 then RP2040)

Run just the MQTT flow for 10 minutes:

```sh
python3 test-flows/network-packages-pass.py --ssid ... --wifi-password ... --broker ... \
  --only mqtt --seconds 600
```

Watch for:

- `DEBUG ... payload=True` from the `wifi_status` debug node more than once, or any `payload=False`.
  `wifi_status` only emits on a connection-identity change, so repeated `True` means the IP/gateway changed (or
  the link flapped); `False` is a disconnect.
- The broker's log showing repeated MQTT connect/disconnect cycles.
- The editor's status dot (if using the browser instead) cycling connected/disconnected.

If it flaps, capture the full console and the broker log, and note the board and MicroPython version. That is the
regression this pass exists to catch.

## First run, 2026-10-19

Ran clean on an ESP32-C3 (runtime 11.0.0) after all six network nodes were converted to core packages: all five
flows passed at 40s each, and the MQTT soak passed at 605.6s with `wifi_status` connected once and no disconnect.
Broker was a LAN MQTT server at `192.168.10.22:1883` with a username and password.

Two things to know when repeating it:

- **Check the broker from the board, not the host.** That broker resets any connection from a desktop but accepts
  the board; a host-side `mosquitto_pub` probe would have read as "broker down". Deploy the mqtt flow and read its
  console instead.
- **A large HTTP page fails with `MemoryError`.** The http flow passes on a small page; a 56 KB page needed one
  56 KB allocation, which the C3 did not have. Keep `--http-url` pointed at a small response, or expect
  `NODE_ERROR ... type=MemoryError`. See `docs/working-notes/outstanding-items/http-response-size-limit.md`.

## If something fails

- **Compile/deploy names a compile hook** — the editor-side interpreter/worker path, not the flow. Capture the
  console text.
- **`wifi_status` says connected but MQTT gets nothing** — broker reachability or credentials; check from the host
  first (`mosquitto_sub -h ... -t 'thingstudio/pass/#'`).
- **HTTP case fails** — confirm the URL is plain `http://` on port 80/other, and reachable from the board (not just
  the host).
- **UDP case fails** — some stacks do not loop `127.0.0.1` back; pass `--udp-host <host LAN IP>` and run a listener
  on the host (`nc -u -l 9918`).

## Not covered

The browser/worker path (covered by `tools/compile_hook_smoke.py`) and `mqtt_publish`/`mqtt_subscribe` as
packages — they are still built-ins and are waiting for `ts_mqtt`. When they convert, the MQTT soak here is the
template, plus the dynamic-subscription cases in `outstanding-items/mqtt-dynamic-subscription.md`.
