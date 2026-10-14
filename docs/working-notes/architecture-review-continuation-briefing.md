# Briefing: architecture review — opinion and continuation (2026-10-14)

Handoff for the next architecture-review session (Mike is continuing this
review on another machine). This file carries forward (1) the review
artifacts produced this session, (2) the completed design-doc revision,
and (3) the written architecture opinion so the next session starts from
it rather than re-deriving it. The whiteboard this review built is still
live in Whiteboard Desktop — open it first, it anchors everything here.

There is an older `architecture-review-briefing.md` (2026-08-15,
decisions/assumptions review, pre-v1). Different session, different
scope — this file is the continuation of the *whole-repo* architecture
review, not a replacement for that one.

## What this session did

- Built a Whiteboard mapping the repo's main data flows, access patterns,
  and code paths for a full architecture review:
  **"Thingstudio architecture: data flows, access patterns, code paths"**,
  session `ba6cbab0-562f-4775-9447-8e43fd387cf4`, pinned to repo
  `/Users/mike/Src/ThingStudio` at HEAD `34e9909` (now `32ffd47` — the
  design-doc commit; the whiteboard pins resolve the same files). Open it
  with `session_open` on that session id, or it should appear in the
  Whiteboard Desktop review list. Section list: What/why, Requirements,
  System at a glance (flow diagram), Main data flow author→deploy→run
  (flow diagram), Code path deploy end-to-end (call stack), Wire protocol
  & live data, Transports (serial relay / WiFi auth / discovery
  sequence), Access patterns (hardware singletons, configs/credentials/
  msg envelope), Device runtime boot/resume/fault isolation, Persistence
  (three stores, database lens), Design-doc freshness, Version gating.
- Audited `docs/thingstudio-design-doc.md` for currency against the
  shipped v0.2.0 codebase.
- **Rewrote the design doc to v0.2** (committed, `32ffd47 "CHANGE:
  Update to design doc"`). See below.
- Formed an opinion on the overall architecture (the content of this
  briefing).

## The architecture opinion (preserve verbatim)

**Verdict:** the architecture is unusually coherent for a product that's
grown this fast. The core bet — *editor compiles to `.mpy` client-side,
device runs an interpreter that never compiles* — has held from the POCs
through v0.2.0, and every major subsystem reads as one design rather than
accretions. The strength and the risk are the same thing: **the editor is
the entire platform.** That deserves to be the center of the review.

**Genuinely strong:**

- **The compilation pipeline is a single, legible spine.** Flow JSON →
  `compile()` → Python source → mpy-cross WASM → DEPLOY is one path with
  verified line-level attribution (`nodeLineRanges`,
  `nodeCallWithFaultBoundary`). `thingstudio-compile` reuses the *same*
  compiler and *same* vendored WASM headlessly — rare, and why AI
  authoring works.
- **Fault handling is genuinely architectural, not bolted on.**
  Per-task `_guarded` boundaries, `NodeError` blaming the exact node, a
  listener that refuses to die, `MemoryError`→`DEPLOY_ERROR`, safe mode
  against boot loops, time-bounded reads everywhere. Matches the
  project's stated priority and is in the runtime, not aspirational.
- **Access patterns are consistent and rule-driven.** Keyed hardware
  singletons (compile-time `claimResource` + device `runtime.shared`),
  configs referenced-never-wired with secrets backend-side, deterministic
  flow serialization, `F64:` line framing as an honest workaround for a
  hardware bug rather than a hack.
- **Small, stable device API surface.** The board exposes ~9 functions,
  not a node table. Node growth happens in the editor, so the runtime
  rarely needs a breaking change. Cleanest part of the design.

**Where the review should focus:**

- **The editor is the single point of failure.** Node *implementations*
  are TypeScript codegen modules; compiler, type system, dependency
  resolution, and version gate live client-side in one 3,100-line
  `main.ts`. The device is a thin executor. If codegen is wrong, every
  board in a fleet fails — and `_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION`
  are manually mirrored, with the "over-cautious major bump" rule papering
  over that. §7's extensibility is real, but all authority is still in
  one file per node type plus `main.ts`.
- **The wire protocol is half-trusted, half-ignored.** `VALUE_STREAM` and
  `STATE_READ`/`STATE_WRITE` are defined, validated, and deliberately
  unimplemented — reserved for a future the no-premature-optimization
  rule keeps deferring. Fine as a decision, but live debugging is thin:
  per-node dots and print-line parsing, no real value streaming. Worth
  asking whether that line is right to hold post-launch.
- **Two seams to test hard:** (1) the backend is a dumb relay that never
  decodes CBOR — simple and robust, but it can't do protocol-level
  features later (logging, replay, fleet ops) without rework; (2) runtime
  install is a parallel raw-REPL path completely separate from the relay
  — correct today (a bare board has no listener), but a second protocol/
  state machine to keep honest.
- **§10/§11 tension:** the roadmap lists a lot of v2 candidates (state
  store, live streaming, incremental deploy, MQTTS, catch/error) that all
  touch the same "what does the wire protocol owe" question. Reserved
  message types are cheap now, but the *state store* in particular needs
  design work before too many deployed devices exist.

**Bottom line:** strong, coherent, fault-first architecture with one
structural bet — editor-as-platform — that everything hangs off. The
right bet for this stage; the review should treat `main.ts` + the node
library as the thing needing the most careful scrutiny, and the unbuilt
Tier-2 wire types as deliberate debt with a known cost, not a gap.

## Design doc revision, done and committed

`docs/thingstudio-design-doc.md` is now **Status: draft v0.2, revised
2026-10-14**, matching shipped v0.2.0 (runtime 10). What changed, briefly:

- §3 target hardware: tested matrix (ESP32 family, RP2040/RP2350, seven
  named boards), board/processor definition system, RISC-V misdetect bug,
  STM32 `ENODEV` status.
- §4 system architecture: backend-first (WS + HTTP admin API, serial/
  WiFi TCP relay), WebSerial demoted to hidden fallback, flows save via
  File System Access API (not the backend).
- §5 execution model: kept the still-true core, added shipped fault
  isolation (NodeError attribution, MemoryError→DEPLOY_ERROR), safe mode,
  hardware singletons, runtime install via Tools → Install runtime
  (not esptool); crossed out unbuilt v0.1 claims (state store, watchdog).
- §6 flow/graph: full ~37-type node library incl. display/GUI/touch and
  adc/encoder/neopixel; four config types (wifi singleton, i2c-bus keyed,
  touch-panel, mqtt-broker).
- §7 extensibility: node types are editor codegen modules; per-flow
  dependencies (DEP_PUT/DEP_COMMIT into /lib); custom node packages;
  `thingstudio-compile`.
- §8 live debugging: NODE_STATUS dots + NODE_ERROR + print lines;
  VALUE_STREAM explicitly not built.
- §9 security: shipped reality (board password, random-nonce HMAC-SHA256
  TSAUTH1, no password ⇒ no listener, captive portal, loopback-only
  backend) replaces the never-built monotonic-counter scheme.
- §10 roadmap: shipped-v0.2.0 list vs. the real v2/post-MVP backlog.
- §11 open questions trimmed to live ones.
- §13 wire protocol: shipped 20-message table (was 8 in the sketch),
  F64 base64 framing, session-level auth.

`docs/working-notes/decisions.md` got one index line under Architecture
noting the revision (per the maintenance rule). Both committed in
`32ffd47`. Source URLs were restored verbatim; the diff is only the
intended revision.

## Suggested focus for the next session

1. Open the whiteboard (session id above) and re-anchor on it — it was
   built intentionally as the shared map.
2. Test the "editor is the single point of failure" claim concretely:
   walk one node type end-to-end (e.g. `mqtt_subscribe` or `display_spi`)
   from TypeScript codegen through generated Python, and check what a
   codegen bug actually does to a deployed board (fault attribution vs.
   silent misbehavior). Count/nail down what `main.ts`'s 3,100 lines
   actually own.
3. Decide the backend-relay question: is "never decodes CBOR" the right
   line, or does anything on the v2 list (logging, fleet ops, replay)
   force protocol awareness in the backend?
4. Scrutinize the manually-mirrored version constants
   (`_RUNTIME_VERSION` ↔ `EDITOR_TARGET_VERSION`) and the
   same-change-bump discipline — the strongest candidate for a real
   structural weakness.
5. Pick a verdict on the unbuilt Tier-2 wire types (VALUE_STREAM,
   STATE_READ/WRITE): keep reserved, implement, or remove.

## Notes for the next machine

- Working tree is at commit `32ffd47` (design-doc revision committed).
  `test-flows/kitchen-sink.flow.json` is untracked and unrelated to this
  review; leave it alone.
- The whiteboard pins the repo at `34e9909` (pre-commit HEAD); pins
  resolve fine on the same files. If the files move in a later commit,
  `session_set_target` may be needed to re-anchor.
- Review is a discussion session — the opinion above is analysis, not a
  decision; no `decisions/` entry was written for it, by design.