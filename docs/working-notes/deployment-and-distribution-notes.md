# Working note: deployment and distribution, medium-term

Status: working note, 2026-08-14, **premise partially corrected 2026-08-16**
(see bullet 1) — `rete-migration-decision.md`'s own "Open, needs Mike" list
flagged this file as stale under Decision 2 without fixing it; this pass
fixes bullet 1 and surfaces one real open question that pass didn't
anticipate. Still not scoped as a full design — this remains a captured
set of medium-term needs, not a plan. `thingstudio-design-doc.md`
doesn't cover hosting/distribution at all yet (§14 is repo/dependency
structure, not where things get served from) — this is new ground for the
docs, not a gap in an existing section.

Three needs raised together, medium-term (post-v1-pipeline-proof, pre-real-users):

- ~~**Static site for editor hosting.** The editor (`editor/`) is already
  a static Vite build — no server-side component, WebSerial and the
  mpy-cross WASM compile both run entirely client-side. Hosting it is a
  "point a static host at `vite build`'s output" problem, not an
  architecture problem — but needs a decision on where (GitHub Pages,
  Cloudflare Pages, etc.) and, since WebSerial requires a secure context,
  confirming the chosen host serves over https by default.~~
  **superseded 2026-08-16 (`rete-migration-decision.md` Decision 2): this
  isn't a static-hosting problem anymore.** The backend (Python/`aiohttp`,
  `backend-platform-decision.md`) serves the editor's built assets itself
  — there's no longer a public static host to pick, because there's no
  longer a deployment where the editor exists independent of the backend
  that's also doing serial I/O and flow-file I/O for it. Distribution
  becomes a **package-install story**: how does a user get the backend
  (and the editor assets bundled with/served by it) running on their own
  machine — pip install, a frozen build (PyInstaller or similar), an OS
  package? Not decided here; `backend-platform-decision.md` §7 already
  flagged packaging mechanics as unscoped and pointed here as the natural
  place to scope it, and this pass is leaving it exactly that
  open — correcting the stale premise, not doing the packaging design in
  the same breath.

  **One real question this correction surfaced, not previously asked
  anywhere: does WebSerial (`navigator.serial`, browser-side) still have
  a role at all, or is it fully superseded by the backend's own
  `pyserial`-based serial access?** `rete-migration-decision.md` described
  the backend as "one ~230-line WebSocket *sibling*" to `transport.ts`'s
  existing WebSerial implementation — phrasing that reads as "both exist,
  pick one at runtime" (WebSerial for a simple local-only session with no
  backend running; WebSocket-to-backend when remote access or the backend
  model generally is in play). But `backend-platform-decision.md` and
  `backend-editor-auth-and-protocol.md` were both written assuming the
  backend is *always* in the loop for serial access, with no mention of a
  WebSerial fallback path — which reads instead as "WebSerial is retired,
  every path goes through the backend now." These two readings imply
  different things for this bullet specifically: if WebSerial survives as
  a local-only fallback, a secure-context concern still exists for that
  path (confirmed this session: Web Serial requires a secure context, and
  `localhost` is explicitly exempted from the HTTPS requirement the same
  way it's exempted for other browser security-sensitive APIs — so a
  local-only WebSerial path stays simple regardless).

  **Resolved 2026-08-16, later same session: WebSerial survives, as a
  deliberate frozen fallback, not a maintained parallel feature.** Two
  cost profiles were on the table — full parity (both transports actively
  developed and kept in sync forever, expensive, fights "thin") versus
  keeping already-working, already-hardware-validated code scoped to
  exactly what it already does (local-only, no remote access, no auth
  story) while all new investment goes into the backend path. The second
  is what got picked, and it's a much easier call than the first — not
  "build and maintain two systems," just "don't delete working code with
  no reason to." One direct consequence for §9: the physical-access-as-gate
  reasoning that section's 2026-08-16 edit called invalidated is only
  invalidated for backend-mediated deploys — it still holds for WebSerial-
  direct mode, unchanged, since that mode has no remotely-reachable process
  in the loop at all. §9 corrected to say so in the same pass as this note.

  **Mode selection is an explicit user choice, not auto-detection** —
  "direct" (WebSerial) vs. "via backend," picked by the user rather than
  inferred. Auto-detecting "is a backend reachable" would fail silently
  and ambiguously (can't distinguish "no backend running" from "backend
  slow/misconfigured" without telling the user which), exactly what
  CLAUDE.md's fault-handling priority argues against. §4 now states this
  explicitly.
- **Documentation site.** Nothing decided yet — not clear if this means a
  generated site off `docs/*.md` as-is, or a purpose-built docs site with
  its own structure distinct from the working-notes/design-doc split that
  serves *this project's own development* right now. Those two audiences
  (contributors reading `docs/working-notes/` vs. end users of a shipped
  tool) probably don't want the same document, worth keeping distinct
  when this gets scoped rather than assuming the existing docs tree
  becomes the site verbatim.
- **Runtime install page** — confirmed unaffected by Decision 2
  (`rete-migration-decision.md`'s own "Open, needs Mike" note), and worth
  seeing why rather than taking it on faith: this page's job is flashing
  a fresh board *before* `device-runtime` exists on it at all, so there's
  no backend-to-device relationship yet for the backend model to change —
  it stays what it already was, a standalone browser page. Tasmota-style
  (<https://tasmota.github.io/install/>) — a browser-based flashing page
  so a user can put `device-runtime` on a fresh board with no local
  toolchain. Tasmota's page is built on ESP Web Tools (Web Serial-based,
  same browser API `transport.ts` already uses for `DEPLOY`), which
  argues for reusing that rather than hand-rolling a flasher — but
  ESP Web Tools flashes a full firmware image at a given manifest/offset,
  which is a different shape of artifact than what exists today
  (`device-runtime/src/*.py`, copied onto a device's filesystem as loose
  files per `test/hil/README.md`'s manual flash steps, not a single
  flashable binary). Getting a Tasmota-style install page working
  probably implies deciding on a real build/packaging step for
  `device-runtime` (a frozen MicroPython image with the listener/runtime
  baked in, most likely) before the install page itself is buildable —
  that packaging question isn't scoped anywhere yet either.

Nothing here started. Listed for prioritization whenever v1's pipeline
work is far enough along to need it, not scoped as a design yet.
