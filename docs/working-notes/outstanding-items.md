# Outstanding items — working-notes backlog

Status: index, restructured 2026-08-22 from the 2026-08-19 consolidated map
(`working-notes-consolidation-briefing.md`). **This restructuring only changed shape, not content or status** — it
did not re-audit anything against `git log` or re-verify what's landed. Each item below is a 1-2 line pointer; the
full reasoning for any item with more than that lives in `outstanding-items/<slug>.md`. Read this file plus
`docs/thingstudio-design-doc.md` to get an accurate picture of what's open across the whole project without opening
every file in `docs/working-notes/`.

Originally compiled by auditing every file in `docs/working-notes/` (including `validation/mvp-validation-plan.md`)
against its own stated success criteria/stop conditions, cross-checked against `git log` and against
`docs/thingstudio-design-doc.md`'s own resolved/open sections. Where a file's resolution status couldn't be
confirmed with confidence, it was flagged as open rather than guessed closed — see "Flagged as ambiguous" at the
bottom. That audit is not redone here; item status reflects the 2026-08-19/2026-08-21 audit plus whatever's noted
inline, not a fresh check.

## Next up (already flagged before this audit, unstarted)

- **MQTT real-hardware validation + network follow-ups (in progress).** **Mike's direct request, top priority (2026-08-22).** Real-hardware validation of the MQTT WiFi-precheck fix, full MQTT functional pass, `http_request`'s config-node/canvas migration, and Problem 2a's loud-error fix extended to `http_request`/`mqtt-shared.ts`. ([detail](outstanding-items/mqtt-hardware-validation.md))
- **Redeploy cleanup / network fault detection (implemented 2026-08-20, hardware pass still owed).** Implemented 2026-08-20: cleanup registry replacing GC-timing socket leak, mandatory `wifiConfigId` (with new `"unmanaged"` opt-out), compile-time check on empty password. **Still owed:** the real-hardware redeploy pass and `http_request`/`mqtt-shared.ts` loud-error treatment. ([detail](outstanding-items/redeploy-cleanup-network-fault-detection.md))
- **Sequencing override set by Mike, 2026-08-20 (read before picking anything else as "next").** Order: (1) custom node authoring + docs — done 2026-08-20; (2) a deliberately narrow validation session using only `docs/user-guide/custom-nodes.md`, not yet run by Mike; (3) resume normal backlog order after. ([detail](outstanding-items/sequencing-override.md))
- **RP2350 (Pico 2 / Pico 2 W) bring-up — not started.** Follow-up to the RP2040 bring-up session; never executed. RP2040 confirmed working with comfortable RAM headroom; RP2350 untouched on real hardware. Resume point after the sequencing override above, not before. ([detail](outstanding-items/rp2350-bringup.md))

## Network / config nodes

- **`http_request` never got the config-node treatment.** Still registry-only, raw `ssid`/`password` per instance, no canvas presence — explicitly flagged as a follow-up when `wifi_status`/`udp_send`/`udp_receive`/`mqtt_publish`/`mqtt_subscribe` all got this treatment. ([detail](outstanding-items/http-request-config-node-gap.md))
- **MQTTS (MQTT over TLS) — not built, deferred on Mike's explicit call (2026-08-21).** Vendored `mqtt_as`'s `config` dict already has unused `ssl`/`ssl_params` keys; checked against the one-way-door principle before deferring — a config's `properties` is a plain JSON blob, so this isn't a one-way door. Nothing reserved. ([detail](outstanding-items/mqtts-tls-deferred.md))
- **TCP send / TCP listen-receive — never built.** `udp-tcp-nodes-implementation-briefing.md` scoped four node types; only UDP send/receive landed. TCP send needs a lazy-expiry connection cache; TCP listen-receive needs a callback-to-coroutine bridge design. Tracked in `mvp-feature-priorities.md` Tier 1 item 5 point 3. ([detail](outstanding-items/tcp-send-listen-receive.md))
- **I2C/SPI sensor nodes — not started at all.** Tier 1 item 3, gated on having actual sensor hardware on hand. Also carries an unresolved fault-handling question (stuck I2C device hang) Mike flagged 2026-08-16, and gates on the I2C/SPI slave-mode witness-rig spike. ([detail](outstanding-items/i2c-spi-sensor-nodes.md))
- **Network nodes' real hardware pass — partially closed.** UDP send/receive: real hardware pass done (echo-tester flow). `wifi_status`/`http_request`: off-device verified only. `mqtt_publish`/`mqtt_subscribe`: first real hardware pass 2026-08-21 surfaced the WiFi reconnect-race bug; fix needs a second pass to confirm it holds. ([detail](outstanding-items/network-hardware-pass-status.md))
- **Whether to file an upstream issue for the `mqtt_as` WiFi-reconnect race — undecided, Mike's call.** Real bug confirmed against current `master` of peterhinch/micropython-mqtt, but the same class of fix has been raised before (#59, #61, #57) without landing — which is exactly why Thingstudio fixed it locally instead. ([detail](outstanding-items/mqtt-upstream-issue-decision.md))
- **Filter / event-compression node — not built.** Tier 1 item 5 point 2, pulled into v1 alongside interrupt/pin-change but never implemented. Buildable with zero new compiler capability (reuses `timer.ts`'s per-instance state pattern) — just not done yet. ([detail](outstanding-items/filter-event-compression-node.md))
- **Most of the node library still has no canvas presence.** `variable_get`, `variable_set`, `pwm_out`, `http_request` are registry-only: real codegen, no Rete class, no palette entry, unreachable from the editor UI. `boolean`/`arithmetic`/`comparator` removed as node types entirely 2026-08-21; `mqtt_publish`/`mqtt_subscribe` closed 2026-08-21. ([detail](outstanding-items/canvas-presence-gaps.md))

## WiFi provisioning / captive portal

- **Tasmota-style soft-AP + captive-portal WiFi fallback — raised by Mike 2026-08-20, no design/scope yet.** Mike believes MicroPython code for this already exists — worth checking before building from scratch. The new `security: "unmanaged"` config state exists specifically to keep this door open. Needs its own scoping session. ([detail](outstanding-items/wifi-provisioning-captive-portal.md))

## Node authoring / extensibility

- **Custom node authoring — implemented 2026-08-20 (historical record).** Letting users create/register their own node types. Scoped and built in one session per Mike's sequencing override; all of its "real open questions" now resolved (distribution mechanism, editor-side discovery, compiler/editor contract, sandboxing). ([detail](outstanding-items/custom-node-authoring.md))

## Redeploy / runtime

- **Pin/resource-conflict detection — never built.** Two nodes claiming the same physical pin in different modes get two independently-correct but conflicting `Pin` objects instead of a compile-time error. Confirmed still open as of the 2026-08-14 GPIO/timer batch. Single-flow-only gap, not just the deferred multi-flow version. ([detail](outstanding-items/pin-resource-conflict-detection.md))
- **Board-transport auth — the one required piece is still unbuilt.** `transport-auth-design.md` recommends HMAC-SHA256 + persisted counter for v1.1+, but names one cheap v1 hedge: `HELLO`'s `authRequired`/`authScheme` fields, even shipping `false`/`"none"`. Tier 0 committed item, no commit yet. ([detail](outstanding-items/board-transport-auth.md))
- **OTA-capable partition table on the ESP32 build — still not done.** Tier 0 item, flagged repeatedly across multiple later briefings as "still not done." Build-config only, one-way door (every field device would need a manual reflash later otherwise), no code dependency on anything else outstanding. ([detail](outstanding-items/ota-partition-table.md))
- **Tier 2 — live value streaming + flow/state persistence — not started at all.** `mvp-feature-priorities.md`'s own framing: this is half of §1's value proposition, should be pulled forward in parallel with Tier 1, not trail behind it. `mvp-validation-plan.md`'s Tier 2 section is entirely `(pending)`. Variable get/set are currently in-RAM only, not the flash-backed store §5 describes. ([detail](outstanding-items/tier2-live-streaming-persistence.md))
- **Stateful nodes / cross-message synchronization (Node-RED-style `join`) — not started, not even scoped.** Flagged 2026-08-13, still open. Distinct from the (now-resolved) flashing-LED `context`/`flow` gap, which did get built. ([detail](outstanding-items/stateful-nodes-join.md))
- **Connection-state gate/router nodes — neither shape built.** A pass-or-drop WiFi/MQTT-status gate (cheap) and a real two-output status router (needs a genuine multi-output-port contract) are both flagged, neither started. The router shape connects to a bigger "route by a condition" need. ([detail](outstanding-items/connection-state-gate-router-nodes.md))
- **Tier 1 "kitchen sink" gate — not run.** One combined flow wiring every v1 node type together, soak-run for an extended period, per `mvp-validation-plan.md`'s own Tier-level bar. Needs the rest of Tier 1 (I2C sensors, network hardware pass, remaining canvas wiring) to mean anything. ([detail](outstanding-items/tier1-kitchen-sink-gate.md))

## UI / editor

- **Live console output shows raw numeric node IDs only.** No way to map `NODE_ERROR node=4`/`DEBUG node=2` back to a canvas node without reading the flow file's JSON by hand. Logged as a priority bug, 2026-08-19, in `mikes-questions-and-points.md`'s "Bugs -- priority" section. The editor already tracks a node-id↔canvas-node mapping internally (`graph-adapter.ts`'s `reteIdByNodeId`/`nodeIdByReteId`) for other reasons, so this should be a small, contained fix. Unstarted. ([detail](outstanding-items/console-node-id-mapping.md))
- **Drag-to-splice — still not built, still needs Mike's own real-browser call.** Reclassified to "should eventually match Node-RED" priority (2026-08-15 addendum, `mvp-feature-priorities.md`), and multiple Rete migration sessions confirmed a working ~90-line poc-rete implementation exists to port — but the trigger mechanism (`nodedragged` vs. `nodetranslated`) is an explicitly unresolved hands-on judgment call only Mike can make in his own browser. `rete-migration-phase4-briefing.md` confirms this is untouched even after the full Rete migration closed out — `editor/src/app/rete/insert-node.ts` was never ported from poc-rete. ([detail](outstanding-items/drag-to-splice.md))
- **Mike's own suspicion, not yet diagnosed: `inject` might be doing the job of two separate nodes.** Flagged 2026-08-17 in `mikes-questions-and-points.md`'s "To review" section, wants a review "fairly soon." No investigation yet. ([detail](outstanding-items/inject-node-review.md))
- **"Init node triggered by start of flow?" — raw open question, never discussed.** From `mikes-questions-and-points.md`'s "Nodes - to be prioritised" list, never discussed even in the Tier 1 prioritization session that triaged every other item on that list. Whether `inject`'s manual/repeat semantics already cover this is unconfirmed — resolve alongside the inject-node review, not separately. ([detail](outstanding-items/init-node-on-flow-start.md))
- **Named/labeled pin mapping — Mike's ask, not scoped.** Define human-readable names for pins once, reuse them in every pin-selection dropdown, instead of remembering "sensor X is on GPIO14" by hand. Related to but distinct from the config-node work already done. ([detail](outstanding-items/named-labeled-pin-mapping.md))
- **Machine/board-specific node collections — Mike's ask, not scoped.** Node "collections" for board/processor-specific node sets (e.g. Pi Pico PIO nodes), so the palette doesn't show irrelevant nodes for the target board. Connects to the editor-board-awareness item. ([detail](outstanding-items/board-specific-node-collections.md))
- **General UI wishlist, untriaged.** `mikes-questions-and-points.md`'s "# UI" section: collapsible/resizable panes, delete node/wire, a notes/README sheet for documenting a flow. Not scoped, not prioritized against anything else here. ([detail](outstanding-items/ui-wishlist-untriaged.md))
- **Editor board-awareness — filter palette / warn on bad pins by target board.** Explicitly "medium-term, not for now" (2026-08-15). Connects to §6's already-flagged v2 pin-conflict gap and the board-specific-node-collections item. ([detail](outstanding-items/editor-board-awareness.md))
- **Recovery button/jumper for a wedged listener — not scoped as a real design.** A runtime-image feature (not a node) giving §5's boot-time Ctrl-C escape hatch a standing, on-demand equivalent for the life of the device, not just the first few seconds after boot. Concrete implementation notes exist in `architecture-review-briefing.md`. ([detail](outstanding-items/recovery-button-wedged-listener.md))
- **Low-memory warning — not scoped.** §13 describes `HELLO` reporting free flash/RAM so the editor can warn before a flow is too big, but only the version-compatibility half of the pre-flight check is wired in. Would also need the max-flow-size ceiling item resolved. ([detail](outstanding-items/low-memory-warning.md))

## Hardware / rig

- **§3's RP2040-vs-RP2350 RAM floor — still not formally closed.** RP2040 data is in hand and comfortable (~209KB free of 264KB, no drift under real interrupt traffic) but is one flow on one board, not proof against every v1 flow shape. RP2350 bring-up hasn't happened. Whether that's enough to close §3's provisional language is Mike's call. ([detail](outstanding-items/rp2040-vs-rp2350-ram-floor.md))
- **No stated maximum-flow-size assumption anywhere in the design doc.** No max node count / max stateful-node count — a RAM trend line needs a ceiling to validate against. Flagged 2026-08-15, not pinned down. ([detail](outstanding-items/max-flow-size-ceiling.md))
- **CBOR-over-JSON (§13) — the original revisit trigger has technically passed.** The real wire protocol has shipped, so the "revisit once real payload sizes exist" trigger has passed, but no explicit revisit of the size trade-off has happened since. Low priority, worth closing out formally or dropping. ([detail](outstanding-items/cbor-over-json-revisit.md))

## Backend / auth

- **Backend / auth — the whole thin-backend architecture is design-only, now marked MVP-needed.** No `backend/` directory exists anywhere in this repo yet. Platform (Python/aiohttp/pyserial) and editor-auth-and-protocol decisions are both decision-complete but zero code. Newly marked MVP-needed by Mike, 2026-08-21. ([detail](outstanding-items/backend-auth-overview.md))
- **Explicit cross-platform requirement, added by Mike 2026-08-20: editor/backend must support macOS, Windows, Linux.** Not a new direction — Python + aiohttp + pyserial is already cross-platform in principle — but never stated explicitly before, and no per-OS behavior verified yet (serial port naming/permissions, WebSerial/Web Bluetooth support differ by OS). ([detail](outstanding-items/cross-platform-requirement.md))

## Board/processor reference data

- **A local, maintained folder of board and processor definitions — raised by Mike 2026-08-20, not scoped.** Stop re-deriving/re-fetching board and processor specs from websites each time; keep a curated local reference with per-board advisable/inadvisable pins. Likely data dependency of three other open UI items. ([detail](outstanding-items/board-processor-reference-data.md))

## Docs / process

- **Documentation — nothing written (basic user docs, developer guide).** `mikes-questions-and-points.md`: basic user docs, a developer guide ("how to make new node types"). Nothing started (note: `docs/user-guide/custom-nodes.md` since covers the node-authoring half — see `custom-node-authoring.md`). ([detail](outstanding-items/docs-nothing-written.md))
- **Documentation site — not scoped.** `deployment-and-distribution-notes.md`: unclear whether this means a generated site off `docs/*.md` as-is or a purpose-built site for a different (end-user) audience than the working-notes/design-doc split serves today. ([detail](outstanding-items/documentation-site.md))
- **Tasmota-style runtime install page — not scoped, blocked on an unscoped prerequisite.** Needs `device-runtime` packaged as a single flashable image first (a frozen MicroPython build with the listener/runtime baked in) — that packaging question isn't scoped anywhere either. `deployment-and-distribution-notes.md`. ([detail](outstanding-items/tasmota-install-page.md))
- **CI vendor-neutrality — should CI be independent of GitHub specifically?** Mike's raised question (`mikes-questions-and-points.md`, "# CI"). Currently GitHub Actions (`repo-structure-and-conventions.md`). Not revisited. ([detail](outstanding-items/ci-vendor-neutrality.md))
- **Package-install/distribution story for the backend — not decided.** pip install vs. a frozen PyInstaller-style build vs. something else. Explicitly not decided in `backend-platform-decision.md` §7, pointed at `deployment-and-distribution-notes.md`, which hasn't scoped it either. ([detail](outstanding-items/backend-distribution-story.md))

## Already tracked — v2/v3 candidates and open design-doc questions (not this list's job to re-derive)

Design doc §10's own v2 candidate list (roughly in priority order): full BLE/WiFi transport with pairing/auth,
per-device config override on top of v1's now-shipped shared config nodes, a catch/error node, Home Assistant
auto-discovery on the v1 MQTT node, incremental (non-full) redeploy, mDNS discovery, TCP client proactive connection
expiry on top of v1's lazy-expiry version. §10's v3+ list: a self-hosted mini dashboard (needs an on-device HTTP
server — also the "HTTP in" item Mike raised, deliberately not folded into v1's UDP/TCP promotion), multi-device
flows, a companion server for team libraries/fleet deployment. `mvp-feature-priorities.md`'s own "Explicitly still
out of v1" section covers the same ground in more detail and is the fuller source if needed.

## Coverage note — closing the loop on `mikes-questions-and-points.md`

Two items from that file are fully resolved elsewhere but weren't otherwise cross-referenced back to the raw note:

- **"App Platform"** (backend-served web UI vs. a cross-platform GUI app) — resolved 2026-08-16: thin local Python
  backend + browser-based web editor, explicitly not Electron/Tauri. `decisions.md`, "Backend" section, first entry.
- **"file ops"** (from "Nodes - to be prioritised") — resolved 2026-08-17: rejected as a node type entirely,
  reduces to a `function`-node one-liner. `decisions.md`, "Config nodes / Tier 1 scope" section, first entry.

## Flagged as ambiguous — needs a human decision, not guessed here

- **`architecture-review-briefing.md`'s "browser-only, no install" claim (§4).** See
  [detail](outstanding-items/ambiguous-browser-only-claim.md).
- **`mikes-questions-and-points.md` itself is a live, actively-appended file** (most recent entry dated 2026-08-19
  as of the original audit) — treated as a permanent open-items scratchpad, not something to mark resolved or
  archive. Its still-open items are pulled into the relevant sections above; re-check it directly for anything
  newer than this index.
- **`mvp-feature-priorities.md` and `validation/mvp-validation-plan.md` remain the live sources of truth** for
  tier-by-tier status — both are large, actively-maintained tracking documents in their own right, not superseded
  by this index. This file pulls their open items forward but doesn't replace them; check them directly for
  anything this index compressed away.

---

## Files marked fully resolved by the original 2026-08-19 audit (archived 2026-08-22)

Moved into `docs/working-notes/archive/` 2026-08-22 (unchanged otherwise, just relocated — none of these were
edited) so the main directory only shows files an active session might actually need:

`archive/config-node-system-scoping.md`, `archive/editor-hands-on-briefing.md`,
`archive/editor-look-and-feel-briefing.md`, `archive/fault-isolation-briefing.md`,
`archive/mvp-planning-briefing.md`, `archive/repo-structure-and-conventions.md`,
`archive/rete-migration-decision.md`, `archive/rete-migration-implementation-briefing.md`,
`archive/rete-migration-phase3-briefing.md`, `archive/rete-migration-phase4-briefing.md`,
`archive/rete-migration-planning-briefing.md`, `archive/rete-spike-briefing.md`,
`archive/rp2040-bringup-findings.md`, `archive/tier1-interrupt-node-implementation-briefing.md`,
`archive/tier1-node-candidates-prioritization-briefing.md`, `archive/tier1-node-set-briefing.md`,
`archive/wire-protocol-briefing.md`, `archive/wire-type-system-scoping.md`,
`archive/wire-type-system-implementation-briefing.md`.

Every other file in the inventory was read and classified but left completely untouched — either because it's
partially resolved (open items pulled forward above, rest of the file stands as historical context), still fully
active, or is one of the three living tracking documents noted under "Flagged as ambiguous."
