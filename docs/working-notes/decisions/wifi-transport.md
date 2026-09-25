# Decisions — WiFi transport (MVP item 6)

- **2026-09-24 — Shape agreed with Mike.** Backend stays in the middle: a TCP link backend⇄listener carrying the
  same `F64:` lines as serial. The flow's `wifi_status` stays the only WiFi owner; the listener opens its TCP
  port once the station is up. Boards whose definition says no radio are serial-only; no definition means offer
  WiFi. `wifi-transport-scoping.md`.
- **2026-09-24 — Password auth; serial exempt; WiFi off until a password is set.** Password and hostname are
  board settings set over USB. WiFi sessions start with a nonce/HMAC-SHA256 challenge (the radio is up, so the
  RNG is real, replacing the 2026-08-16 counter scheme for this path). Narrows design doc §9 for v1: serial
  needs no password. Same note.
- **2026-09-24 — Hostname is a board setting, not a `wifi_status` property.** A flow property would give every
  board running that flow the same `.local` name. Applied by `wifi_status`/captive portal before connect.
- **2026-09-24 — Board list from a ThingStudio UDP probe, not mDNS browse.** Stock MicroPython answers
  `name.local` lookups but can't advertise a service. Same note.
- **2026-09-24 — Hostname applied by the listener at boot, not by `wifi_status` codegen.** `network.hostname()` is
  global and only needs to run before the station connects; the listener does it before the captive portal and
  the saved flow start. Same result as the agreed "wifi_status applies it", with no codegen change.
- **2026-09-24 — Runtime 3.0.0.** No codegen changed, but the editor's WiFi and Board settings features need the
  3.0 listener; a major bump makes an old board say "install the runtime" rather than silently lack them.
- 2026-09-25: the backend turns on TCP keepalive (5 s idle, 3 s x 3 probes) and a 20 s cap on unacknowledged
  retransmits (`TCP_RXT_CONNDROPTIME` on macOS, `TCP_USER_TIMEOUT` on Linux) for every WiFi session
  (`tcp_relay.enable_dead_peer_detection()`). A board that lost power never closed its end, so the editor never
  showed it disconnected. Backend-only: the board's lwIP answers keepalive probes itself, no runtime change.
