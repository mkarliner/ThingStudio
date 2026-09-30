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
  clipped red circle with static -> confirmed working on the real TiDAL
  badge, 2026-09-18, all four real-hardware bugs this session fixed
  together (wire-type gap, LCD_PWR/LCD_BLEN polarity, GRAM offset, RGB565
  byte order). Full test suite re-run clean throughout (515 passing, only
  the pre-existing unrelated `node-startup.test.ts` failures unchanged).


- **2026-09-18 -- CYD (ESP32-2432S028, 2 USB ports) confirmed ST7789(V)-compatible, working
  display config found on real hardware.** `framebuffer-display-node-scoping.md`'s open "CYD
  controller-variant story" resolved: `docs/working-notes/cyd-touch-gui-flash-budget-briefing.md`
  item 1's own fallback plan (chip-ID read first, then try candidate drivers on real hardware) run
  in full. Chip-ID reads (`RDDID`/`RDID1-3`/`RDID4`) all came back `0x00` -- inconclusive alone,
  consistent with these registers being known-unreliable on real CYD units (an independent CYD
  diagnostic tool project doesn't attempt automatic ID detection either). Community naming
  heuristics conflicted (one GitHub issue says 2-USB CYD variants are ST7789, Bruce firmware's own
  default profile for this exact board string is ILI9341) -- not trusted alone, per the original
  briefing's own warning that silkscreen/model number doesn't reliably distinguish these boards.
  Settled by running the project's own vendored `st7789py_mpy` driver directly against real
  hardware (`test-flows/cyd-display-test-pattern.py`, `cyd-display-orientation-test.py`,
  `cyd-display-mh-test.py`) and iterating on a real photographed test pattern until all 6
  independently-colored test bars rendered correctly. Working config for this unit: `st7789py_mpy`'s
  `ST7789` class, `reset=None` (RST tied high, no GPIO), `xstart=0, ystart=0` (no GRAM offset needed
  at native 240x320), `inversion_mode(False)` (the class's own `init()` hardcodes `True`, tuned for
  TiDAL's different panel), and `MADCTL = 0x4C` (`BGR | MH | MX` -- written directly via
  `display.write(ST7789_MADCTL, ...)`, bypassing `_set_mem_access_mode()`'s rotation-table wrapper,
  which never exercises the `MH` bit at all -- see the learnings-log entry below). Pins: SPI bus 2,
  `sck=14, mosi=13, miso=12, cs=15, dc=2, backlight=21` (mischianti.org's documented values, now
  hardware-confirmed rather than sourced from one unverified page). Backlight assumed active-high
  and was correct (no repeat of TiDAL's active-low surprise). Does NOT resolve whether this holds
  across other CYD units/batches -- the original briefing's own "no visible way to tell apart"
  caveat still stands for a different physical unit; this is one confirmed real board, not a
  universal CYD answer. Real bugs found along the way (full-frame `MemoryError`, the MADCTL `MH`
  bit, unreliable ID reads, conflicting board-naming heuristics) logged separately:
  `docs/working-notes/learnings/hardware-bringup-hil-rig.md`.

- **2026-09-18 -- `display_spi` panel-variant config landed as real node properties (colorOrder,
  invertColors, dataLatchOrder), defaulting to the CYD config confirmed above.** Direct follow-on to
  the CYD bring-up entry immediately above: Mike's framing was explicit ("we need to node to
  accommodate variants, so this stuff should be in node properties... lets get node properties in,
  other wise the cyd work is useless") -- a confirmed working config sitting only in one-off scratch
  scripts (`test-flows/cyd-display-*.py`) doesn't help a real flow. Three new properties: `colorOrder`
  (`"rgb"`/`"bgr"`, default `"bgr"`, validated with a `CompileError` on anything else), `invertColors`
  (bool, default `false`), `dataLatchOrder` (bool, default `true` -- the MADCTL `MH` bit, named for
  what it actually does rather than "mirror" since it isn't a coordinate mirror on this panel family).
  `rotation`'s own default changed from `0` to `1` to match the CYD unit's confirmed orientation.
  MADCTL is now computed the same way the CYD bring-up scripts worked it out by hand
  (`ROTATION_BITS[rotation] | (dataLatchOrder ? MH : 0) | (colorOrder=="bgr" ? BGR : 0)`) and written
  directly via `display.write(ST7789_MADCTL, ...)`, replacing the old
  `_set_mem_access_mode(rotation, False, False, False)` call -- that wrapper never exercises the `MH`
  bit at all (the learnings-log entry from the CYD session), so it could never have produced the CYD's
  working config regardless of what properties fed it. `invertColors` now drives an explicit
  `inversion_mode(...)` call after `init()`, overriding `st7789py_mpy`'s own hardcoded `True` (tuned
  for TiDAL) rather than living with whatever the vendored driver's `init()` picked.
  **TiDAL's already-confirmed-working config preserved explicitly**, not silently broken by the new
  CYD-shaped defaults: `test-flows/display-spi-tidal-test.flow.json` now sets `colorOrder: "rgb"`,
  `invertColors: true`, `dataLatchOrder: false` (rotation `0` was already explicit). Four new tests in
  `editor/test/node-display-spi.test.ts` assert the generated MADCTL/inversion bytes directly off the
  mock SPI transcript for both configs (`LAST_WRITES 20 36 4c` for the CYD default, `LAST_WRITES 21 36
  00` for TiDAL's override) plus the `colorOrder` validation. Verified with a full fresh build in an
  isolated copy of `editor/` + `device-runtime/`: clean `npm ci`, `tsc --noEmit` (one strict-null fix,
  `ROTATION_BITS[rotation]!` -- safe, `rotation` is already range-checked to 0-7 above the lookup),
  full `vitest run` at 519/521 passing (the 2 failures are the pre-existing, already-documented
  `node-startup.test.ts` WIP-node gap, unchanged), and `verify-flow-file.ts` against the updated TiDAL
  flow file. **Still a one-unit caveat** (same as the entry above): these are CYD-confirmed defaults,
  not a universal CYD or ST7789 answer -- a different panel/batch may need different property values,
  which is exactly what the properties are now for. Unblocks the POST-MVP preset-dropdown idea Mike
  raised in the same conversation (`outstanding-items.md`). The separate framebuffer-memory problem
  the CYD session's `MemoryError` surfaced (full RGB565 frame too big for classic ESP32 heap) is
  scoped, not solved, as its own item (`outstanding-items/display-spi-framebuffer-memory.md`).

- **2026-09-18 -- `display_spi` framebuffer-memory fix: option 1 chosen, extended to four frame
  depths, palette-driven throughout.** Mike's call on the architectural fork
  `outstanding-items/display-spi-framebuffer-memory.md` flagged (asked for explicitly via
  `AskUserQuestion`, per that note's own instruction not to default to either shape): `display_spi`
  grows real properties and does the expansion internally, rather than staying dumb with a documented
  function-node pattern. Extended beyond that note's binary rgb565/gs4 framing on Mike's own ask --
  also support 2-bit and 1-bit depths for more constrained devices. Maps directly onto MicroPython's
  own `framebuf` module formats: `frameFormat` will be `"rgb565"` (default, unchanged, `RGB565`,
  16bpp), `"gs4"` (`GS4_HMSB`, 4bpp), `"gs2"` (`GS2_HMSB`, 2bpp), or `"mono"` (a `MONO_*` variant, 1bpp,
  exact variant TBD). Memory for a 240x320 frame: 153,600 / 38,400 / 19,200 / 9,600 bytes respectively.
  Second decision, same session: all three reduced depths are palette-driven, not hardcoded
  gray/black-white ramps -- one `palette` property, always 16 RGB565 entries regardless of
  `frameFormat`, with `gs4`/`gs2`/`mono` reading the first 16/4/2 entries. Keeps one consistent
  expansion-codegen shape across all three depths and leaves room for a tinted low-color panel (e.g.
  amber-on-black) rather than forcing literal grayscale/black-white. Full write-up, including what's
  still not decided (default `gs2`/`mono` palette seeding, which `MONO_*` bit-packing variant, whether
  `gs2`/`mono` ship in the same change as `gs4` or as a fast-follow, row-batching size per depth):
  Claude-project doc `display-spi-framebuffer-format-decision.md` (ThingStudio project, not yet
  transcribed into this repo in full -- do that once implementation actually starts). Not built.
  `outstanding-items/display-spi-framebuffer-memory.md`'s architectural-fork section updated to point
  here.

- **2026-09-18 -- `@micropython.viper` GS4/GS2/mono expansion-loop spike: mechanism confirmed
  off-device, real-hardware timing still open.** Before committing engineering time to the codegen
  above, ran a standalone spike (not checked into this repo) against a freshly-built MicroPython
  unix-port interpreter: `@micropython.viper`-typed (`ptr8`/`ptr16` params) nibble/bit-unpack +
  16-entry-palette-lookup loops for all three reduced depths, correctness-checked against hand-derived
  expected bytes, then timed. Results on that x86 dev machine, 240x320 frame: gs4 0.25ms, gs2 0.23ms,
  mono 0.38ms (all far under the source driver's ~100ms/frame target), a ~42x speedup over plain Python
  for gs4. Confirms the `@micropython.viper` mechanism itself has no syntax/semantic surprises and that
  the expansion loop is very unlikely to be the CPU bottleneck relative to SPI transfer time -- but
  this is explicitly NOT a real-hardware result (x86 dev CPU, not ESP32 Xtensa; MicroPython's own SPI
  driver, the actual bottleneck in the corroborating account, isn't exercised at all). A real CYD/
  TiDAL pass is still needed before the "under 100ms" target is confirmed for this project's own
  boards. Full method + numbers: `docs/working-notes/learnings/micropython-device-runtime.md`.
- **2026-09-18 -- `frameFormat: "gs4"` built (the decision two entries above, `gs4` slice only --
  `gs2`/`mono` still not built).** `display-spi.ts`: `frameFormat` (`"rgb565"` default | `"gs4"`) and
  `palette` (16 RGB565 entries, `DEFAULT_PALETTE_GS4` a hand-verified placeholder pending Mike's real
  values) properties, validated the same way every other property in this file is. In `"gs4"` mode,
  `expectedBytes` is `Math.ceil(width / 2) * height` (GS4_HMSB's real row-padded stride, confirmed by
  reading MicroPython's own `extmod/modframebuf.c` directly rather than assumed -- differs from a flat
  `ceil(w*h/2)` on an odd width like TiDAL's 135). Expansion is a per-instance `@micropython.viper`-
  decorated helper (typed `ptr8`/`ptr16` params, the mechanism the entry above spiked off-device),
  streamed 2 rows/transaction via the vendored driver's own `set_window()` + `write(None, ...)`
  primitives rather than `blit_buffer()` (which assumes RGB565). Mirrored into `nodes.ts`'s typed
  property defaults (frameFormat/palette added, `"rgb565"`-default so a freshly-dropped node still
  compiles the same as before) and `PropertyPanel.vue` (a frame-format dropdown; palette has no
  color-picker UI yet, flow-file-only, same gap `colorOrder`/`invertColors`/`dataLatchOrder` already
  have -- found while making this change, not fixed here, flagged for Mike separately).
  `docs/user-guide/nodes/display-spi.md` updated in the same change (CLAUDE.md's own rule).

  **A real bug found and fixed before landing, not caught by review after the fact:** the first draft
  of the expansion loop expanded the source buffer as a flat sequence of nibbles. GS4_HMSB pads each
  row to a whole byte, so on an odd width (TiDAL's 135) that flat approach would expand a row's
  trailing pad nibble into a phantom extra pixel, shifting every subsequent pixel out of alignment for
  the rest of the frame -- exactly the "silently wrong beats loudly right" failure CLAUDE.md's fault-
  handling priority exists to catch, and exactly the kind of bug that only shows up on an odd-width
  panel, easy to miss testing only against CYD's even-width one. Fixed: the expansion loop is now
  pixel-count-aware per row (expands exactly `width` pixels, discards any trailing pad nibble) rather
  than byte-count-aware. Verified twice by hand against the real vendored driver + the existing
  pymock harness (an odd-width 3x2 case, and a taller 2x3 case split across two row-batches) before
  writing the equivalent vitest cases from the same hand-derived numbers, specifically to avoid writing
  a test that would just re-assert the bug. Four new `describe("frameFormat gs4", ...)` cases added to
  `node-display-spi.test.ts` (odd-width expansion, multi-batch splitting, wrong-length error message,
  custom-palette override), plus format/palette validation-error cases.

  **Not yet verified by this project's own `tsc --noEmit`/`vitest run`.** Built and reviewed from a
  session without access to run those (CLAUDE.md's npm/vitest-from-sandbox restriction), so correctness
  here rests on the manual driver-level verification above plus code review, not an actual green test
  run -- Mike's own build/test pass is the real gate before trusting this compiles and the new tests
  pass, same as any other change handed off this way. No `device-runtime/src` file was touched (only
  read, for the stride finding), so no `_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION` bump applies.
  `outstanding-items/display-spi-framebuffer-memory.md` updated to match; the stride-padding finding
  also logged in `learnings/micropython-device-runtime.md`.


## `frameFormat: "gs4"` verified: real `tsc`/`vitest` pass, 2026-09-18

Follow-up to the `gs4` build above, same day. Extracted the project (excluding `node_modules`) into an
isolated cloud-session workspace and ran `npm ci --ignore-scripts` fresh there, per `CLAUDE.md`'s
mandated fallback for not running `npm`/`tsc`/`vitest` against the live-mounted `editor/` directly.
Result: `./node_modules/.bin/tsc --noEmit` clean apart from one pre-existing, unrelated
`node-startup.test.ts` gap (an already-known WIP node type not yet registered); `vitest run
test/node-display-spi.test.ts` 27/27 passing; a full `vitest run` shows the same pre-existing
`node-startup` gap plus three other pre-existing failures (`node-display-i2c`, `node-ebutton`,
`node-eswitch`) that are an artifact of this verification tarball only including the `st7789py_mpy`
vendor directory, not `events`/`ssd1306` -- unrelated to this change, not a regression.

This pass caught two real problems. First, 4 real TypeScript strict-null errors in the new
`node-display-spi.test.ts` helper (`output.match(...)?.[1].trim()` needed to be `?.[1]?.trim()` --
`.trim()` chained directly after an optional-chained index without its own `?.`), fixed in both the
test file and the isolated copy. Second, and more significant: an earlier `device_commit_files` push
(with `force: true`) of the corrected pixel-aware expansion function had silently not landed on the
actual device file -- `tsc`/`vitest` reported success against a verification tarball, but that tarball
had been built from the OLD file, before the corrected push. The stale content wasn't caught by hand
verification alone (which was checking the local pre-push file, not re-reading the device file after
each push) -- only the real vitest run's failing assertion, decoded back to confirm it matched the old
buggy behavior exactly, surfaced it. Re-pushed, re-verified via a direct `grep` on the device file
immediately after the push (byte size and line count both matching the intended local file), then
rebuilt the verification tarball from that confirmed-correct device state and re-ran clean.

Process takeaway logged in `learnings/micropython-device-runtime.md`: a `device_commit_files` call
returning success is not sufficient confirmation the content actually landed on the device -- re-read
the on-device file directly after a push, before trusting a verification pass built from it.

## `mpy-cross` WASM deploy pipeline missing `-march`, found and fixed on first real `gs4` deploy attempt, 2026-09-18

Mike's first real Deploy of `test-flows/display-spi-gs4-cyd-test.flow.json` (after resolving an
unrelated stuck-REPL board issue, `learnings/hardware-bringup-hil-rig.md`) failed with
`SyntaxError: invalid arch` from `mpy-cross`, not a code bug in the gs4 codegen: the editor's browser
Deploy pipeline (`editor/src/app/main.ts`'s `compileToMpy()`) has always called the vendored
`mpy-cross` WASM build with no `-march=<arch>` flag, which is fine for ordinary architecture-
independent bytecode but breaks the moment any `@micropython.viper`/`@micropython.native`-decorated
function needs to be compiled -- exactly what `frameFormat: "gs4"` introduced, the first time this
project's real Deploy path has ever needed to compile native code (the earlier off-device viper spike
used its own from-scratch native `mpy-cross` build, entirely separate from this pipeline).

Root-caused by reading the actual supported-arch list embedded in `editor/public/vendor/mpy-cross/
mpy-cross.wasm` directly (`strings` on the binary: `x86, x64, armv6, armv6m, armv7m, armv7em,
armv7emsp, armv7emdp, xtensa, xtensawin, rv32imc, rv64imc, host, debug`), not guessed. Fixed with a
single named `MPY_CROSS_MARCH = "xtensawin"` constant feeding `callMain(["-march=" + MPY_CROSS_MARCH,
...])` -- correct for every board this project currently targets with a real flow (ESP32/ESP32-C3/
ESP32-S3, all Xtensa, MicroPython's own ESP32 port firmware uses `xtensawin` uniformly across that
family). Verified against the real WASM module run directly under Node before shipping: the exact
gs4-generated source (captured via a `compile()` dry run through the registry) now compiles cleanly to
a 2615-byte `.mpy`, and a plain non-viper snippet produces byte-identical output with or without the
flag (SHA-256 match) -- confirms zero regression for every other flow type in this project. `tsc
--noEmit` re-run clean afterward (same one pre-existing, unrelated `node-startup.test.ts` gap).

**Real gap, flagged not solved**: no board/architecture concept exists anywhere in the compile
pipeline to pick a different `-march` value automatically -- a single global constant, deliberately
kept as one easy-to-find point rather than scattered, specifically so it's a small change (not a
rearchitecture) whenever an ARM-family board needs viper/native code too. Nothing today does (the
RP2040/RP2350 boards this project already has real flows for, `test-flows/interrupt-basic.pico-
*.flow.json`, don't use viper anywhere), so this isn't a fork requiring Mike's call yet -- but worth
remembering before the next board that both (a) needs `@micropython.viper` and (b) isn't Xtensa-family,
since the wrong `-march` either fails loudly at compile time (safe) or, if it somehow passed compile,
would fail loudly on-device at import time instead (MicroPython's own `.mpy` loader checks a file's
required native arch against the running device's) -- not a silent-wrong-code risk either way, but
still a real gap worth closing with real board-awareness before it's actually hit.

## CYD `display_spi` real hard-crash root-caused: 40MHz SPI baudrate, not gs4/viper, 2026-09-18

Direct follow-on to the mpy-cross `-march` fix above, same deploy session. After that fix, the gs4 CYD
flow compiled and deployed for real, then boot-looped (`SW_CPU_RESET`) on every subsequent boot. Looked
exactly like a viper/native-codegen bug at first (also this project's first-ever real Xtensa execution
of `@micropython.viper` code) -- ruled out by recognizing the flow only fires on a manual inject click,
so the crash (happening automatically on every boot, nothing clicked) had to be in the flow's
unconditional SETUP code, not the click-gated sink/expand code viper only affects. A temporary
diagnostic (`GS4_DIAGNOSTIC_PLAIN_PYTHON` in `display-spi.ts`, since reverted) confirmed this by
running the same setup with viper removed entirely -- still crashed, confirming viper was never the
variable in play.

Root-caused by isolating the setup sequence into a standalone script
(`test-flows/cyd-display-spi-init-probe.py`, six labeled steps) run via `mpremote run`: the crash is in
`machine.SPI(2, baudrate=40000000, ...)` -- `display_spi`'s own node default. ESP-IDF logged (but
MicroPython didn't surface as a Python exception) `spi_hal: The clock_speed_hz should less than
26666666` / `spi_master: spi_bus_add_device(500): assigned clock speed not supported` -- this CYD's
specific pin assignment (`sck=14, mosi=13, cs=15, dc=2` on SPI bus 2) can't reach 40MHz, likely GPIO-
matrix routing rather than the native IO_MUX fast path. The Python-visible `SPI` object still looked
valid, so the flow proceeded to `ST7789.init()`'s first real transaction, which hit repeated
`check_trans_valid: invalid dev handle` errors and crashed hard: `Guru Meditation Error: Core 1
panic'ed (LoadProhibited)`, a near-null-pointer dereference -- confirmed as a genuine C-level fault,
not a catchable Python bug, by checking `_resume_flow()`'s own `try/except Exception` around
`import _flow` (device-runtime/src/listener.py) doesn't catch it.

Every prior CYD display script (`cyd-display-test-pattern.py`, `cyd-display-mh-test.py`,
`cyd-display-orientation-test.py`) already used `baudrate=27_000_000` -- nobody had hit this before
because none of them ever went through `display_spi`'s own codegen default; this gs4 flow is the first
real CYD `display_spi` deploy through the actual DEPLOY pipeline, node default included. TiDAL's flow
uses `baudrate: 40000000` and works fine, confirming this is pin-assignment-specific, not a general
40MHz-is-too-fast problem.

**Fix: `test-flows/display-spi-gs4-cyd-test.flow.json`'s own `baudrate` property set to `27000000`
explicitly** -- same "a real flow pins its own real values, the node default is a starting point"
convention `xstart`/`ystart`/`colorOrder`-family properties already established, not a codegen change
(`baudrate` was already a real property). `GS4_DIAGNOSTIC_PLAIN_PYTHON` reverted to `false` (real
viper) once this is confirmed rendering cleanly -- staged deliberately: confirm the SPI fix with the
simpler plain-Python path first, then re-enable viper and confirm it renders identically, so the actual
first-ever-real-Xtensa-viper validation this project has been waiting on isn't muddled by two unknowns
resolving at once. `learnings/hardware-bringup-hil-rig.md` has the full incident.

**Both stages confirmed, 2026-09-18, same session.** Redeploy with the baudrate fix and
`GS4_DIAGNOSTIC_PLAIN_PYTHON` still `true` (plain Python) rendered correctly on the real CYD panel --
confirms the SPI fix alone was sufficient and the crash really was fully explained by the baudrate, not
some second latent issue plain Python happened to dodge. `GS4_DIAGNOSTIC_PLAIN_PYTHON` was then flipped
back to `false` on-device (diagnostic-only flag, not a real property -- no flow-file change needed) and
the identical flow redeployed once more with real `@micropython.viper` code in the sink: **also
rendered correctly** ("seems to work fine" -- Mike). That second redeploy is this project's first-ever
real-hardware execution of viper-compiled code on Xtensa/ESP32 -- until now the only viper evidence was
the off-device unix-port spike (`learnings/micropython-device-runtime.md`) and the mpy-cross-level
compile check (`learnings/editor-build-tooling.md`), neither of which exercises real Xtensa silicon.
Nothing about the viper codegen itself needed changing to get here; the entire incident chain (runtime
bootstrap, `-march`, baudrate) was three unrelated pre-existing gaps the gs4 feature was simply the
first thing to actually exercise, not gs4/viper bugs. `GS4_DIAGNOSTIC_PLAIN_PYTHON` stays in
`display-spi.ts` as a named, easy-to-revert constant (currently `false`) rather than being deleted --
cheap to keep for the next display-codegen change that wants the same plain-Python-vs-viper isolation
trick again.

A same-day `test-flows/display-spi-gs4-cyd-animation.flow.json` (timer-driven continuous redraw, not
single-inject) exercises the identical viper sink under sustained load rather than one frame -- built
after this confirmation, as a demo, not a new finding; verified via `verify-flow-file.ts` and a
`compile()` dry run the same way every flow in this session was, generated Python inspected by hand
(the viper `_display_spi_expand` block is byte-identical to the already-confirmed one, only the driving
timer/function nodes are new).

## `gs2`/`mono` frame formats built, 2026-09-18 -- same day as gs4's real-hardware confirmation

Following on from gs4's full real-hardware confirmation above, extended `display_spi`'s `frameFormat`
to the two remaining depths the original decision (`display-spi-framebuffer-format-decision.md`)
already scoped but didn't build: `gs2` (`framebuf.GS2_HMSB`, 2 bits/pixel, an eighth of RGB565's
memory, 4-color palette) and `mono` (1 bit/pixel, a sixteenth, 2-color palette). Same `palette`
property shape as gs4 -- always exactly 16 RGB565 entries, `gs2` reads the first 4, `mono` the first
2 -- one property, one codegen path, across all three depths, per the original decision.

**A real design fork resolved, not just an extension: which MicroPython `framebuf` mono format.**
MicroPython has three 1-bit formats -- `MONO_VLSB` (vertical byte columns, the OLED/SSD1306
convention this project's own `display_i2c` node already uses -- wrong orientation for this node's
row-by-row SPI streaming), `MONO_HLSB`, and `MONO_HMSB` (both horizontal/row-oriented like
`GS4_HMSB`/`GS2_HMSB`, but pack their 8 pixels/byte in OPPOSITE bit orders from each other).
`MONO_HMSB` was picked for `"mono"`, for naming consistency with `GS4_HMSB`/`GS2_HMSB` -- a real
judgment call, flagged to Mike rather than treated as the only reasonable choice, since (per the next
finding) its bit order does NOT actually match either of those two consistently anyway.

**A second real correctness fact, found reading MicroPython's real `extmod/modframebuf.c` source
directly (`gs4_hmsb_setpixel`, `gs2_hmsb_setpixel`, `mono_horiz_setpixel`) rather than assumed to
generalize from gs4's already-working loop:** the three formats pack pixels into a byte in OPPOSITE
bit orders from each other. `GS4_HMSB`'s first (leftmost) pixel of a pair occupies the HIGH nibble --
descending, high-to-low. `GS2_HMSB` and `MONO_HMSB` are the other way: each format's first pixel of
its group occupies the LOWEST bits, its last pixel the HIGHEST -- ascending, low-to-high. (Also
confirmed in passing: `MONO_HLSB`'s bit order -- despite its "LSB" name -- is actually the descending
one, matching `GS4_HMSB` rather than its own `HMSB`-suffixed sibling `MONO_HMSB`. Names alone don't
predict this; only the real source does.) Each of the two new expansion loops (`gs2`/`mono`, in
`display-spi.ts`'s `expandFunctionBody()`) was written and independently hand-verified against its
own format's real setpixel/getpixel source -- deliberately NOT derived from gs4's already-working loop
by analogy, since that analogy would have gotten the bit order silently backwards for both.

**Real stride-padding rule generalized correctly from the start, not re-discovered per format**: gs4's
own odd-width stride bug (padding a row's byte count UP to a whole byte, not a flat `w*h/N` formula --
this doc's earlier 2026-09-18 entry) is a property of every indexed `framebuf` format, confirmed the
same way (reading the real C source's stride computation for each): `Math.ceil(width / pixelsPerByte)`
per row, `pixelsPerByte` = 2/4/8 for gs4/gs2/mono. Built into `gs2`/`mono` from the start.

**Style choice, not a correctness one**: gs4's already-real-hardware-confirmed expansion loop was left
completely untouched (still hand-unrolled, 2 pixels at a time) rather than rewritten to match gs2/
mono's newer style, so nothing proven working on real Xtensa hardware was disturbed for uniformity's
sake. gs2/mono's own loops use a small `for k in range(N)` inner loop instead of a hand unroll --
simpler to write correctly for 4/8 pixels than gs4's 2-pixel unroll was, at a marginal (and per this
project's own prior viper-timing findings, likely immaterial relative to SPI transfer time) native-
code cost; real per-frame timing on hardware remains unmeasured for every format including gs4.

**Verified the same way as gs4's own original build**: a real `./node_modules/.bin/tsc --noEmit`
(clean, same one pre-existing unrelated `node-startup.test.ts` gap) run directly against the live-
mounted `editor/` (permitted -- CLAUDE.md's npm-sandbox section only restricts `npm ci`/`vite build`/
`vite dev`/`vitest`, not `tsc`), and a real `vitest run` against a freshly re-synced isolated
extraction (per CLAUDE.md's mandated fallback for vitest specifically) -- 37/37 in
`node-display-spi.test.ts` (6 new gs2 cases, 5 new mono cases, plus a message-text update to one
existing gs4 assertion -- the length-check error now also names the real `framebuf.<CONSTANT>`, not
just the format string, a real UX improvement made in passing), 531/540 across the full suite, the 9
unrelated failures confirmed environmental (this ad-hoc verify copy's `device-runtime/vendor/` was
never given an `ssd1306` vendor file or a couple of button-driver ones, unrelated to anything touched
here) rather than real regressions.

**Two new real-hardware test flows** (`test-flows/display-spi-gs2-cyd-test.flow.json`,
`display-spi-mono-cyd-test.flow.json`), same CYD config as the gs4 test flow -- `test-flows/README.md`'s
own entry has the full description and expected byte counts (19,200/9,600).

**Deployed and confirmed working on real CYD hardware, 2026-09-18 -- same day.** Mike ran both flows
on the same CYD unit gs4 was confirmed on; both rendered correctly (text, colored/shaded bands, filled
circle/rectangle) with no `MemoryError` and no visible bit-order corruption, closing out the open
question of whether the ascending-bit-order expansion loops (the opposite of gs4's) were actually
right on real silicon, not just independently hand-verified off-device. All three indexed depths
(`gs4`, `gs2`, `mono`) are now confirmed working end to end on real hardware.

## `startup` node reports why the flow started, 2026-09-25

Mike's point (`mikes-questions-and-points.md`): "the startup node should provide a reason in its payload, like
wake from deep sleep." Every `startup` message now carries `msg['reason']`: `deploy`, or at boot `power_on`,
`hard_reset`, `watchdog`, `deep_sleep`, `soft_reset`, `unknown`. A new payload type, `start reason`, also puts it
in the payload (output port type `string`), since `payload` is what generic downstream nodes read.
The listener sets `runtime.start_reason` just before importing the flow: `"deploy"` in `_handle_deploy`,
`_boot_reason()` (from `machine.reset_cause()`, matched by constant name because each port defines a different
subset) in `_resume_flow`. Codegen reads it with `getattr(runtime, 'start_reason', 'unknown')`, so a flow from
this editor still runs on a 5.0.0 board -- hence runtime 5.1.0, a minor bump, not a major one (CLAUDE.md's
bump rule: nothing this codegen emits fails on the old runtime). Done now rather than later because the node
shipped 2026-09-24: adding a field changes no existing flow. Detail left for later: ESP32's
`machine.wake_reason()` (which pin or timer woke it) is not reported.

## `bme280` node, 2026-09-26

First I2C sensor node. A source with a dict payload `{temperature, humidity, pressure}` (Mike's call over one
number chosen by a property); BMP280 accepted with humidity `None` (Mike: "both supported if easy"). Driver:
vendored robert-hh `bme280_float.py` plus marked local patches -- chosen over writing our own because its
compensation maths is the datasheet's and already checked against the datasheet's worked example in
`device-runtime/test/test_bme280.py`; the patches add what it lacked (chip-id check, BMP280, an asyncio read).
Fault handling: status dot, never raise out of the loop (`outstanding-items/i2c-spi-sensor-nodes.md`).
Runtime 6.0.0: a flow using the node needs the driver on the board (Mike: "ok for the moment", pending
lazy-loading part 2, pushing libraries with the flow).

## Generic `i2c` node, 2026-09-26

Mike's ask, for devices without a node of their own. A transform on the shared I2C bus: `read` (N bytes, optional
8-bit register), `write` (msg.payload as bytes / list of 0-255 / one int, message passed on unchanged) or `scan`.
Same fault handling as `bme280`: never raises (a raising transform ends its source's loop), status dot on failure,
only on change. Board-to-board messaging over I2C was split off as a separate POST-MVP item (outstanding-items.md,
"comms bus"); this node is controller-side only.

- **2026-09-27 — Custom nodes load automatically (Mike's call; reverses 2026-08-20/21 "session-scoped only").**
  Every package in `~/.thingstudio/custom-nodes/` is loaded when the editor connects to the backend; a broken
  one is skipped and named. Trust unchanged: loading only registers a palette entry, and the code runs on a
  board only after the user places the node and deploys. Built 2026-09-30, next entry.

- **2026-09-30 — Auto-load built.** The editor loads every package the backend lists
  (`app/custom-node-loader.ts`) on start, on backend reconnect, on window focus, and on the palette's
  **Reload custom nodes** (replacing "Load custom node…" and its picker). One console line per broken
  package, naming its file; an unchanged folder logs nothing on focus. Two packages with the same `type`: the
  first (backend order: search folder, then file name) loads, the second is reported -- never replaced. A
  flow using a type whose package failed says which file and why, on open (`missingNodeTypeMessage`) and in
  the compile preview. The backend searches an ordered list of folders (`PersistedStore.custom_node_dirs`,
  only `~/.thingstudio/custom-nodes/` today); a same-named package in a later folder is listed as shadowed.
  Two example packages (`examples/doubler`, `examples/dht22`, `backend/.../example_nodes/`) are copied into
  `~/.thingstudio/custom-nodes/` only when that folder doesn't exist yet, so deleting one sticks.
- **2026-09-30 — Built-in nodes do not move into `~/.thingstudio` (Mike agreed).** Question raised: should
  every node, built-ins included, live in the user's folder? No: an edited built-in in the user folder would
  either block or be overwritten by upgrades; built-ins are tied to the board runtime and its vendored files
  (`mqtt_as`, the event primitives, `decideDeploy`'s version gate); and a broken or deleted file would take
  out basic nodes and every flow using them. The Node-RED model instead: same format, different place -- core
  nodes ship with the install, `~/.node-red` holds only what the user adds. Built-ins may later become
  packages in a folder shipped with the install, placed ahead of the user's folder in `custom_node_dirs`;
  the reserved `thingstudio/` namespace keeps a user package from replacing one by accident. That needs the
  package format to reach parity first (tracked in `outstanding-items.md`, "Custom node format parity").
