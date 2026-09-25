# Briefing: WiFi transport built (MVP item 6), item 5 closed, startup node on the canvas

2026-09-24. Handoff for the hardware pass. Everything here is off-device verified only.

## What landed

- **MVP item 5 closed.** `display_spi`'s `palette` got swatches (`PaletteField.vue`, `rgb565.ts`), the last
  property with no form field. `decisions/editor-canvas.md`.
- **`startup` node on the canvas.** Its codegen and test were committed 2026-09-17 by accident without any wiring;
  now registered, in the palette (after inject), with a property panel block and a user doc page.
  `outstanding-items/init-node-on-flow-start.md`.
- **WiFi transport (item 6), runtime 3.0.0.** `wifi-transport-scoping.md` has the design, Mike's calls and a
  "Built" section; `decisions/wifi-transport.md` has the decisions. User doc: `docs/user-guide/wifi-connection.md`.

## Hardware checklist

Reinstall the runtime first (3.0.0 adds `board_settings.py` and `net_transport.py`).

1. **ESP32 over USB:** Board settings… → name `bench`, password. Console: `BOARD_SETTINGS saved`, then `[wifi]
   bench has a password set`. Reset, reconnect: name and password survive.
2. **Flow with `wifi_status`:** deploy; the board prints `NET_LISTENING <ip>:7462 (bench.local)`.
3. **Discovery:** ⟳ ports lists `bench (<ip>) -- WiFi`. If not, check the Mac firewall allows UDP 7463 replies.
4. **Connect over WiFi:** saved password connects silently; Deploy, Check status, inject clicks, the command box.
5. **`os.dupterm` mirror (untested off-device):** a `debug` node's output and EXEC results must appear in the
   console over WiFi, not just `[HELLO]`-type frames. If only frames arrive, dupterm didn't attach -- check the
   board's serial log for it.
6. **`.local`:** "WiFi address…" → `bench` resolves via mDNS from the Mac.
7. **Faults:** wrong password (re-asks), second editor (busy), clear the password over USB (session ends, port
   closes), pull the board's power while connected (editor shows disconnected), WiFi AP off (session drops within
   ~90 s at worst; the backend's keepalive notices sooner).
8. **Pico W:** repeat 1-4; `network.hostname()` needs rp2 firmware v1.25+ for `.local` to work.
9. **Plain Pico:** no Board settings button, no WiFi entries for it.

## Known gaps

- Network scan (Mike: nice to have) not built. `wifi_provision._scan_networks` could back it.
- The captive portal's AP password still can't be set (`set_ap_password` has no caller); Board settings is the
  natural home.
- Mid-session WiFi output that exceeds 16 KB before the client reads it is dropped with a `NET_WARN` line.
- One vitest failure appeared once in a full run and didn't reproduce in three reruns; which test is unknown.
- The two `node-startup.test.ts` failures are fixed (they were stale expectations, not a startup-node change).

## Hardware results, 2026-09-25 (ESP32-C3, Mike's Mac)

- Steps 1-5 pass: Board settings over USB, `NET_LISTENING`, WiFi connect with the saved password, deploy over WiFi,
  and the `debug` node's print() output arriving over the session (the `os.dupterm` mirror, untestable off-device).
- Found and fixed on the way: repeated Install clicks racing on one port (one job per port now); credentials not
  fetched when picked from a dropdown, so no `connect()` was generated (fetched on pick and at Deploy; no SSID is now a
  compile error).
- macOS 15 Local Network privacy blocked the backend's Homebrew Python when started from iTerm ("No route to host")
  even with iTerm allowed; Apple's Terminal works (TN3179 exempts it). Docs and the error message say so; packaging
  (item 7) must ship a signed app with `NSLocalNetworkUsageDescription`.
- Not yet checked: steps 6-9 (`.local` entry, fault cases, Pico W, plain Pico).
- Later the same day: discovery found one of two boards. `discover()` now resends the probe every 0.4 s within
  its 1.5 s window. The real cause turned out to be the port menu: its "(no board found)" placeholder was set before
  discovery and stayed selected when two WiFi boards were found (fixed; a 15 s test scan showed both boards
  answering within 0.3 s). Connecting to a
  board with no password now says so and points at Board settings (`refused` code for ECONNREFUSED; the editor
  also uses the probe's `wifiTransport` flag). Plain Pico showing WiFi entries: deferred, in outstanding-items.
- Step 6 passes on both boards (ESP32-C3, Pico W): `<name>.local` resolves, and a rename takes effect after a
  power cycle. The Mac's mDNS cache hid the rename at first (`sudo killall -HUP mDNSResponder` cleared it).
- Slow pings (2-324 ms, ~33% loss) turned out to be the ESP32-C3, not the Pico W: the board renamed `picow-1`
  was the ESP32-C3 (Board settings applies to whichever board is on USB). The Pico W (`ts-3c0c31`, running the
  `wifistatus` test flow with mqtt nodes, RSSI -58) pings at 2-25 ms with no loss. The ESP32's pattern looks like
  its default WiFi modem sleep; not yet confirmed with `pm=PM_NONE`.
- ESP32-C3 + MQTT (afternoon): a first WiFi join from an MQTT flow failed (1001 for 15 s, then 202) until the
  runtime was installed precompiled -- memory, see `learnings/micropython-device-runtime.md`. Along the way: WiFi
  config became a singleton, `mqtt_as` gained two local patches (runtime 5.0.0), the ESP32 first join moved to flow
  start, and MQTT connect errors name every attempt's WiFi status and the broker's refusal reason. The `NET_INFO
  mqtt:` lines are experiment diagnostics -- keep or quieten. Lazy runtime imports are now [P2] in outstanding-items.
- Still not checked: steps 7-9 (fault cases, Pico W WiFi transport, plain Pico), and the Pico W / RP2 regression
  check after today's `mqtt_as` and codegen changes.
