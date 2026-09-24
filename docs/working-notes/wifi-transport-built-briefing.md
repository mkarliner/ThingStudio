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
