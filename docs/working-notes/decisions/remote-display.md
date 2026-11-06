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
