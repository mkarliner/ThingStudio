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
- **2026-11-07 — Spike scope: the concept call, not the deliverable (Mike).** "This is a spike. The goal is to
  evaluate the concept of the remote display, not to implement everything. Working on a board with PSRAM proves
  it; custom builds are for a full implementation." So the custom-builds-only decision above is the delivery
  plan for when the feature is implemented, not spike-phase work: the S3's measured headroom (8 MB gc / 8.07 MB
  IDF, below) is the evidence the concept fits hardware that can carry it, and that is what proves the spike.
  The landed `esp32-s3` target folder (74c8cd4) stands as registry work; no image is recorded or offered until
  the implementation starts. Pico W waits with it — it was a question about whether "custom builds only" needs a
  second entry, not about the concept. Spike work remains: install the rebind fix on the S3 (needs a UART
  connection), phone checkpoints 4/5/7/8/9, and the SPEC read-through against hardware.
