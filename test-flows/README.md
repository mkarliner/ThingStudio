# test-flows

Hand-authored flow JSON files, for manually exercising a real node type on
real hardware outside the `test/hil/` automated checks -- a human at the
DUT board watching what happens, not a pass/fail script.

**Correction:** this doc originally claimed there's no real flow-file
load/save in the editor yet. Wrong -- there is (`editor/src/flow-file/
flow-file.ts`, wired into the browser's "Open Flow"/"Save Flow" buttons in
`main.ts`). Files here use that real format directly, and can be loaded
straight into the editor.

`interrupt-basic.flow.json` uses `FlowFile`'s real shape
(`editor/src/flow-file/flow-file.ts`): `formatVersion` (must be `1`),
`nodes` (`{ id, type, properties }[]`), `edges`
(`[originId, originSlot, targetId, targetSlot][]` -- 4 elements, not the
6-element `GraphLink` tuple the compiler consumes internally; link IDs and
socket types are regenerated on load, not saved), `layout` (canvas
position per node id), and (as of 2026-08-18) `configs`
(`{ id, type, properties }[]`, string `id` -- config nodes,
config-node-and-palette-implementation-briefing.md; always present,
possibly empty). This is the git-friendly `nodes`/`edges`/`layout`/
`configs` split design doc §6 describes, not the compiler's own
lower-level `GraphData` input shape.

**Not every node type is on the canvas yet.** `http_request` is still
registry-only -- no `ports` field in its `NodeDefinition`, no Rete node
class, no palette entry (config-node-and-palette-implementation-
briefing.md's own explicit, flagged follow-up -- not silently dropped). A
`FlowFile` referencing it can't be loaded through the browser's "Open
Flow" at all; such a file would still need the compiler's own lower-level
`GraphData` shape via the "Alternate path" section below. **`wifi_status`,
`udp_send`, and `udp_receive` are canvas-wired** (config-node-and-palette-
implementation-briefing.md, 2026-08-18) -- see `udp-echo-tester.flow.json`
below, which loads through the real "Open Flow." **`mqtt_publish` and
`mqtt_subscribe` are canvas-wired too, as of 2026-08-21** -- their first
canvas presence at all, plus (at the time) a `wifiConfigId` (WiFi network
credentials) AND a `brokerConfigId` (`thingstudio/config/mqtt-broker` --
broker host/port and optional username/password) referenced
independently, rather than either living as raw node properties.

**2026-09-04: `wifiConfigId` removed from `mqtt_publish`/`mqtt_subscribe`
(and `udp_send`/`udp_receive`/`http_request`) entirely** -- a flow's
`wifi_status` node is now the sole source of WiFi credentials every other
network node type derives from, fixing a real bug where two network
nodes in one flow could otherwise reference disagreeing WiFi configs
(`docs/working-notes/outstanding-items/wifi-single-owner-fix.md`). A
flow needs exactly one `wifi_status` node if it uses any other network
node type. `mqtt_publish`/`mqtt_subscribe` still each reference their own
`brokerConfigId` -- unaffected, that was never part of the bug. See
`basic-mqtt.flow.json` below for the sample flow exercising all of this.

## Bootstrapping a new board (`deploy_runtime.py`)

Before any flow can be deployed to a board at all, the board's filesystem
needs the actual runtime (`device-runtime/src/*.py`, `listener.py` as
`main.py`, and the vendor libs some node types need) on it -- a one-time
step per board (or after a full erase/reflash), separate from deploying any
particular flow. `deploy_runtime.py` scripts what every prior hands-on
session has done by hand via individual `mpremote cp` commands (see
`docs/working-notes/rp2040-bringup-findings.md`'s "Runtime deployed via
mpremote" note for the exact manual sequence this replays):

```sh
pip install mpremote  # not yet a tracked project dependency -- see docs/third-party-licenses.md's note on this
python3 test-flows/deploy_runtime.py --port /dev/tty.usbmodemXXXX
```

Pushes `errors.py`, `cbor.py`, `framing.py`, `messages.py`, `protocol.py`,
`runtime.py` as-is, `listener.py` as `main.py`, and (by default --
`--no-vendor` to skip) `threadsafe_event.py` and `mqtt_as.py`. Reset the
board afterward and watch its first boot with a **passive** serial
connection (`mpremote connect <port>` with no further subcommand, or any
monitor that doesn't send Ctrl-C on open) -- `mpremote repl`/Thonny's Shell
both interrupt on connect, which looks identical to "never boots" even when
everything's correct (the exact gotcha `rp2040-bringup-findings.md`
recorded and this note exists so it doesn't cost time twice). You're
watching for `LISTENER_BOOTING` -> `LISTENER_READY` -> a `HELLO` frame.
Only after that works does `deploy_flow.py` (below) mean anything.

`deploy_runtime.py` itself only touches the filesystem via `mpremote cp` --
it never talks the §13 wire protocol, unlike everything else in this
directory.

## `interrupt-basic.flow.json`

Tier 1 item 5's interrupt/pin-change node, first hands-on test since it
was built this session. `thingstudio/interrupt` (pin 1, both edges,
debounce on, 50ms cooldown) fans out to `thingstudio/gpio_out` (pin 12,
the onboard LED on the LuatOS CORE-ESP32-C3 boards this project's already
using) and `thingstudio/debug` (prints to the console) -- press/release a
button on GPIO1 and the LED should mirror it with a debug line per
transition, debounced.

Pin **1**, not 4 -- deliberately clear of `test/hil/pin-map.md`'s already-
wired GPIO4/witness-GPIO5 pair (the automated HIL check's own interrupt
test uses that pair; this manual experiment needs its own pin so the two
don't collide on the same physical board). GPIO1 is one of `pin-map.md`'s
listed free pins (GPIO1/11/18/19), no caveats attached (18/19 carry a
"confirm your board doesn't need them for native USB" note; 1 doesn't).

Also newly true as of this same round: `interrupt` is now wired into the
canvas (ports on `interrupt.ts`, a Rete node class + palette entry +
property panel section in `editor/src/app/rete/`) -- it wasn't when this
file was first written, matching `gpio_in`'s old registry-only precedent.
Loading this file into the editor and hitting Deploy is now the intended
path; it was not before.

Verified two ways before being handed over, neither a substitute for the
real thing (below): parsed through the actual `parseFlowFile` logic
(`editor/src/dev-tools/verify-flow-file.ts`) to confirm the shape is
valid and every referenced node type has a real canvas factory; and
compiled through the actual `compile()` + registry once (before the
`edges`/`layout` rewrite, same node config) to confirm the generated code
is correct -- fan-out, debounce cooldown, both sinks fault-boundary-
wrapped. Not run on real hardware -- that's this experiment.

**Two real prerequisites before deploying this, not polish:**

1. **`threadsafe_event.py` has to already be on the device's filesystem.**
   `device-runtime/src/vendor/threadsafe_event/README.md`'s own "Deploy
   note" flags this: nothing in the compile/deploy pipeline pushes
   `vendor/` files alongside a flow's bytecode yet, and this flow's
   generated code does `from threadsafe_event import ThreadSafeEvent`,
   which will fail with `ImportError` on-device if that file isn't there
   already. `deploy_runtime.py` (above) now handles this as part of the
   one-time board bootstrap -- no longer a separate manual step, as long
   as it was run without `--no-vendor`.
2. **GPIO4 needs an external pull, or a button module with one built in.**
   `interrupt.ts`'s codegen is `machine.Pin(pin, machine.Pin.IN)` with no
   pull argument at all (matches `gpio_in`'s old scope, which also never
   had one) -- a bare floating pin will read noise, not a clean
   button-press signal. Wire a pull-down with the button to 3.3V (idle
   LOW, press HIGH -- LED lights when pressed, the intuitive direction for
   this flow's direct mirror), not a bare switch to a floating pin.

## `basic-mqtt.flow.json`

Mike's own minimal MQTT roundtrip test, 2026-09-02: `thingstudio/inject`
("manual", payload "hello mike!") -> `thingstudio/mqtt_publish` (topic
"foobar", qos 0, retain false); `thingstudio/mqtt_subscribe` (same topic,
qos 0) -> `thingstudio/debug`; one `thingstudio/wifi_status` node
providing the flow's WiFi credentials (2026-09-04: the only node in this
flow with a WiFi config reference of its own -- see this doc's header
note above), plus one shared `thingstudio/config/mqtt-broker` config
referenced by both mqtt nodes' own `brokerConfigId`.

**First real-hardware run of this file produced a silent failure** -- no
debug output, no error. Dated Results entry:
`docs/working-notes/validation/mvp-validation-plan.md`'s Tier 1 network
section, 2026-09-02. Of the two candidate causes identified,
`inject-click-fire-missing.md`'s (inject never actually fired -- "manual"
only ever ran once at boot, not on click) is now implemented for real
(2026-09-02): this flow's saved `repeat: "manual"` property is simply
ignored by the new codegen, and re-deploying it now requires clicking the
inject node on the canvas while connected to actually send anything. The
other candidate, `mqtt-pubsub-boot-race.md`'s suspected publish-vs-
subscribe wire-ordering race, is still unconfirmed and unfixed -- this
file is the natural first real-hardware re-test for both once Mike
rebuilds, since a real click now isolates "did the publish even get sent"
from "was there a boot race" in a way a boot-time one-shot fire never
could.

Needs a real local broker reachable from the board (Mosquitto, matching
`mqtt-hardware-validation-and-network-followups-briefing.md`'s
recommended setup) -- broker host/port/credentials are a saved credential
(`lan-mqtt-broker`), edit or replace it via the editor's own MQTT broker
config widget (see [Canvas basics](../docs/user-guide/canvas-basics.md#config-nodes))
before deploying, not in this file itself. Load via the browser ("Open
Flow") same as the other files in this directory.

**Update, 2026-09-04: confirmed working end-to-end on real hardware**
(inject click -> publish -> subscribe -> debug), some edge cases flagged
as deferred but not yet itemized -- see `docs/working-notes/outstanding-
items/mqtt-hardware-validation.md`'s 2026-09-04 update. That confirmation
predates the same-day single-wifi-owner fix (this doc's header note
above) -- this file's own `wifiConfigId` properties were removed as part
of that fix (a trivial edit; it already had its own `wifi_status` node),
but it hasn't been redeployed and re-confirmed on real hardware since.

## Loading and deploying via the browser (the intended path now)

Open the editor (`npm run dev` in `editor/`), click "Open Flow", pick
`interrupt-basic.flow.json`. Pin/edge/debounce are editable in the
property panel once the interrupt node is selected. Deploy as normal.

## Verifying a flow file without a browser

```sh
cd editor
npx tsc -p tsconfig.devtools.json          # emits to /tmp/ts-out
node /tmp/ts-out/dev-tools/verify-flow-file.js ../test-flows/interrupt-basic.flow.json
```

Runs the file through the real `parseFlowFile` and checks every node type
against the canvas's own factory set -- catches a malformed file or an
unwired node type before it produces a confusing partial load in the
browser. `tsconfig.devtools.json` is a separate, narrower tsconfig
(compiler + node-library + dev-tools + `flow-file.ts` only) -- the main
`tsconfig.json` includes `src/app/rete/**`, which relies on Vite's
bundler-mode module resolution and won't type-check under plain Node ESM
resolution; this sidesteps that rather than fighting it. Only useful for
`FlowFile`-shaped files with every node type already canvas-wired -- see
the "Alternate path" section below for what the one still-registry-only
node type (`http_request`) needs instead.

## Alternate path: compiling and deploying without the browser

`dev-tools/compile-flow.ts` takes the compiler's own lower-level
`GraphData` shape (`{ nodes, links }`, 6-element link tuples), not a
`FlowFile` -- a different, lower-level shape than the files in this
directory now use, and there's no automated converter between the two
(the real conversion, `graph-adapter.ts`'s `toGraphData()`, runs against a
live Rete graph in the browser, not a `FlowFile` on disk). Useful if you
want a scriptable deploy with no browser involved at all, at the cost of
hand-writing a second file in the older shape -- and currently the ONLY
path for the one node type that isn't canvas-wired yet (`http_request`).
`udp_send`/`udp_receive` graduated out of this list 2026-08-18 (see
`udp-echo-tester.flow.json` below); `mqtt_publish`/`mqtt_subscribe`
graduated out 2026-08-21. A `GraphData`-shaped file has no `configs` array of its
own the way a `FlowFile` does (compiler/graph.ts's `GraphConfigNode` is
the equivalent field there, same `{id, type, properties}` shape, string
id) -- a hand-written file exercising a config-referencing property
(`wifiConfigId`) needs to include one directly.

```sh
cd editor
./node_modules/.bin/tsc -p tsconfig.devtools.json --outDir /tmp/ts-out   # direct binary, not npx -- see CLAUDE.md's stray-.js note
node /tmp/ts-out/dev-tools/compile-flow.js ../test-flows/a-graphdata-shaped-file.json > /tmp/flow.py
python3 ../test-flows/deploy_flow.py --dut-port /dev/tty.usbmodemXXXX --mpy-cross /path/to/mpy-cross /tmp/flow.py
```

`deploy_flow.py` itself is unaffected by any of this -- it only ever
consumed already-compiled Python, never the JSON directly. Reuses
`test/hil/hil_common.py`'s `DutLink`/`compile_flow`, same §13 protocol
handling every `test/hil/` script uses, just without a witness board or
pass/fail assertions. Sends `DEPLOY`, waits for `DEPLOY_ACK`, then prints
console output and any `NODE_ERROR` until you Ctrl-C. `--mpy-cross` needs
a native build -- `device-runtime/test/README.md` has the recipe.

## `udp-echo-tester.flow.json`

The UDP/TCP batch's first hands-on hardware pass, and the reason
`deploy_runtime.py` (above) exists -- both a Pico W and an ESP32-C3 needed
bootstrapping to test this. `thingstudio/wifi_status` (fanned to `debug`,
for a periodic "am I actually connected, and to what IP" console line)
alongside two independent chains -- `thingstudio/timer` (3s) ->
`thingstudio/udp_send` (a heartbeat, the timer's own tick count as
payload), and `thingstudio/udp_receive` -> `debug` (prints anything that
comes back). Same flow file works for either board unmodified.

**Rewritten 2026-08-18 (config-node-and-palette-implementation-briefing.md)
to use the real `FlowFile` format with one shared config node**, now that
`wifi_status`/`udp_send`/`udp_receive` are canvas-wired -- this is the
concrete proof the session's own success bar names explicitly. Previously
this file was `GraphData`-shaped (the "Alternate path" above) with the
same `YOUR_WIFI_SSID`/`YOUR_WIFI_PASSWORD` placeholder pair duplicated
across all three network nodes, byte-identical by hand or silently
dropped by `compile.ts`'s dedup -- exactly the pain the config-node
mechanism exists to close. Now there's one `thingstudio/config/wifi`
config object (id `wifi-home`) in the file's own `configs` array,
referenced by `wifiConfigId` from all three nodes -- edit the placeholder
credential in **one place**, not three, via the editor's own
dropdown/pencil/+ widget once the file is loaded (the config node itself
only holds a `credentialName`; the placeholder ssid/password live in the
saved `your-wifi` credential, not in this JSON file).

**Real network peer required, not a mock or the witness rig** -- exactly
what this batch's own implementation briefing called for. Run
`udp_echo_server.py` (this directory) on this machine before deploying:

```sh
python3 test-flows/udp_echo_server.py --listen-port 9999 --reply-port 9998
```

It listens on 9999 for a board's heartbeats (prints each one), and echoes
`ECHO:<payload>` back to the sender's IP on port 9998 -- deliberately the
fixed reply port, not the sender's ephemeral source port, since `udp_send`
never reads anything back itself (it's a one-way sink, see
`udp-send.ts`'s own header); only the flow's separate `udp_receive` node,
bound to 9998, is set up to pick the echo up. Two independent UDP flows on
two fixed ports, not one request/response pair on one port.

**Two placeholder values need editing before this compiles into
something that'll actually connect** -- the saved `your-wifi` credential's
own `ssid`/`password` (edit once via the editor's WiFi config widget once
the file is loaded -- no longer duplicated across three node instances,
see above, and no longer edited in this JSON file directly), and
`YOUR_MAC_LAN_IP` on the `udp_send` node (this machine's LAN IP on the
same network the boards will join -- `ipconfig getifaddr en0` on macOS,
or check System Settings -> Network; not `127.0.0.1`, the boards are
separate devices on the WiFi network, not this process).

**Load and deploy via the browser now** (`npm run dev` in `editor/`, "Open
Flow", pick this file) -- the intended path, same as `interrupt-basic.
flow.json` above. The "Alternate path" section's `compile-flow.ts`/
`deploy_flow.py` route still works unchanged if a browser isn't available,
but is no longer the only option for this file the way it was before this
session. Watch each board's console via either path's own output for the
periodic `wifi_status` line (confirms real WiFi association + IP), the
timer-driven heartbeat count going out, and -- the actual round-trip proof
-- an `ECHO:N` payload coming back through `udp_receive` a moment later.
Also watch `udp_echo_server.py`'s own terminal: a `RECEIVED`/`REPLIED` pair
per heartbeat confirms the send direction independent of whether the board
ever manages to receive its own echo back, which is worth checking
separately if only one direction seems to be working.

## `wifi-provision-test.flow.json`

Minimal hands-on test for the boot-time WiFi self-provisioning feature
(`device-runtime/src/wifi_provision.py`,
`outstanding-items/wifi-provisioning-captive-portal.md`) -- just
`thingstudio/wifi_status` (config security `"unmanaged"`,
`allowReprovisioning` off) fanned to `debug`, nothing else. The point is
watching the board's own boot sequence, not the flow's runtime behavior.

**The board needs `wifi_provision.py` on it first** -- re-run
`deploy_runtime.py` (above) against any board bootstrapped before
2026-09-14; it wasn't in the pushed file list before this feature landed.

**To see first-run provisioning:** delete `/_wifi_provision.json` off the
board first if it's ever been provisioned before (`mpremote fs rm
:/_wifi_provision.json`, or start from a freshly-bootstrapped board --
`deploy_runtime.py` doesn't touch this file either way, it's not part of
the runtime push). Load this file in the browser ("Open Flow"), Deploy,
then reset the board and watch a **passive** serial connection (same
`mpremote connect <port>` caveat the "Bootstrapping a new board" section
above already flags). Expect `WIFI_PROVISION_FIRST_RUN`, then
`WIFI_PROVISION_AP_UP ssid='Thingstudio-Setup-XXXX'`.

Connect a phone or laptop to that network (password `thingstudio`) --
most phones prompt to sign in automatically; if not, browse to
`http://192.168.4.1/`. Pick the target network from the dropdown, enter
its password, submit. Expect a "Connected" page in the browser and
`WIFI_PROVISION_CONNECTED (freshly provisioned)` on the serial console,
followed by the flow's own normal boot (`LISTENER_READY`, then
`wifi_status`'s periodic line once `debug` starts printing).

**To confirm persistence:** reset the board again without touching
anything. Expect `WIFI_PROVISION_TRY_STORED` followed directly by
`WIFI_PROVISION_CONNECTED (stored credential)` -- no AP, no portal.

**To test the reprovisioning fallback:** flip `allowReprovisioning` to
`true` on the config (editor property panel), redeploy, then make the
stored credential fail -- easiest is temporarily changing that network's
own password, or moving the board out of range, then resetting it. Expect
`WIFI_PROVISION_REOPENING_PORTAL` and the AP coming back up. Change the
network's password back (or move the board back in range) afterward --
this flag intentionally leaves the AP re-openable on every future
connect failure, matching its own on-canvas warning about trusted-network
use only.

Nothing here is exercised by the automated MicroPython/vitest suites --
both stop at the protocol/unit level (`outstanding-items/
wifi-provisioning-captive-portal.md`'s own "Verification" note). This
file is the actual hardware check for the feature.

## `wifi-gate-test.flow.json`

Hands-on hardware test for the pass-or-drop WiFi-link gate
(`thingstudio/wifi_gate`, `outstanding-items/connection-state-gate-router-
nodes.md`'s 2026-09-14 entry). Two independent chains sharing one
`thingstudio/wifi_status` node (config security `"unmanaged"`, same as
`wifi-provision-test.flow.json` above -- reuses whatever credential the
board already learned via self-provisioning, no placeholder to edit):

- `wifi_status` -> `debug` (full message) -- the link-state reference:
  confirms whether the board is actually connected right now, same as
  `udp-echo-tester.flow.json`'s own periodic status line.
- `thingstudio/timer` (2000ms) -> `thingstudio/wifi_gate` ->
  `thingstudio/debug` (payload only) -- a steady tick count that only
  reaches the second debug node while the WiFi link is up. `wifi_gate`
  checks live link state per message, not `wifi_status`'s own (slower,
  emit-on-change-only) output, so it reacts immediately.

**What to watch for:** with the board connected, the gated debug stream
prints an incrementing count every ~2s, matching the timer interval.
Disconnect the board's WiFi (power off the AP it joined, or move the
board out of range) and the gated stream should stop cleanly -- no
errors, just silence -- while the status debug stream (still polling
every 5s) reports the disconnect. Reconnect and the gated stream should
resume, picking up the timer's counter where it left off (the counter
itself never stops incrementing -- `wifi_gate` drops the messages fired
while disconnected, it doesn't pause the timer upstream of it).

Load via the browser ("Open Flow", same as every other file in this
directory) and Deploy. Verified via `verify-flow-file.ts` (parses clean,
every node type has a real canvas factory), a `compile()` dry run through
the registry, and confirmed 2026-09-14 as a real-hardware smoke test --
deploys and runs cleanly (this flow's first deploy attempt also surfaced
and confirmed the fix for `learnings/backend-serial-wire-format.md`'s
DEPLOY-null-field CBOR bug, unrelated to `wifi_gate` itself). The specific
pass-vs-drop behavior (gated stream stopping on disconnect, resuming on
reconnect) hasn't been separately confirmed yet -- see this file's own
"What to watch for" above.

## `ebutton-tidal-test.flow.json`

First real-hardware test for the new `thingstudio/ebutton` node
(`decisions/node-authoring.md`'s 2026-09-17 entry), against an EMF Camp
2022 TiDAL badge (ESP32-S3, stock community MicroPython -- not the
badge's own custom `TiDAL-Firmware` fork) rather than one of this
project's usual ESP32-C3/RP2040 dev boards. Eight `thingstudio/ebutton`
nodes, one per physical button, each fanned to its own `thingstudio/debug`
(full message), pins and `pull` taken directly from
[emfcamp/TiDAL-Firmware's buttons.md](https://github.com/emfcamp/TiDAL-Firmware/blob/main/buttons.md):

| Button  | pin | pull   |
|---------|-----|--------|
| Up      | 15  | up     |
| Down    | 16  | up     |
| Left    | 8   | up     |
| Right   | 7   | up     |
| Centre  | 9   | up     |
| Button3 | 6   | up     |
| Button2 | 2   | none   |
| Button1 | 1   | up     |

All buttons are active-low on this board (`senseMode: "1"`, i.e. "unpressed
reads as 3V3") -- set explicitly rather than left on `senseMode: "auto"`,
so the test doesn't depend on no button happening to be held at boot.
Button2 already has its own onboard pull-up (per buttons.md, deliberately
not routed through the RP2040/ESP32's own internal one, "to avoid
interference with the power supply circuit") -- `pull: "none"` for that
one node only, matching the hardware exactly rather than doubling up an
external and an internal pull on the same pin.

**This flow is what prompted `eswitch`/`ebutton`'s new `pull` property**
(none/up/down, `decisions/node-authoring.md`) -- every button but Button2
needs the chip's own internal pull-up per buttons.md's own MicroPython
example, which these nodes had no way to configure before this session.

Verified via `verify-flow-file.ts` (parses clean, all 16 nodes have a
real canvas factory) and a `compile()` dry run through the registry (8
independent fault-isolated tasks, `machine.Pin.PULL_UP` present on every
node but Button2's, `sense=1` on all eight) -- not yet run on real
hardware, that's this experiment. Load via the browser ("Open Flow") and
Deploy, same as every other file in this directory; `deploy_runtime.py`
(above) needs to have pushed `primitives_events/events.py` and
`primitives_events/delay_ms.py` first (default behavior, unless
`--no-vendor` was passed) -- this flow's generated code does
`from events import EButton, WaitAny`, which fails with `ImportError`
on-device otherwise. Press each button in turn and watch for
`press`/`release` (and `long`/`double` on a long or rapid-double press)
on that button's own debug line.
