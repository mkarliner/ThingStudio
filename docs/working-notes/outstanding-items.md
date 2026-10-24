# Outstanding items — working-notes backlog

Status: index, restructured 2026-08-22 from the 2026-08-19 consolidated map
(`working-notes-consolidation-briefing.md`). **Last audited 2026-10-24, against `git log` at `84dcbfc`.**

That pass was a readability one: every bullet whose own text said it was closed, done, settled, built or
superseded moved to "Resolved", the append-only "Added <date>" sections were folded into their topics, and
active items that were sitting under a "fully resolved" heading were put back where they belong. Tags and
priorities were left alone except where an item's status actually changed. Content was compressed, not
deleted: the detail files still hold the full reasoning.

Each item is a 1-2 line pointer; the full reasoning for any item with more than that lives in
`outstanding-items/<slug>.md`. Read this file plus `docs/thingstudio-design-doc.md` to get an accurate picture
of what's open across the whole project without opening every file in `docs/working-notes/`.

Tags: **[P1]**-**[P5]** priority (1 highest), **[POST-MVP]**, **[DEFERRED]**, **[TRACKING]** (a rollup pointer),
**[LAUNCH]** / **[LAUNCH-NICE]** (a launch gate / not a gate -- `decisions/launch-scope.md`), **[BACKLOG]**
(unscheduled idea). `[MVP]` marks an item promoted into the MVP plan by `road-to-mvp.md`.

History: the 2026-08-19/21 audit compiled this from every file in `docs/working-notes/` against its own
success criteria, `git log` and the design doc. The 2026-09-06 pass re-checked every active item's own status
and moved six already-implemented items to "Resolved". The 2026-09-06 priority pass tagged every active item
[P1]-[P5] (or folded, resolved or deleted it on Mike's call). Where a status could not be confirmed, it was
left open rather than guessed closed.

## Launch MVP (added 2026-10-05)

Product work the launch plan made launch-critical. Order, spec and reasoning: `launch-mvp-scope-briefing.md`;
decisions: `decisions/launch-scope.md`. Marketing-only work (copy, channels, video) lives in the
ThingStudioMarketing repo, not here.

- **[LAUNCH]** **GUI templating system, built properly.** Container/constraint layout (flexbox / X
  Intrinsics), GUI view, `screens` section, unknown/stale value states; widgets limited to label, value,
  button, status. Design: `decisions/gui-layout.md`, `gui-layout-widget-system-scoping.md`.
  **Custom GUI (authoring/styling widgets) is GUI-line work, not node-format work** (2026-10-15): a widget
  manifests in the flow only partially (value in / event out); styling and the eventual drag-and-drop editor
  belong to the GUI subsystem's own editing model. See `node-context-parity-scoping.md` §4(g).
- **[LAUNCH]** **GUI: fill the rest of the page, and page dots in a footer -- ruled 2026-10-24, not built.**
  A layout must be able to fill the remaining space on a page, and the page dots belong in a footer rather
  than being a widget dropped at (112, 211). `grow` and a full-screen root already exist, so this is a
  default plus an affordance (a `fill` control, or a last-card default) plus a footer strip the screen draws
  the dots into; the strip shrinks the page, it does not overlay it. No runtime bump while nothing
  device-side changes; a page-table `"footer"` entry would be codegen-visible and would need the usual
  version-bump judgement.
  ([detail](outstanding-items/gui-layout-fill-and-footer.md))
- **[LAUNCH]** **Ship 13.0.0 / publish v0.4.0 -- the biggest outstanding item.** 13.0.0 has never shipped;
  `v0.4.0` is runtime 12.1.0 and `firmware/classic-esp32/tested.json` still holds only
  `thingstudio-classic-esp32-12.1.0-8e2f87d.bin`. To ship: flash a committed image on a board, run it,
  `record-tested.sh <image> "<board>" "<what you saw>"`, then `publish.sh <tag>`, attach the image (built
  locally and attached by hand) and publish the draft. `build.sh` names the image from `git rev-parse HEAD`,
  so **commit first, build second** -- an image built from a dirty tree carries a SHA it does not contain.
  (`gui-layout-fill-and-footer-briefing.md`, `classic-esp32-firmware-briefing.md`)
- **[LAUNCH]** **Button rework -- built and hardware-checked 2026-10-09; these are the leftovers.** Open: the
  touch panel's landscape axes, a GUI view for button properties, and GT911/CST820 panel controllers
  (FT6336U/FT6236 is the supported family; `config-types.ts` says so). The rotation control landed as the
  `orientation` config node (display, screen size and touch axes turn together). See `decisions/gui-layout.md`
  and `gui-button-rework-briefing.md`.
- **[LAUNCH]** **`touch_spi` node (classic CYD).** The I2C side (`touch_i2c`, FT6336U first) was built
  2026-10-09; SPI touch for the CYD is still open. `touch-input-briefing.md`.
- **[LAUNCH-NICE]** **Palette: one colour per group.** Recolour every kind in `palette.ts` by group,
  `ebutton`/`eswitch` as "gpio button"/"gpio switch" (`decisions/gui-layout.md`, 2026-10-09). The GUI labels
  have no `gui` prefix and the group is "GUI"; the colours are not done. Retake the annotated editor
  screenshots afterwards.
- **[LAUNCH]** **Trend (moving histogram) widget and `journal` node -- built and hardware-checked
  2026-10-10; these are the leftovers.** Open: memory on the Pico/CYD, a real `series` port type (the
  journal's two outputs are `any`), autoscale. Original rationale: `decisions/gui-layout.md` (2026-10-07),
  `gui-layout-widget-system-scoping.md`.
- **[LAUNCH]** **Memory-gate example flows on the common boards (moved to the end of the queue, 2026-10-10).**
  Besides the headliner (S3, PSRAM), examples that run on RP2040/RP2350 (Pico W, Pico 2 W) and classic ESP32
  (the CYD, no PSRAM), measuring free heap before deploy, after deploy and at steady state. What breaks feeds
  the board memory budget the compiler should check (`decisions/gui-layout.md`, 2026-10-06). Not scoped.
- **[LAUNCH]** **Newcomer test with a target-group tester** (a maker who knows MicroPython). Re-runs the
  `road-to-mvp.md` acceptance test after the docs restructure.
- **[LAUNCH]** **Headless compile/validate -- built 2026-10-10; the backend move is open.** `editor/src/cli/`,
  `npm run build:cli`, `docs/user-guide/check-a-flow.md`: `checkFlowText` plus `thingstudio-compile`
  (exit 0/1/2, `--json`, `--board`, `--out`, `--strict`). Not covered: credentials (stand-ins), custom node
  packages. Open: the backend move. MCP server decided [POST-MVP] 2026-10-23 (`decisions/mcp-server.md`).
- **[LAUNCH]** **User-facing AI-authoring doc -- built 2026-10-10; these are owed.** `--describe` /
  `--board-info`, a generated node catalog (drift-tested), `ai-authoring.md`, `llms.txt`/`llms-full.txt` via
  an mkdocs hook (untested on mkdocs 1.6; the sandbox has 1.1). Owed: Mike's board runs of
  `test-flows/ai-authoring/`, a round 3 with tasks that have no example, then the copy-into-your-assistant
  block and a skill; the first-run workspace `AGENTS.md` waits for a workspace folder. Scoping:
  `ai-authoring-doc-scoping.md`; rounds: `ai-authoring-test-rounds.md`.
- **[LAUNCH-NICE]** **Download the generated Python** (viewing already works).
- **[LAUNCH-NICE]** **Landing page and README rewrite: technical side.** Content comes from the
  ThingStudioMarketing repo; hosting, GoatCounter on the page, and a docs/README note saying GoatCounter is
  used and what it counts.
- **[LAUNCH-NICE]** **Speaker/tone node.** The other two in this group shipped: `neopixel` (WS2812) and the
  `adc` node were built and hardware-tested 2026-10-12.

## Boards / definitions

- **[P2]** **ESP32-C6 (and H2, P4...) detected as a classic ESP32 -- new bug, 2026-09-30.** Found by a test
  for the Pins… page. `target.ts`'s processor match is a substring test on the normalised MCU name and
  `processors/esp32.json` matches "ESP32", so a board reporting "... with ESP32C6" resolves to the classic
  ESP32: its pin checks and its native arch (`xtensawin`, where the C6 is RISC-V) both apply. Not an MVP chip,
  but it fails silently. Fix: stop "ESP32" matching a letter-variant suffix (S2/S3/C3/C6/H2/P4) or match
  exact names; an unknown ESP32 variant should resolve to no processor, which the Pins… page explains.
- **[P3]** **Board header data for the LOLIN S2 Mini and the CYD -- new item, 2026-09-30.** The Pins… page
  shows physical pins from a board's `header` (Pico family done). The S2 Mini's maker prints labels but no pin
  numbers, so it needs a position scheme agreed first; the CYD's P1/P3/CN1 connectors vary between units. Only
  add either from a source checked against a real board: a wrong header is worse than none.
- **[P3]** **Seeded copies of built-in definitions hide later updates -- noted 2026-09-30.** The backend copies
  built-in board/processor files into `~/.thingstudio` once, and a user copy always wins
  (`builtin_reference.py`'s documented cost). A fix: remember what was copied (a hash) and refresh a copy the
  user never edited.
- **[P5]** **RP2350 (Pico 2 / Pico 2 W) bring-up -- in progress, wiring deferred.** Follow-up to the RP2040
  bring-up. Plain Pico 2 (non-W) confirmed 2026-09-06: MicroPython flash, runtime deploy, boot-to-HELLO. The
  functional interrupt-flow pass and the memcheck RAM comparison against RP2040's ~209 KB free are deferred
  until Mike has the button wired. ([detail](outstanding-items/rp2350-bringup.md))
- **Processor/board definitions: follow-ups.** The flow file doesn't record its board; the Board
  menu choice isn't remembered across reloads; CYD touch/SD/LED pins unverified; CYD on SPI bus 1 at >27 MHz
  untested. `outstanding-items/processor-board-definitions-followups.md`.
- **[DEFERRED]** **Plain Pico still shows WiFi entries in the port menu** (Mike, 2026-09-25, "not that fussed").
  A board with no WiFi hardware shouldn't be offered WiFi options. Not investigated.

## Network / config nodes

- **Board forgets its WiFi-transport password on a power cycle -- new bug, 2026-09-27 (Mike, Pico W).**
  Password set over USB, WiFi worked; after replugging the board reported no password set. **Not reproduced
  2026-09-30** and code review found no path that loses `/_board.json`. If it comes back: read `/_board.json`
  (and `os.listdir('/')`) before and after a power cycle, and keep the first console lines after reconnecting.
- **[P4]** **Suspected `mqtt_publish`/`mqtt_subscribe` publish-after-subscribe-confirmed ordering race at flow
  boot -- likely (co-)cause of a silent-failure hardware test, 2026-09-02, unconfirmed.** Targeted fix + retest
  still owed. ([detail](outstanding-items/mqtt-pubsub-boot-race.md))
- **[P4]** **MQTTS (MQTT over TLS) -- not built, deferred on Mike's explicit call (2026-08-21).** Vendored
  `mqtt_as`'s `config` already has unused `ssl`/`ssl_params` keys; a config's `properties` is a plain JSON
  blob, so deferring is not a one-way door. Nothing reserved. ([detail](outstanding-items/mqtts-tls-deferred.md))
- **[POST-MVP]** **TCP send / TCP listen-receive -- never built; deferred past MVP (Mike, 2026-09-26).** Only
  UDP send/receive landed. TCP send needs a lazy-expiry connection cache; TCP listen-receive needs a
  callback-to-coroutine bridge. `mvp-feature-priorities.md` Tier 1 item 5 point 3.
  ([detail](outstanding-items/tcp-send-listen-receive.md))
- **[P3]** **I2C/SPI sensor nodes -- BME280/BMP280 built 2026-09-26** (on Pico hardware; TCS34725/MPU-9250 go
  through the generic `i2c` node until a tutorial needs a dedicated one). Open: the stuck-I2C-device
  fault-handling question Mike flagged 2026-08-16, and the I2C/SPI slave-mode witness-rig gate.
  ([detail](outstanding-items/i2c-spi-sensor-nodes.md))
- **`http_request` response size -- decision needed, found 2026-10-19.** The whole body is read into one
  allocation, so a 56 KB page on an ESP32-C3 failed with `MemoryError allocating 56722 bytes` while a 48-byte
  page worked. Smallest fix is a clear "response body doesn't fit" error; whether to add a size limit (or
  stream) is the open decision. ([detail](outstanding-items/http-response-size-limit.md))
- **[POST-MVP]** **File an upstream issue for the `mqtt_as` WiFi-reconnect race -- undecided, Mike's call.** A
  real bug against current `master`, but the same class of fix has been raised before (#59, #61, #57) without
  landing -- which is why Thingstudio fixed it locally. ([detail](outstanding-items/mqtt-upstream-issue-decision.md))
- **[P3]** **Filter / event-compression node -- built 2026-09-26, off-device tests only.** Owed: a real-hardware
  pass. `filter-node-spec.md`; reuses `timer.ts`'s per-instance state pattern.
  ([detail](outstanding-items/filter-event-compression-node.md))
- **[P4]** **AADC (Hinch's §5 ADC-monitoring driver) node -- deferred follow-up, 2026-09-17.** Split off from
  the eswitch/ebutton pass on Mike's call; not started. His DRIVERS.md collection stays a candidate source for
  further nodes later, not scoped now.
  ([DRIVERS.md §5](https://github.com/peterhinch/micropython-async/blob/master/v3/docs/DRIVERS.md))
- **[P4]** **`interrupt` node has no way to enable an internal pull resistor -- new item, 2026-09-17.**
  `eswitch`/`ebutton` have a `pull` (none/up/down) property; `interrupt` has the identical "no internal pull,
  wire an external one" limitation. Same shape of fix: a `pull` property threaded into
  `machine.Pin(pin, machine.Pin.IN, ...)`. ([detail](decisions/node-authoring.md))
- **[POST-MVP]** **Preset dropdown for known-working `display_spi` panel configs -- new item, 2026-09-18.**
  Unblocked: the `colorOrder`/`invertColors`/`dataLatchOrder`/`rotation` properties exist. The picklist (named
  presets plus manual entry for an unlisted panel) is still not built.
- **[POST-MVP]** **Threading / multicore support, possibly an Exec node -- new item, 2026-09-08.** Not scoped.
- **[DEFERRED]** **Continuous WiFi board discovery** (Mike, 2026-09-25). Backend re-probes every ~5 s while an
  editor is open and not connected over WiFi; keeps a last-seen table keyed by hostname, drops a board after
  ~3 missed rounds, pushes changes; follows IP changes, enables "last seen" help. No board-side change, no
  runtime bump. Today discovery runs only on ⟳ ports / page load (`tcp_relay.discover()`).
- **[DEFERRED]** **ESP32-C3 slow, lossy pings over WiFi** (2-324 ms, ~33% loss; Pico W 2-25 ms, none). Probably
  the C3's default modem sleep; not confirmed (`w.config(pm=w.PM_NONE)` then ping). Mike, 2026-09-25: defer
  unless it causes other problems. A fix would switch power saving off during a WiFi session only.

## Hardware / rig

- **[P3]** **LSM6DS3TR-C interrupt-example node -- needs a real-hardware pass, 2026-10-15.** The example
  package `st/lsm6ds3_int` (`backend/.../example_nodes/`) proves a custom node can be a hardware-interrupt
  source (`eventSource` + `ThreadSafeEvent` + `Pin.irq`). Its data-ready path is well-trodden; its wake /
  single-tap / double-tap / free-fall register settings want confirming on a XIAO nRF52840 Sense (INT1 =
  pin 11). Iterate the register map here if a mode misfires.
- **`ntp` node (replaces `clock`) -- built 2026-10-14, owes a hardware check.** Sync, summer time,
  the headliner's clock page, and a flow with only `ntp` joining WiFi. `clock` is removed; seven-segment
  stays a gui label font. ([detail](outstanding-items/ntp-node-replaces-clock.md))
- **GPIO pin range hardware pass.** The hardcoded 0–39 range was resolved 2026-09-23 by the
  processor/board definitions (`decisions/chip-board-definitions.md`); the hardware pass is still owed.
  ([detail](outstanding-items/gpio-pin-range-by-chip.md))
- **[P2]** **Lazy loading, for RAM on small boards -- both parts done 2026-09-25 (runtime 5.1.0), not yet seen
  on hardware.** Context: an ESP32-C3 couldn't join WiFi from an MQTT flow, most likely memory
  (`learnings/micropython-device-runtime.md`, 2026-09-25); installs are now precompiled. Part 1: runtime
  modules imported only when needed (`wifi_provision`, `board_settings`, `net_transport` at every boot).
  Part 2: node libraries pushed with the flow, not at install. Also: report free ESP-IDF heap in HELLO next
  to `freeRamBytes`, and a C3 memory check (MQTT + display) on the hardware checklist. **Mike's call
  2026-09-25:** watch memory as the remaining MVP nodes go in, build lazy loading further only if needed;
  otherwise post-MVP.
- **[P5]** **CBOR-over-JSON (§13) -- the original revisit trigger has technically passed.** No explicit revisit
  of the size trade-off has happened since. Mike, 2026-09-06: review last, once everything else MVP-scoped is
  complete. ([detail](outstanding-items/cbor-over-json-revisit.md))

## Redeploy / runtime

- **[P3]** **`machine.reset()` before each deploy, for a known-clean device state -- raised 2026-09-04, not
  scoped.** +3s deploy time, likely worth it. A full reset gets the clean-slate effect "a power cycle fixed
  it" confirmed. Not a one-liner: inserting a reset mid-handshake breaks the single-connection
  DEPLOY/DEPLOY_ACK exchange -- needs boot-time auto-resume plus host-tooling changes.
  ([detail](outstanding-items/reset-before-deploy.md))
- **[POST-MVP]** **WLAN interface state isn't torn down on redeploy -- stray native WiFi driver noise can
  outlive the flow that started it.** Confirmed 2026-09-04; a power cycle fixes it. Unconditional teardown
  would defeat `wifiSetupStatement()`'s "stay connected across a quick redeploy"; needs Mike's sign-off on the
  conditional version. **2026-09-06, Mike's call: deferred past MVP** -- likely accepted and documented as a
  troubleshooting note instead. ([detail](outstanding-items/wlan-state-not-torn-down-on-redeploy.md))
- **[P4]** **Flow dependencies (per-flow library push) -- built 2026-10-07 on the `flow-dependencies` branch
  (runtime 7.0.0), tested off-device, then confirmed on hardware the same day** (Pico W: MQTT then library
  removal; CYD/ESP32 upgraded from 6.0.0, old root copies gone, MQTT flow). Open: a display flow.
  `decisions/flow-dependencies.md`. This is the answer to the old `deploy_runtime.py` `VENDOR_FILES` scaling
  concern (a display driver is only pushed to a board whose flow uses one).
- **[POST-MVP]** **OTA-capable partition table on the ESP32 build -- still not done.** Build-config only, a
  one-way door (every early field device would need a manual reflash later). **Mike, 2026-09-06: deferred past
  MVP anyway** -- no field devices exist yet and only a handful are expected, so the reflash cost is cheap.
  A deliberate, informed override of `AGENTS.md`'s premature-optimization corollary, not an oversight.
  ([detail](outstanding-items/ota-partition-table.md))
- **[POST-MVP]** **Flash-backed runtime-state persistence (a calibration constant surviving redeploy) -- not
  built.** Node/runtime state, node-ID keyed; distinct from the pre-MVP application settings store (now built)
  and from the flow's own bytecode surviving power loss (built 2026-09-05). Deferred past MVP: real design
  thinking needed. ([detail](outstanding-items/tier2-live-streaming-persistence.md))
- **[POST-MVP]** **Stateful nodes / cross-message synchronization (Node-RED-style `join`) -- not started, not
  scoped.** Mike's condition for deferring: only OK while context get/set is interrupt-safe. Checked: the
  hard-IRQ handler only signals a `ThreadSafeEvent`; every real decision runs in the coroutine, so the
  architecture satisfies it by construction. Confirm on hardware once picked up.
  ([detail](outstanding-items/stateful-nodes-join.md))
- **[POST-MVP]** **Dedicated router/switch node -- deferred 2026-09-14 (Mike's call).** The general
  multi-output mechanism landed 2026-09-12 and the pass-or-drop WiFi status gate is built; a `function` node's
  multiple outputs plus an in-code switch already cover the routing need.
  ([detail](outstanding-items/connection-state-gate-router-nodes.md))
- **[P5]** **Tier 1 "kitchen sink" gate -- not run.** One combined flow wiring every v1 node type together,
  soak-run for an extended period. Needs the rest of Tier 1 to mean anything.
  ([detail](outstanding-items/tier1-kitchen-sink-gate.md))
- **[POST-MVP]** **Store the flow definition on the device itself, not just the host file system -- raised
  2026-10-22, not scoped.** A flow's `.flow.json` optionally kept next to the compiled flow, so connecting
  loads the current flow. `HELLO` already reports `currentFlowName`/`currentFlowDeployId`; reading the JSON
  back needs a request/response pair, a device-side store and an editor path for missing custom nodes. Safe to
  store: `flow.configs` holds `credentialName`, never a secret.

## UI / editor

- **GUI widget styles and colour -- new item, 2026-10-23 (Mike: "gui widgets are currently very dull"), not
  yet prioritised.** Cards on containers, status chips, segmented bars, switch toggles; colour by named roles
  in a theme on the gui screen, resolved per frame format (RGB565, gs4/gs2 palette-bounded, mono ink/paper).
  ([scoping](gui-widget-styles-and-colour-scoping.md))
- **[POST-MVP]** **Install MicroPython from the editor -- new item, 2026-10-01, from the first newcomer test.**
  Getting MicroPython onto the board took most of the 27-minute run. Post-MVP on Mike's call: too many
  variants (BOOTSEL reports only a chip; ESP32 builds vary by PSRAM and USB mode). Revisit only if later
  newcomer runs still stall here after the docs fix.
- **[P3]** **Custom node format parity with built-ins -- in progress.** The end state is the Node-RED model: a
  node is one package (descriptor + device-side Python), built-ins shipped in a folder ahead of the user's,
  same format. Remaining gaps: `credential`/`palette` field kinds, context parity (flow/compile context for
  packages), capability parity (dynamic ports in the custom schema, multi-output sources, resource claims,
  presets, native code), and built-ins-as-packages for the design/verification projects left (`touch_i2c`,
  `display_spi`, `adc` and `wifi_gate` context queries). CLI custom-node loading is also open. The
  compile-hook mechanism and all the network/GPIO package flips landed. **Next-session handoff:**
  `node-format-parity-briefing.md`; roadmap and constraints: `decisions/node-authoring.md` (2026-10-15),
  `builtins-as-packages-scoping.md`, `package-compile-hooks-scoping.md`,
  `reviews/2026-10-18-node-parity-architecture.md`.
- **[P3]** **Deploy the runtime itself from the browser editor, not just compiled flows -- confirmed untracked
  until 2026-09-12.** Today `test-flows/deploy_runtime.py` is a standalone `mpremote` script; a runtime deploy
  has to overwrite the listener's own currently-executing source, so it needs a real design session before it
  is buildable. ([detail](outstanding-items/deploy-runtime-from-editor.md))
- **[P2]** **Node connection-status indicators (`NODE_STATUS`) -- built and real-hardware confirmed
  2026-09-10/11; these are owed.** The `NODE_STATUS` message type, the state enum, clear-on-redeploy and the
  `wifi_status`/`mqtt_publish`/`mqtt_subscribe` rendering all landed; the WiFi-flapping fix is confirmed on
  hardware. Owed: the real MicroPython test suite for the `device-runtime/src` changes, a `vitest` re-run
  against the updated mqtt/wifi codegen, a hardware check of `mqtt_publish`'s connected/disconnected reporting
  once it has published, and clear-on-redeploy. ([detail](outstanding-items/node-status-indicators.md))
- **[POST-MVP]** **Drag-to-splice -- not built, needs Mike's own real-browser call.** A working ~90-line
  poc-rete implementation exists to port; the trigger mechanism (`nodedragged` vs. `nodetranslated`) is an
  unresolved hands-on judgment only Mike can make. `editor/src/app/rete/insert-node.ts` was never ported.
  ([detail](outstanding-items/drag-to-splice.md))
- **[POST-MVP]** **Named/labeled pin mapping -- Mike's ask, not scoped.** Define human-readable names for pins
  once, reuse them in every pin-selection dropdown. Board files' `pins` labels (2026-09-23) are a first
  per-board version: shown in the property panel, not yet a dropdown.
  ([detail](outstanding-items/named-labeled-pin-mapping.md))
- **[P3]** **Machine/board-specific node collections -- Mike's ask, not scoped.** Board/processor-specific node
  sets so the palette doesn't show irrelevant nodes. **Mike, 2026-09-06:** reuse the existing `group` field
  rather than a new parallel concept, plus a way to select the target board on the canvas that filters the
  palette. Connects to editor board-awareness below.
  ([detail](outstanding-items/board-specific-node-collections.md))
- **[P5]** **General UI wishlist -- remaining: a notes/README sheet for documenting a flow.** Collapsible
  panes, delete node/wire and the resizable console all landed; the palette and property panel still collapse
  rather than drag-resize. ([detail](outstanding-items/ui-wishlist-untriaged.md))
- **[POST-MVP]** **Editor board-awareness -- the deeper "warn on bad pins" half is built; palette filtering is
  not.** The Board menu and per-board pin checks landed 2026-09-23
  (`decisions/chip-board-definitions.md`); filtering the palette by target board stays medium-term.
  ([detail](outstanding-items/editor-board-awareness.md))
- **In-editor node reference -- raised 2026-09-07, not scoped.** A per-node summary inside the editor, fed
  from one authored source shared with the external guide rather than two hand-maintained copies. See
  `documentation-scoping.md`'s addendum and `documentation-tech-selection.md`.
  ([detail](outstanding-items/in-editor-node-reference.md))
- **A function node can't feed a `number` input -- found 2026-10-11.** `function`'s output is `any`, and
  `number`/`int`/`string` inputs refuse `any`, so a function can't drive `pwm out`'s duty and there is no
  conversion node. Options: allow `any` into numbers (fail on the board), typed function outputs, or a
  conversion node. ([detail](outstanding-items/function-output-into-typed-inputs.md))
- **`convert` node -- explicit port-type conversion -- new item, 2026-10-11.** Builds the conversions
  `sockets.ts` refuses (`bytes` ↔ `string`, `any` → a concrete type, ...). Pairs with loosening `any`
  compatibility; decide both together. ([detail](outstanding-items/convert-node.md))
- **ADC2 pins: move the ESP32 map into the board definitions -- new item, 2026-10-11.** The `adc` node refuses
  an ESP32 ADC2 pin when the flow uses WiFi, using a hardcoded pin map keyed by processor id; it belongs in
  the processor definitions like `gpio`/`reserved`. ([detail](outstanding-items/adc-esp32-adc2-pins.md))
- **A custom display node can't drive a gui screen's size, format, orientation or touch -- new item,
  2026-10-17.** The screen only follows a wired `display_spi` (found by type in three places); wired to the
  RM68090 custom node it falls back to a hidden 320x240 gs4, so a portrait panel fails at start. Build: an
  optional `display` descriptor key (a descriptor change, so confirm with Mike first).
  ([implementation note](custom-display-node-scoping.md))
- **STM32 / pyboard support -- new item, 2026-10-13.** Deploy fails with ENODEV: the runtime writes under `/`,
  but the stm32 port mounts its filesystem at `/flash`. Beyond that, STM32 pins are named (`X1`), so the pin
  model needs a decision first. `-march` for STM32F4 is fixed.
  ([detail](outstanding-items/stm32-pyboard-support.md))

## Backend / auth

- **[P3]** **Posture-2 auth (app-secured) -- not built, split from the backend/auth item, 2026-09-07.**
  bcrypt-hashed password, signed session cookie, TLS mechanics, packaging -- decision-complete in
  `backend-editor-auth-and-protocol.md` §1, zero code. Deferred until the backend is bound to a LAN/public
  interface. ([detail](outstanding-items/posture-2-auth.md))
- **[P3]** **No editor UI to author or upload a custom node package to the backend -- found 2026-09-08.** The
  editor only reads `GET /api/custom-nodes`; a user has to place `<name>.node.json`/`<name>.node.py` in
  `~/.thingstudio/custom-nodes/` themselves. Client-side plumbing (`writeCustomNode`/`deleteCustomNode`)
  exists and is tested, unused. Mike, 2026-09-08: deferred, priority 3.
  ([detail](outstanding-items/backend-persisted-data-protocol.md))
- **[MVP]** **Network transport (WiFi) editor/backend↔board, supplementing USB serial -- built 2026-09-24,
  off-device verified, partly hardware-confirmed.** 2026-09-25 on an ESP32-C3 (Mike): password auth, deploy,
  `NODE_STATUS` and plain `print()` output all work over the network session, so the `os.dupterm` mirror works
  on real hardware. Still to check: wrong password, power pull mid-session, Pico W, `.local` entry, discovery
  from a Mac with the permission sorted; the network scan (nice to have); setting the captive portal's AP
  password from Board settings (`wifi_provision.set_ap_password` has no caller). macOS Local Network privacy
  blocks a framework-build Python -- start the backend from Apple's Terminal (docs and the error message say
  so); packaging item 7 must ship a signed app with `NSLocalNetworkUsageDescription`.
  `wifi-transport-scoping.md`, `learnings/backend-security-research.md`.

## Docs / process

- **[BACKLOG]** **"Future" page in the user docs** (Mike, 2026-10-11). One clearly labelled page for planned
  features, inviting feedback, so the rest of the docs describe only the current state. Not scheduled.
- **User docs rewrite to the style guide -- new item, 2026-10-11 (Mike, docs style review).** Prioritised page
  list: P1 Getting started, `working-in-the-editor.md`, `sensor-display.md`, `debugging.md`; P2 node pages to a
  fixed layout, `boards.md`, `custom-nodes.md`, `faq.md`, `flow-lifecycle.md`; P3 background pages. Rules:
  `docs-style-guide.md`. ([detail](outstanding-items/user-docs-rewrite.md))
- **User docs on GitHub Pages -- new item, 2026-09-27 (Mike).** `docs.yml` deploys to the `gh-pages` branch
  successfully; Pages isn't switched on in the repo settings. Then check links and link it from the README,
  release notes and `install.sh`. ([detail](mvp-remaining-work-briefing.md), item A)
- **MkDocs future -- stay on 1.x, Zensical likely later (2026-09-24).** MkDocs 1.x is unmaintained, 2.0 is an
  incompatible rewrite Material can't use, Material reportedly enters maintenance mode 2026-11-05. No action
  until a build breaks or packaging fixes the toolchain. ([detail](outstanding-items/mkdocs-future.md))
- **Developer section of the user manual: running from source on macOS -- new item, 2026-09-27.** Say: run
  `make run` / `thingstudio-backend` from Apple's **Terminal** on macOS. From iTerm (or VS Code's terminal) the
  dev backend's unsigned venv Python can't reach boards over WiFi ("No route to host") and macOS never
  prompts; Terminal is exempt (TN3179). Confirmed 2026-09-27. Released builds carry their own signed
  executable and are unaffected. ([background](learnings/backend-security-research.md))
- **User docs are missing an execution-model explanation.** `canvas-basics.md`'s Wiring section covers
  connection mechanics but not the underlying model: each source node drives its own independent async loop,
  there's no shared tick, and multi-output fan-out iterates outputs in order. Worth a short new subsection; not
  big enough for its own detail file.
- **[POST-MVP]** **Board-to-board messaging ("comms bus") -- new item, 2026-09-26.** Transport-independent
  `link out`/`link in` nodes carrying a whole `msg` as a CBOR frame; UART first, I2C target next, ESP-NOW
  later. Open for Mike: is I2C a requirement, distances and board count, which LoRa board. The generic `i2c`
  node (controller side) is separate and built.
- **[P5]** **CI vendor-neutrality -- should CI be independent of GitHub specifically?** Mike's raised question
  (`mikes-questions-and-points.md`, "# CI"); currently GitHub Actions. Not revisited.
  ([detail](outstanding-items/ci-vendor-neutrality.md))

## Already tracked — v2/v3 candidates and open design-doc questions

Design doc §10's own v2 candidate list (roughly priority order): full BLE/WiFi transport with pairing/auth,
per-device config override on top of v1's shared config nodes, a catch/error node, Home Assistant
auto-discovery on the v1 MQTT node, incremental (non-full) redeploy, mDNS discovery, TCP client proactive
connection expiry on top of v1's lazy-expiry version. §10's v3+ list: a self-hosted mini dashboard (needs an
on-device HTTP server -- also the "HTTP in" item Mike raised, deliberately not folded into v1's UDP/TCP
promotion), multi-device flows, a companion server for team libraries/fleet deployment.
`mvp-feature-priorities.md`'s "Explicitly still out of v1" section covers the same ground in more detail.

## Resolved — closed out of the active backlog

Done and verified (or resolved as a decision); kept as one-line pointers rather than full paragraphs in the
active sections, per the same "index, not a copy" principle as this whole file.

### Launch

- **Freenove FNK0104S board support** -- built 2026-10-08, hardware-checked 2026-10-10: touch lands right at
  90/180/270 and the press highlight holds and releases. Replaced the FNK0104B (2026-10-09).
- **CYD gate for custom firmware images** -- closed 2026-10-23 (`c71ab96`): the image installs on the CYD and
  deploys the hero GUI flow three times over a running flow. The five-cycle gate is retired
  (`decisions/gui-layout.md`); attaching the tested image to the release is tracked under release debt.
- **Deploy a second time on a low-memory board: guidance, not a sequence** -- settled 2026-10-23. Remove
  flow… → power cycle → deploy; if it still fails, the flow may be too big. One `DEPLOY_MEMORY_HINT` constant
  serves all three memory failures; no wire message, no HELLO field, no version bump.
- **Classic-ESP32 custom image** -- built, booting, deploying repeatedly (2026-10-22/23): 1.69 MB, 34 frozen
  libraries, idle 149 KB free. `decisions/classic-esp32-firmware.md`, `firmware/classic-esp32/`. Publishing is
  tracked under release debt.
- **Headliner (showreel) flow and task guide** -- flow hardware-checked 2026-10-10 (BME280 readouts, trends,
  MQTT publish, clock page with NTP and summer time); task guide written (`docs/user-guide/sensor-display.md`).
- **External controls example flow** -- dropped from the launch (Mike, 2026-10-13; ThingStudioMarketing
  `marketing-plan.md` §6). The neighbours story moves to Home Assistant; whether the touch/MQTT-both-ways/
  unknown-stale acceptance moves elsewhere is a product call, not made here.
- **`touch_i2c` node (FT6336U first)** -- built 2026-10-09 (`bc5bc9e`, later a core package); presets and the
  missing-bus error landed after. `touch_spi` is still open.
- **[LAUNCH-NICE] `adc` node (Hinch's AADC)** -- built and hardware-tested 2026-10-12 (LuatOS ESP32-C3-CORE);
  claims its pin and shares the ADC channel through `runtime.shared('adc', ...)`.
- **[LAUNCH-NICE] `encoder` node (Hinch's quadrature `Encoder`)** -- built 2026-10-11 and hardware-tested;
  pins shared via `sharedPin()`.
- **[LAUNCH-NICE] `neopixel` node** -- built and hardware-tested 2026-10-12; data pin shared, driver claimed.
- **Pico W WiFi-password bug** -- confirmed fixed on hardware (2026-10-10).

### Nodes and runtime

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

### Editor and backend

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

### Decisions, process and other

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

## Flagged as ambiguous — needs a human decision, not guessed here

- **`architecture-review-briefing.md`'s "browser-only, no install" claim (§4).** See
  [detail](outstanding-items/ambiguous-browser-only-claim.md).
- **`mikes-questions-and-points.md` itself is a live, actively-appended file** -- treated as a permanent
  open-items scratchpad, not something to mark resolved or archive. Its still-open items are pulled into the
  sections above; re-check it directly for anything newer than this index.
- **`mvp-feature-priorities.md` and `validation/mvp-validation-plan.md` remain the live sources of truth** for
  tier-by-tier status. This file pulls their open items forward but doesn't replace them.

---

## Files marked fully resolved by the original 2026-08-19 audit (archived 2026-08-22)

19 working-notes briefings whose own success criteria were entirely met were moved into
`docs/working-notes/archive/` 2026-08-22, unchanged otherwise -- see that directory for the list. Everything
else in the original inventory was read and classified but left in place -- either partially resolved (open
items pulled forward above), still fully active, or one of the living tracking documents noted under "Flagged
as ambiguous."
