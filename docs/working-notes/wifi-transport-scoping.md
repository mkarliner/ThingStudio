# WiFi transport (MVP item 6) — scoping

Status: decision, 2026-09-24. Mike agreed the shape, the three calls below, and the board-level hostname.

## Mike's direction, 2026-09-24

- **No-WiFi boards:** serial only when the board definition says the board has no radio (plain Pico, Pico 2).
  If there's no board definition for it, offer WiFi anyway.
- **WiFi setup:** through the flow's own `wifi_status` node, as today. A network scan would be nice.
- **Finding a board:** mDNS would be nice, manual IP as the fallback.
- **Auth:** password auth for deploy etc. There is currently no way to set the password.

## Shape

The backend stays in the middle. Today: editor ⇄ WebSocket ⇄ backend ⇄ serial ⇄ listener, with the listener
speaking base64 `F64:` lines on stdin/stdout. WiFi adds a TCP link from backend to listener carrying the same
`F64:` lines, so `line_framing.py`, `ws_relay.py`'s WS side and the whole editor protocol stack are reused.
The editor's connect UI gains a "network" choice next to serial ports.

## Pieces

1. **Listener TCP server.** Once the station interface is up (brought up by the flow's `wifi_status`, or the
   captive portal), the listener opens a TCP server on a fixed port. The listener never connects WiFi itself:
   the flow stays the single WiFi owner (`outstanding-items/wifi-single-owner-fix.md`). Consequence, to document:
   a board is reachable over WiFi only while a flow with `wifi_status` runs (including after a reset, since the
   saved flow resumes). One client at a time; serial and WiFi input feed the same dispatch loop.
2. **Board settings: password and hostname.** Set from the editor over USB serial (physical access is the trust
   anchor), in one board settings panel. Stored on the board in one file that survives deploys; the password as
   salt + SHA-256 derived key, never plain. Hostname defaults to `ts-` plus the chip ID's last digits. It is a
   board setting, not a `wifi_status` property, so the same flow on two boards doesn't give two boards one name.
   `wifi_status` (and the captive portal) call `network.hostname()` with it just before connecting. A per-flow
   override can be added later as an optional `wifi_status` property. `HELLO` gains `authRequired`/`authScheme`
   (the long-reserved one-way-door fields, `outstanding-items/board-transport-auth.md`).
3. **Session auth over WiFi.** On TCP connect the board sends a random nonce (`os.urandom`; the radio is up, so
   the ESP32 RNG is a true RNG here, which removes the 2026-08-16 reason for a counter). The backend answers
   HMAC-SHA256(key, nonce). Nothing else is accepted on that connection until it verifies. The password lives in
   the backend's existing credential store, one entry per board. No TLS: a LAN attacker who can hijack a live
   TCP session is out of scope for v1, as `transport-auth-design.md` already accepts.
4. **Discovery.** `name.local` works on stock MicroPython (ESP32; rp2 from v1.25) once `network.hostname()` is
   set, so hostname entry plus manual IP needs no new dependency. A *list* of boards needs a service advert,
   which stock MicroPython can't do (`micropython-mdns` needs custom firmware with the built-in responder off).
   So the list comes from a small ThingStudio UDP probe instead: the backend broadcasts, listeners reply with
   hostname, board and flow name.
5. **Board definitions.** Processor/board files get a `wifi` flag. `false` hides the network option; missing
   means offer it.
6. **Network scan (nice to have, last).** A listener command over USB that returns `WLAN.scan()` results, used
   by the WiFi config's SSID field as a pick list.

## Calls (agreed 2026-09-24)

- **Call 1: serial needs no password.** Serial is how the password is set, and it needs physical access.
  (Design doc §9 says board auth applies to both modes; this narrows it for v1.)
- **Call 2: WiFi transport stays off until a password is set.** The listener opens no TCP port on a board with
  no password, so no board is ever open on the LAN unauthenticated by default.
- **Call 3: the browse list is our own UDP probe, not mDNS.** `.local` names still resolve by mDNS.

## Version bump

Listener protocol changes (new `HELLO` fields, auth handshake, set-password, scan) are breaking by `CLAUDE.md`'s
rule: bump `_RUNTIME_VERSION` and `EDITOR_TARGET_VERSION` major together.

## Build order

Board definition flag → `HELLO` auth fields + set-password over USB → listener TCP server + session auth →
backend TCP connection + editor network connect → hostname/IP entry → UDP probe list → user docs → network scan.
Each step is testable off-device (MicroPython unix port for the listener, pytest for the backend) before the
hardware pass.

Sources: [MicroPython discussion #10932 (rp2 mDNS)](https://github.com/orgs/micropython/discussions/10932),
[cbrand/micropython-mdns](https://github.com/cbrand/micropython-mdns).

## Built, 2026-09-24

- Device: `board_settings.py` (hostname, salted key, HMAC, challenge/verify), `net_transport.py` (TCP server,
  session auth, `os.dupterm` output mirror, UDP probe responder), `listener.py` wiring (`SET_BOARD_SETTINGS`, new
  `HELLO` fields, per-source dispatch with a lock, network sessions through the same line loop). Runtime 3.0.0.
  Hostname applied by the listener at boot, before the portal or saved flow starts WiFi, rather than in
  `wifi_status` codegen -- same effect, no codegen change.
- Backend: `tcp_relay.py` (`TcpConnection` drop-in for `SerialConnection`, `discover()`), `ws_relay.py` connect-by-
  host and `discover`, `board` credential type looked up by the hostname in the board's challenge.
- Editor: WiFi group in the port menu (discovered boards, "WiFi address…"), password prompt when none is saved or
  it's wrong, **Board settings…** (USB only), `wifi` flag on board definitions, `network-choice.ts`.
- Verified off-device: MicroPython unix-port suites incl. 4 new listener integration tests over real TCP; backend
  pytest incl. `test_tcp_relay.py`; backend `TcpConnection` against the real listener; the built editor in headless
  Chromium against the real backend and listener (over a pty for USB): settings, discovery, WiFi connect, password
  prompt, wrong-password retry.
- Not verified: real hardware. In particular the `os.dupterm` mirror (not in the unix port), mDNS `.local`
  resolution, broadcast discovery on a real LAN, and `network.hostname()` timing on ESP32 vs rp2.

