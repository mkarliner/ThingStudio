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
- 2026-09-25: HELLO and DEPLOY_ACK carry `freeIdfHeapBytes` and `largestIdfHeapBlockBytes` (optional, ESP32
  family only, from `esp32.idf_heap_info(esp32.HEAP_DATA)`). The WiFi stack allocates from ESP-IDF's heap, not
  MicroPython's, which is why the C3's failed join looked like plenty of RAM free. The editor prints a
  `[memory]` line after each HELLO and deploy, since those echoes are verbose-only. Runtime 5.1.0 (minor: both
  fields are optional on the wire, and absent means "not reported").
- **2026-09-27 — Discovery probes every interface's directed broadcast, 255.255.255.255 only as fallback.**
  On macOS the limited broadcast failed ("No route to host") where the subnet broadcast worked, and it only
  leaves by one interface. Addresses from `getifaddrs` via ctypes (`net_interfaces.py`, no new dependency;
  Windows falls back). A scan that couldn't send anywhere now tells the editor why (`problem` in the `boards`
  message, shown in the console). `learnings/backend-security-research.md`, 2026-09-27.
- 2026-10-08 (runtime 9.1.0): the transport's watcher only looks at the station when WiFi is wanted -- a board
  password is set, or the running flow imports `network` (every network node's code does). If the WiFi driver
  fails to start it prints one `NET_WARN` and backs off 60 s. Before, it created `network.WLAN(STA_IF)` every 2 s
  on every board, which on an ESP32 starts the WiFi driver: a GUI flow with no networking on a CYD ran out of
  ESP-IDF memory and ESP-IDF logged errors every 2 s. Minor bump: nothing generated depends on it.
  `device-runtime/test/test_net_watch.py`.
