# Resolved items — closed out of the backlog

Companion to `outstanding-items.md`: everything below is done and verified, or settled as a decision, so it
no longer sits in the working list. Kept as one-line pointers because this answers "did we already do or
settle this?" without a `git log` search, and because some entries still carry a caveat that would otherwise
drop out of the backlog. Full reasoning stays at each pointer's target; `git log` holds the rest.

**Last audited 2026-10-24, against `git log` at `84dcbfc`** (see the parent file's header). Split out of the
working list the same day, per Mike's call.

## Launch

- **Classic-ESP32 13.0.0 image shipped in v0.5.0** -- built from `7f607bc`, flashed on the CYD, booted 13.0.0
  with all 34 libraries frozen, recorded in `firmware/classic-esp32/tested.json`; `publish.sh v0.5.0 --publish`
  attached and verified the image, `_deps.json` and `main.py`. The orphan v0.4.0 draft was deleted. The
  frozen-library skip was checked by reproducing the image's deps index with the editor's mpy-cross (34/34),
  because the headless CLI installs libraries unconditionally
  (`learnings/micropython-device-runtime.md`).
- **GUI: fill the rest of the page, and page dots in a footer** -- built 2026-10-24. A `fill` checkbox on a
  container writes `grow: 1`; a footer is a non-growing row after a filling container, with the page dots as an
  ordinary widget in it -- no footer field, strip or fixed height, and no pixel-usage warning. The CYD theme
  demo uses the shape; a layout test and the example-flow compile pass pin it, and it was confirmed on the CYD's
  panel 2026-10-24. No runtime bump.
  ([detail](outstanding-items/gui-layout-fill-and-footer.md))
- **Freenove FNK0104S board support** -- built 2026-10-08, hardware-checked 2026-10-10: touch lands right at
  90/180/270 and the press highlight holds and releases. Replaced the FNK0104B (2026-10-09).
- **CYD gate for custom firmware images** -- closed 2026-10-23 (`c71ab96`): the image installs on the CYD and
  deploys the hero GUI flow three times over a running flow. The five-cycle gate is retired
  (`decisions/gui-layout.md`); the image has since shipped in v0.5.0.
- **Deploy a second time on a low-memory board: guidance, not a sequence** -- settled 2026-10-23. Remove
  flow… → power cycle → deploy; if it still fails, the flow may be too big. One `DEPLOY_MEMORY_HINT` constant
  serves all three memory failures; no wire message, no HELLO field, no version bump.
- **Classic-ESP32 custom image** -- built, booting, deploying repeatedly (2026-10-22/23): 1.69 MB, 34 frozen
  libraries, idle 149 KB free. `decisions/classic-esp32-firmware.md`, `firmware/classic-esp32/`. The 13.0.0
  image shipped in v0.5.0.
- **Headliner (showreel) flow and task guide** -- flow hardware-checked 2026-10-10 (BME280 readouts, trends,
  MQTT publish, clock page with NTP and summer time); task guide written (`docs/user-guide/sensor-display.md`).
- **External controls example flow** -- dropped from the launch (Mike, 2026-10-13; ThingStudioMarketing
  `marketing-plan.md` §6). The neighbours story moves to Home Assistant; whether the touch/MQTT-both-ways/
  unknown-stale acceptance moves elsewhere is a product call, not made here.
- **`touch_i2c` node (FT6336U first)** -- built 2026-10-09 (`bc5bc9e`, later a core package); presets and the
  missing-bus error landed after. `touch_spi` is still open.
- **[LAUNCH-NICE] Vivid theme preset** -- added 2026-10-24 from the CYD card demo: a third `THEME_PRESETS` entry
  (near-black background, violet cards, cyan accent) beside `dark-slate`/`light-paper`. The demo now sets
  `"preset": "vivid"` with no role overrides and compiles byte-identically. Adding it exposed a duplicated preset
  table in `display_spi`'s Python compile hook; the hook now generates its role list, default and presets from
  `gui-theme-shared.ts`, and the palette test compares every preset and format. No runtime bump.
- **[LAUNCH-NICE] `adc` node (Hinch's AADC)** -- built and hardware-tested 2026-10-12 (LuatOS ESP32-C3-CORE);
  claims its pin and shares the ADC channel through `runtime.shared('adc', ...)`.
- **[LAUNCH-NICE] `encoder` node (Hinch's quadrature `Encoder`)** -- built 2026-10-11 and hardware-tested;
  pins shared via `sharedPin()`.
- **[LAUNCH-NICE] `neopixel` node** -- built and hardware-tested 2026-10-12; data pin shared, driver claimed.
- **Pico W WiFi-password bug** -- confirmed fixed on hardware (2026-10-10).

## Nodes and runtime

- **MQTT real-hardware validation + network follow-ups** -- closed 2026-09-06: `http_request` GET/POST pass,
  and the wifi_status-vs-`mqtt_as` ordering race accepted as a documented limitation (clean, attributed
  `NODE_ERROR`), generalized into `AGENTS.md`'s fault-handling rule.
  ([detail](outstanding-items/mqtt-hardware-validation.md))
- **MQTT dynamic subscription** -- built 2026-10-20: `mqtt_subscribe` is two-faced and takes `msg.action`
  subscribe/unsubscribe; `ts_mqtt` supplies the per-node registry and resubscribe after reconnect.
  ([detail](outstanding-items/mqtt-dynamic-subscription.md))
- **Network nodes' real-hardware pass** -- closed 2026-10-19 for the package conversions: the five-flow pass
  (mqtt, ntp, http, udp, gate) on an ESP32-C3, and a 605.6 s MQTT soak with no disconnect.
  ([detail](outstanding-items/network-hardware-pass-status.md))
- **`udp_send`'s `timeout` and `udp_receive`'s `poll interval`** -- answered 2026-09-06: both real (the
  `EAGAIN`-retry bound; the non-blocking-socket workaround for MicroPython's missing datagram await). No code
  change; the 20 ms default is still unvalidated against back-to-back hardware traffic.
- **Config-node Functor/Singleton** -- resolved 2026-10-12 as a project rule: every built-in pin/PWM/SPI user
  claims its resources at compile time and gets objects through `runtime.shared()`.
  (`decisions/hardware-singletons.md`, `AGENTS.md`)
- **Pin/resource-conflict detection** -- resolved 2026-10-12 by the same rule: a pin set up two ways is a
  compile error naming both nodes. ([detail](outstanding-items/pin-resource-conflict-detection.md))
- **`interrupt` node's debounce option removed** -- resolved 2026-10-16 (`eswitch`/`ebutton` own debounce);
  the node is a core package now. Old flows carrying the properties ignore them.
- **`display_spi`/`display_i2c` nodes (framebuffer-driven display push)** -- built 2026-09-17. Two bus
  families, unmodified MIT vendored drivers, a `controller` property for future chips. Five follow-on real-
  hardware bugs found and fixed (wire-type gap, LCD_PWR/BLEN polarity, GRAM offset, RGB565 byte order,
  MADCTL/inversion properties) and confirmed on the CYD and the TiDAL. ([detail](decisions/node-authoring.md))
- **`display_spi` full-resolution framebuffer memory** -- closed 2026-09-18: `gs4`, `gs2` and `mono` depths
  built and confirmed on real CYD hardware, so a 240x320 frame no longer needs 153,600 bytes. The
  `test-flows/display-spi-*` flows and the viper expansion loops are the shipped shape.
- **Board-transport auth (`HELLO`'s `authRequired`/`authScheme`)** -- built 2026-09-24 with the WiFi transport.
  ([detail](outstanding-items/board-transport-auth.md))
- **`clock` removed, replaced by `ntp`** -- done 2026-10-14; the new node's hardware check is tracked under
  Hardware / rig. ([detail](outstanding-items/ntp-node-replaces-clock.md))
- **Templating UI nodes** -- superseded 2026-10-05 by the Launch GUI templating item.
- **`eswitch`/`ebutton` nodes** -- built 2026-09-17 with real-hardware confirmation on the TiDAL badge
  (`press`, `release`, `long`, `double`); `eswitch` itself and other buttons stay unconfirmed but share the
  same driver. ([detail](decisions/node-authoring.md))
- **Pass-or-drop WiFi-link status gate (`wifi_gate`)** -- built 2026-09-14, smoke-tested on hardware; the
  specific pass-vs-drop behaviour on a real link drop is not separately confirmed.
  ([detail](outstanding-items/connection-state-gate-router-nodes.md))
- **Tasmota-style soft-AP + captive-portal WiFi provisioning** -- built and verified 2026-09-14 (soft AP,
  catch-all DNS, hand-rolled form, `allowReprovisioning` opt-in, `wifiProvision` DEPLOY marker). Mike's
  hands-on hardware test of the portal is still not done.
  ([detail](outstanding-items/wifi-provisioning-captive-portal.md))
- **Named credential store for WiFi/MQTT secrets** -- built 2026-09-13: configs hold only `credentialName`;
  secrets live in `~/.thingstudio/credentials/` and never enter a saved `.flow.json`. The 6 committed
  test-flow files were migrated. ([detail](outstanding-items/credential-storage-design.md))
- **Credential-free git-committable flows** -- resolved 2026-09-13 by the credential store.
  ([detail](outstanding-items/credential-free-committable-flows.md))
- **`filter` node** -- built 2026-09-26 with off-device tests; only the hardware pass is open.
- **`journal` node and trend widget** -- built and hardware-checked 2026-10-10 (`1844878`); series/autoscale
  leftovers are under Launch.
- **`http_request` config migration / canvas presence / hardware pass** -- closed 2026-09-04/05/06.
  ([detail](outstanding-items/http-request-config-node-gap.md))
- **HTTP in / HTTP response nodes** -- built 2026-09-08, hardware-verified 2026-09-09; `http_in` became a
  core package 2026-10-20 and was re-checked on the C3. Exact `(method, path)` match only in v1.
  ([detail](outstanding-items/http-in-response.md))
- **`delay` node** -- built 2026-09-06 (transform; blocks its source's next iteration for the delay, by
  design).
- **`startup` node and the `display_spi` palette editor** -- closed 2026-09-24.
  ([detail](outstanding-items/init-node-on-flow-start.md))
- **`inject` node split into fire and edit** -- fixed 2026-09-13 (`7bf6b53`); the "▶" fires, the body opens
  the property panel. The old automatic boot-fire moved to `startup`.
  ([detail](outstanding-items/inject-node-review.md))
- **`wifi_status` complete status (IP, network, RSSI)** -- built 2026-09-09/10 and hardware-verified; the
  `debug` node gained `fullMessage` for it. ([detail](outstanding-items/wifi-status-completeness.md))
- **Protocol: hardware pass for runtime 13.1.0** -- done 2026-10-24 on the CYD: the 13.1.0 image booted with
  all 34 libraries frozen, the dummy GUI flow deployed twice in one session over the running flow, a resent
  `FLOW_PUT` piece and a resent `DEP_PUT` piece were both ACKed, and `DEP_COMMIT` installed the library
  (`DEP_OK`) -- the resend cases that used to end in `BadPiece`. No `PROTOCOL_ILLEGAL`.
  (`reviews/2026-10-24-protocol-state-machine.md`)
- **`wifi_status` emit-on-change** -- built 2026-09-02, confirmed on hardware.
  ([detail](outstanding-items/wifi-status-emit-on-change.md))
- **Single-wifi-owner fix** -- landed 2026-09-04, confirmed on hardware. Whether the one-shot connect needs
  retry/backoff stays deliberately unbuilt until it causes problems.
  ([detail](outstanding-items/wifi-single-owner-fix.md))
- **`inject`'s click-only live-fire** -- built 2026-09-02, hardware-confirmed 2026-09-06.
  ([detail](outstanding-items/inject-click-fire-missing.md))
- **Redeploy cleanup / network fault detection** -- built 2026-08-20 (socket cleanup registry, mandatory
  `wifiConfigId`, empty-password compile check); real-hardware redeploy-twice pass closed 2026-09-06.
  ([detail](outstanding-items/redeploy-cleanup-network-fault-detection.md))
- **wifi_status-vs-`mqtt_as` ordering race on ESP32** -- accepted as a documented limitation 2026-09-06 (a
  clean `NODE_ERROR`, not a crash); promoted to the fault-handling rule.
  ([detail](outstanding-items/wifi-status-mqtt-connect-ordering-race.md))
- **Flow dependencies (`deploy_runtime.py`'s `VENDOR_FILES` scaling)** -- built 2026-10-07 and confirmed on
  hardware; only a display flow is outstanding (Redeploy / runtime above).

## Editor and backend

- **Device settings store (persistent key/value for application values)** -- landed and hardware-verified
  2026-10-17: `get`/`set`/`delete`/`keys`, namespaced by `flowName`, atomic `_settings.json`, a clear action
  over `EXEC`, and `test-flows/device_cli.py` for headless hardware sessions.
  ([scoping](device-settings-store-scoping.md))
- **Context model, Node-RED-style, volatile (in-RAM) scope** -- resolved 2026-10-21: a generic `change` node
  (set/delete a msg property or flow variable) replaces the hidden `variable_get`/`variable_set` pair.
  (`decisions/context-model.md`)
- **Low-memory warning** -- built: `memory-advice.ts` warns before a deploy when the board's reported free
  memory is small next to the flow, and never refuses. It also supplies the hard-reset and too-big hints.
- **Backend / auth** -- complete for the moment, 2026-09-08 (Mike's call): platform, serial↔WebSocket relay
  and the Host-header allowlist are real code, unit-tested and run for real. No further per-board passes --
  with dozens of boards expected, effort goes to general failure handling.
  ([detail](outstanding-items/backend-auth-overview.md))
- **Backend↔browser persisted-data protocol** -- decided and built 2026-09-07/08: an HTTP admin API for
  custom nodes (Host-allowlisted, CORS). Flow save/open ended up on the OS file dialog with no backend
  involvement; the `/api/flows` routes and `admin-api-client.ts` flow functions stay in the tree, tested and
  unused. ([detail](outstanding-items/backend-persisted-data-protocol.md))
- **Editor↔backend wiring** -- built and verified end-to-end on real hardware 2026-09-07/08, including the
  base64 line-framing fix and the WS-teardown guard. Mike confirmed a real "via backend" connect and MQTT flow.
  ([detail](outstanding-items/editor-backend-wiring.md))
- **One start command for backend and frontend** -- `thingstudio-backend` (or `make run`) serves the editor and
  the backend; there is no second process to start.
- **Board/processor reference data folder** -- built 2026-09-23 (MVP item 4): `editor/src/definitions/` plus
  `~/.thingstudio/processors/` and `boards/`, with per-pin reserved/avoid reasons. What's left is keeping it
  current as boards are added. ([detail](outstanding-items/board-processor-reference-data.md))
- **Package `device-runtime` as a single flashable image** -- shipped as the classic-ESP32 image
  (2026-10-22/23); stock install stays the default. `decisions/classic-esp32-firmware.md`.
- **Custom nodes load automatically from `~/.thingstudio/custom-nodes/`** -- built 2026-09-30: broken packages
  skipped and named, first of two same-typed packages wins, **Reload custom nodes** replaces the picker, two
  example packages seeded. `decisions/node-authoring.md`.
- **Custom node authoring** -- implemented 2026-08-20, all open questions resolved.
  ([detail](outstanding-items/custom-node-authoring.md))
- **Multiple wires into one node input** -- built and real-browser verified 2026-09-10 (`1e5353e`).
  ([detail](outstanding-items/multi-connection-node-inputs.md))
- **Console-click-to-navigate viewport jump** -- fixed 2026-09-13 (`7bf6b53`); an already-visible node is
  selected in place. ([detail](outstanding-items/console-click-viewport-jump.md))
- **Palette node-family ordering** -- built 2026-09-13 (`cba9d80`), explicit numeric `priority`.
  ([detail](outstanding-items/palette-node-family-ordering.md))
- **Multiple panes for one large flow** -- built 2026-09-13 (`e2359f3`): tabbed panes, cross-pane wires and
  reordering deferred to post-MVP. ([detail](outstanding-items/multi-pane-canvas.md))
- **Foldable palette groups** -- built 2026-10-17: groups start folded except "general", state remembered per
  browser.
- **Wider / resizable console panel** -- done 2026-10-12: defaults to 630px, the left edge drags, width kept
  per browser, double-click resets.
- **Delete node / delete wire** -- built and verified 2026-09-08.
  ([detail](outstanding-items/delete-node-wire.md))
- **Gray out the compile/deploy button after a successful deploy** -- built and real-browser verified
  2026-09-09. ([detail](outstanding-items/gray-deploy-button-until-edit.md))
- **Console-message-to-node attribution** -- built and verified 2026-09-04.
  ([detail](outstanding-items/console-node-id-mapping.md))
- **Stable node IDs** -- built and verified 2026-09-04 (the Rete UUID is the compiler/wire/flow-file id).
  `decisions.md`, "Stable node IDs".
- **Canvas-presence gaps** -- closed 2026-09-06 for `pwm_out`; `variable_get`/`variable_set` were hidden again
  the same day and later replaced by the `change` node.
  ([detail](outstanding-items/canvas-presence-gaps.md))
- **Serial write-timeout gap (`serial_relay.py`)** -- fixed 2026-09-08 with a 5 s `write_timeout`; 10 new
  tests, negative-control verified.

## Decisions, process and other

- **Sequencing override set by Mike, 2026-08-20** -- fully closed 2026-09-06: custom node authoring + docs
  done, and the narrow docs-only validation session was a clean pass.
  ([detail](outstanding-items/sequencing-override.md))
- **Prior handoff docs, all superseded** -- `framebuffer-st7789-display-briefing.md` (led to the two display
  bus-family nodes), `wifi-gate-and-protocol-fix-briefing.md` (led to `wifi_gate` and a DEPLOY-encoding fix)
  and `credential-store-implementation-briefing.md` (led to the credential store). What they carried is built
  below or still tracked above.
- **Repo-root `AGENTS.md` was empty** -- filled since; `CLAUDE.md`'s `@AGENTS.md` import resolves.
- **GPIO pin range hardcoded to 0–39** -- resolved 2026-09-23 by the processor/board definitions; the hardware
  pass is tracked above.
- **§3's RP2040-vs-RP2350 RAM floor** -- closed 2026-09-06: resolves through the RP2350 bring-up item, which
  produces the comparison data.
- **"App Platform" question** -- resolved 2026-08-16: a thin local Python backend plus a browser editor.
  `decisions.md`, "Backend".
- **"file ops" node idea** -- rejected 2026-08-17: reduces to a `function`-node one-liner.
- **Recovery button/jumper for a wedged listener** -- rejected 2026-09-06: `HELLO_REQUEST`, the reset node and
  the hardware reset pin cover it. ([detail](outstanding-items/recovery-button-wedged-listener.md))
- **Documentation** -- scoping, tech selection, design and content-writing done 2026-09-07; a real mkdocs
  build confirmed 2026-09-08. ([detail](outstanding-items/docs-nothing-written.md))

