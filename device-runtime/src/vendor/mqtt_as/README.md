# Vendored: `mqtt_as`

Source: [peterhinch/micropython-mqtt](https://github.com/peterhinch/micropython-mqtt),
`mqtt_as/__init__.py` on the `master` branch. License: MIT (confirmed both
via the file's own header comment and the repo's GitHub-reported license
metadata).

Fetched 2026-08-14. Pin reference: the file's own `VERSION = (0, 8, 5)`
constant, and the repo's `pushed_at` timestamp of `2026-03-14T18:40:53Z` at
fetch time — not a specific commit SHA, since the GitHub API was
rate-limited during this session before a commit-level lookup could be
made. Worth tightening to an exact commit SHA next time this file is
touched, rather than left permanently vague.

SHA-256 of the vendored file as committed: `0fe913cfb76f9e0fdcad1fcdbcece249a89dc31cb185c408ecdb3a738a161d56`.
Honest caveat on verification, matching this project's convention of
saying plainly what wasn't checked: this was fetched via a web-fetch tool
in an environment with no direct outbound network access from the shell,
so the copy here was transcribed from that fetch's returned content and
syntax-checked (`ast.parse`, real Python) rather than byte-diffed against
a second independent download. Worth an actual `diff` against a fresh
clone the next time someone has normal shell network access, before
relying on this for anything security-sensitive.

## Why vendored rather than hand-rolled

`device-runtime/src/cbor.py` hand-rolls its own protocol rather than
depending on anything, and that precedent is worth contrasting rather than
silently deviating from. CBOR there was small and fully scoped (8 fixed
message shapes, no need for the general-purpose spec) — a case where
`CLAUDE.md`'s "prefer fewer dependencies... a small native implementation
over pulling in a small utility package" pointed toward hand-rolling.
MQTT is a different shape of problem: real broker reconnection logic,
keepalive timing, QoS 1 retransmission and PUBACK bookkeeping, and
WiFi-outage recovery are substantial protocol/state-machine surface, not
a small utility — exactly the case design doc §7 calls out ("existing
MicroPython drivers... wrapped as a node with only a thin adapter, rather
than ported from scratch"). Hand-rolling this ourselves for the
`mqtt_publish`/`mqtt_subscribe` nodes would mean re-deriving and
re-debugging reconnection/keepalive/QoS edge cases a mature, widely-used
library already has covered — a worse trade than the CBOR case, not the
same one.

## Why this one over `umqtt.simple`

`umqtt.simple` (the more commonly cited MicroPython MQTT client) uses
blocking sockets — its own upstream limitations list, quoted in
`mqtt_as`'s README, states it "can block forever" waiting on a QoS 1
PUBACK and can't reliably recover from a WiFi outage. `mqtt_as` is
purpose-built as the asyncio-native, resilient alternative: non-blocking
throughout (built on `uasyncio` streams/tasks), automatic WiFi and broker
reconnection, and a callback-free `Event`/`Queue` interface (`config
["queue_len"] > 0`) used by this project's `mqtt_subscribe` node instead
of the callback-based default. This matters architecturally, not just as
a quality preference: the compiler's transform/sink codegen was made
`async` specifically so `mqtt_publish`/`http_request` could `await`
real non-blocking I/O rather than stall the whole flow's event loop —
using a blocking client here would have made that compiler work pointless.

## What's NOT vendored

Only `mqtt_as/__init__.py`. The upstream package also has an optional
`mqtt_v5_properties.py`, imported lazily only when `config["mqttv5"]` is
`True`. This project's nodes never set that flag (design doc §6 only
calls for basic MQTT publish/subscribe, not MQTTv5), so that file is
never imported and isn't needed here.

## Deploy note

~~Nothing in this repo's compile/deploy pipeline yet pushes `vendor/`
alongside the flow module and the rest of `device-runtime/src/`'s
first-party files to a real device — that's part of the still-open
"how a node survives deploy" question `node-definition-model.md` already
flags for anything beyond inline-per-flow code. `mqtt_publish`/
`mqtt_subscribe`'s generated code does `import mqtt_as`, which only
resolves on-device once this vendored package is actually part of
whatever gets pushed to the device's filesystem — real follow-up work,
not something this node batch's off-device tests can exercise.~~
**resolved** — `test-flows/deploy_runtime.py`'s `VENDOR_FILES`/
`VENDOR_DEST_NAMES` now push this file (renamed to `mqtt_as.py`, a
single-file module, not `__init__.py` under a package dir — MicroPython's
import resolution needs the flat name) by default; `--no-vendor` skips it.

## Local patches

None. This file is vendored unmodified.

A real WiFi-reconnect race in this file's `wifi_connect()` (ESP32 branch --
`s.active(True)` can trigger ESP-IDF's own NVS-cached auto-reconnect, and
the unconditional `s.connect(self._ssid, self._wifi_pw)` right after can
collide with it, raising `"sta is connecting, cannot set config"`) was
found and reproduced on real hardware 2026-08-21. A local patch here was
drafted and briefly applied, then deliberately reverted: this exact class
of fix (an `isconnected()`/connecting-state guard before the ESP32
branch's connect call) has already been raised against this library more
than once ([peterhinch/micropython-mqtt#59](https://github.com/peterhinch/micropython-mqtt/issues/59),
[#61](https://github.com/peterhinch/micropython-mqtt/issues/61), and
discussed in [#57](https://github.com/peterhinch/micropython-mqtt/pull/57))
without landing upstream -- Mike's own call, after reviewing that history,
was to fix this on Thingstudio's own side instead of carrying a diverging
local patch against the maintainer's evident preference. See
`editor/src/node-library/mqtt-shared.ts`'s header for where the fix
actually lives now, and `docs/working-notes/decisions.md` (2026-08-21) for
the full reasoning, including why this is safe to do without touching
this file.
