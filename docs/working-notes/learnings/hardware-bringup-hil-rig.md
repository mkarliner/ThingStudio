# Learnings — Hardware bring-up / HIL rig

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **A floating witness GPIO input pin picks up what looks exactly like a
  real signal — steady ~27–29µs-spaced edge bursts, present even with
  nothing driving the DUT side.** Diagnosed from the burst's suspicious
  regularity (inconsistent with a real transition or simple wire
  crosstalk) — fixed by giving every watching pin an internal
  `PULL_DOWN`. Design around this from the start on any new witness-rig
  wiring, don't rediscover it. `fault-isolation-briefing.md`,
  `tier1-sensors-network-briefing.md`.
- **Long breadboard patch wires cause real electrical ringing on fast
  GPIO edges.** Harmless for "did *a* transition happen" checks; would
  corrupt anything relying on precise edge *counts* (PWM duty-cycle,
  timer measurements) until the wiring is cleaned up (shorter leads, a
  series resistor). `tier1-sensors-network-briefing.md`.
- **A witness's first `.irq()` arm in a session can `MemoryError` under
  heap fragmentation.** Pre-existing MicroPython behavior, not a bug in
  this project's firmware — worked around with a `gc.collect()` plus a
  throwaway warm-up call before the real checks. `mvp-validation-plan.md`,
  2026-08-14 GPIO/timer hardware Results entry.
- **Watching a board's first boot through Thonny is unreliable.**
  Thonny's Shell sends a keyboard interrupt on connect/reconnect, which
  `listener.py`'s deliberate few-second boot-delay window (§5's
  physical-access fallback) interprets as a real request to drop to
  REPL — looks exactly like "never reaches HELLO" even when boot is
  correct. Use a passive `mpremote connect <port>` (no interrupt) or any
  serial monitor that doesn't auto-send Ctrl-C on open. Not
  board-specific — will bite on any board watched this way.
  `rp2040-bringup-findings.md`.
- **Declared node `width`/`height` are a real rendering clipping budget
  in Rete's classic preset, not layout hints the way Litegraph's `size`
  is.** A node sized against the default renderer can clip its own socket
  once custom per-type styling changes padding/font — verify, don't
  assume old sizes still fit. `editor-look-and-feel-briefing.md`,
  `rete-migration-implementation-briefing.md`.
- **A single full-frame `framebuf.FrameBuffer` buffer can `MemoryError` on a classic ESP32
  (not S3) even though the total exists in RAM.** A 240x320 RGB565 frame (153600 bytes) failed
  to allocate as one contiguous block on a real CYD unit (`cyd-display-test-pattern.py`,
  2026-09-18) -- TiDAL's smaller 135x240 panel (64800 bytes) never hit this. Worked around by
  building and pushing the frame one horizontal strip at a time (~25KB each) instead of one
  full-screen buffer, with `gc.collect()` between strips. Relevant to item 4's flash/memory-budget
  concerns and to `framebuffer-display-node-scoping.md`'s LVGL/full-frame-contract question -- a
  full-frame-only input contract may not hold as a free assumption on every board this project
  targets, independent of the LVGL partial-rect question. Not yet built into `display_spi`'s own
  codegen -- a real risk for any panel resolution large enough to matter, worth revisiting before
  a bigger panel is targeted.
- **`st7789py_mpy`'s `_set_mem_access_mode()` never exercises the MADCTL `MH` bit (Display Data
  Latch Order).** Its rotation table only combines `MY`/`MX`/`MV`; a real CYD panel
  (2026-09-18 bring-up) stayed mirrored across all four `MY`/`MX` combinations and only came out
  correct with `MH` set (`MADCTL = BGR | MH | MX`, written directly, bypassing the helper). Some
  ST7789 glass/FPC assemblies apparently need `MH` specifically for horizontal orientation, not
  `MX` -- worth trying if a future panel stays mirrored through the whole `MY`/`MX` rotation table.
- **CYD chip-ID SPI reads (`RDDID`, `RDID1-3`, ILI9341's `RDID4`) all came back `0x00` on a real
  unit, while `RDDST` (Read Display Status) returned real structured data on the same wiring** --
  proof the SPI/MISO/pin wiring was correct, not that the chip lacks a readable identity. These
  four ID-specific registers are apparently just not implemented usefully on this board, matching
  an independent CYD diagnostic tool project's choice not to attempt automatic ID detection at all.
  Don't treat an all-zero ID read as damning on its own -- check whether ANY register roundtrips
  real data first (a working non-ID read like `RDDST` is what actually proves the bus itself is
  fine). `test-flows/cyd-controller-id-probe.py`.
- **Community board-naming heuristics for the CYD (2-USB vs 1-USB "R" suffix -> controller chip)
  actively conflict between sources** -- one GitHub issue claims 2-USB is ST7789 and "R" is
  ILI9341; Bruce firmware's own default device profile for the same board string is ILI9341
  regardless. Real-hardware confirmation (this file's own entry above) matched the 2-USB->ST7789
  claim for one specific unit, but the two sources disagreeing at all is itself the useful data
  point -- board string/USB-port-count is a hint worth checking, never a substitute for testing the
  actual unit.

- **A `SyntaxError: invalid syntax` / `File "<stdin>", line 1` on connect or "Check status" usually
  means the board has no runtime at all, not a boot-timing race -- check the boot log before chasing
  DTR/RTS.** Discovered 2026-09-18, second CYD unit for the `gs4` real-hardware pass: connecting (and
  retrying) both produced this exact error, with the connecting side's own framed message (e.g.
  `F64:AAIKoA==`) visible right after a `>>> ` prompt -- proof real protocol bytes were reaching the
  board fine, just landing on its raw REPL instead of `listener.py`'s framed protocol loop. First
  hypothesis (plausible, not wrong in general): `listener.py`'s own 3-second boot-delay window
  (`_BOOT_DELAY_S`, real Ctrl-C still live) racing against the backend's `HELLO_REQUEST`, sent ~0.5s
  after connect, if opening the serial port also auto-resets the board (`serial_relay.py`'s
  deliberately-unresolved DTR/RTS default, `backend-platform-decision.md` §5,
  `backend/test/hardware/dtr_rts_disconnect_pass.py` exists to pin this down). **Actual cause here,
  confirmed once a full power-on boot log was seen:** this specific board had simply never had
  `deploy_runtime.py` run against it -- boot showed the plain MicroPython banner
  (`MicroPython v1.28.0 on 2026-04-06...`) with no `LISTENER_BOOTING` line at all, meaning there was no
  `main.py` to race against in the first place; every message sent, at any time, would hit the REPL.
  **The tell:** a real boot-delay race would still show `LISTENER_BOOTING -- Ctrl-C within 3s...`
  before the REPL takes over; a never-bootstrapped (or wiped) board's boot log shows the stock
  MicroPython banner and nothing else. Check for that line before assuming the DTR/RTS race and
  reaching for the diagnostic script -- `deploy_runtime.py --port <port>` (`test-flows/README.md`'s
  "Bootstrapping a new board" section) is the fix when it's absent, no `--wipe` needed. The DTR/RTS
  question itself is still genuinely open for a board that DOES show `LISTENER_BOOTING` and still hits
  this.

- **CYD's `display_spi` pins need `baudrate` capped around 27MHz -- 40MHz silently creates an invalid
  SPI device handle, then crashes hard on the first real transaction.** Discovered 2026-09-18,
  `display_spi`'s first-ever real CYD deploy (`test-flows/display-spi-gs4-cyd-test.flow.json`, the gs4
  real-hardware pass): `machine.SPI(2, baudrate=40000000, ...)` (`display_spi`'s own node default)
  printed no Python-level error, but the console showed `E spi_hal: The clock_speed_hz should less
  than 26666666` / `E spi_master: spi_bus_add_device(500): assigned clock speed not supported` --
  ESP-IDF silently failed to create a real device handle underneath a Python object that still looked
  valid. The first actual SPI transaction (`ST7789.init()`) then hit repeated
  `check_trans_valid: invalid dev handle` errors and crashed hard: `Guru Meditation Error: Core 1
  panic'ed (LoadProhibited)`, `EXCVADDR: 0x00000074` (a near-null pointer dereference) -- a real
  boot-loop (`SW_CPU_RESET`), not a catchable Python exception (confirmed `_resume_flow()`'s own
  `try/except Exception` around `import _flow` doesn't catch it -- this is a C-level fault). Initially
  looked exactly like a gs4/`@micropython.viper` bug (first-ever real deploy of that code too, same
  session) -- ruled out by realizing the crash happens on every boot with no inject click, meaning it's
  in the flow's unconditional SETUP code (SPI/ST7789 init), never the click-gated sink/expand code
  viper only touches. Root-caused by isolating the exact init sequence into a standalone script
  (`test-flows/cyd-display-spi-init-probe.py`) run step-by-step via `mpremote run`, which pinpointed the
  crash to the SPI bus construction itself. This CYD's specific pin assignment (`sck=14, mosi=13,
  cs=15, dc=2` on SPI bus 2) apparently can't reach 40MHz -- likely GPIO-matrix routing rather than the
  native IO_MUX fast path, capping the real achievable clock well below the node's 40MHz default. Every
  prior CYD display script (`cyd-display-test-pattern.py`, `cyd-display-mh-test.py`,
  `cyd-display-orientation-test.py`) already used `baudrate=27_000_000` -- nobody had hit this because
  none of them went through `display_spi`'s own codegen default before; this gs4 flow was the first
  real CYD `display_spi` deploy through the actual pipeline, node default and all. TiDAL's flow uses
  `baudrate: 40000000` and works fine, so this is pin-assignment-specific, not a general 40MHz problem.
  **Fix: pin `baudrate` explicitly per board, same convention `xstart`/`ystart`/`colorOrder`-family
  properties already established** -- a real flow targeting real hardware sets its own real values, the
  node's default is a starting point, not a promise any given board matches it. No codegen change
  needed; `baudrate` was already a real property. `decisions/node-authoring.md`'s 2026-09-18 entries,
  `outstanding-items/display-spi-framebuffer-memory.md`.

- **A repeated large `bytearray`/`bytes` allocate-and-discard cycle at a fast timer cadence
  fragments a classic-ESP32 heap badly enough to `MemoryError` within about a second, even right
  after a power cycle.** Found 2026-09-18 building `test-flows/display-spi-gs4-cyd-animation.flow.
  json` (a `thingstudio/timer`-driven, `intervalMs: 1` version of the already-confirmed gs4 CYD test
  flow). Its `function` node reused the single-inject test flow's own code unmodified -- `buf =
  bytearray(stride * h)` then `msg['payload'] = bytes(buf)`, two full 38,400-byte allocations every
  tick -- which is fine run once per manual click, but run continuously it hit
  `MemoryError: memory allocation failed, allocating 38401 bytes` almost immediately on deploy, and
  the same on a fresh power cycle -- a real allocation-*pattern* problem, not the earlier session's
  one-off fragmentation-from-repeated-deploy-churn (that one needed a power cycle to clear; this one
  doesn't, because the fragmentation is happening live, every tick, inside a single boot). **Fix**:
  allocate the `bytearray` (and its `framebuf.FrameBuffer` wrapper) once, stash it in the function
  node's own `context` store (`context.get`/`context.set`, per-node-instance persistent state --
  `function-node.ts`'s header), and mutate it in place on every later tick instead of reallocating.
  Also dropped the `bytes(buf)` copy entirely: `display_spi`'s sink only ever reads the payload via
  `len()` and a viper `ptr8` pointer, both of which work identically against a `bytearray`, so the
  copy was never required in the first place, just carried over unexamined from the single-shot flow.
  Worth remembering generally: MicroPython's heap allocator has no compaction, so any flow that
  repeatedly allocates-and-drops a large buffer on a tight loop is a fragmentation risk regardless of
  total free RAM looking sufficient at any single snapshot -- a persistent, in-place-mutated buffer
  (this project's `context`/`flow` store mechanism) is the fix, not a bigger heap or a GC-timing
  workaround. `test-flows/README.md`'s own entry for the animation flow has the full before/after.

- **A blank ESP32-S2 (no MicroPython) enumerates on macOS as a USB serial port
  (`/dev/cu.usbmodem02`) and accepts an open, but sends nothing back at all — not even to Ctrl-C.**
  2026-09-23. So "port appears and opens" says nothing about whether MicroPython is there; total
  silence after Ctrl-C/Ctrl-A is the signal. Contrast a board with MicroPython but no runtime, which
  echoes a framed request back as a `SyntaxError`. `board-diagnosis.ts` / `raw_repl.classify_reply()`
  rely on that difference.

- **The CYD's 27 MHz SPI ceiling comes from using SPI id 2 with SPI id 1's pins.** Found 2026-09-23
  while writing the ESP32 processor definition. MicroPython's `machine.SPI(1)` on a classic ESP32 is
  HSPI, whose IO_MUX ("fast") pins are SCK 14 / MOSI 13 / MISO 12; `machine.SPI(2)` is VSPI, fast pins
  18 / 23 / 19 (`ports/esp32/machine_hw_spi.c`'s id table, ESP-IDF `spi_pins.h`). The CYD flows use
  `spiBus: 2` with 14/13, so the signals go through the GPIO matrix, where ESP-IDF caps full-duplex SPI
  at 80/3 MHz and refuses 40 MHz outright (the 2026-09-18 crash above). `spiBus: 1` on the same pins
  should reach 40 MHz or more. Not tested on hardware yet
  (`outstanding-items/processor-board-definitions-followups.md`). S2/S3 differ: their id 2 (SPI3) has no
  IO_MUX pins at all, and ESP-IDF's matrix frequency check is ESP32-only; TiDAL (S3) runs 40 MHz on id 2.


- **The single-shot CYD `display_spi` test flows' `bytes(buf)` copy stopped fitting under runtime 2.0.0.**
  Found 2026-09-24, CYD hardware check for the board definitions work. After a power cycle, the gs4 test flow
  deployed fine but its first inject hit `MemoryError ... allocating 38401 bytes` at 98 KB free: the
  `bytearray(38400)` fit, the `bytes()` copy needed a second contiguous 38 KB block that wasn't there. The same
  code worked on 2026-09-18 (runtime 1.x, smaller). Fix is the one the animation-flow entry above already found:
  send the `bytearray` itself. Applied to the gs4/gs2/mono CYD and TiDAL test flows and `display-spi.md`.
  Before the power cycle the same deploy timed out (no `DEPLOY_ACK`) and the board rebooted about 3 s after
  Deploy, then reported the flow as running; the power cycle cleared it. Not reproduced since, cause not pinned
  down -- if it recurs, capture the board's boot output.

- **Confirmed: the CYD's display runs at 40 MHz on SPI id 1.** 2026-09-24, same CYD unit as above: the gs4 test
  flow with `spiBus: 1`, `baudrate: 40000000` and the stock pins (SCK 14, MOSI 13) deploys and renders. This
  backs up the 2026-09-23 IO_MUX finding above (14/13 are id 1's own pins), and `pin-check.ts`'s rule now
  matches real hardware in both directions: id 2 at 40 MHz is refused at compile time, id 1 is allowed.
  The test flows still use id 2 at 27 MHz; switching them is optional.

- **Install runtime couldn't stop a Pico already running the listener.** 2026-09-24: `entering raw REPL: timed
  out ... last seen: b''`. The listener turns Ctrl-C off (`kbd_intr(-1)`), and the installer's Ctrl-C only ever
  worked because opening the port resets an ESP32 through its USB-serial chip's DTR/RTS, landing the Ctrl-C in
  the 3 s boot window. A native-USB board (RP2040, and ESP32-S2/S3 on native USB) doesn't reset on open, so
  only a power cycle got through. Install now does what Remove flow already did: STOP_TO_PROMPT from the editor
  when the board is answering, then `board_recovery.catch_prompt` (repeated Ctrl-C, reopen on re-enumeration,
  "press reset or unplug and replug" status) before raw REPL.
