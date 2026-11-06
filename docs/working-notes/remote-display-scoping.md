# Remote displays — scoping (provisional)

**Status: provisional.** Written 2026-11-05 from a brainstorm with Mike; design principles and lineage added
2026-11-06. The two design principles are decided (`decisions/remote-display.md`); nothing else is: the positions
below are where the brainstorm ended, and Mike makes the final decisions in a separate session. Until then, nothing
in this note supersedes `gui-layout-widget-system-scoping.md` ("Remote views (2026-10-08)", which leaned
MQTT-first, multi-viewer and read-only to begin with). Nothing is built beyond the hooks listed under "What exists".

## Why this is worth doing

- **Memory-constrained boards get a good UI.** The board holds no framebuffer, fonts or display driver; the phone
  does the layout and drawing. The GUI's hardest problems so far (a 320x240 gs4 frame is 38.4 KB; the CYD couldn't
  allocate it because of fragmentation; fonts loaded from `.mpy` stay in RAM; banded rendering exists to work round
  it) don't arise. A Pico W or ESP32-C3 with no display can have a richer UI than a CYD.
- **Nearly everyone carries a phone.** It's a display, a keyboard and precise touch that the user already owns. No
  display hardware to buy, wire or choose a driver for.
- **Boards with no input at all can be configured**: no buttons, no keyboard, no display.
- **A UI format that an AI writes and a person audits.** A remote display is an entry in the `screens` tree,
  checked by the same compiler as the flow, so the checks between the UI and the flow are free (a widget bound
  to a value nothing produces, a type mismatch, a widget unsuited to the display). This is the "common ground"
  argument of Mike's post *Making Common Ground for Humans and LLM's*
  (https://blog.karliner.net/posts/thingstudio-common-ground/) applied to UIs, and it is what the 2015 ThingStudio
  was missing: a small vocabulary of parts, but no checker (see "Lineage", below).

## Provisional positions (Mike, 2026-11-05)

1. **A remote display is a display.** It behaves like a physical one: one view, navigation owned by the board,
   one connection at a time. Many simultaneous viewers, web-app style, is left to other tools (MQTT, Home
   Assistant, Node-RED Dashboard).
2. **Four use cases define it:** tricorder, headless settings, remote control with failsafe, second screen
   (below). First-run WiFi setup and data-logger download are designed alongside, not built.
3. **The board serves the page.** Reached over the home WiFi (LAN) or, in the field, the board's own access point.
   Same page, same server, either route.
4. **Rendering is HTML**, driven by the same `screens` tree, laid out by CSS flexbox with the phone's own fonts.
   Not a pixel mirror.
5. **Transport: WebSocket** (Mike's preference; bidirectional suits input).
6. **The page↔board messages become an interface spec under `interfaces/`.** Mike's permission given. Principle:
   as open as possible; developers can extend the system without touching the core.
7. **Alerts are out of scope**: a notification node (e.g. Pushover) handles them.
8. **Possibly an MVP item**, expected to be modest in size, but behind the current focus (tester readiness,
   onboarding, outreach).

## Design principles (Mike, 2026-11-06)

These sit above the provisional positions: a position that conflicts with one of them changes, not the principle.

### P1. Everything is a plugin, and contributing must not open a supply-chain hole

The project-wide rule (`builtins-as-packages-scoping.md`: extend without changing the core; `docs/security-policy.md`
§2, supply chain is **Defend**) applies here unchanged. Mike wants a community that finds contributing easy, in this
project and in its 2015 predecessor's spirit, without making each contribution a way in. For remote displays:

- **A remote widget's face is a new place package code runs**: on the user's phone, inside a page that holds an
  authenticated session able to drive hardware. That is a new zone and code source in the security policy (§1, §3.4),
  added in the same change that builds it.
- **Prefer data to code.** Most widget faces should be declarative (a descriptor composing core-rendered
  primitives: text, SVG shapes, bindings to the widget's values and events), so the common case ships no JS at all
  and is reviewable at a glance, by a human or an AI. A JS face is the exception and is marked as such.
- **A JS face gets the narrowest interface the core can give it**: it receives its own widget's values and may emit
  its own widget's declared events, nothing else. No access to the socket, the session key, other widgets or the
  network (e.g. a sandboxed iframe or worker with a message-only API, and a CSP on the page). A malicious face can
  then at worst misdraw itself or send events the flow already accepts from that widget.
- **Unknown or refused widgets degrade**, as already planned: a labelled placeholder with the raw value.
- Package distribution, signing and any registry stay under the existing deferred marketplace decision; nothing here
  pre-empts it.

### P2. The hosted page is the first client, not the only one

v1 is the board-served web page over WebSocket. Nothing in the design may assume it is the only client, so that a
native app (Capacitor or otherwise), a **Bluetooth LE** transport, or a later many-viewer renderer can be added
without redesign. Concretely:

- **The interface spec is transport-neutral.** Messages, login (`TSAUTH1`), version negotiation and link-status
  semantics are defined independently of HTTP/WebSocket; the WebSocket binding is one section, BLE another later.
  No reliance on browser origin, cookies or URL paths for meaning.
- **Messages stay small and chunkable**: BLE MTUs are tens to a few hundred bytes. Values deltas are already small;
  the screen definition and assets must be fetchable in pieces.
- **Assets are versioned and content-addressed** (hash per renderer and widget face), so a native app can bundle the
  core renderer and fetch or cache only what a flow adds, over whatever transport it has.
- **Renderer in shared TS**, the same code in the board-served page and a native wrapper.
- **Capabilities a browser lacks** (DNS-SD discovery, BLE on iOS, phone sensors as flow inputs) are features of a
  client, advertised in version negotiation, never assumed by the board.

## Use cases, and what each tests

| Use case | What it looks like | What it tests |
|---|---|---|
| **Tricorder** | Displayless sensor board (temperature, distance, radar presence) as a phone add-on | Live values; direct link with no router; portability |
| **Headless settings** | Change thresholds, names, intervals on a board with no buttons | Text and number entry; settings that survive reboot; short occasional sessions |
| **Remote control with failsafe** | Robot, camera slider, pan-tilt | Continuous input (drag, joystick); latency; outputs go safe when the link drops |
| **Second screen** | A 128x64 OLED shows essentials; the phone shows detail, history, settings | A physical and a remote display at once, different pages and layouts |

Designed alongside, not built: **first-run setup** (must work before the flow's networking; probably belongs to the
runtime's provisioning AP, `computeWifiProvisionMarker`, not to flows) and **field data-logger download** (bulk
transfer, not live values). Boundary cases, explicitly not this: alerts with nobody looking; many viewers.

## What exists

- `gui.py` `RemoteSurface`: a surface with its own page tree and navigation that sends
  `{"type": "screen", ...}` on page/modal change and `{"type": "values", ...}` for dirty widgets. Tests in
  `test_gui.py`. The `on_value` feed (every change, on screen or not) also exists.
- Controlled widgets: unknown → pending → confirmed, or revert on timeout. What network latency needs.
- `TSAUTH1` session auth (random-nonce HMAC-SHA256) on the WiFi transport.
- `http_in` / `ts_http_server.py` (~100 lines, no WebSocket upgrade).
- Layout engine in TypeScript (`editor/src/gui/layout.ts`): row/column/gap/padding/grow/align/justify, a strict
  subset of CSS flexbox.
- Backend UDP broadcast discovery of boards.
- A provisioning access point for first boot.

## Design (provisional)

### Network routes

- **LAN:** board in station mode; the phone opens the board's address.
- **Access point:** the board runs its own network, at a fixed address. The ESP32 can be station and AP at once,
  so "fall back to AP when the home network is missing" is possible. **Pico W: verify** STA+AP at once.
- Phones complain about "no internet" on the board's AP and some fall back to mobile data. Document it; it's the
  same for every device of this kind.

### Security

- On the AP, proximity plus the AP's WPA2 password is the control. On the LAN it isn't: anyone on the network can
  reach the board, and with take-over semantics could kick the current viewer off. So the page logs in on both
  routes, with the board's existing transport password.
- **Browsers only expose `crypto.subtle` in secure contexts** (https, localhost). A page served over plain HTTP from
  a LAN address doesn't get it, so the page ships a small pure-JS HMAC-SHA256 for the `TSAUTH1` handshake.
- After login, frames carry no per-frame integrity, the same known gap as the editor's WiFi session (threat
  model §3.3). Input drives hardware, so this is a new boundary for the threat model.
- A remote display that accepts input is remote control of hardware: a per-display property says whether it may.

### Discovery

Browsers can't discover anything: no mDNS browsing, no UDP. The WLED apps (Android, iOS) are native largely for
this; they browse mDNS for `_wled._tcp`. Options for v1, cheapest first:

1. **The editor tells you.** After deploy, the editor (which already finds boards by UDP broadcast) shows the
   remote display's URL and a QR code.
2. **A name:** `http://<hostname>.local`. `HELLO` already carries a hostname. Android `.local` resolution has been
   patchy; verify on current Android before relying on it.
3. **AP route:** fixed address, printable on the board's label or shown in the editor.
4. **Later, with a native app:** the board advertises a DNS-SD service (e.g. `_thingstudio._tcp`) and the app
   browses for it, as WLED does. Mike has another discovery mechanism in mind (to record here).

### Transport: WebSocket

- The page connects to `ws://<board>/...` on the origin it was loaded from, so there are no mixed-content or
  local-network permission issues in any browser.
- `ts_http_server.py` needs a WebSocket upgrade path (handshake, framing, ping). Candidate source to borrow from:
  microdot (MIT, MicroPython, has WebSocket support). Check fit before vendoring.
- **One connection per remote display; a new one takes over** (the old one is closed with a reason the page
  shows), rather than being refused: a phone that silently dropped off must not lock its owner out.
- Message rate: board → page reuses `RemoteSurface`'s coalescing (dirty set, `min_interval_ms`). Page → board
  continuous input (joystick, drag) is rate-limited on the page and coalesced on the board: latest value wins.

### Rendering: HTML from the `screens` tree

- A remote display is an entry in `screens` like any other, of a new display kind (e.g. `remote`), bound to the
  board's web server rather than a display node.
- The page receives the screen definition (page tree, widget kinds, placement properties) and builds the DOM: Row
  and Column become flex containers with the same gap/padding/grow/align/justify.
- Overflow is checked at compile time against a **nominal** phone size (e.g. 360x640 CSS px, portrait); CSS handles
  the real size at runtime. Not exact, by design.
- Unknown/stale/pending/error keep their visual language (shape and pattern, not colour alone).
- Navigation and modals stay board-owned (`RemoteSurface`), so the page shows whatever page the board says. Page
  dots and back/next are taps sent as navigator commands.
- The page and its JS are flow dependencies, sent gzipped, cached by the browser and versioned with the flow
  (flash cost on a Pico W to measure).
- The pixel-mirror renderer still has a job: the editor's preview of physical displays. Separate work.

### Input

- In v1, because headless settings and remote control are mostly input.
- A phone has precise touch and a keyboard, so the "panel, not form" rule (resistive touch, no keyboard) doesn't
  apply to remote displays. New widgets: **text field, number field, select**. Widgets get a capability tag (any
  display / keyboard and fine touch); the compiler checks placement.
- Existing buttons (momentary, toggle, navigate) work as they are: a tap on the page becomes the same event a
  physical touch produces.
- **Link loss is a declared policy per remote display:** `stale` (default: show values as stale, nothing else),
  `safe` (fire a link-lost event the flow wires to its outputs, e.g. stop motors). Settings forms never
  half-apply: a form submits as one message.

### Settings that survive reboot

Mike: there is already a "settings" context mechanism. **To locate and link.** The remote display only needs to
read and write it like any other value; persistence is the flow's job, not the GUI's.

### Extensibility

The interface spec (`interfaces/remote-display/`, name TBD) covers: the screen definition sent to the page; board →
page messages (`screen`, `values`, take-over, link status); page → board messages (login, events, navigator
commands); version negotiation. Conformance vectors, as for the wire protocol.

Custom widgets (post-MVP, high priority: `.widget.json` + `.widget.py`) gain a remote face, so a developer can add
a remote widget without touching the core. Per P1 the face is **declarative data by default** (composed from
core-rendered primitives); a JS module is the marked exception and runs confined to its own widget's values and
events. Unknown or refused widget kinds render as a labelled placeholder showing the raw value, never a blank.

## Later, not v1

- **Native app** (Capacitor wrapping the same TS client): DNS-SD discovery, BLE transport (the best tricorder on
  iPhone: Safari has no Web Bluetooth), QR pairing with the password in the keychain.
- **Web Bluetooth** route for Android/desktop Chrome, from a page hosted on the ThingStudio site.
- **Phone as an input sensor** (from 2015 ThingStudio's `DeviceOrientation` widget): GPS, compass, orientation into
  the flow, e.g. a presence reading logged with location.

## For the decision session

Confirm or change each provisional position above, then settle:

1. Which discovery mechanism Mike has in mind; record it here.
2. Where the settings context mechanism is; link it.
3. Pico W: STA+AP at once? Flash budget for the page assets?
4. Android `.local` resolution today.
5. WebSocket server: extend `ts_http_server` ourselves or borrow from microdot.
6. Interface spec name and first draft.
7. Nominal phone size(s) for the compile-time overflow check.
8. Is the web server implicit in a remote display, or an explicit node or config the remote display references
   (like a touch panel config)?
9. MVP or post-MVP.

Raised in the 2026-11-06 review session (Claude, with Mike), not yet agreed:

10. **Integrity on page→board input frames in v1** (HMAC with a counter, keyed from the `TSAUTH1` session), since
    input drives hardware. Board→page frames can stay as the editor session is.
11. **Link loss by heartbeat, not socket close.** The board declares the link lost after N missed pings; a phone
    leaving WiFi is often never seen as a close. For continuous input, a separate deadman timeout: no fresh
    input within X ms means safe, even with the link up.
12. **Serve page assets gzipped as-is** (`Content-Encoding: gzip`): no decompression on the board.
13. **Captive-portal DNS on the AP route**: answering every name with the board's address makes most phones open
    the page on joining, and reduces the fall-back-to-mobile-data problem.
14. **Nominal sizes:** portrait and landscape (remote control is mostly landscape), not one size.
15. **Keep the screen definition transport-neutral** (P2), so a later many-viewer renderer over MQTT could reuse
    it: the 2015 ThingStudio's multi-viewer strength, without making it v1.

## Corrections from the brainstorm

- "Nobody has TLS on a home Mosquitto" was wrong: Home Assistant's Mosquitto add-on supports TLS, with Let's Encrypt
  certificates. TLS is off by default, and browsers need a publicly trusted certificate.
- Chrome (142+, WebSockets from 147) lets an https page reach LAN devices after a Local Network Access prompt,
  exempt from mixed-content blocking. Safari and Firefox not checked. Moot while the board serves its own page.

## Lineage: the 2015 ThingStudio

Remote displays are the second time Mike has built "a UI for a device". The first, also called ThingStudio, ran
2015-2019 (thingstud.io; Mike Karliner and Paul Grieselhuber):

- **Material.** `~/Src/ThingStudio2015` holds the 2015-2016 documents: `WhitePaper1.doc` (privacy vs security,
  the "remote control problem"), `Thingstudio Presentations/` (`MeteorJune.pdf`, `TS-0.2.0.pdf`,
  `March2016IntroKey.pdf`), screencasts and MongoDB backups. The later code and docs are archived in
  `~/Src/ThingStudioArchive/2019/ThingStudio/private/docs`.
- **What it was.** A cloud-hosted Meteor IDE and viewer; MQTT over WebSockets from the browser to the user's own
  broker, so no device data passed through ThingStudio's servers; screens written as HTML/handlebars templates
  with a few helpers (`{{message "DesktopTemp"}}`, `data-feed="Doorbell"`) and SVG widgets as custom elements;
  apps were database queries over stored templates; any number of viewers.
- **What carries forward.** Privacy by architecture (data never leaves the user's own network); a small
  vocabulary of parts that does a lot; widgets anyone can add; the phone as an input sensor (its
  `DeviceOrientation` widget, "Later, not v1").
- **What this design reverses.** A new user's first step was "run an MQTT broker". Remote displays need no
  broker, no cloud, one viewer. Templates and helpers were free-form and unchecked, and lived in a hosted database;
  here screens are files in the flow, checked by the compiler.
- **Why it matters now.** Reviewing the 2015 material on 2026-11-06, Mike agreed that its idea is more relevant
  today as a format AIs write and humans can audit than as a hand-coding IDE (`decisions/remote-display.md`).
