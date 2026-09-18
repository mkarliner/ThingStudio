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
- **2026-09-17 — `thingstudio/display_spi`/`thingstudio/display_i2c`: two
  display node types split by bus family, not one universal node.**
  Prompted by the same TiDAL-badge follow-up session as eswitch/ebutton
  (Mike: "driving its own 135x240 ST7789 screen next"), then corrected and
  widened mid-scoping: the badge runs stock MicroPython, not TiDAL-
  Firmware (an earlier architecture conclusion assuming a pre-initialized
  `tidal.display` object was wrong and retracted), and the ask broadened
  from "M5Stack" to "many other boards," pins made node properties rather
  than defaults. Mike's own framing resolved the design: "generic" means
  the framebuffer *wire contract*, not one universal node — hardware
  specifics differ enough per display that separate node types are
  correct, held to the two bus families (SPI/I2C) where feasible rather
  than one node per exact chip ("if we can keep it down to i2c and spi
  that would be great"). `display_spi` (SPI color TFTs, vendoring
  `devbis/st7789py_mpy`'s `ST7789` driver — chosen over `russhughes/
  st7789_mpy`, which needs a custom-compiled firmware build this
  project's stock-MicroPython + `mpremote cp` deployment model can't
  accommodate) and `display_i2c` (I2C mono OLEDs, vendoring micropython-
  lib's `SSD1306_I2C` driver), both `device-runtime/src/vendor/`, both
  unmodified, both MIT, both hash-verified against two independent fetch
  methods. A `controller` property on each is a real, forward-looking
  choice, not hardcoded away — leaves room for more chips per bus family
  (ILI9341/GC9A01/etc. for SPI, SH1106/etc. for I2C) without a breaking
  property-shape change later, even though only one controller is wired
  per node this session. Each node's single `bytes` input is an already-
  rendered `framebuf.FrameBuffer` buffer built upstream (RGB565 for
  `display_spi`, MONO_VLSB for `display_i2c`) — no drawing primitives here
  on purpose, matching the separate POST-MVP "templating UI nodes for
  displays" item; Mike flagged a future graphics framework (LVGL or
  similar) sitting in front of these nodes, so the wire contract was kept
  framework-agnostic rather than building anything LVGL-specific now. A
  length check against the exact expected buffer size runs before every
  push on both nodes — a wrong-length buffer would otherwise either
  silently desync the SPI panel's address window (`blit_buffer` has no
  internal validation) or, worse, silently RESIZE `SSD1306`'s own
  `self.buffer` via Python's bytearray full-slice-assign semantics,
  corrupting `self.pages`/`self.width`-based indexing on the next
  `.show()` call — exactly the quiet-wrong-answer failure mode this
  project's fault-handling priority exists to catch loudly instead.
  `device-runtime/src/vendor/st7789py_mpy/README.md`/`.../ssd1306/
  README.md` have the full provenance stories, including two vendoring-
  process corrections worth knowing about: an early WebFetch summary of
  `st7789py.py` wrongly implied a `reset=None` patch would be needed (it
  isn't — every call site already guards with `if self.reset:`), and a
  shallow `git clone --depth 50` against `micropython-lib` (a large
  monorepo) silently returned an unrelated boundary commit for `git log
  -1 -- ssd1306.py` instead of erroring — caught by the returned commit
  message having nothing to do with a display driver, not by any tooling
  guarantee; fixed by re-cloning with `--filter=blob:none` for full
  history. Off-device tests run each real vendored driver through a real
  CPython asyncio loop (18 tests, all passing), which needed real gaps
  closed in `editor/test/fixtures/pymock/`: `machine.py` gained `SPI`/
  `I2C` mock classes plus `Pin.off()`/`.on()` (real `machine.Pin` shorthand
  neither prior node type called), and `mode` on `Pin.__init__` was made
  optional (matching real MicroPython's own default, not a hardcoded
  requirement — SPI/I2C reconfigure a pin's function internally and never
  pass one); three new fixture modules were added,
  `micropython.py`/`ustruct.py` (straight passthroughs to real stdlib
  `struct`/a no-op `const()`) and `framebuf.py` (a minimal `FrameBuffer`
  stand-in — deliberately no drawing primitives beyond `fill()`, which
  `SSD1306.init_display()` calls unconditionally as real setup, not an
  optional feature these tests happen to exercise). `display_spi`'s
  rotation support (`_set_mem_access_mode()` called a second time after
  `.init()`, overriding the vendored driver's own hardcoded call — upstream
  gives no other way to configure it) is flagged **untested on real
  hardware this session** (no board available), same as the whole feature.
  **Tracked, not solved, mid-session:** Mike flagged that vendored display
  drivers shouldn't become "huge monsters" pushing unbounded flash to
  every board as more chips get supported. Investigation confirmed the
  concrete mechanism — `test-flows/deploy_runtime.py`'s `VENDOR_FILES` list
  pushes unconditionally to every board on every bootstrap, not scoped per
  flow. His call: "proceed with the simpler one and track the scaling" —
  both drivers added to `VENDOR_FILES` the normal way this session
  (~8.4KB/~4.9KB source, small next to `mqtt_as`'s own ~36KB already there
  unconditionally), with the scaling concern itself tracked in
  `outstanding-items.md` as the point where a selective/opt-in vendor push
  needs building, before a third or fourth controller lands the same way.


- **2026-09-17 -- Wire-type system: `any -> bytes` allowed
  (`app/rete/sockets.ts`'s `BytesSocket`), closing a real gap the wire-type-
  system-scoping.md doc had explicitly anticipated and deferred ("Former open
  questions" #4: build a conversion node "when a real node with a
  bytes/string-typed port that actually needs one gets added to the canvas,
  not before").** That node landed this same session
  (`display_spi`/`display_i2c`'s `frame` input, the only two bytes-typed
  inputs in the entire node library) -- and its trigger case showed up
  immediately, for real: a hand-authored `test-flows/display-spi-tidal-
  test.flow.json` wiring `thingstudio/function` (untyped `any` output) into
  `thingstudio/display_spi` (typed `bytes` input) loaded with that edge
  silently missing. Root cause: `validation.ts`'s `canCreateConnection()` --
  the same gate a live canvas drag goes through -- also runs during flow-file
  load (`main.ts`'s edge-restore loop), and `BytesSocket.isCompatibleWith()`
  was identity-only (bucket 3, "any into any concrete non-bool type: refuse"),
  so `connectNodes()` returned `false` and `main.ts` logged `[load: failed to
  connect ...]` to the console -- present, but easy to miss, which is exactly
  how it read as "the function node is not connected to the display node"
  rather than a surfaced error. Fix mirrors the wire-type doc's own already-
  accepted `any -> bool` self-correction, not a blanket loosening of bucket 3:
  `bytes <-> string` stays refused unchanged (a real encoding choice -- utf-8,
  hex, base64 differ), but `any -> bytes` has no such ambiguity buried in it
  -- it's just "is this value already bytes-shaped," and a wrong-shaped value
  reaching `display_spi`/`display_i2c` at runtime already gets a clear
  `ValueError` (their own length check, `NODE_ERROR`-attributed), the same
  "fails later, not never" contract already accepted for `string -> number`.
  `editor/test/sockets.test.ts` (new -- no file covered `sockets.ts` before
  this) runs the real `isCompatibleWith()` methods directly (no DOM/Rete
  instance needed, vitest's `environment: "node"`) and covers the full matrix,
  not just the new case: identity for all six classes, both numeric-widening
  directions, both refused `bytes <-> string` directions, `any` refused into
  `number`/`int`/`string` (unchanged), and the new `any -> bytes` allow
  alongside `bytes`'s remaining refusals. Full suite re-run clean after the
  fix (511 passing, only the pre-existing unrelated `node-startup.test.ts`
  failures -- the unfinished WIP `startup` node -- unchanged).


- **2026-09-18 -- `display_spi`: two more real-hardware bugs found and fixed
  testing `display-spi-tidal-test.flow.json` on the actual TiDAL badge, on top
  of the wire-type and LCD_PWR/LCD_BLEN fixes above. (1) GRAM offset: codegen
  used to hardcode `xstart=0, ystart=0` in the `ST7789(...)` call,
  deliberately bypassing st7789py_mpy's own built-in 240x240/135x240 offset
  table -- reasoned at the time as covering an arbitrary-resolution panel the
  table doesn't know about, but that reasoning missed that TiDAL's own 135x240
  panel (the vendor README's own reason for picking this driver) needs
  `xstart=52, ystart=40`, not `0, 0`. Forcing `0, 0` silently blitted into the
  wrong GRAM window -- content came out clipped/offset with stray stale pixels
  along the uncovered edges, no error at all. Fixed by adding real
  `xstart`/`ystart` node properties (default `-1`, "let the vendored driver's
  own table decide", same sentinel convention `cs`/`reset`/`backlight` already
  use), with four new off-device tests against the real vendored driver (`-1`
  resolving both known panel sizes correctly, an explicit override, and a
  clear `ValueError` instead of a silent wrong offset for anything else). (2)
  RGB565 byte order: confirmed via MicroPython's own upstream PR discussion
  (`micropython/micropython#3536`, closed unmerged) that `framebuf.RGB565`
  stores pixels in CPU-native (little-endian on ESP32) byte order, while SPI
  TFT controllers expect big-endian pixel bytes on the wire -- `display_spi`
  forwards buffer bytes as-is with no transform step, so a buffer built
  directly from `framebuf.FrameBuffer(..., framebuf.RGB565)` comes out with
  red/blue channels scrambled (worked out by hand: intended pure green
  `0x07E0` stored little-endian and read back big-endian becomes `0xE007`, a
  strong red -- exactly what showed up on the badge). No MicroPython-level fix
  exists (that unmerged PR would have added one); fixed in the flow's own
  `function` node with a final byte-swap loop before `msg['payload'] =
  bytes(buf)`, and flagged in `docs/user-guide/nodes/display-spi.md` and the
  property panel's hint text as a gotcha affecting every future user of this
  node, not just this one flow. Both fixes verified via `compile()` dry run
  (confirms `xstart=52, ystart=40` and the byte-swap loop in the generated
  Python) and, combined with the earlier LCD_PWR/LCD_BLEN fix, resolved the
  flow's real-hardware symptoms in order: import error -> blank screen ->
  clipped red circle with static -> not yet reconfirmed clean with all three
  fixes together (next real-hardware pass). Full test suite re-run clean
  throughout (515 passing, only the pre-existing unrelated `node-
  startup.test.ts` failures unchanged).
