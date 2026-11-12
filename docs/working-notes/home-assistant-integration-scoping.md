# Home Assistant integration — scoping (provisional)

**Status: provisional.** Written 2026-11-12 from a brainstorm with Mike. Nothing here is decided; Mike makes the
final calls in a separate session. Related, on the `remote-display-spike` branch only (not yet on main):
`remote-display-scoping.md`, `decisions/remote-display.md`, `interfaces/remote-display/SPEC.md`. Already on record:
design doc §10 and `outstanding-items.md` list "Home Assistant auto-discovery on the v1 MQTT node" as the first
post-launch candidate. Mike, 2026-11-12: the MVP gate is not the frame for this; the question is **what gives HA
users the most value**.

## Where the value is

Auto-discovery alone is table stakes: nobody tries Thingstudio with HA if seeing a value needs YAML. But on its own
it doesn't answer "why not ESPHome?", which already does "sensor into HA" well and is HA's own project. What
Thingstudio adds for an HA user:

- **Logic on the board in plain Python** (debounce, hysteresis, state machines, run-on timers) that keeps working
  when HA is down. In ESPHome that is where YAML turns into C++ lambdas.
- **Physical touch panels that show and control HA entities**, built by drawing wires: a CYD on the wall for the
  boiler, the plugs, the outside temperature. This is the marketing plan's media message ("a touch panel for the
  smart plugs you already own"), which until now depended on an unbuilt external-controls flow.

The panel needs data flowing **both ways**. So the frame (Mike agreed, 2026-11-12): **HA entities become nodes.**

## The four integrations

1. **Board → HA: MQTT discovery.** Board appears as an HA device with entities; HA can command switches/numbers.
   Cheapest, and table stakes.
2. **HA → board: inbound entities.** A flow reads HA entity state and calls HA services. The hard direction: HA
   does not publish arbitrary entity state over MQTT by default.
3. **Thingstudio as an HA add-on.** Editor + backend run inside HA (as ESPHome's dashboard does). A distribution
   channel to a large, well-matched audience, and the natural home for the inbound relay (below). Mike: interested.
4. **Native HA integration (HACS custom component)** speaking Thingstudio's own protocol, no broker. Most powerful,
   most work, and would make the wire protocol a public interface (needs Mike's permission per `AGENTS.md`). Later,
   if at all.

## 1. Outbound: discovery nodes

- **Dedicated nodes**, not a checkbox on `mqtt_publish`: `ha_sensor`, `ha_binary_sensor`, `ha_switch`, `ha_number`,
  `ha_button`, `ha_select` (or one `ha_entity` with a component picklist). Discovery needs `device_class`, unit,
  `state_class`, min/max/step, which a raw publish doesn't carry. The user never types a topic.
- **An `ha` config node:** discovery prefix (default `homeassistant`), device name, area, broker ref.
- **Device-based discovery:** one retained config message per board on `homeassistant/device/<id>/config`, all
  entities under `cmps`. Generated at compile time as a constant, with HA's abbreviated keys to save RAM. Deleting a
  node removes its entity on the next full deploy because the whole device is republished without it.
- **Availability:** add a Last Will to the shared `ts_mqtt` client (one per broker, so one per board): `offline` on
  `<base>/availability`, `online` after connect. `ensure_client` has no Will today; mqtt_as supports one.
- **Birth message:** subscribe to `homeassistant/status`; republish discovery when HA comes back `online` (HA's docs
  ask devices to do this).
- **Stable identity:** unique id = board id + node id, so renaming a flow doesn't orphan entities.
- **Commands echo confirmed state**, not optimistic, so HA shows the truth.
- **Compile checks** in the usual style: invalid `device_class`/unit pairs, wire-type mismatches (a number wired to
  a `binary_sensor`), duplicate unique ids.

## 2. Inbound: `ha_entity_in`

Pick an entity, get its state as messages; send it a message to call a service on it. Routes for the data:

- **Via the add-on (preferred):** the add-on talks to HA's API and relays the entities a flow asks for onto MQTT
  topics. Boards hold no HA token and do no TLS. If the add-on stops, values go unknown/stale rather than lie.
- **Via `mqtt_statestream`** (built into HA, YAML config): fallback for HA Container/Core installs, which can't run
  add-ons. Open: is this a supported path or a documented workaround?
- **Direct REST/WebSocket from the board:** rejected for now (token on the board, TLS, RAM).

## 3. The add-on, and flashing

How ESPHome does it: the first install needs a cable; after that, updates go over WiFi. Its add-on offers OTA,
"plug into this computer" via Web Serial, or a manual download. The Web Serial route usually fails from a self-hosted
HA because Web Serial needs HTTPS and HA is normally reached over plain HTTP, which is why ESPHome also runs ESPHome
Web, a standalone hosted flasher built on ESP Web Tools (also used by WLED and ESPEasy).

Thingstudio fits this better than ESPHome: flows already deploy over WiFi (`decisions/wifi-transport.md`), and the
board password and hostname are set once over USB. So the cable step is one-off: install MicroPython + runtime, set
WiFi and board password. Mike's suggestion of a standalone flasher outside HA matches what ESPHome converged on.
Candidates: the existing desktop app, which already flashes firmware (`editor-firmware-flashing-scoping.md`,
`decisions/firmware-catalogue.md`); a hosted web installer on docs.thingstudio.net (HTTPS, so Web Serial works); or
both. Pico W first install is BOOTSEL drag-and-drop anyway.

Snags:
- Board discovery is a UDP broadcast probe, so the add-on needs host networking (add-ons can request it).
- MicroPython firmware updates still need USB; only flows and runtime files go over WiFi. Say so in the docs.
- The backend would run in HA's container as well as on desktops; check how far the packaging work already gets.

## 4. Meeting the GUI and the screen builder

Mike (2026-11-12): the remote-display work aims at a drag-and-drop screen builder, and it and HA go together well.

**The value contract already exists on main**, so no new interface spec is needed for HA values:
- A `payload` of `None` shows `--` (unknown). HA `unavailable`/`unknown` maps onto it.
- A **toggle with a wired input** already does HA's command/state model: tap shows the requested state with a dotted
  outline until the input confirms; no confirmation in time → reverts and shows a cross. So `ha_entity_in` → toggle
  input, toggle output → HA service call, with no GUI change.
- The remote-display SPEC (spike branch) carries values as `[value, state]` with `unknown known stale pressed
  pending`, so HA values reach a phone page through the same path.

**One possible GUI change:** "stale" is only a timer property on a widget; a message can't mark a value stale. When
HA or the relay goes offline, either send `None` (blank to `--`) or add a "mark stale" input so the last value stays
visible, dimmed. Open question for Mike.

**The real coupling is editor-side: an entity picker.** In the screen builder, drop `sensor.outside_temp` and get
the node, the widget, the wire, and label/unit filled from HA's entity registry (read by the editor in the add-on, at
edit time, so nothing extra goes to the board). Keep the flow visible: the builder drops a real node, not a hidden
binding. Timing: the screen-builder improvements (ScreenOutline edits, first-free-cell adds) are on
`remote-display-spike`, which stays unmerged while the main-as-production question is open (main is ~116 commits
ahead). So the picker either waits for that merge or is built against main's outline and rebased.

**Less tied than it first looked:** the spike decided remote displays ship as custom images (C3 below the IDF-heap
floor; S3 comfortable; Pico W unmeasured). The HA wall panel is main's *physical* GUI and doesn't depend on that.
For HA users the phone page matters least (they have the HA app); headless settings and the field tricorder are
where remote displays earn their place.

## Step zero: memory on the CYD

The wall panel is GUI + framebuffer + WiFi + MQTT on a no-PSRAM ESP32. The spike's lesson: the WiFi stack's IDF heap
is what collapses, and `gc.mem_free()` looked healthy throughout the C3's failure. Nobody has measured a CYD on GUI +
MQTT (the CYD memory-gate flows are still open). Before more design: run an existing GUI flow plus an
`mqtt_subscribe` on a CYD and read `freeIdfHeapBytes` / `largestIdfHeapBlockBytes`. If it's tight, the HA panel is a
custom-image feature too, and the pitch changes.

## Suggested order

0. CYD memory measurement.
1. Outbound discovery nodes + Last Will + birth handling. Touches no GUI code; can start on main any time.
2. Hosted web installer for first setup (helps every user, not just HA).
3. Add-on: editor + backend + entity relay.
4. `ha_entity_in`, and the entity picker in the screen builder (after the spike merge, or rebased).
5. Wall-panel showcase on Mike's own HA: the integration test for all of it, and the media demo.

Remote pages showing HA values come for free once 4 and the remote display both exist.

## Open questions for Mike

1. HA/relay offline: blank to `--`, or add a "mark stale" widget input?
2. HA editor work: wait for the spike merge, or go ahead on main?
3. CYD memory check: Mike runs an existing flow, or a test flow written for it first?
4. `mqtt_statestream`: supported path or documented workaround for non-add-on installs?
5. Outbound node shape: dedicated nodes (recommended) or one `ha_entity` with a picklist?
6. `ha_entity_in` calling services in v1, or read-only first? Service calls make a panel useful, and are also where
   a misbehaving flow can do real damage in the house.
7. Hosted web installer, desktop app, or both, for the one-off cable step?

## Facts to recheck before building

- HA device-based discovery (`homeassistant/device/<id>/config`, `cmps`): from HA's MQTT docs and the PR that
  introduced it; confirm current key names and the empty-payload removal behaviour.
- `mqtt_statestream` attribute publishing: not checked.
- ESPHome's LVGL support as the comparison for panels: from memory, not checked recently.

## Sources

- [Home Assistant MQTT integration](https://home-assistant.io/components/mqtt/) (birth/LWT, discovery)
- [Device-based discovery PR description](https://forum.hacf.fr/t/coucou-je-viens-ici-a-plein-temps-bye-jeedom-sans-regrets/50383)
- [Getting started with ESPHome and HA](https://esphome.io/guides/getting_started_hassio.html)
- [Waveshare ESPHome tutorial: first flash and the HTTPS limit on Web Serial](https://docs.waveshare.com/ESP32-ESPHome-Tutorials/First-Device)
- [ESP Web Tools announcement](https://community.home-assistant.io/t/power-up-your-esp8266-and-esp32-projects-browser-based-installation-and-configure-wi-fi-via-bluetooth-le/316200)
