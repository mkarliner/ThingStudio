# Remote display spike — follow-ups (2026-11-06)

Open items from the spike's code side, each resolved during the spike or moved into the MVP/post-MVP call
(`remote-display-spike-results.md`). Not a commitment list; the hardware session and Mike's call decide.

- **The viewer token in the URL** (`?t=<hex>` on the WebSocket): replayable by an eavesdropper if it leaks
  through a proxy's or browser history's logs on the LAN; production options (a header or a per-session
  upgrade nonce) decided at the production build. Status: open (the spike ships it; security-policy §3.8
  records it).

- **Captive-portal DNS on the AP route** (scoping item 13): needs a UDP DNS responder beside `ts_http_server`
  answering every name with the board's own address; the hardware session sees whether phones open the page
  on joining, which sets whether it is worth the flash. Status: open.

- **Two owners of one shared server**: `mount()` appends routes to an existing Server; two flows that both
  *construct* the same port with different tables still race (first factory wins). Production shape: one
  `web_server` config node owns the port and its route table; codegen checks overlap at compile. Status:
  open (production design, not the spike's).

- **Editor awareness of the remote display**: no node, no descriptor, no property panel — the flow is
  hand-written. This is the biggest production work item if the spike results say MVP.

- **`ts_http_server` request logging**: the Server answers silently; the console should get one terse
  REQUEST line per flow route (host:port and path), matching the project's console style, before the
  remote display ships to anyone but Mike.

