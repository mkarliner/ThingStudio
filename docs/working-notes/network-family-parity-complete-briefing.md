# Briefing: the network family is complete as packages

Written 2026-10-20. Continues `node-parity-remaining-nodes-briefing.md` and `network-package-gaps-briefing.md`;
read those for the package format and the per-node recipe. This session closed the last three blockers.

## What landed

**`ts_mqtt` + the MQTT packages** (`946da5b`). `mqtt_publish` and `mqtt_subscribe` are core packages on a new
shared device library (`device-runtime/src/vendor/thingstudio_mqtt/`): one client per broker keyed by host:port,
connect once and leave reconnection to `mqtt_as`, a per-node subscription registry (wildcard routing, UNSUBSCRIBE
only when the last node lets go, resubscribe from the current set after a reconnect), per-node status, and redeploy
cleanup. The old `mqtt-shared.ts` and TS node files are gone.

**The first soak found a real regression, fixed in the same commit.** `ensure_connected()` called `connect()`
whenever `isconnected()` was false, racing `mqtt_as`'s own `_keep_connected()`. On the C3 that produced
`wifi:sta is connecting, cannot set config` and a connect/disconnect cycle every ~18 s. The rule now:
after the first connect, only observe and resubscribe. Re-run at 608 s: connected once, no disconnect. Learning:
`learnings/micropython-device-runtime.md`, "Never reconnect a client that mqtt_as is already reconnecting".

**Dynamic MQTT subscription** (`b3f3f88`, `06659e4`). `mqtt_subscribe` is two-faced (`kind: "sink"` +
`eventSource: true`) with an input port on every instance. A `dynamic subscription` boolean (default off) gates the
input face; `msg.action` is `subscribe`/`unsubscribe`, `msg.topic` a string or list. The configured topic stays
subscribed at start. Unknown actions, a missing topic, and actions with the feature off raise a clear error.
`connect`/`disconnect` are deliberately unsupported. Hardware: initial topic silent, subscribe delivered published
messages, unsubscribe stopped them (two in-flight), then 20 s quiet.

**`http_in` + `nodesOfType` + `ts_http_server`** (`32ea9e6`). `ctx.nodesOfType` is a new compile-context field
(every node of the same type, non-secret properties, including itself; approved as option A). The `http_in` hook
builds the port's route table from it, so duplicate `(method, path)` is still a compile error. `ts_http_server`
runs one server per port through `runtime.shared`, with one request queue per node; the timeout/500 and
`http_response` handshake are unchanged. Hardware: `GET /status` returned 201 `ok`; an unknown path returned 404.

**Harness fix.** `device_cli.wait_for()` now prints console lines that arrive before `DEPLOY_ACK`. The flow starts
before the ACK, so `wifi_status`'s one-time `payload=True` could be dropped and a clean soak read as a failure.

## Git state

- `HEAD = 32ea9e6`, pushed; working tree clean.
- Editor: 101 files, 1130 passed / 2 skipped. Backend: 301 passed. MicroPython suite: 109 passed. `tsc` and
  `mpy-cross` clean for both new libraries.
- Catalog regenerated; `mqtt_subscribe` now lists `dynamic` and an input port, `http_in` lists `wifiConfigId`.

## Where node-format parity stands

Every network node is a package. Remaining built-ins, by blocker:

- **Property-dependent port types** (not held, editor-side): `inject`, `startup` (`payloadType` drives the output
  type) and `variable_get`. This is the next recommended item.
- **`variable-set`**: its fate is the context model's no-code-path question (Q3), still open.
- **Hardware remainder**, each its own design/verification task: `touch_i2c` (nested config, panel single-use,
  reset pin), `display_spi` (compile-time geometry/viper loops must become runtime Python), `adc` (ESP32 ADC2-vs-
  WiFi guard reads siblings).
- **Residue, built-in-only by design**: `function` (verbatim code) and the `gui_*` family.

## Open items worth picking up

- **HTTP response size** (`outstanding-items/http-response-size-limit.md`): the whole body is one allocation; a
  56 KB page failed on the C3 with `MemoryError`. Decision needed: catch it and raise a clear error (recommended),
  add a size limit, or stream. User docs already state the limit.
- **Release gates**: browser smoke test for the compile-hook worker (`tools/compile_hook_smoke.py`), compile-context
  conformance vectors under `interfaces/node-compile-context/vectors/`, and the mainline `ports/webassembly`
  interpreter spike before a release.
- **CLI custom-node loading** still does not exist, so the CLI has no hook path for user packages.
- **Dynamic subscription follow-ups**: Node-RED's `msg.topic: true` "all topics" form is not implemented (string and
  list are), and `connect`/`disconnect` are excluded.

## Validation recipe / gotchas

- Build the CLI first: `cd editor && npm run build:cli`.
- Reset the board before a pass and use `--seconds 40` on an ESP32-C3; after several deploys the largest IDF heap
  block drops to a few KB and a deploy can miss `DEPLOY_ACK`.
- If a dependency install fails with `bad base64` or a `DEP_ACK` timeout, the previous flow was still printing.
  Deploy a quiet flow first, or simply retry (installed pieces stay installed).
- The C3's local IP is DHCP; get it with
  `device_cli.py exec "import network; print(network.WLAN(network.STA_IF).ifconfig())"` before curling an
  `http_in` flow. It was `192.168.10.246` earlier in the session and `192.168.10.242` at the end.
- The LAN broker at `192.168.10.22:1883` (guest/guest) resets host probes but accepts the board; check broker
  reachability from the board's console, not from the host.
- Full pass: `test-flows/network-packages-pass.py --only mqtt --seconds 600 ...` against that broker. See
  `test-flows/network-packages-pass.md` for the board-specific notes.

## Suggested next order

1. The property-dependent port-type data form, unblocking `inject`/`startup`/`variable_get`.
2. Browser smoke test + conformance vectors (release gates).
3. `http_in`/dynamic-subscription follow-ups as Mike prioritises them, then the hardware remainder.
