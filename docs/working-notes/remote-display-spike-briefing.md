# Remote display spike — briefing

Status: handoff, 2026-11-06. For a new session. Written at the end of the session that settled the open questions
(`remote-display-principles-briefing.md`). Nothing is built yet beyond the hooks in the scoping note's "What exists".

## Read first

1. `remote-display-scoping.md` in full: principles P1/P2, positions, design, and "Where the questions stand".
2. `decisions/remote-display.md` (5 entries) — the decided rules. Do not re-open them in the spike.
3. `docs/security-policy.md` "Check this first": this spike adds a WebSocket route, a new auth client and input that
   drives hardware (§3.1, §3.3, §3.4).
4. `device-runtime/src/vendor/thingstudio_gui/gui.py` (`RemoteSurface`, `on_value`, controlled buttons),
   `device-runtime/src/vendor/thingstudio_http/ts_http_server.py` (~107 lines), `device-runtime/src/device_settings.py`,
   `editor/src/gui/layout.ts` (the flexbox subset), `board_settings.py` (`TSAUTH1`).

Background, not required: the 2015 ThingStudio (`~/Src/ThingStudio2015`, archive
`~/Src/ThingStudioArchive/2019/ThingStudio/private/docs`) — scoping note, "Lineage".

## What kind of session this is

A spike: prove or kill the risky parts end to end on real boards and real phones, measure, and report. Not the
production build and not editor work. Board-side code that is clearly keepable (the WebSocket upgrade) may be
written to production standard on a branch; everything else may be rough. If results argue for changing a decided
rule, stop and say so to Mike rather than working round it.

## The question the spike answers

Can a board with no display serve a phone a usable, authenticated, live GUI with input, built from the `screens`
tree, within the memory of a Pico W and an ESP32-C3 — and is it small enough to be an MVP item? Mike makes the
MVP/post-MVP call on the results.

## Constraints (from decisions; not negotiable in the spike)

- **No new dependencies** (security policy rules). WebSocket handshake/framing written in-house in `ts_http_server`
  (microdot may be read as a reference, not copied wholesale); the page's HMAC-SHA256 hand-written, tested against
  RFC 4231 vectors; no npm packages for the page.
- **The web server is a general facility** (Mike, 2026-11-06): the remote display mounts under its own path prefix
  (e.g. `/ts/remote/`), leaving `/` to the flow; WebSocket upgrade is a server capability usable by any route; auth
  is per route; take-over applies only to the remote display's socket. Show this with one other route on the same
  server (an `http_in` or a static page) working alongside.
- **Transport-neutral messages (P2):** design the page↔board messages so WebSocket is one binding; keep frames small
  (assume a BLE-sized MTU of a few hundred bytes is the eventual floor) and the screen definition sendable in pieces.
- **Screen-size agnostic:** flexbox on the real viewport, vertical scroll when taller. No nominal-size check.
- **Widget faces are data (P1):** the spike's page renders the existing built-in widget kinds from core code only.
  No JS-face mechanism; unknown kinds render as a labelled placeholder with the raw value.

## Checkpoints

Each has a pass condition; record measurements in the results note as you go.

1. **WebSocket on the board.** Upgrade path in `ts_http_server`: handshake (`hashlib.sha1` + `binascii`), masked
   client frames, text/binary, ping/pong, close, fragmentation at least rejected cleanly. Unix-port tests beside
   `test_*.py`. Pass: echo and a 1 kHz-ish message burst survive on classic ESP32, ESP32-C3 and Pico W; record free
   heap before/after and with the flow running. Check `hashlib.sha1` exists on each target build.
2. **Live display.** A hand-written flow (codegen and the editor config node are out of scope) with a
   `RemoteSurface` bound to the WebSocket. The page receives the screen definition, builds Row/Column as flex
   containers with the same gap/padding/grow/align/justify as `layout.ts`, and applies `screen`/`values` messages.
   Unknown/stale/pending/error keep their visual language. Pass: values update; board-owned navigation and modals
   work; latency board→page measured on LAN.
3. **Login.** `TSAUTH1` from the page over plain HTTP (no `crypto.subtle`), with the board's transport password.
   Pass: wrong password refused, fail closed; works on Android Chrome and iOS Safari.
4. **Input.** Taps on momentary/toggle/navigate buttons arrive as the same events a touch produces; controlled
   toggles go unknown → pending → confirmed/revert across the network. New widgets for the spike: number field and
   text field, writing through `runtime.settings`; a settings form submits as one message. Page→board input frames
   carry an HMAC and counter keyed from the session (item 10); a replayed or altered frame is rejected.
   Pass: a threshold set on the phone survives a reboot.
5. **Link loss and take-over.** Heartbeat: the board declares the link lost after N missed pings (item 11); for
   continuous input (a drag or slider driving an LED's PWM or a servo), a deadman timeout drives the output safe
   without fresh input. A second phone takes over; the first is told why. Pass: measured time from phone leaving
   WiFi (walk away / airplane mode) to `safe` firing; nothing locks the owner out.
6. **Routes.** LAN (station) and the board's own AP, same page. ESP32: STA+AP at once. **Pico W: STA+AP at once**,
   and the known rp2 issues (AP DNS overwritten after STA connects; AP DHCP fixed at 192.168.4.x). Captive-portal DNS
   on the AP (item 13): does the phone open the page on joining? Note "no internet" behaviour on Android and iOS.
7. **Delivery and budget.** Page assets served gzipped as-is (`Content-Encoding: gzip`, item 12), cached, versioned.
   Pass: record asset size (raw/gz), flash used, peak RAM during first load, time to first paint, on Pico W and C3.
8. **Discovery.** Print the URL on the console (the editor's URL + QR display is production work; note that a QR
   code needs either a dependency or an in-house encoder — ask Mike before choosing). Test `<hostname>.local` from
   MicroPython's mDNS responder on current Android and iOS (Android needs RFC 6762 legacy unicast answers).
9. **Spec draft.** Write `interfaces/remote-display/SPEC.md` (status draft) from what the spike actually sent:
   messages each way, login, version negotiation, link status, the WebSocket binding as one section. Mike has given
   permission for this spec; keep it to what was proven.

Stretch, only if 1-8 are done: the **second screen** use case (a CYD or OLED board showing one page physically while
the phone shows another).

## Kill or rethink signals

Stop and report to Mike if any of these hold: the Pico W cannot run WebSocket + page serving + a small flow with
headroom; input latency on LAN is too high for a joystick-style control (aim: tap-to-board well under 100 ms,
continuous input at ~20 Hz); link-loss detection cannot be made reliable in a few seconds; `TSAUTH1` in pure JS is
impractical on iOS Safari.

## Hardware

Classic ESP32 (or a CYD), ESP32-C3, Pico W; ESP32-C5 if convenient. An Android phone and an iPhone (ask Mike which
models and OS versions, and record them). One LED or servo for the failsafe checkpoint.

## Output

- `remote-display-spike-results.md`: per checkpoint, pass/fail and measurements (a table of heap, flash, sizes,
  latencies per board), surprises, and a recommendation: MVP or post-MVP, and what the production build needs.
- Update the scoping note's "Where the questions stand" (items 3, 4, 10-13 resolved one way or the other).
- New learnings in `learnings/`; anything Mike decides, in `decisions/remote-display.md` the same day.
- Before any production merge: the security policy gains the phone page as a zone and code source, and the
  remote-display row in "Check this first".
- A topic-named handoff briefing and its line in `BRIEFINGS.md` (`AGENTS.md`, handoff rules).

## Environment

- Device-runtime tests: headless MicroPython unix port, `$MICROPYTHON test_<name>.py`, built per
  `device-runtime/test/README.md` (same commit for `mpy-cross` and `micropython`).
- Editor: `npm test`, `./node_modules/.bin/tsc --noEmit` in `editor/` (`editor/AGENTS.md`).
- Pushing the runtime to a board: `test-flows/deploy_runtime.py`; existing flows in `test-flows/` (e.g.
  `basic-http-in.flow.json`) are a starting point for the hand-written flow.
- Firmware images: `firmware/targets/{classic-esp32,esp32-c3,esp32-c5}/`; builds run on Mike's Mac (ESP-IDF).
- The writing session had no hardware access and ran none of these; confirm each before relying on it.
