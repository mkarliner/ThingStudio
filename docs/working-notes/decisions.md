# Decisions log

Status: index, started 2026-08-19. An append-only, one-entry-per-decision
ledger — not a re-derivation of the reasoning behind each one. Each entry
is dated, states the decision in one line, and points back to the working
note (or design doc section) with the full argument. Read this to
orient fast across ~15 real decisions otherwise scattered across 33+
working-notes files; read the pointed-to source when the *why* actually
matters for what you're about to do.

**Scope boundary, so this doesn't duplicate two things that already
exist:** `docs/thingstudio-design-doc.md` §11 is still the record for
architecture-level, user-facing decisions, using its own strikethrough-
plus-dated-resolution style in place — this log doesn't replace that, it
indexes it alongside everything else (tooling, library, process, and
implementation-technology choices the design doc's own convention says
don't belong in it). A design-doc decision gets one line here too, so this
stays the single place to scan.

**Maintenance rule:** whenever a session writes or updates a
`Status: decision`/`Status: resolved` note, or resolves a design-doc open
question, add one line here in the same change — not batched for later.
Same convention already established for `docs/third-party-licenses.md`.

---

## Architecture

- **2026-08-11 — MicroPython over CircuitPython.** Already validated
  end-to-end by POC-A/B/D against stock MicroPython; re-spiking
  CircuitPython would strand that validation for an unlikely win.
  `thingstudio-design-doc.md` §11.
- **2026-08-11 — Litegraph.js over Drawflow for the canvas (POC-C).**
  Native type-checked wiring, live value propagation, multi-select;
  Drawflow needed all three hand-rolled. **Reversed 2026-08-16** — see
  below.
- **2026-08-16 — Rete.js over Litegraph.js (reversal of the above).**
  Not a correction of POC-C's method — a maintenance/ecosystem finding
  POC-C wasn't scoped to weigh: Litegraph is a vendored, unmaintained
  single file; Rete is a real, actively-installed npm package set.
  `rete-migration-decision.md`, `thingstudio-design-doc.md` §11.
- **2026-08-11 — Human-readable generated Python, not a compact
  intermediate form.** `mpy-cross` compile latency is sub-millisecond
  regardless of source verbosity, so compactness buys nothing; readable
  source keeps `NODE_ERROR` reports traceable. `thingstudio-design-doc.md`
  §11.
- **2026-08-11 — No function-node sandboxing for v1.** No marketplace or
  shared-flow mechanism exists yet, so the only stated reason to harden it
  doesn't apply. Revisit if/when one is scoped. §11.
- **2026-08-11 — No node distribution/versioning system for v1.** v1's
  node set is fixed at flash time as part of the runtime image; a node's
  "version" is just the runtime image's version, already carried by
  `HELLO`. §11.
- **2026-08-11 — No no-hardware simulation mode, ever — not deferred, out
  of the project's roadmap entirely.** Real hardware doesn't behave like a
  simulator; POC-D's own hardware-only bug list is exactly what a
  simulator wouldn't catch. §11.
- **2026-08-11 — USB-only runtime image updates for v1; OTA deferred to
  v2.** No wireless transport exists yet for OTA to ride on. One hedge
  taken now regardless: reserve OTA-capable ESP32 partitions from the
  first flash (still not actually done — see `outstanding-items.md`). §11.
- **2026-08-12 — Precompiled `.mpy` bytecode over raw-source `exec()`.**
  Not a latency call (POC-A showed raw-source is fast enough) — a RAM
  call: on-device compilation needs RAM on top of what the compiled code
  needs, and can OOM a constrained board even when the bytecode runs fine.
  §15.1 addendum.

## Repo / tooling

- **2026-08-12 — Single monorepo** (editor, device-runtime glue, node
  library together), not split repos — the pieces are tightly coupled
  right now. `repo-structure-and-conventions.md`.
- **2026-08-12 — TypeScript for the editor, Python for device-runtime.**
  Static typing catches the `msg` envelope/node-registry/CBOR-shape
  mismatches at build time; MicroPython target leaves no choice on the
  device side. Same note.
- **2026-08-12 — Vite + Vitest** as build/test tooling, replacing the
  POCs' no-build-step habit. Same note.
- **2026-08-12 — `ruff` for `device-runtime`'s Python**, configured around
  expected MicroPython-only-name false positives rather than suppressing
  broadly. Same note.
- **2026-08-12 — Apache-2.0 project license**, over MIT, mainly for the
  explicit patent grant on an embedded/wireless project. §14.
- **"Harness" retired as a name** for the on-device listener — too easily
  misread as agent-harness. Real code uses `runtime`/`listener`. Doesn't
  touch the POCs' own frozen `harness.py`. `repo-structure-and-conventions.md`.

## Backend (design-complete, zero code as of 2026-08-19 — see `outstanding-items.md`)

- **2026-08-16 — Thin local backend + browser-based web editor — explicitly
  not a native GUI app (Electron/Tauri), and not browser-only
  WebSerial-direct either.** A backend decouples "where the device is"
  from "where the human is" (remote access as a first-class use case, not
  just packaging) — a capability unlock Electron/Tauri can't provide
  either, since a desktop GUI app is just as tied to the machine it runs
  on. Tauri specifically ruled out on a technical ground, not taste: its
  system webview (WKWebView/WebKitGTK) doesn't implement Web Serial, so it
  would force the transport rewrite anyway while also adding Rust and the
  full packaging/signing burden — strictly more cost than the backend
  alone. `rete-migration-decision.md` Decision 2 (§"Not Electron, not
  Tauri").
- **2026-08-16 — Python + `aiohttp`, not FastAPI or raw
  `asyncio`+`websockets`.** The job is narrow (relay + static files);
  FastAPI's Pydantic/Starlette/Uvicorn weight isn't needed; raw
  asyncio means hand-writing what aiohttp already provides.
  `backend-platform-decision.md`.
- **2026-08-16 — Plain `pyserial` (sync, wrapped in
  `asyncio.to_thread`), not `pyserial-asyncio`.** That package is dead
  (no release since Sept 2021); one fewer dependency to audit, at the cost
  of hand-writing the thread-executor wiring. Same note.
- **2026-08-16 — WebSocket wire shape: one endpoint, multiplexed by frame
  type** — binary frames are §13's CBOR bytes passed through verbatim (no
  backend-side decode), text frames are backend-local JSON control
  messages (port list, connect, status). `backend-editor-auth-and-protocol.md`.
- **2026-08-16 — Posture 1 (default) auth: Host-header allowlist is the
  load-bearing defense against DNS rebinding, not `Origin`.** Same-origin
  policy doesn't cover WebSocket connections from page JS the way it
  covers `fetch`/XHR. Same note.
- **2026-08-16 — Posture 2 (opt-in remote access) auth: hand-rolled
  `bcrypt` + signed, expiring session cookie, not `aiohttp-session`.**
  That library has had no release in ~12 months; the actual surface needed
  is small enough to implement directly against the stdlib. Same note.
- **2026-08-16 — Session cookie, not a bearer token**, specifically
  because the browser's native `WebSocket` constructor cannot set custom
  headers — no way to send `Authorization: Bearer` on a WS handshake from
  page JS. Same note.

## Board-transport auth (perimeter 2)

- **2026-08-16 — HMAC-SHA256 + a persisted monotonic counter, not a
  random-nonce challenge–response.** The ESP32-C3's hardware RNG is not a
  true RNG unless WiFi/BT is enabled, and v1 is USB-only with no radio
  bring-up — a nonce would be pseudo-random. A counter defeats replay
  without needing any entropy on-device. `transport-auth-design.md`.
- **2026-08-16 — Real v1 commitment is just two `HELLO` fields**
  (`authRequired`, `authScheme`), even shipping `authRequired: false`.
  Everything else about the codec is additive and cheap to add later —
  the one real one-way door is capability *advertisement*, not encoding.
  **Still not implemented** — see `outstanding-items.md`. Same note.
- **2026-08-16 — No keypair auth for v1.** Costs a firmware rebuild for a
  native module (or unmeasured, likely-slow pure-Python verification) to
  defend against a threat (backend compromise) v1 doesn't yet meaningfully
  face. Reserved as a future `authScheme` value, not a protocol revision.
  Same note.

## Editor / canvas

- **2026-08-16 — Rete migration: an adapter over `compiler/graph.ts`,
  not a rewrite of its accepted shape.** Keeps the tested compiler-input
  contract unchanged; `graph-adapter.ts` translates Rete's graph into the
  existing `{nodes, links}` shape. `rete-migration-decision.md`.
- **2026-08-16 — Hand-rolled palette drag-and-drop, not
  `rete-dock-plugin`.** Sub-decision 2, same note.
- **2026-08-16 — Wire-type system deliberately NOT bundled into the Rete
  migration** — kept as its own, immediately-following task so any
  regression stays attributable to one or the other. Sub-decision 3, same
  note.
- **2026-08-16 — Wire-type system: ship narrow and loose, tighten later
  if real use shows real pain.** Three-bucket coercion matrix (truthiness
  into `bool` always allowed; numeric widening allowed, narrowing
  refused; `bytes`↔`string` and `any`-into-concrete-types refused, need an
  explicit conversion node). No conversion node built yet — nothing in
  the current node set needs one. `wire-type-system-scoping.md`.
- **2026-08-14 — Compiler emits `async def`/`await` uniformly for every
  transform/sink node**, not an opt-in per-node flag or blocking sockets
  with no compiler change — avoids stalling the flow's one event loop
  during real network I/O, mechanical for every other node type.
  `mvp-validation-plan.md`, 2026-08-14 network-batch Results entry.
- **2026-08-17 — Debounce uses the cooldown algorithm** (ignore
  transitions within N ms of the last accepted one), not
  settle-and-confirm — the cheap version, per `CLAUDE.md`'s
  premature-optimization principle. `tier1-interrupt-node-implementation-briefing.md`.
- **2026-08-14 — Vendor `mqtt_as` (Peter Hinch, MIT), not `umqtt.simple`.**
  Non-blocking I/O and built-in WiFi/broker reconnection, worth the
  vendoring cost over the more commonly-cited blocking library.
  `mvp-validation-plan.md`, 2026-08-14 network-batch Results entry.

## Config nodes / Tier 1 scope

- **2026-08-17 — Tier 1 item 5 resolved: interrupt/pin-change (replacing
  `gpio_in`), filter/event-compression, and four UDP/TCP nodes pulled into
  v1.** ADC and file ops rejected as node types entirely (both reduce to
  a `function`-node one-liner or an already-tracked need elsewhere); mDNS
  deferred to v2 (MicroPython support unconfirmed across targets); HTTP-in
  (on-device server) stays deferred per §6's existing dashboard reasoning.
  `tier1-node-candidates-prioritization-briefing.md`.
- **2026-08-18 — Config nodes: build Node-RED's per-flow, referenced-by-ID
  pattern, not the design doc's original per-device-override vision.**
  Direct override from Mike ("entering ssid credentials multiple times is
  not acceptable even for an MVP") — smaller, fixes the actual pain,
  per-device override stays a v2 layer on top.
  `config-node-and-palette-implementation-briefing.md`.
- **2026-08-18 — A config reference (`wifiConfigId`) stays optional, not
  mandatory**, for the four non-MQTT network node types — smaller behavior
  change, keeps a config-less flow compiling exactly as before. Same
  note.

## Redeploy / network fault handling

- **2026-08-20 — Explicit cleanup registry (`runtime.register_cleanup`/
  `cancel_running`), not GC-timing reordering, fixes the redeploy socket
  leak.** A `gc.collect()` reorder would only make the `EADDRINUSE` flake
  less frequent, still relying on incidental collection timing for
  something that needs to be deterministic. `redeploy-cleanup-and-
  network-fault-detection-briefing.md` Problem 1, `runtime.py`.
- **2026-08-20 — `wifiConfigId` made mandatory for `wifi_status`/
  `udp_send`/`udp_receive` (Option B), reversing the config-node
  briefing's "optional" call.** The optional/implicit fallback was
  exactly what let `wifi_status` report a connection the flow never
  declared. `http_request` is untouched (still unmigrated to config
  nodes at all). Mike's own explicit sign-off, not a default. Same
  briefing, Problem 2b; see `config-node-and-palette-implementation-
  briefing.md`'s own retroactive note.
- **2026-08-20 — WiFi config `security` field: `"password"` (default) |
  `"open"` | `"unmanaged"`, not just the two the briefing scoped.** The
  third state (`"unmanaged"` -- no managed connection, ride on whatever
  the device already has) is the explicit, labeled replacement for what
  an omitted `wifiConfigId` used to mean implicitly, kept specifically so
  Option B's mandatory-config rule doesn't foreclose a future captive-
  portal/AP-fallback WiFi provisioning flow (raised by Mike 2026-08-20,
  not built or scoped -- see `outstanding-items.md`). An empty password
  on a `"password"`-security config is a compile-time `CompileError`.
  `config-types.ts`, `wifi-status.ts`.
- **2026-08-20 — Network OSError messages re-raised with host:port
  context, `udp_send`/`udp_receive` only.** `http_request`/`mqtt-
  shared.ts` left untouched -- the briefing flagged touching them as a
  judgment call, not mandated; not done this session, still open for
  whoever picks it up next.

## Node authoring / extensibility

- **2026-08-20 — Custom nodes: two-file package (`<name>.node.json` +
  `<name>.node.py`), no new wire protocol.** Inlined into the existing
  DEPLOY-compiled flow module via a generic `NodeDefinition` builder
  (`buildCustomNodeDefinition`, `node-library/custom-node.ts`) that wraps
  user Python in a per-instance closure — `compile.ts` itself needs zero
  changes; a custom node's `NodeDefinition` is indistinguishable from a
  first-party one to the compiler. Distribution mechanism deliberately
  narrower than design doc §11's module-push sketch — that stays
  deferred until a real need (shared-across-flows, size) forces it, per
  `CLAUDE.md`'s no-premature-optimization principle.
  `custom-node-authoring-scoping.md`.
- **2026-08-20 — No sandboxing for custom node Python — same trust
  boundary as the `function` node, and doesn't reopen §11's dormant
  sandboxing question.** Custom nodes don't cross the existing
  deploy-access trust perimeter (§9). Mike's explicit call: "go with the
  trust-boundary call (until it bites us)." Loading is session-scoped only
  (browser File System Access API multi-file picker) — no persistence,
  file-watching, registry, or URL-install mechanism built or planned.
  Same note.
- **2026-08-20 — Custom node output ports capped at 1 by codegen
  validation, not by the package format.** The `.node.json` schema itself
  places no limit on `ports.outputs`; `validateCustomNodeDescriptor` is
  what enforces ≤1 for v1, specifically so this doesn't compromise the
  higher-priority multi-output-routing roadmap item — confirmed as the
  right framing directly with Mike ("multiple outputs is fairly high on
  the priority list... just don't do anything to compromise it"). Same
  note.

## Session sequencing

- **2026-08-20 — Custom node authoring + documentation come next, ahead of
  `outstanding-items.md`'s normal order, followed by a documentation-only
  validation session before resuming normal order.** Mike's own explicit
  call: implement custom node authoring (design doc §7's groundwork,
  `outstanding-items.md`'s "Node authoring / extensibility" section) and
  end-user documentation together in one session, despite that backlog
  entry's own note that it "needs its own dedicated scoping session" —
  that scoping now happens inside this session, not before it. Once done,
  a separate session gets *only* the resulting end-user docs (not this
  file, not `CLAUDE.md`) and has to build a new node type from a brief —
  a real test of whether the documentation is actually sufficient, not
  just written. `outstanding-items.md`'s "Next up" section.

## What this list doesn't include

Small per-file implementation judgment calls (exact property names, which
bucket a specific type pair lands in, pin numbers) — those live in the
node's or file's own header comment, per this project's existing
convention, and aren't worth indexing here.
