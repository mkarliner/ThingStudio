# Briefing: WiFi transport and MQTT hardware pass, ESP32-C3 memory fix

2026-09-25. Handoff for the next session. MVP item 6 (WiFi transport) is done on hardware.

## Where things stand

- **WiFi transport passes the full hardware checklist** on the ESP32-C3 and the Pico W, re-run from step 1 on
  runtime 5.0.0. Detail: `wifi-transport-built-briefing.md` ("Hardware results").
- **Runtime 5.0.0, installed precompiled.** The editor compiles the runtime to `.mpy` with its own mpy-cross and
  the backend pushes that (`decisions/runtime-install-from-editor.md`). This fixed the ESP32-C3's WiFi join
  failing from MQTT flows: compiling source on the board left WiFi too little memory
  (`learnings/micropython-device-runtime.md`).
- **The WiFi config is a singleton.** Every WiFi-using node has a WiFi field that edits the flow's one config;
  `wifi_status` is optional. Older flows merge on load (`decisions/config-nodes-tier1-scope.md`).
- **MQTT on ESP32:** `mqtt_as` carries two marked local patches; the first join happens at flow start; a
  redeployed flow's old client is stopped; connect errors name each attempt's WiFi status and the broker's
  refusal reason (`decisions/redeploy-network.md`, `device-runtime/src/vendor/mqtt_as/README.md`).
- **Smaller fixes:** port menu placeholder no longer hides WiFi boards; discovery resends its probe; clear
  "no password set" and "port already in use" messages; Board settings names the board it will change; editor
  tabs survive backend restarts; a board that loses power shows disconnected within ~30 s; console **Verbose**
  switch hides routine system lines.
- Last commit: `fef8a04`. The Verbose switch, the slow-pings note and the learning's "ruled out" line may still
  be uncommitted -- check `git status` first (and `rm -f .git/index.lock` before any commit).

## Standing instructions from Mike (2026-09-25)

- **Memory:** watch it while the remaining MVP nodes go in, especially on the ESP32-C3 (its WiFi stack shares
  the main RAM). Build lazy runtime imports only if needed; otherwise post-MVP. Plan in outstanding-items ([P2]
  "Lazy loading").
- **Slow ESP32-C3 pings:** deferred unless they cause other problems.

## Open, small

- Plain Pico still shows WiFi entries in the port menu (deferred).
- Report free ESP-IDF heap in HELLO, and add a C3 memory check (MQTT + display flow) to the hardware checklist --
  cheap, and makes the next memory problem visible instead of cryptic.
- One flaky vitest seen: `node-eswitch.test.ts`'s driver-timing test fails on slow machines.

## Next picks

1. **Remaining MVP nodes**, with a memory check on the C3 as each lands.
2. **MVP item 7: packaging and install routes.** Must ship `editor/src/definitions/`, and on macOS a signed app
   with `NSLocalNetworkUsageDescription` (Local Network privacy blocked the backend from iTerm). The precompiled
   install needs nothing new: the editor's mpy-cross WASM does the compiling.
3. **MVP item 8: docs** (getting-started tutorial, task guides, chip/board/display pages).
