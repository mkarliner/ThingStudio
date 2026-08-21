# Outstanding items — working-notes backlog

Status: consolidated map, written 2026-08-19 (`working-notes-consolidation-briefing.md`'s
own session). This is a map, not a copy — each item is a one/two-line
summary with a pointer back to its source file for full reasoning. Read
this file plus `docs/thingstudio-design-doc.md` to get an accurate picture
of what's open across the whole project without opening all 33+ files in
`docs/working-notes/`.

Compiled by auditing every file in `docs/working-notes/` (including
`validation/mvp-validation-plan.md`) against its own stated success
criteria/stop conditions, cross-checked against `git log` (71 commits at
audit time) and against `docs/thingstudio-design-doc.md`'s own resolved/
open sections. Where a file's resolution status couldn't be confirmed with
confidence, it's flagged as open rather than guessed closed — see
"Flagged as ambiguous" at the bottom.

Files fully resolved by this audit got a short dated status note prepended
(pointing back here) and were otherwise left untouched — nothing was
deleted or rewritten. See the file list at the very end for exactly which
ones.

---

## Next up (already flagged before this audit, unstarted)

- ~~**`redeploy-cleanup-and-network-fault-detection-briefing.md`**~~ —
  **implemented 2026-08-20**, all three sub-items: (1) `runtime.py` gained
  an explicit `register_cleanup`/`cancel_running` cleanup registry, closed
  over by `udp-send.ts`/`udp-receive.ts`'s own setup statements, replacing
  the GC-timing-dependent redeploy socket leak; (2) `wifiConfigId` is now
  mandatory for `wifi_status`/`udp_send`/`udp_receive` (Mike's own Option
  B call), with a new `"unmanaged"` config `security` state as the
  explicit opt-out (see the new "WiFi provisioning / captive portal" item
  below for why that state exists); (3) `thingstudio/config/wifi` gained a
  `security: "password" | "open" | "unmanaged"` field, with an empty
  password on `"password"`-security now a compile-time `CompileError`.
  `device-runtime`'s off-device tests (11/11, including 4 new ones) pass
  against a freshly-built real MicroPython unix-port binary; the editor
  suite (262/262 across 29 files, up from 251) passes via `tsc --noEmit` +
  `vitest run`. **Still owed, not done this session (needs Mike, real
  hardware)**: the actual real-hardware pass this briefing's own success
  criteria require — redeploying `udp-echo-tester.flow.json` twice
  back-to-back with no `EADDRINUSE`, and confirming a real network
  failure's `NODE_ERROR` message is actually diagnosable on-device, not
  just in the generated source. `http_request`/`mqtt-shared.ts` did NOT
  get the Problem 2a loud-error treatment (briefing flagged this as a
  judgment call, not mandated) — still open, see "Network / config nodes"
  below, unchanged.

- **Sequencing override, set by Mike 2026-08-20 — read this before
  grabbing anything else in this file as "next."** Out of this list's
  normal order, in this sequence:
  1. ~~**Custom node authoring** (below, "Node authoring / extensibility")
     **+ documentation** (below, "Docs / process")~~ — **implemented
     2026-08-20**, scoping and implementation both, in the same session
     (the scoping gap this bullet originally flagged was resolved as that
     session's own first task, per Mike's call, not raised back as a
     blocker). Two-file package format (`<name>.node.json` +
     `<name>.node.py`), a generic `NodeDefinition` builder
     (`node-library/custom-node.ts`) requiring zero `compile.ts` changes,
     session-scoped browser loading (multi-file picker,
     `custom-nodes-store.ts`), no sandboxing (same trust boundary as the
     `function` node, confirmed with Mike), output ports capped at 1 by
     codegen validation only (not the package format — doesn't compromise
     the multi-output-routing item below). 285/285 editor tests pass
     (30 files, up from 29), `tsc --noEmit` and `vite build` both clean.
     End-user documentation: `docs/custom-nodes.md`. Full reasoning:
     `custom-node-authoring-scoping.md`; ledger entries:
     `decisions.md`'s new "Node authoring / extensibility" section,
     `learnings.md`'s new "Custom node authoring" section (the
     `nonlocal`-not-`global` gotcha). See "Node authoring / extensibility"
     below — its own "real open questions" list is now resolved, not just
     this bullet.
  2. **A deliberately narrow validation session, next.** Mike will run a
     session equipped with *only* `docs/custom-nodes.md` — not this file,
     not `CLAUDE.md`, not the rest of `docs/working-notes/` — and ask it
     to build a new node type from a brief, as a real test of whether the
     documentation alone is sufficient for that task, not just whether it
     reads well. Not this project's job to set up.
  3. **Resume this file's normal order after (2) closes out** — back to
     whichever item is earliest below at that point (currently
     `rp2350-bringup-briefing.md`, next bullet, unless something changes
     before then).

- **`rp2350-bringup-briefing.md`** — written as the follow-up to the
  RP2040 bring-up session; never executed (no matching commit in
  `git log`). RP2040 (plain Pico) is confirmed working, stable, with
  comfortable RAM headroom (`rp2040-bringup-findings.md`) — RP2350
  (Pico 2 / Pico 2 W) has not been touched on real hardware at all.
  §3's RP2040-vs-RP2350 floor question is explicitly waiting on Mike's
  own sign-off once this data exists, not decided anywhere yet.
  **Not the immediate next session** — see the sequencing override
  above; this is the resume point after it, not before.

---

## Network / config nodes

- **`http_request`/`mqtt_publish`/`mqtt_subscribe` never got the
  config-node treatment.** `config-node-and-palette-implementation-briefing.md`
  landed the config-node subsystem and wired `wifi_status`/`udp_send`/
  `udp_receive` onto the canvas sharing one `thingstudio/config/wifi`
  object; these three network node types are still registry-only,
  duplicating raw credentials per instance. Explicitly flagged as a
  follow-up in that briefing's own success-criteria section, not a silent
  scope cut.

- **TCP send / TCP listen-receive were never built.** `udp-tcp-nodes-implementation-briefing.md`
  scoped four new node types; only UDP send/receive landed (confirmed
  hardware-tested via `test-flows/udp-echo-tester.flow.json`, per
  `config-node-and-palette-implementation-briefing.md`). TCP send (needs a
  new lazy-expiry connection cache) and TCP listen-receive (needs a real
  callback-to-coroutine bridge design, `uasyncio.start_server`'s
  per-connection handler into this project's one-coroutine-per-source
  model, plus a per-connection read timeout) are both still open design
  + implementation work, tracked in `mvp-feature-priorities.md` Tier 1
  item 5 point 3.

- **I2C/SPI sensor nodes — not started at all.** Tier 1 item 3, gated on
  having actual sensor hardware on hand (`tier1-sensors-network-briefing.md`).
  Also carries its own unresolved fault-handling question, flagged by Mike
  2026-08-16 (`mikes-questions-and-points.md`): does a stuck/unresponsive
  I2C device hang the node's coroutine indefinitely, and does that need
  the same bounded-timeout treatment §5 requires for network I/O? Per
  `CLAUDE.md`'s engineering priority, this should be resolved while
  building the first I2C sensor node, not deferred past it. Also gates on
  the I2C/SPI slave-mode spike for witness-rig adversarial testing —
  `witness_firmware.py`'s `I2C_SLAVE_EMULATE` is still a stub.

- **Network nodes' real hardware pass — still pending.** `wifi_status`,
  `http_request`, `mqtt_publish`, `mqtt_subscribe` are off-device verified
  only (`mvp-validation-plan.md`'s 2026-08-14 Results entry); no pass
  against a real local MQTT broker or HTTP test server on real hardware
  has been recorded. (UDP send/receive did get a real hardware pass later,
  via the echo-tester flow — that part of this gap is closed.)

- **Filter / event-compression node — not built.** Tier 1 item 5 point 2
  (`mvp-feature-priorities.md`), pulled into v1 alongside interrupt/
  pin-change but never implemented. Buildable with zero new compiler
  capability (reuses `timer.ts`'s per-instance state pattern) — just not
  done yet.

- **Half the registered node library still has no canvas presence.**
  `wire-type-system-scoping.md` flagged this directly: of 16 registered
  node types, only `inject`/`function`/`debug`/`gpio_out`/`timer` were
  wired onto the Rete canvas originally. Since then `interrupt`,
  `wifi_status`, `udp_send`, `udp_receive` were added — but `boolean`,
  `arithmetic`, `comparator`, `variable_get`, `variable_set`, `pwm_out`,
  `http_request`, `mqtt_publish`, `mqtt_subscribe` are all still
  registry-only: real compiler-side codegen, no Rete node class, no
  palette entry, unreachable from the actual editor UI. This is a large,
  currently-invisible gap between "the node library" and "what a user can
  actually drag onto the canvas."

## WiFi provisioning / captive portal

- **Tasmota-style soft-AP + captive-portal WiFi fallback — raised by Mike
  2026-08-20, no design or scope exists anywhere yet.** When the device
  can't connect to its configured network, it would fall back to hosting
  its own AP with a captive portal, letting a user scan for and pick a
  real network (and presumably persist the result, likely via ESP-IDF's
  own NVS station-config caching — the same mechanism that turned out to
  be the root cause of Problem 2b above). **Mike's own note: he believes
  there's existing MicroPython code for this already** — worth checking
  before building from scratch (a common pattern with several published
  implementations, e.g. search "MicroPython captive portal WiFiManager");
  not verified or evaluated yet, just recorded so whoever scopes this
  doesn't start from zero.
  Directly relevant to `redeploy-cleanup-and-network-fault-detection-
  briefing.md`'s Problem 2b (`wifi-status.ts`'s header, `decisions.md`'s
  new "Redeploy / network fault handling" section): making `wifiConfigId`
  mandatory for `wifi_status`/`udp_send`/`udp_receive` would have
  foreclosed this direction outright if there were no way for a flow to
  say "something else manages this connection." The new `security:
  "unmanaged"` state on `thingstudio/config/wifi` exists specifically to
  keep this door open — a flow that wants to ride on a captive-portal-
  provisioned connection references an `"unmanaged"` config rather than
  omitting `wifiConfigId` (which is now a compile error). That state is
  built; the actual captive-portal/soft-AP provisioning mechanism itself
  (a device-runtime boot-time subsystem, most likely, not a flow/node
  concept at all) is not — needs its own dedicated scoping session before
  any implementation starts, same as "Node authoring / extensibility"
  below.

## Node authoring / extensibility

**Implemented 2026-08-20** — scoped and built in one session per Mike's
sequencing override above. The item below is left as historical context
(what was unknown going in); each of its "real open questions" now has a
resolution, noted inline. `custom-node-authoring-scoping.md`,
`docs/custom-nodes.md`, `decisions.md`'s "Node authoring / extensibility"
section.

- **Custom node authoring — letting users create and register their own
  node types without rebuilding the whole system. No design or scope
  exists anywhere yet; added to the backlog 2026-08-19, not from an audit
  finding.** `docs/thingstudio-design-doc.md` §7 already lays the
  conceptual groundwork, worth rereading before scoping this: a node is
  just two halves — a small JSON descriptor for the editor (palette
  entry, ports, property UI) plus a Python module implementing its
  behavior — and because node logic is ordinary precompiled `.mpy`, not
  baked into the firmware image, §7's own framing is that adding a node
  type should be "a matter of pushing a new `.mpy` module to the device's
  filesystem alongside the flow, not rebuilding and reflashing the
  runtime — much closer to Node-RED's install-a-node-and-go model than a
  native-code VM allows." §11 explicitly defers the *mechanism* past v1
  (v1's node set ships fixed inside the runtime image), and no v2/v3
  candidate in §10's own roadmap names this as its own line item —
  worth adding there once this is actually scoped, not silently treated
  as covered by §7's prose alone.

  Real open questions, as of 2026-08-19 — each now resolved, see the note
  appended to it:
  - **Distribution mechanism** — how a user-authored node actually gets
    from wherever it's written onto a device. §11's own sketch (never
    built) is a module-push wire message plus a version/hash field on
    `HELLO`, extending the free-space accounting §6's multi-flow section
    already discusses — worth confirming that's still the right shape
    rather than assumed.
    **Resolved 2026-08-20: no new wire protocol.** Custom node Python is
    inlined into the existing DEPLOY-compiled flow module, same as any
    first-party node's generated code — §11's module-push sketch stays
    deferred until a real need (shared-across-flows, size) forces it, not
    built now. `custom-node-authoring-scoping.md` Decision 1.
  - **Editor-side discovery/registration** — how the editor's palette
    picks up a node it didn't ship with: a manifest format, a local
    file-watch/import step, or something heavier. Nothing like this
    exists in `editor/src/node-library/registry.ts` today, which is a
    static, compiled-in list.
    **Resolved 2026-08-20: session-scoped browser file picker, no
    persistence.** A two-file package (`<name>.node.json` +
    `<name>.node.py`) loaded via the File System Access API multi-file
    picker into a new reactive store (`app/rete/custom-nodes-store.ts`),
    parallel to but deliberately separate from the config-node store —
    not cleared by "clear canvas," not saved/reloaded across sessions.
    `custom-node-authoring-scoping.md` Decision 4.
  - **Whether the compiler/editor contract extends cleanly to
    third-party-authored nodes.** `node-definition-model.md`'s
    `NodeDefinition` contract (type ID, ports, properties, codegen hook,
    claimed resources) and the wire-type system's coercion rules
    (`wire-type-system-scoping.md`) were both designed and built assuming
    every node type is first-party. Whether a user-authored node can
    declare ports/types through the same contract, or needs a narrower
    one, is unexplored.
    **Resolved 2026-08-20: yes, cleanly, via a generic builder.**
    `buildCustomNodeDefinition()` (`node-library/custom-node.ts`) wraps
    one instance's `.node.py` text in a per-instance closure and returns
    an ordinary `NodeDefinition` — indistinguishable to `compile.ts` from
    a first-party registry entry; zero compiler-core changes needed.
    Output ports capped at 1 by this builder's own codegen validation
    (not the wire-type system or the package format), specifically so it
    doesn't foreclose the multi-output-routing item under "Redeploy /
    runtime" below. `custom-node-authoring-scoping.md` Decisions 2 and 3.
  - **This is very likely the trigger condition for §11's already-flagged,
    currently-dormant function-node-sandboxing question.** §11 resolved
    "no hardening for v1" specifically because "v1 has no marketplace or
    shared-flow mechanism... revisit if/when Thingstudio ever supports
    something like shared/marketplace flows written by someone other than
    the deployer." Custom node authoring is close kin to exactly that —
    arguably closer than a shared *flow* would be, since a node runs with
    the same trust level as the runtime itself, not just as flow-author
    code inside the existing `function` node's already-accepted trust
    perimeter. Whoever scopes this should treat the sandboxing question as
    back on the table, not still safely deferred.
    **Resolved 2026-08-20, Mike's explicit call: no hardening, same as
    the `function` node — "go with the trust-boundary call (until it
    bites us)."** Custom nodes don't cross the existing deploy-access
    trust perimeter (§9); loading stays session-scoped only, no registry
    or URL-install mechanism exists or is planned, so the "someone other
    than the deployer" trigger condition §11 named still hasn't actually
    occurred. Revisit if real pain shows, not preemptively.
    `custom-node-authoring-scoping.md` Decision 5.

## Redeploy / runtime

- **Pin/resource-conflict detection — never built.** `node-definition-model.md`'s
  long-standing flagged gap: two nodes claiming the same physical pin in
  different modes get two independently-correct (but conflicting) `Pin`
  objects instead of a compile-time error. Confirmed still open as of the
  2026-08-14 GPIO/timer batch (`mvp-validation-plan.md`'s Results entry
  says this explicitly). Single-flow-only for now, so this is a real gap
  within one flow, not just the already-deferred multi-flow version.

- **Board-transport auth — the one required piece is still unbuilt.**
  `transport-auth-design.md` (2026-08-16) recommends HMAC-SHA256 +
  persisted counter for v1.1+, but names exactly one thing as a real,
  cheap, one-way-door hedge for v1 itself: two new fields on `HELLO`
  (`authRequired: bool`, `authScheme: string`), even shipping
  `authRequired: false`/`authScheme: "none"` — so a future device with
  real auth can be told apart from an old one an attacker stripped auth
  from. `mvp-feature-priorities.md`'s Tier 0 list picked this up
  2026-08-16 as a committed item; no commit implementing it has landed.
  Cheap (two lines per side in `messages.ts`/`codec.ts`/`messages.py` plus
  a version-matrix test case) and still open.

- **OTA-capable partition table on the ESP32 build — still not done.**
  Tier 0 item, flagged repeatedly across multiple later briefings
  (`tier1-node-set-briefing.md`, `tier1-sensors-network-briefing.md`) as
  "still not done." Build-config only, one-way door (every field device
  would need a manual reflash later to become OTA-capable otherwise), no
  code dependency on anything else outstanding.

- **Tier 2 — live value streaming + flow/state persistence — not started
  at all.** `mvp-feature-priorities.md`'s own framing is that this isn't
  "polish to do last," it's half of §1's actual value proposition, and
  should be pulled forward in parallel with Tier 1 rather than trail
  behind it. `mvp-validation-plan.md`'s Tier 2 section is entirely
  `(pending)`. Variable get/set are currently in-RAM only, not the
  flash-backed store §5 describes.

- **Stateful nodes / cross-message synchronization (a Node-RED-style
  `join` node) — not started, not even scoped as a design.** Flagged
  2026-08-13, still open. Distinct from the (now-resolved) flashing-LED
  `context`/`flow` gap, which did get built.

- **Connection-state gate/router nodes — neither shape built.** A
  pass-or-drop WiFi/MQTT-status gate (cheap, no compiler change) and a
  real two-output status router (needs a genuine multi-output-port
  contract in the compiler/graph model) are both flagged, neither started.
  The router shape connects to a bigger, recurring need — "route by a
  condition" — worth designing as a generic switch/router primitive
  rather than wifi/mqtt-specific, per `mvp-feature-priorities.md`'s own
  reasoning.

- **Tier 1 "kitchen sink" gate — not run.** One combined flow wiring every
  v1 node type together, soak-run for an extended period, per
  `mvp-validation-plan.md`'s own Tier-level bar. Needs the rest of Tier 1
  (I2C sensors, network hardware pass, remaining canvas wiring) to mean
  anything.

## UI / editor

- **Live console output shows raw numeric node IDs only** — no way to map
  `NODE_ERROR node=4` or `DEBUG node=2` back to a canvas node without
  reading the flow file's JSON by hand. Logged as a priority bug,
  2026-08-19, in `mikes-questions-and-points.md`'s "Bugs -- priority"
  section. The editor already tracks a node-id↔canvas-node mapping
  internally (`graph-adapter.ts`'s `reteIdByNodeId`/`nodeIdByReteId`) for
  other reasons, so this should be a small, contained fix. Unstarted.

- **Drag-to-splice — still not built, still needs Mike's own real-browser
  call.** Reclassified to "should eventually match Node-RED" priority
  (2026-08-15 addendum, `mvp-feature-priorities.md`), and multiple Rete
  migration sessions confirmed a working ~90-line poc-rete implementation
  exists to port — but the trigger mechanism (`nodedragged` vs.
  `nodetranslated`) is an explicitly unresolved hands-on judgment call
  only Mike can make in his own browser. `rete-migration-phase4-briefing.md`
  confirms this is untouched even after the full Rete migration closed out
  — `editor/src/app/rete/insert-node.ts` was never ported from poc-rete.

- **Mike's own suspicion, not yet diagnosed:** the `inject` node might
  actually be doing the job of two separate nodes — flagged 2026-08-17 in
  `mikes-questions-and-points.md`'s "To review" section, wants a review
  "fairly soon." No investigation yet.

- **"Init node triggered by start of flow?"** — a raw open question from
  `mikes-questions-and-points.md`'s "Nodes - to be prioritised" list,
  never discussed anywhere in the project's history, including the Tier 1
  prioritization session that triaged every other item on that same raw
  list (`tier1-node-candidates-prioritization-briefing.md`). Whether
  `inject`'s existing manual/repeat semantics already cover "fire once when
  the flow starts," or whether this needs its own dedicated node type, is
  unconfirmed — worth resolving alongside the neighboring `inject`-review
  item above, not as a separate investigation.

- **Named/labeled pin mapping** — Mike's ask (`mikes-questions-and-points.md`,
  "Port mapping"): define human-readable names for pins once, reuse them
  in every pin-selection dropdown, instead of remembering "sensor X is on
  GPIO14" by hand. Related to but distinct from the config-node work
  already done — not scoped anywhere yet.

- **Machine/board-specific node collections** — Mike's ask: node
  "collections" for board/processor-specific node sets (e.g. Pi Pico PIO
  nodes), so the palette doesn't show irrelevant nodes for the target
  board. Connects to `architecture-review-briefing.md`'s already-flagged
  "editor board-awareness" item below. Not scoped.

- **General UI wishlist, untriaged** (`mikes-questions-and-points.md`,
  "# UI"): collapsible/resizable panes, delete node/wire, a notes/README
  sheet for documenting a flow. Not scoped, not prioritized against
  anything else here.

- **Editor board-awareness — filter palette / warn on bad pins by target
  board.** Explicitly "medium-term, not for now" (`architecture-review-briefing.md`,
  2026-08-15). Connects to §6's already-flagged v2 pin-conflict gap and to
  the machine-specific node collections item above.

- **Recovery button/jumper for a wedged listener** — a runtime-image
  feature (not a node) giving §5's boot-time Ctrl-C escape hatch a
  standing, on-demand equivalent for the life of the device, not just the
  first few seconds after boot. Concrete implementation notes exist
  (`architecture-review-briefing.md`) but nothing is scoped as a real
  design yet.

- **Low-memory warning** — §13 already describes `HELLO` reporting free
  flash/RAM so the editor can warn before a flow is too big, but only the
  version-compatibility half of the pre-flight check is wired in. A
  runtime/ongoing low-memory warning would also need the max-flow-size
  ceiling below. Not scoped.

## Hardware / rig

- **§3's RP2040-vs-RP2350 RAM floor — still not formally closed.**
  RP2040 bring-up data is in hand and comfortable (~209KB free of 264KB,
  no drift under real interrupt traffic) but is explicitly one flow on one
  board, not proof against every v1 flow shape. RP2350's own bring-up
  (above, "Next up") hasn't happened. Whether that data is enough to
  close §3's provisional language outright is Mike's call, not decided
  anywhere.

- **No stated maximum-flow-size assumption anywhere in the design doc**
  (max node count, max stateful-node count) — a RAM trend line needs a
  ceiling to validate against. Flagged 2026-08-15
  (`architecture-review-briefing.md`), not pinned down.

- **CBOR-over-JSON (§13) — the original "revisit once real payload sizes
  exist" trigger has technically passed** (the real wire protocol has
  shipped) but no explicit revisit of the size trade-off has happened
  since. Low priority, worth closing out formally or dropping.

## Backend / auth (the whole thin-backend architecture is still design-only)

Worth flagging as a group, not just individually — there is currently no
`backend/` (or equivalent) directory anywhere in this repo. Every piece of
`rete-migration-decision.md`'s Decision 2 (a thin local Python backend,
Node-RED's own model, enabling remote access) exists only as design notes;
zero code has been written against any of them yet.

- **`backend-platform-decision.md`** — decision-complete (Python,
  `aiohttp`, plain `pyserial` wrapped in `asyncio.to_thread`), zero code.
- **`backend-editor-auth-and-protocol.md`** — decision-complete (Host-header
  allowlisting for posture 1, hand-rolled `bcrypt`+signed-cookie session
  for posture 2, one WebSocket endpoint multiplexed by frame type), zero
  code.
- **`transport-auth-design.md`**'s board-perimeter half is covered above
  under Redeploy/runtime (the `HELLO` fields).
- Neither backend note's own "what this doesn't decide" list has been
  picked up either: TLS mechanics for posture 2, packaging/config format
  for where the posture-2 password lives, rate limiting.

Whoever picks this up should treat it as one coherent, currently-unstarted
body of work, not three independent small tasks.

- **Explicit cross-platform requirement, added by Mike 2026-08-20
  (`mikes-questions-and-points.md`, "# Platforms"): the editor/backend
  must support macOS, Windows, and Linux.** Not a new architectural
  direction — Python + `aiohttp` + `pyserial` (above) is already
  cross-platform in principle, and this was implicitly part of why
  Electron/Tauri were ruled out (`decisions.md`'s "Backend" section) —
  but it was never stated as an explicit requirement anywhere, and
  nothing about actual per-OS behavior has been verified (serial port
  naming/permissions differ by OS, WebSerial/Web Bluetooth browser
  support differs by OS+browser per `architecture-review-briefing.md`'s
  own learnings). Worth confirming this holds once the backend actually
  gets built, not assumed from the platform choice alone.

## Board/processor reference data

- **A local, maintained folder of board and processor definitions —
  raised by Mike 2026-08-20 (`mikes-questions-and-points.md`, "# Working
  docs"), not scoped anywhere yet.** The ask: stop re-deriving/re-fetching
  board and processor specs from websites each time they're needed;
  keep a curated local reference instead, including notes on which pins
  are advisable/inadvisable to use per board, kept up to date as new
  boards/processors are supported. Distinct from, but a likely data
  dependency of, three already-open UI items above: "Named/labeled pin
  mapping" (a flow author's own per-project pin names), "Machine/board-
  specific node collections" (palette filtering by board), and "Editor
  board-awareness" (warn on bad pins for the target board) — all three
  would plausibly read from this reference data once it exists, rather
  than each inventing their own board-fact source. Not scoped as its own
  design; whoever picks up any of those three UI items should check
  whether this reference folder needs to exist first.

## Docs / process

- **Documentation — nothing written.** `mikes-questions-and-points.md`:
  basic user docs, a developer guide ("how to make new node types").
  Nothing started.
- **Documentation site — not scoped.** `deployment-and-distribution-notes.md`:
  unclear whether this means a generated site off `docs/*.md` as-is or a
  purpose-built site for a different (end-user) audience than the
  working-notes/design-doc split serves today.
- **Tasmota-style runtime install page — not scoped, blocked on a
  prerequisite that also isn't scoped.** Needs `device-runtime` packaged
  as a single flashable image first (a frozen MicroPython build with the
  listener/runtime baked in) — that packaging question isn't scoped
  anywhere either. `deployment-and-distribution-notes.md`.
- **CI vendor-neutrality** — Mike's raised question
  (`mikes-questions-and-points.md`, "# CI"): should CI be independent of
  GitHub specifically. Currently GitHub Actions
  (`repo-structure-and-conventions.md`). Not revisited.
- **Package-install/distribution story for the backend** — pip install vs.
  a frozen PyInstaller-style build vs. something else. Explicitly not
  decided in `backend-platform-decision.md` §7, pointed at
  `deployment-and-distribution-notes.md`, which itself hasn't scoped it
  either.

## Already tracked — v2/v3 candidates and open design-doc questions (not forgotten, not this list's job to re-derive)

Design doc §10's own v2 candidate list (roughly in priority order): full
BLE/WiFi transport with pairing/auth, per-device config override on top
of v1's now-shipped shared config nodes, a catch/error node, Home
Assistant auto-discovery on the v1 MQTT node, incremental (non-full)
redeploy, mDNS discovery, TCP client proactive connection expiry on top of
v1's lazy-expiry version. §10's v3+ list: a self-hosted mini dashboard
(needs an on-device HTTP server — also the "HTTP in" item Mike raised,
deliberately not folded into v1's UDP/TCP promotion, see
`tier1-node-candidates-prioritization-briefing.md`), multi-device flows, a
companion server for team libraries/fleet deployment.

`mvp-feature-priorities.md`'s own "Explicitly still out of v1" section
covers the same ground in more detail and is the fuller source if needed.

## Coverage note — closing the loop on `mikes-questions-and-points.md`

Two items from that file are fully resolved elsewhere in this project but
weren't otherwise cross-referenced back to the raw note — recording the
pointer here so every item in that file has a traceable disposition in one
place, not just scattered across `decisions.md`:

- **"App Platform"** (should the editor ship as a backend-served web UI,
  or a cross-platform GUI app like Electron/Tauri?) — resolved
  2026-08-16: thin local Python backend + browser-based web editor,
  explicitly not Electron/Tauri. `decisions.md`, "Backend" section, first
  entry.
- **"file ops"** (from the "Nodes - to be prioritised" list) — resolved
  2026-08-17: rejected as a node type entirely, reduces to a
  `function`-node one-liner. `decisions.md`, "Config nodes / Tier 1
  scope" section, first entry.

## Flagged as ambiguous — needs a human decision, not guessed here

- **`architecture-review-briefing.md`'s "browser-only, no install" claim
  (§4)** — flagged as unusually undermotivated when originally written;
  partially overtaken by the backend-architecture decision (Decision 2)
  but never explicitly closed out as "yes, still true" or "no, superseded."
  WebSerial itself was later confirmed to survive as a frozen local-only
  fallback (`deployment-and-distribution-notes.md`), which resolves part
  of this, but the original §4 framing question was never explicitly
  revisited against that resolution.
- **`mikes-questions-and-points.md` itself is a live, actively-appended
  file** (most recent entry dated 2026-08-19, the day this audit ran) —
  treated here as a permanent open-items scratchpad, not something to
  mark resolved or archive. Its still-open items are pulled into the
  relevant sections above; re-check it directly for anything newer than
  this audit.
- **`mvp-feature-priorities.md` and `validation/mvp-validation-plan.md`
  remain the live sources of truth for tier-by-tier status** — both are
  large, actively-maintained tracking documents in their own right, not
  archived by this audit. This file pulls their open items forward but
  doesn't replace them; check them directly for anything this summary
  compressed away.

---

## Files marked fully resolved this session (prepended note, unarchived, unchanged otherwise)

`config-node-system-scoping.md`, `editor-hands-on-briefing.md`,
`editor-look-and-feel-briefing.md`, `fault-isolation-briefing.md`,
`mvp-planning-briefing.md`, `repo-structure-and-conventions.md`,
`rete-migration-decision.md`, `rete-migration-implementation-briefing.md`,
`rete-migration-phase3-briefing.md`, `rete-migration-phase4-briefing.md`,
`rete-migration-planning-briefing.md`, `rete-spike-briefing.md`,
`rp2040-bringup-findings.md`, `tier1-interrupt-node-implementation-briefing.md`,
`tier1-node-candidates-prioritization-briefing.md`,
`tier1-node-set-briefing.md`, `wire-protocol-briefing.md`,
`wire-type-system-scoping.md`, `wire-type-system-implementation-briefing.md`.

Every other file in the inventory was read and classified but left
completely untouched — either because it's partially resolved (some open
items pulled forward above, rest of the file stands as historical
context), still fully active (see "Next up" and the backend section
above), or is one of the three living tracking documents noted under
"Flagged as ambiguous."
