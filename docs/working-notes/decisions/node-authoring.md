# Decisions — Node authoring / extensibility

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

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
- **2026-08-21 — Custom node package persistence across app runs: waits
  for the backend, resolving Decision 4's "future work" either/or in favor
  of its backend-owned half.** Not a browser-side File System Access
  handle-persistence build — see the `Backend` section entry above for the
  reasoning and the MVP-priority consequence. `local-persistence-scoping.md`.
- **2026-09-17 — `thingstudio/eswitch`/`thingstudio/ebutton`: partial
  adoption of Peter Hinch's `micropython-async`, resolving design doc
  §11's open question for switches/buttons.** Vendored his `ESwitch`/
  `EButton`/`WaitAny`/`Delay_ms` classes verbatim
  (`device-runtime/src/vendor/primitives_events/`, pinned commit SHA +
  SHA-256 hashes, same convention as `ThreadSafeEvent`/`mqtt_as`) rather
  than re-deriving debounce/long-press/double-click logic by hand. Single
  output port per node, `topic` distinguishes which event fired
  (`close`/`open` for eswitch; `press`/`release`/`long`/`double` for
  ebutton) — confirmed with Mike rather than extending the compiler's
  multi-output support (transform-only today) to sources. His §5 `AADC`
  driver deliberately deferred to a follow-up item, same call, not bundled
  into this pass. Found and fixed a real correctness bug while building
  this: `WaitAny.clear()` clears every event it watches, but `EButton` can
  set both `press` and `double` in the same synchronous call (a rapid
  second click) — clearing the whole group after each wake would silently
  drop whichever lost `WaitAny`'s internal race, so `buildMsg` clears only
  the one event that actually fired (`_trig.clear()`), not the group.
  Off-device tests run the real vendored driver through a real CPython
  asyncio loop (not just this project's own generated text), since neither
  class has a hard-IRQ dependency pymock can't stand in for. Side effect,
  not yet acted on: the existing `interrupt` node's debounce option is now
  redundant with eswitch/ebutton's own, and could be removed — flagged in
  `outstanding-items.md`, not resolved here.
  `device-runtime/src/vendor/primitives_events/README.md`.
- **2026-09-17, same session, real-hardware pass — added a `pull` property
  (none/up/down, default "none") to `eswitch`/`ebutton`.** Found while
  wiring up a real EMF 2022 TiDAL badge (stock MicroPython, ESP32-S3): its
  own buttons.md documents every button but one relying on the chip's
  *internal* pull-up (`machine.Pin(..., machine.Pin.PULL_UP)`), not an
  external resistor or a pull built into the button hardware itself — a
  case this node's original "no internal pull, wire an external one"
  design (inherited from `interrupt`'s own convention) had no way to
  handle at all. Backward-compatible: default "none" means every
  already-generated flow's Python is byte-for-byte unchanged.
  `interrupt` has the identical gap, not addressed in this pass — scoped to
  eswitch/ebutton only, matching the button test at hand; worth the same
  treatment later if it comes up again.
  **Confirmed working on the real board, same day:** `ebutton` on the
  TiDAL's Centre/joystick-press button (pin 9, `pull: "up"`) reported
  `press`/`release`/`long` correctly, and `double` reported the exact
  dual-event behavior the `WaitAny` full-clear fix above was built to
  produce — a rapid second click gave both `press` and `double` back to
  back (2ms apart in the real console timestamps), not `double` alone.
  First real confirmation this fix holds on actual hardware, not just in
  the off-device CPython tests. `eswitch`, and every other `ebutton`
  button/pin on this board, are still unconfirmed.
