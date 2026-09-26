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

Monorepo structure; TypeScript editor / Python device-runtime split; Vite + Vitest; `ruff` config; Apache-2.0 license; the "harness" → `runtime`/`listener` rename; today's CLAUDE.md/decisions.md/learnings.md context-size restructuring; the top-level Makefile (2026-09-24). 8 entries: `docs/working-notes/decisions/repo-tooling.md`.

## Backend (minimal build + persisted-data protocol + editor-backend wiring landed 2026-09-07; admin-API fetch client + CORS landed 2026-09-08; first real-hardware DTR/RTS pass landed 2026-09-08; flow storage reverted same day to the File System Access picker, not backend-managed at all; complete for the moment as of 2026-09-08, no further per-board passes planned — see `outstanding-items.md`)

Thin local Python + `aiohttp` backend feeding a browser-based web editor (not Electron/Tauri, not browser-only WebSerial); plain `pyserial` over the dead `pyserial-asyncio`; the one-endpoint multiplexed WebSocket wire shape; both auth postures (Host-header allowlist default, hand-rolled bcrypt + session cookie for opt-in remote access); `~/.thingstudio` local-state persistence, now MVP-needed; the backend↔browser persisted-data protocol is an HTTP admin API, not a WS control-plane extension; "via backend" is now the default editor connection mode, "direct" WebSerial kept as a working fallback (then hidden in the UI once storage went backend-exclusive); a real serial-wire-format bug (raw binary assumed, base64/F64-lines actually needed) found and fixed while wiring the two together; editor storage is now backend-exclusive, not connection-mode-gated; admin-API CORS reflects the request's Origin rather than an explicit allowlist; remote/firewalled backend access goes through a loopback tunnel for now, not a non-loopback bind; a real-hardware DTR/RTS pass on one ESP32-C3/CH9102 board confirms today's default doesn't reset it; a same-day --flows-dir experiment was reversed within hours -- flows now save via the browser's native file dialog (File System Access API), not backend-managed at all, matching "just like any other editing program"; custom nodes remain the one thing backend-owned in ~/.thingstudio; no further per-board hardware passes planned (Mike's call) -- backend/auth treated as complete for the moment, effort redirects to general, board-independent failure handling. 18 entries: `docs/working-notes/decisions/backend.md`.

## Board-transport auth (perimeter 2)

HMAC-SHA256 + a persisted counter over a nonce challenge-response (no trustworthy on-chip RNG); the one real v1 commitment (`HELLO`'s `authRequired`/`authScheme` fields, still unbuilt); no keypair auth for v1. 3 entries: `docs/working-notes/decisions/board-transport-auth.md`.

## Editor / canvas

The Rete migration's shape (adapter over `compiler/graph.ts`, hand-rolled palette drag-and-drop, wire-type system kept as its own separate task); the wire-type coercion matrix; uniform `async`/`await` codegen; debounce via the cooldown algorithm; vendoring `mqtt_as`; the stable-node-ID migration (UUID identity end-to-end, replacing recomputed integer ids — the console-attribution work builds on this); the UI cleanup pass (collapsible panels, palette groups); hiding `variable_get`/`variable_set` from the canvas pending a Node-RED-style context model; the connection-status-indicator design (new `NODE_STATUS` message type, small fixed state enum, clear-on-redeploy, scoped to `wifi_status`/mqtt only); multi-output-port support for the `function` node (loose tolerance on a malformed return shape, live-value streaming deferred, grow-the-pill sizing). 12 entries: `docs/working-notes/decisions/editor-canvas.md`.

## Config nodes / Tier 1 scope

The Tier 1 node-type triage (interrupt/pin-change, filter/event-compression, four UDP/TCP nodes in; ADC/file-ops/boolean-arithmetic-comparator rejected as node types); config nodes built as Node-RED's per-flow referenced-by-ID pattern, not per-device override; `wifiConfigId`'s optional-then-mandatory history; `mqtt_publish`/`mqtt_subscribe`'s migration to config nodes plus first real canvas presence; the separate `mqtt-broker` config type for broker-level auth; WiFi/MQTT-broker config nodes moving to a name-keyed backend credential store instead of holding secrets themselves; the WiFi config becoming a singleton (every WiFi node's field edits the one instance, wifi_status optional); the `filter` node built (2026-09-26); I2C bus as a keyed singleton config, and `runtime.shared()` on the device (2026-09-26). 11 entries: `docs/working-notes/decisions/config-nodes-tier1-scope.md`.

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
sibling) -- and, later the same day, both confirmed working on real CYD hardware too, closing out all
three indexed depths end to end. `startup` node start reason (2026-09-25); `bme280` and generic `i2c` nodes (2026-09-26). 17 entries: `docs/working-notes/decisions/node-authoring.md`.

## GUI layout / widget system

Hinch's `micropython-micro-gui`/`micropython-touch` rejected as the runtime GUI layer (too monolithic for a
code generator to emit against, though individual widget draw routines and `Writer`/`font_to_py` remain
candidates to vendor); GUI layout required to be container-based rather than absolute coordinates, which puts
the layout engine in the editor at compile time and ships nothing to the device. Supersedes
`cyd-touch-gui-flash-budget-briefing.md`'s item 3. Then (2026-09-22): the GUI gets its own editor view
parallel to the flow view, GUI nodes are two-faced (one record, both views), MVC guides the design,
superseding the named-slot design; unknown is a first-class value state in the GUI's visual language.
4 entries: `docs/working-notes/decisions/gui-layout.md`.

## Session sequencing

Custom node authoring + docs sequenced ahead of the normal backlog, then a documentation-only validation session, before resuming normal backlog order. 1 entry: `docs/working-notes/decisions/session-sequencing.md`.

## Docs / process

Documentation split into three activities (scoping, design, tech selection); all three now done or scaffolded as of 2026-09-07 -- the real content gap is an end-user flow-builder guide (developer guide already done by `custom-nodes.md`), tooling is MkDocs + Material on GitHub Pages for now, and structure/nav is a 4-page guide plus a one-file-per-node reference, with the actual MkDocs project (config, workflow, placeholder pages) scaffolded. Only the real content-writing (and Mike's own install/build verification) remains. A new, related in-editor node-reference idea (Mike's, same week) is tracked separately, not yet designed. 4 entries: `docs/working-notes/decisions/documentation-process.md`.

## Editor connect-error UX

**2026-09-22 -- backend-relay connect failures get a plain-language workaround, not raw exception
text.** MVP item 2 (`mvp-kickoff-brief.md`), first slice: `serial_relay.py`'s already-structured
`SerialRelayError` text (permission denied, port busy, device vanished) is now pattern-matched into
a workaround suggestion in the editor (`connect-error-help.ts`), and the HELLO-timeout message now
names the real, documented "no runtime installed" cause (`learnings/hardware-bringup-hil-rig.md`'s
2026-09-18 entry) alongside the boot-race one it already mentioned. Scoped to the backend-relay path
only, matching the existing WebSerial-direct-is-frozen/hidden decision above -- no new investment
there. A real "Install runtime" button is item 1, not this. 1 entry:
`docs/working-notes/decisions/editor-connect-errors.md`.

## Runtime install from the editor

**2026-09-22 -- MVP item 1 built end-to-end (backend raw-REPL client through an editor button),
backend-relay only, NOT yet verified against real hardware.** A bare board with no listener has
nothing to answer a framed §13 message, so only a raw-REPL bootstrap (the same host-side primitive
`mpremote` uses) can do an *initial* install -- corrects this item's own earlier scoping doc, which
had framed that as one of two interchangeable mechanism choices. New `raw_repl.py` +
`runtime_installer.py` in the backend, a shared `device-runtime/runtime_manifest.py` so
`test-flows/deploy_runtime.py` and the new path can't drift apart, a new `install_runtime`/
`install_runtime_result` control-plane message pair in `ws_relay.py`, and
`BackendTransport.installRuntime()` plus an "Install runtime…" button in the editor (backend mode
only -- no WebSerial-direct equivalent). No auto-reconnect after the install's hard reset, by
design (`CLAUDE.md`'s "make the failure legible instead" corollary -- USB re-enumeration timing
isn't something to chase per board). Fully unit-tested against fakes (a real protocol bug was
caught this way, not by inspection); zero hardware confirmation this session (no board available).
1 entry: `docs/working-notes/decisions/runtime-install-from-editor.md`.

## Board-aware compile (-march)

**2026-09-22 -- MVP item 3 built, NOT yet verified against real hardware.** Replaces the single
`MPY_CROSS_MARCH = "xtensawin"` constant with `editor/src/app/native-arch.ts`'s `inferNativeArch()`
(auto-detects from HELLO's `chipType`) plus a manual-override dropdown (`nativeArchSelect`) for when
Auto guesses wrong or no board is connected yet -- both parts of the same brief item, built together
rather than staged. Found and fixed a second, previously-unnoticed bug in the same area while doing
this: the old constant's own justification ("ESP32/ESP32-C3/ESP32-S3 are all Xtensa") was wrong --
ESP32-C3/C6 are RISC-V cores (`rv32imc`), confirmed against MicroPython's own docs, not Xtensa. RP2040
maps to `armv6m` (confirmed, Cortex-M0+); RP2350 maps to `armv7emsp`, sourced from a MicroPython
maintainer discussion thread, not this project's own hardware -- flagged unconfirmed, the main reason
the manual override exists at all for v1. 1 entry: `docs/working-notes/decisions/board-aware-compile.md`.

## Presets (named, saveable, human-editable per-node property bundles)

**2026-09-22 -- MVP item 4 built (per-node scope only, NOT board/chip-family auto-seeding), NOT yet
verified against real hardware.** New `~/.thingstudio/presets/<type>/<name>.json` store
(`PersistedStore.list_presets`/`read_preset`/`write_preset`/`delete_preset` + mirrored
`/api/presets/{type}[/{name}]` routes), an open `type` namespace rather than credentials' fixed
wifi/mqtt-broker tuple. Copy-on-apply, confirmed with Mike over a live-reference design (presets hold
no secret, so credentials' "keep the real value out of the flow file" reasoning doesn't apply) --
selecting a preset copies its values onto `node.properties` once, no persisted reference stays behind.
Per Mike's explicit follow-up when confirming this ("if a user adds a preset file manually that is
invalid there should a very obvious syntax error flagged"), `list_presets()` eagerly validates every
file's JSON and reports `valid`/`error` per entry — the one real behavioral departure from the
credentials pattern it otherwise mirrors, which only validates at write time. New `PresetRefField.vue`
widget (dropdown + save-as-name, invalid entries shown disabled with a location-naming warning), wired
into `PropertyPanel.vue`'s `display_spi`/`display_i2c` blocks — the two kinds Mike named explicitly as
"complex to set up." Picked up in the same change: `display_spi`'s `colorOrder`/`invertColors`/
`dataLatchOrder` (MVP item 5's own named gap) had no property-panel fields at all before this, which
would have undercut a "save this display's SPI setup as a preset" feature; `nodes.ts`'s `DisplaySpiNode`
defaults now match `display-spi.ts`'s own codegen fallback values, closing that gap for those three
properties (`palette` remains the one display_spi property with no form field — out of scope, a separate
color-picker UI). `board-processor-reference-data.md` (board-family auto-seeded defaults across several
nodes at once) stays unbuilt, its own separately-scoped item — this only supplies the storage/UI
mechanism a future board-preset type could sit on top of. 1 entry:
`docs/working-notes/decisions/presets.md`.

## Processor and board definitions (MVP item 4)

**2026-09-23 -- built, NOT yet verified on real hardware.** Hand-writable JSON definitions: built-ins in
`editor/src/definitions/{processors,boards}/`, user files in `~/.thingstudio/processors/` and `boards/`
(read-only `GET /api/definitions`), id = file name, user file replaces a built-in whole, invalid files
logged loudly. New toolbar Board menu (Auto from HELLO `chipType`, or a manual pick). All 7 pin-taking
nodes check pins, SPI/I2C buses and SPI speed against the target; errors vs warnings split as the brief
suggested. 1 entry: `docs/working-notes/decisions/chip-board-definitions.md`.

## What this list doesn't include

Small per-file implementation judgment calls (exact property names, which
bucket a specific type pair lands in, pin numbers) — those live in the
node's or file's own header comment, per this project's existing
convention, and aren't worth indexing here.

## Board recovery, command box, stop to prompt

Console command box (EXEC), stop to the MicroPython prompt and restart (STOP_TO_PROMPT), boot-loop safe mode,
and "Remove flow…" that retries through resets; runtime 2.0.0. 1 entry:
`docs/working-notes/decisions/board-recovery-and-commands.md`.

## WiFi transport (MVP item 6)

Backend-relayed TCP link, flow owns WiFi, password auth set over USB (serial exempt, WiFi off until set),
board-level hostname, UDP probe for the board list; built 2026-09-24, runtime 3.0.0; ESP-IDF heap in HELLO (2026-09-25). 7 entries: `docs/working-notes/decisions/wifi-transport.md`.

## Packaging and install routes (MVP item 7)

Public repo + GitHub Releases, relocatable python-build-standalone folder per platform, macOS signed, CLI
`thingstudio`, launchd/systemd recipes; mDNS/remote backend deferred to posture-2 (2026-09-26); packaged
assets built, dev checkout wins over `_assets/`; bundles on native runners, draft releases;
`install.sh` as a release asset. 10 entries:
`docs/working-notes/decisions/packaging.md`.
