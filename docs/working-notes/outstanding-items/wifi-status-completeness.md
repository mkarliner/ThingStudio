# `wifi_status` node should emit complete WiFi status (IP, network info, RSSI)

Mike's ask, from `mikes-questions-and-points.md`'s "Bugs -- priority" section (his own commit `49faf43`): "wifi
status node should emit complete wifi status include ip address."

The IP is already there -- `wifi-status.ts`'s `buildMsg` already computes `_wifi_ip = _wifi_sta.ifconfig()[0]` and
includes it in the emitted envelope (`msg = {'payload': _wifi_connected, 'topic': '', 'ip': _wifi_ip}`), and has
since the emit-on-change work landed (`wifi-status-emit-on-change.md`). So "complete" means more than what's
already emitted, or the existing `ip` field just isn't visible anywhere in the UI today.

**Scope confirmed 2026-09-09 (Mike, all three):**
1. Check what the property panel / debug console actually surface today -- the envelope already carries `ip`, so
   part of this may be a UI-visibility gap rather than a codegen gap.
2. Add the rest of `ifconfig()`'s 4-tuple (subnet, gateway, dns) to the emitted envelope -- portable across
   MicroPython ports.
3. Add RSSI, via `_wifi_sta.status('rssi')` -- **ESP32-only, not a portable MicroPython API across boards.** Per
   `CLAUDE.md`'s whack-a-mole/board-idiosyncrasy corollary: implement where it's available, document plainly (in
   the node's own header comment, not just docs) where it isn't, rather than chasing portability across boards.

Tagged **P1**, build before the connection-status-indicator work.
