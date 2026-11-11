# Decisions — Remote displays

Status: decision, started 2026-11-06. Principles Mike stated for remote displays (a phone or browser acting as a
board's display). The design itself is still provisional: `docs/working-notes/remote-display-scoping.md`, whose
"Design principles" section holds the full text of each rule below and its consequences.

- **2026-11-06 — Everything is a plugin, and contributing must not open a supply-chain hole (Mike).** The
  project's extend-without-touching-the-core rule applies to remote displays, as it did to the 2015 ThingStudio's
  widgets; Mike wants a community that finds contributing easy without each contribution being a way in. So a
  remote widget's face is declarative data by default; a JS face is the marked exception and runs confined to its
  own widget's values and declared events (no socket, session key, other widgets or network). The phone page is a
  new zone and code source for `docs/security-policy.md`, added in the change that builds it.
- **2026-11-06 — The board-served page is the first client, not the only one (Mike).** v1 is a web page over
  WebSocket, but nothing may assume it is the only client: a native app, a Bluetooth LE transport or a
  many-viewer renderer must be addable without redesign. So the interface spec is transport-neutral (WebSocket is
  one binding), messages are small and chunkable, assets are versioned and content-addressed, the renderer is
  shared TS, and client-only capabilities are advertised in version negotiation, never assumed by the board.
- **2026-11-06 — Remote UIs are a format AIs write and humans audit (Mike, agreeing with a review point).** From
  a review of the 2015-2019 ThingStudio material (`~/Src/ThingStudio2015`; later archive
  `~/Src/ThingStudioArchive/2019/ThingStudio/private/docs`): its small vocabulary of HTML templates and helpers is
  more relevant now as something an AI writes and a person can check than as a hand-coding IDE. It lacked a
  checker; here the `screens` tree goes through the flow compiler. Same argument as Mike's post
  https://blog.karliner.net/posts/thingstudio-common-ground/. Lineage: the scoping note's "Lineage" section.
- **2026-11-06 — Remote displays are screen-size agnostic (Mike).** The GUI lays out by constraints, not pixels,
  so the page uses the real viewport and scrolls when content is taller; no compile-time nominal phone size.
- **2026-11-06 — Open questions settled (Mike).** Discovery for v1 (at least the spike): editor URL + QR code,
  `.local` where it resolves, fixed AP address. WebSocket: our own code in `ts_http_server`, microdot as a reading
  reference only (no new dependency). Spec location `interfaces/remote-display/`. The web server is an explicit
  config node referenced by remote displays and `http_in`, and a general facility that may also serve a user's or
  developer's own web front end: the remote display mounts under its own path prefix, WebSocket upgrade is a server
  capability any route can use, auth is per route. Sequencing: a spike first
  (`remote-display-spike-briefing.md`); MVP or post-MVP decided on its results.
- **2026-11-07 — Deliver it as a custom firmware build; stock installs on small ESP32 boards are out of scope
  (Mike).** The spike's hardware session measured the floor. On an ESP32-C3 (66 KB MicroPython heap free) the
  *IDF* heap — what the WiFi stack and lwIP draw from — fell from 30,200 B at boot to **1,312 B with a 448 B
  largest block**; the board stayed associated at RSSI -52 and could not move a packet, and the page received
  `400 Bad Request` because the server's header read timed out. That is not a leak to tune away: it is the
  feature exceeding what a stock install on a no-PSRAM ESP32 leaves spare. So a remote display ships as a custom
  image (`firmware/targets/`) with the runtime and the spike's libraries frozen, and the heap headroom known at
  build time. Mike: "then this feature will [be] for custom builds only ... memory constrained devices".
  **Deliberately not a PSRAM rule:** the RP2040 boards (Pico W) may well carry it, because they do not pay the
  ESP32 memory tax (WiFi stack and lwIP sharing the one heap). The rule is measured headroom on the target, not
  a chip list — which is why the results sheet keeps a column per board rather than a verdict per family.
  **A second one would need:** a target folder + image for that board family, its frozen inventory including the
  spike's libraries, and a row in `remote-display-spike-results.md` measured with `freeIdfHeapBytes` /
  `largestIdfHeapBlockBytes` (never `gc.mem_free()` alone, which looked healthy throughout the C3's failure).
- **2026-11-10 — Remote displays are MVP (Mike).** The spike proved the board-side half end-to-end on a
  Freenove ESP32-S3 4.0" with runtime 15.1.0. The supported path is a custom firmware image with the runtime
  and remote libraries frozen, because that gives known heap headroom. Stock installs are not blocked: a user
  may deploy a remote display to any board that can run the web server and `ts_remote`, but the compiler
  warns when the selected board/image is untested. Documented facts: an ESP32-C3 stock install is below the
  floor (IDF heap collapse); an ESP32-S3 custom image is comfortable. Other boards are caveat emptor. The
  production build must still: record a tested custom S3 image, replace the spike's `?t=` URL token with a
  production-safe session token, and bring `docs/security-policy.md` §3.8 from "spike" to "production tier"
  before release.

- **2026-11-10 — Capability parity, not implementation parity, is the v1 target (Mike).** A remote screen is
  measured by whether the same flow works, not by whether it looks identical to the physical panel. Built-in
  widget faces are declarative data the page interpreter renders with HTML/CSS/SVG. A JS face is explicitly
  post-MVP, marked, and runs confined to its own widget's values and declared events. Widgets with no faithful
  remote rendering get a compile warning and a labelled placeholder, not a compile error.

- **2026-11-10 — One canonical GUI definition serves hardware and remote surfaces (Mike).** The product's core
  value is "one flow, any surface": the same screen tree runs on a physical panel or a phone. The canonical
  definition is rows/column containers + leaf widgets; `gui_panel` is removed in favour of container styling
  (group/card becomes a layout property of a row or column). The hardware renderer and the remote page renderer
  are two plugins over the same canonical tree; a third party can add another renderer without changing the
  authoring model or the board protocol. v1 authoring keeps the row/column flex model already used for remote
  screens; drag-and-drop will place widgets into constraint containers and let users tune flex properties, not
  require exact placement or a parallel layout mode.

- **2026-11-10 — v1 remote widget set and page chrome (Mike).** The v1 widgets are: `label`, `readout`, `bar`,
  `led`/`light`, `button` (momentary/toggle/navigate), `number`, `text`, `submit`, `slider`, `trend`, and
  `histogram`. Trend and histogram are full-featured, not placeholders. Page dots are removed: navigation is
  board-owned and there is no assumption of linear page order. Breadcrumbs, titles, and other page chrome are
  deferred until a concrete requirement exists. Any widget kind the page does not recognise degrades to a
  labelled placeholder with the raw value (P1).

- **2026-11-10 — Production security tier for the phone page (Mike).** Before release, the spike's `?t=<hex>`
  URL token is replaced by a token carried in the WebSocket handshake's `Sec-WebSocket-Protocol` header (e.g.
  `ts-rd-v1-<token>`), because browser WebSocket API does not allow custom headers. Wrong/missing token fails
  the upgrade with 401. The login route gets a simple rate limit (e.g. 10 attempts per 60 s globally, plus a
  cap on concurrent login handlers). `docs/security-policy.md` §3.8 moves from "spike" to "production tier"
  when these land. `TSAUTH1` reuse, HMAC+counter input frames, one viewer, and take-over are unchanged.

- **2026-11-10 — Form submit contract (Mike).** A form submit carries all fields for one form name in one
  signed message. The board validates every value against its declared type; if any fail, the whole form is
  refused with `{"type":"form_err","form":<name>,"failed":{key:msg}}` and nothing is written. If all convert,
  each key is written to `runtime.settings`, then `{"type":"form_ok","form":<name>,"keys":[...]}` is sent and
  a single flow event carrying the written key/value pairs is emitted. A submit with no draft values is allowed:
  it writes nothing, sends `form_ok` with an empty `keys` list, and emits a flow event with an empty values
  object. The flow decides what an empty submit means.

- **2026-11-07 — Spike scope: the concept call, not the deliverable (Mike).** "This is a spike. The goal is to
  evaluate the concept of the remote display, not to implement everything. Working on a board with PSRAM proves
  it; custom builds are for a full implementation." So the custom-builds-only decision above is the delivery
  plan for when the feature is implemented, not spike-phase work: the S3's measured headroom (8 MB gc / 8.07 MB
  IDF, below) is the evidence the concept fits hardware that can carry it, and that is what proves the spike.
  The landed `esp32-s3` target folder (74c8cd4) stands as registry work; no image is recorded or offered until
  the implementation starts. Pico W waits with it — it was a question about whether "custom builds only" needs a
  second entry, not about the concept. Spike work remains: install the rebind fix on the S3 (needs a UART
  connection), phone checkpoints 4/5/7/8/9, and the SPEC read-through against hardware.
