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

**2026-09-06 pass:** split each section below out into its own file under `docs/working-notes/decisions/`, to keep this file a fast index rather than something a session has to read end to end regardless of task. Nothing was reworded or deleted — each section here is now a short summary plus a link to the unchanged full entries. Read only the section(s) matching your task's topic; read the whole index (not the whole set of detail files) when you need the lay of the land.

## Architecture

Top-level platform calls: MicroPython over CircuitPython; Rete.js over Litegraph.js (with the reversal history); human-readable generated Python, not a compact form; no function-node sandboxing, no node distribution/versioning, no simulation mode for v1; USB-only v1 updates with OTA-capable partitions reserved; precompiled `.mpy` bytecode over raw-source `exec()`. 9 entries: `docs/working-notes/decisions/architecture.md`.

## Repo / tooling

Monorepo structure; TypeScript editor / Python device-runtime split; Vite + Vitest; `ruff` config; Apache-2.0 license; the "harness" → `runtime`/`listener` rename; today's CLAUDE.md/decisions.md/learnings.md context-size restructuring. 7 entries: `docs/working-notes/decisions/repo-tooling.md`.

## Backend (minimal build + persisted-data protocol + editor-backend wiring landed 2026-09-07; admin-API fetch client + CORS landed 2026-09-08; first real-hardware DTR/RTS pass landed 2026-09-08; flow storage reverted same day to the File System Access picker, not backend-managed at all; complete for the moment as of 2026-09-08, no further per-board passes planned — see `outstanding-items.md`)

Thin local Python + `aiohttp` backend feeding a browser-based web editor (not Electron/Tauri, not browser-only WebSerial); plain `pyserial` over the dead `pyserial-asyncio`; the one-endpoint multiplexed WebSocket wire shape; both auth postures (Host-header allowlist default, hand-rolled bcrypt + session cookie for opt-in remote access); `~/.thingstudio` local-state persistence, now MVP-needed; the backend↔browser persisted-data protocol is an HTTP admin API, not a WS control-plane extension; "via backend" is now the default editor connection mode, "direct" WebSerial kept as a working fallback (then hidden in the UI once storage went backend-exclusive); a real serial-wire-format bug (raw binary assumed, base64/F64-lines actually needed) found and fixed while wiring the two together; editor storage is now backend-exclusive, not connection-mode-gated; admin-API CORS reflects the request's Origin rather than an explicit allowlist; remote/firewalled backend access goes through a loopback tunnel for now, not a non-loopback bind; a real-hardware DTR/RTS pass on one ESP32-C3/CH9102 board confirms today's default doesn't reset it; a same-day --flows-dir experiment was reversed within hours -- flows now save via the browser's native file dialog (File System Access API), not backend-managed at all, matching "just like any other editing program"; custom nodes remain the one thing backend-owned in ~/.thingstudio; no further per-board hardware passes planned (Mike's call) -- backend/auth treated as complete for the moment, effort redirects to general, board-independent failure handling. 18 entries: `docs/working-notes/decisions/backend.md`.

## Board-transport auth (perimeter 2)

HMAC-SHA256 + a persisted counter over a nonce challenge-response (no trustworthy on-chip RNG); the one real v1 commitment (`HELLO`'s `authRequired`/`authScheme` fields, still unbuilt); no keypair auth for v1. 3 entries: `docs/working-notes/decisions/board-transport-auth.md`.

## Editor / canvas

The Rete migration's shape (adapter over `compiler/graph.ts`, hand-rolled palette drag-and-drop, wire-type system kept as its own separate task); the wire-type coercion matrix; uniform `async`/`await` codegen; debounce via the cooldown algorithm; vendoring `mqtt_as`; the stable-node-ID migration (UUID identity end-to-end, replacing recomputed integer ids — the console-attribution work builds on this); the UI cleanup pass (collapsible panels, palette groups); hiding `variable_get`/`variable_set` from the canvas pending a Node-RED-style context model; the connection-status-indicator design (new `NODE_STATUS` message type, small fixed state enum, clear-on-redeploy, scoped to `wifi_status`/mqtt only); multi-output-port support for the `function` node (loose tolerance on a malformed return shape, live-value streaming deferred, grow-the-pill sizing). 12 entries: `docs/working-notes/decisions/editor-canvas.md`.

## Config nodes / Tier 1 scope

The Tier 1 node-type triage (interrupt/pin-change, filter/event-compression, four UDP/TCP nodes in; ADC/file-ops/boolean-arithmetic-comparator rejected as node types); config nodes built as Node-RED's per-flow referenced-by-ID pattern, not per-device override; `wifiConfigId`'s optional-then-mandatory history; `mqtt_publish`/`mqtt_subscribe`'s migration to config nodes plus first real canvas presence; the separate `mqtt-broker` config type for broker-level auth; WiFi/MQTT-broker config nodes moving to a name-keyed backend credential store instead of holding secrets themselves. 7 entries: `docs/working-notes/decisions/config-nodes-tier1-scope.md`.

## Redeploy / network fault handling

The redeploy-cleanup and WiFi/MQTT hardening work: the socket-leak cleanup registry, mandatory `wifiConfigId`, the WiFi `security` field's three states, the `wifi_status`-vs-`mqtt_as` connect-race fix (kept local rather than patching upstream), `wifi_status` becoming the flow's sole WiFi-credential owner, the runtime/editor version-check gap (semver rule plus a git-SHA backstop), `HELLO_REQUEST`, boot-time flow auto-resume, the CBOR `None`-encoding fix, `flowName`/`deployId` flow identity, the call to accept the ESP32 ordering-race's current failure mode as a documented limitation rather than keep chasing a universal fix, and `wifi_status` deferring connection ownership (not just credentials) to `mqtt_as` entirely when the flow has any mqtt node, fixing WiFi visibly cycling up/down that the new status dots made observable. The single largest, most active section in this log. 13 entries: `docs/working-notes/decisions/redeploy-network.md`.

## Node authoring / extensibility

Custom nodes as a two-file package inlined via a generic `NodeDefinition` builder, no new wire protocol; same trust boundary as the `function` node, no sandboxing; output ports capped at 1 by codegen validation, not the package format; package persistence deferred to the backend; `eswitch`/`ebutton` nodes vendoring Peter Hinch's
`micropython-async` primitives, partially resolving design doc §11; CYD confirmed ST7789(V)-compatible
with a working MADCTL/inversion config, now exposed as real `display_spi` node properties
(colorOrder/invertColors/dataLatchOrder), CYD-defaulted; `display_spi` framebuffer-memory fix
decided (real `frameFormat`/`palette` properties, four depths, palette-driven throughout) with an
off-device `@micropython.viper` spike backing it, then `frameFormat: "gs4"` actually built (a real
odd-width stride bug found and fixed before landing) and verified by a real `tsc`/`vitest` pass, which
also caught a `device_commit_files` push that had silently not landed; then, on the first real
hardware-deploy attempt, a previously-invisible gap in the editor's own `mpy-cross` WASM Deploy
pipeline (never passed `-march`, breaking on the first-ever real `@micropython.viper` compile) found
and fixed; then a real hard crash (`Guru Meditation Error`, boot loop) root-caused to CYD's specific
SPI pins not supporting the node's 40MHz default baudrate, unrelated to gs4/viper at all; both fixes
then confirmed on a real redeploy -- correct render with viper disabled, then correct render again with
real `@micropython.viper` re-enabled, this project's first-ever real-hardware viper execution on
Xtensa, closing gs4 out end to end; then `gs2`/`mono` (the two remaining decided-but-not-built depths)
built the same day, including a real MicroPython-source-confirmed finding that gs4's bit order doesn't
generalize to gs2/mono (they're the opposite of gs4, and of each other's similarly-named `MONO_HLSB`
sibling) -- neither deployed to real hardware yet. 14 entries: `docs/working-notes/decisions/
node-authoring.md`.

## Session sequencing

Custom node authoring + docs sequenced ahead of the normal backlog, then a documentation-only validation session, before resuming normal backlog order. 1 entry: `docs/working-notes/decisions/session-sequencing.md`.

## Docs / process

Documentation split into three activities (scoping, design, tech selection); all three now done or scaffolded as of 2026-09-07 -- the real content gap is an end-user flow-builder guide (developer guide already done by `custom-nodes.md`), tooling is MkDocs + Material on GitHub Pages for now, and structure/nav is a 4-page guide plus a one-file-per-node reference, with the actual MkDocs project (config, workflow, placeholder pages) scaffolded. Only the real content-writing (and Mike's own install/build verification) remains. A new, related in-editor node-reference idea (Mike's, same week) is tracked separately, not yet designed. 4 entries: `docs/working-notes/decisions/documentation-process.md`.

## What this list doesn't include

Small per-file implementation judgment calls (exact property names, which
bucket a specific type pair lands in, pin numbers) — those live in the
node's or file's own header comment, per this project's existing
convention, and aren't worth indexing here.

