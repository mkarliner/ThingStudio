# Learnings — MicroPython / device-runtime

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **`sys.stdin.read(n)`/`readexactly(n)` can hang a port's event loop
  outright — not just slow, a genuine non-yielding block `asyncio.wait_for`
  can't preempt.** Confirmed on the ESP32-C3 LuatOS CORE board during
  POC-D. Fixed by riding binary payloads over `readline()` (base64-encoded
  text line) instead. Verify per-port before trusting a specific-byte-count
  read anywhere in this protocol again — never assume it's safe just
  because it works in browser-side simulation. `thingstudio-design-doc.md`
  §15.5, `fault-isolation-briefing.md`.
- **`mpy-cross` needs RAM headroom beyond what the compiled code itself
  needs.** On-device compilation of large-enough source (MQTT client
  libraries were a real historical trigger, pre-`mpy-cross`-era) can OOM a
  constrained board even though the identical code runs fine once it's
  bytecode. Directly why v1 ships precompiled `.mpy`, not raw-source
  `exec()`. `thingstudio-design-doc.md` §15.1 resolution.
- **The ESP32-C3's hardware RNG is not a true RNG unless WiFi or
  Bluetooth is enabled** (Espressif's own ESP-IDF docs, verified directly).
  A USB-only v1 with no radio bring-up generating a nonce via
  `os.urandom()` would be pseudo-random. Chip-agnostic lesson, not an
  ESP32-C3 workaround: don't assume any given MicroPython target has a
  trustworthy on-chip RNG. `transport-auth-design.md`.
- **MicroPython's `asyncio` has no first-class UDP primitive on any port**
  (confirmed against upstream issue #13382, open). Unlike
  `open_connection`/`start_server` for TCP, UDP needs a non-blocking
  socket polled on a short interval, try/except around `recvfrom()`
  catching `EAGAIN`. `udp-tcp-nodes-implementation-briefing.md`.
- **A board with no auto-reset circuit needs a software fallback.** Some
  boards don't reset when a browser opens the WebSerial port the way
  `esptool`-flashable boards typically do — a best-effort
  `port.setSignals()` RTS trick helps but isn't universal; document the
  physical-reset fallback rather than assuming the software path always
  works. `thingstudio-design-doc.md` §15.5 (POC-D).
- **Client/device timeout mismatches make a working deploy look like a
  hard failure.** If the browser gives up waiting before the device's own
  internal timeout would have fired, a possibly-fine deploy reads as
  broken. Keep the client's wait comfortably longer than the device's
  worst case, never shorter. Same section.
- **ESP-IDF's own NVS-cached station auto-reconnect can fire from
  `network.WLAN(network.STA_IF).active(True)` alone, and races an
  immediately-following explicit `.connect()` call.** If a *previous*
  deploy left credentials in NVS, `active(True)` alone can kick off
  ESP-IDF's own reconnect using those stale credentials; code that then
  unconditionally calls `.connect(ssid, password)` right after (with no
  `isconnected()`/`status()` check first) can collide with that in-flight
  attempt, which ESP-IDF refuses with `E (...) wifi:sta is connecting,
  cannot set config` — its own driver-level error, not a MicroPython
  exception, so it surfaces as a raw serial log line rather than a Python
  traceback. Confirmed on real hardware via `mqtttest.flow.json`; root
  cause traced into the vendored `mqtt_as`'s `wifi_connect()` (ESP32
  branch), which had exactly this gap — `docs/working-notes/decisions.md`,
  2026-08-21 entry. Worth checking for the same shape (`active(True)`
  immediately followed by an unconditional `.connect()`, no connecting-state
  guard) in any other code that brings up `STA_IF` directly, not just this
  one call site.
- **`py_compile` only proves a file parses -- it caught neither of two
  real bugs a real MicroPython run found in the same session.** Built the
  actual toolchain (`device-runtime/test/README.md`'s recipe: clone
  `micropython`, `make -C mpy-cross`, `make submodules && make` in
  `ports/unix`) for the first time from inside a Cowork device-bridge
  session, entirely in the bridge's own scratch space (`~/tmp/`, never the
  shared mount) so it carried none of the cross-platform-native-binary
  risk the npm/`node_modules` restriction exists for. Running the real
  suite immediately surfaced `cbor.py`'s encoder raising `TypeError` on a
  `None` value (2026-09-05's `runtimeBuild` field, sent unconditionally
  including when unknown) -- invisible to `py_compile`, which only checks
  syntax, not runtime behavior, and would have shipped a HELLO that
  silently never sent on any board without a `_runtime_build.txt` marker.
  Worth the ~2 minutes of one-time build cost whenever a session touches
  `device-runtime/src` in a way that could actually run — `py_compile`
  alone is a syntax check, not a test.
- **CBOR `None`/null has to be handled explicitly on both the write and
  read side of an optional field -- it doesn't fail loudly by default.**
  `cbor.py` (this project's hand-rolled encoder) has no null/undefined
  support at all, by design (optional fields are meant to be omitted from
  the map entirely, never encoded as CBOR null) -- but nothing enforced
  that at the call site, so `_send_hello()` passing an explicit `None`
  straight through to `cbor.encode` raised, and that raise was swallowed
  by `_send_message_safe`'s own catch-all, so the failure mode was total
  silence (no HELLO at all), not a visible error. Fixed generally at
  `messages.encode_message_body` (drops `None`-valued keys before
  encoding) rather than at the one call site that happened to trigger it
  -- any future optional-and-sometimes-unknown field gets this for free.
  `decisions.md`'s 2026-09-05 entry.
- **A hand-rolled CBOR encoder/decoder can be self-consistent yet
  non-canonical, so it interoperates with nothing.** `cbor.py` encoded a
  double as major 7 + additional-info 24 + a byte 27 (`f8 1b`) instead of
  the canonical `fb` the editor's cborg emits, and its decoder read
  additional-info 27 as an 8-byte integer length, so it rejected cborg's
  form -- the two ends could not exchange a float in either direction. It
  round-tripped with itself in `test_cbor.py`, which is exactly why the
  unit tests missed it; found 2026-10-14 only when the shared protocol
  conformance vectors put an editor-encoded float through the device
  decoder. Fixed by emitting and accepting the canonical double (`fb` + 8
  big-endian bytes). The lesson: a round-trip test on one implementation
  proves nothing about interop -- cross-implementation conformance vectors
  are what catch encoding drift. `decisions/subsystem-interfaces.md`
  2026-10-14.
- **A `device-runtime/src` change with no codegen-visible effect is safe to
  skip a version bump for; almost anything else isn't, and nothing enforced
  that judgment call automatically until 2026-09-05.** `register_trigger`
  was added to `runtime.py` (2026-09-02, inject click-fire) without bumping
  `_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION`; a board bootstrapped before
  that change still reported the same `0.1.0` HELLO, `version.ts`'s
  `decideDeploy()` correctly said "compatible" (it only ever gates on a
  `major` mismatch), and the flow crashed on real RP2040 hardware with
  `AttributeError: 'module' object has no attribute 'register_trigger'`.
  Promoted to a CLAUDE.md standing rule the same day ("Device-runtime
  version bump discipline"): evaluate every device-runtime-pushable change
  for whether it could make an editor's codegen produce a flow the OLD
  runtime can't run correctly, and if so bump both consts together, in the
  same commit. Blunter than textbook semver — most `runtime.py` additions
  end up `major`, not `minor` — because `minor`/`patch` bumps give
  `decideDeploy` zero actual gating power today; an over-cautious block on
  a safe deploy beats a false "compatible" that lets a crash through again.
  Backed the same day by a non-blocking backstop Mike asked for "for belt
  and braces," not instead of the rule: `test-flows/deploy_runtime.py`
  stamps a board with a git SHA of `device-runtime/src` at push time, the
  board echoes it back in HELLO as `runtimeBuild`, and `version.ts`'s
  `checkRuntimeBuild` logs a warning on mismatch — diagnostic only,
  deliberately a plain marker rather than a content hash (a hash would flag
  a same-behavior comment edit as "different" with no way to tell how much
  actually changed). `runtimeBuild: null` means "can't confirm," not
  "confirmed stale." `decisions.md`'s "Redeploy / network fault handling"
  section, 2026-09-05 entry.

- **`@micropython.viper` works cleanly for a GS4/GS2/mono-to-RGB565 pixel-expansion loop and is
  dramatically faster than plain Python -- confirmed off-device on a real MicroPython unix-port
  build, not yet on this project's actual ESP32 hardware.** Written for `display_spi`'s
  framebuffer-memory scoping (`outstanding-items/display-spi-framebuffer-memory.md`) -- before
  committing engineering time to building `frameFormat`/`palette` properties into `display_spi`'s
  codegen, ran a standalone spike: cloned upstream MicroPython, built `mpy-cross` + the unix port
  fresh in an isolated cloud-session workspace (never the shared mount -- same discipline as
  `editor-build-tooling.md`'s npm/vitest restriction, for the same cross-platform-native-binary
  reason, even though this was a from-scratch build rather than an install into a shared tree), then
  wrote three `@micropython.viper`-typed (`ptr8`/`ptr16` params) expansion loops, one per reduced
  depth (gs4/4bpp, gs2/2bpp, mono/1bpp), each unpacking a source byte into 2/4/8 palette-indexed
  pixels and writing real RGB565 bytes to a destination buffer. All three correctness-checked
  against hand-derived expected output first, then timed against a plain-Python equivalent (gs4
  only, for the ratio). Results, x86 dev machine, 240x320 frame: gs4 0.25ms, gs2 0.23ms, mono 0.38ms
  (all far under the source driver's ~100ms/frame target this scoping cites), a ~42x speedup over
  plain Python for gs4. Core gs4 loop, for reference:
  ```python
  @micropython.viper
  def expand_gs4_viper(src: ptr8, dst: ptr8, n: int, pal: ptr16):
      for i in range(n):
          b = int(src[i])
          hi = b >> 4
          lo = b & 0x0F
          c0 = int(pal[hi])
          c1 = int(pal[lo])
          j = i * 4
          dst[j] = c0 >> 8
          dst[j + 1] = c0 & 0xFF
          dst[j + 2] = c1 >> 8
          dst[j + 3] = c1 & 0xFF
  ```
  gs2/mono use the same shape (4 and 8 pixels per source byte respectively, same palette-lookup +
  byte-split pattern). Confirms the mechanism has no syntax/semantic surprises and that the
  expansion loop itself is very unlikely to be the CPU bottleneck relative to SPI transfer time.
  **Caveat, don't over-read this:** not a real-hardware timing result -- an x86 dev CPU is not an
  ESP32 Xtensa core, and this spike never touches MicroPython's own SPI driver (the actual
  bottleneck in the corroborating GS4 driver account the design doc cites) at all. A real CYD/TiDAL
  pass is still needed before the "under 100ms" target is confirmed for this project's own boards.
  Spike script itself was not checked into this repo (throwaway, cloud-session-only) -- the loop
  shape above plus this entry's numbers are what's preserved; reconstructing it is a few minutes'
  work if a future session wants to re-run or extend it. `outstanding-items/display-spi-framebuffer-
  memory.md`, `decisions/node-authoring.md`'s 2026-09-18 entries.

- **`framebuf.GS4_HMSB` (and `GS2_HMSB`/`MONO_*`) row stride is rounded UP to a whole byte -- a flat
  `width * height / 2` buffer-size formula is wrong for an odd width.** Confirmed by reading
  MicroPython's own `extmod/modframebuf.c` directly (`stride = (stride + 1) & ~1;` for GS4_HMSB before
  the byte count is derived), not assumed from the format name. For an EVEN width (CYD's 240) this
  rounding is a no-op and a flat formula happens to still be correct, which is exactly what made a
  first-draft `display_spi` `"gs4"` expansion loop's flat-nibble-count bug easy to miss -- it only
  breaks on an ODD width (TiDAL's real 135: 68 bytes/row, not 67.5), where a naive expansion silently
  shifts every pixel after the first odd-width row out of alignment for the rest of the frame. Design
  around this from the start on any future reduced-depth framebuf work; applied to `gs2`/`mono` from
  the start when they were built the same day gs4 was confirmed on real hardware (below) -- the correct
  per-row byte count is `Math.ceil(width / 2)` (or `/4`, `/8` for gs2/mono), and the expansion loop
  needs to discard trailing pad nibbles/bits per row, not just expand every byte in the buffer flatly.
  `decisions/node-authoring.md`'s 2026-09-18 `frameFormat: "gs4"` entry, `outstanding-items/
  display-spi-framebuffer-memory.md`.

- **`GS4_HMSB`'s pixel bit order inside a byte does NOT generalize to `GS2_HMSB`/`MONO_HMSB` --
  they're the opposite of gs4, and (for mono) opposite of the similarly-named `MONO_HLSB` too.** Found
  building `gs2`/`mono` support for `display_spi`, 2026-09-18, by reading MicroPython's real
  `gs4_hmsb_setpixel`/`gs2_hmsb_setpixel`/`mono_horiz_setpixel` C source directly rather than assuming
  gs4's already-working, real-hardware-confirmed expansion loop would generalize by analogy. `GS4_HMSB`
  packs the first (leftmost) pixel of each pair into the HIGH nibble, the second into the LOW nibble --
  descending, high-to-low. `GS2_HMSB` (`shift = (x & 3) << 1`) and `MONO_HMSB` (`offset = x & 7`) are
  the other way: each format's first pixel occupies the LOWEST bits, its last pixel the HIGHEST --
  ascending, low-to-high. A further trap: MicroPython's OTHER row-oriented 1-bit format, `MONO_HLSB`
  (`offset = 7 - (x & 7)`), is actually the DESCENDING one despite its "LSB" name -- it's `MONO_HMSB`,
  not `MONO_HLSB`, whose bit order doesn't match gs4's, even though the naming would suggest the
  opposite at a glance. Getting this backwards silently scrambles pixel order within every row (not a
  crash, not a wrong color -- a spatial smear), exactly the "looks like corruption, isn't flagged as an
  error" failure class this project keeps hitting with framebuf formats. Each depth's expansion loop
  needs writing and verifying against its OWN format's real source, never derived from another depth's
  by analogy, no matter how similar the two look. `decisions/node-authoring.md`'s 2026-09-18 "gs2/mono
  frame formats built" entry has the full derivation.
- **2026-09-24 — Unix-port sockets want a resolved address; unix port has no `os.dupterm`.** WiFi transport
  work (`net_transport.py`). `sock.bind(("0.0.0.0", port))` raises "object with buffer protocol required" on the
  unix port, which only takes a raw sockaddr; `socket.getaddrinfo(host, port)[0][-1]` works on every port, so use
  that. And `os.dupterm` exists on ESP32 and rp2 (`MICROPY_PY_OS_DUPTERM`) but not in the unix build, so the
  "mirror all print() output to the WiFi session" path can't be covered off-device -- only the F64-only fallback
  is. The dupterm path needs the hardware pass.
- **2026-09-24 — Ending an asyncio session from another task: cancel it, don't just close its socket.** Closing
  the writer from outside left the session's `readline()` waiting until its 8 s read timeout noticed; cancelling
  the handler task (`asyncio.current_task()` captured at session start) runs its `finally` at once.
- 2026-09-25, ESP32-C3: **compiling source on the board can starve WiFi.** A flow with MQTT nodes could not make a
  first WiFi join -- 15 s at `STAT_CONNECTING` (1001), then 202 (authentication failed) -- while a `wifi_status`-only
  flow joined the same network from the same state, and an MQTT flow deployed onto an already-joined board worked.
  Four fixes aimed at the connect sequence changed nothing. Explanation, confirmed by the fix working (the heap
  itself was never measured -- `esp32.idf_heap_info(esp32.HEAP_DATA)` before and after `import mqtt_as` would): MicroPython's ESP32 heap grows into the
  ESP-IDF heap and doesn't give it back, so compiling ~900 lines of `mqtt_as.py` at import left the WiFi driver
  too little memory for the WPA handshake. Earlier the same day the driver also failed with "Expected to init 10
  rx buffer, actual is 0" -- the same shortage. Response: precompiled installs
  (`decisions/runtime-install-from-editor.md`). The runtime's boot footprint grew in 3.0.0 (WiFi transport), and
  the display/eswitch work landed without a network test on the C3; a memory check belongs on the hardware list.
  Result: with the runtime installed as precompiled `.mpy`, the same MQTT flow joined WiFi 1.7 s after a clean
  power-cycle, and MQTT connected once the broker credential was corrected (CONNACK 0x5 was a wrong broker
  password, unrelated).
  Ruled out: a different network. The flow switched from the `home` credential to `mihome` during the afternoon,
  but the two hold the same SSID and password (Mike), so failing and working runs joined the same network.

## ESP32 reports the reset button as a power-on reset, 2026-09-25

Found on real hardware (ESP32-C3, runtime 5.1.0), testing the `startup` node's start reason: pressing the reset
button gave `power_on`, not `hard_reset`. On ESP32-family chips the button drives the EN (chip enable) pin, so
ESP-IDF sees a power-on reset and MicroPython's `machine.reset_cause()` returns `PWRON_RESET`. Nothing to fix;
the user guide's startup page says so. `hard_reset` is only reported by ports that have a separate reset pin.

## Sensor drivers often block the event loop while they wait, 2026-09-26

robert-hh's BME280 driver (a common MicroPython choice) waits for each conversion with `time.sleep_ms()` in a
loop -- about 60 ms at its default 8x oversampling, during which every other asyncio task on the board (the
listener, WiFi transport, other nodes) is stalled. Most community sensor drivers are written for a plain script,
not an asyncio flow. Check any driver before vendoring it for a blocking wait, and add an async path (see
`device-runtime/src/vendor/bme280/README.md`, local patch 2) rather than calling the blocking method from a node.

## A running display flow leaves too little memory for one large message -- or for WiFi, 2026-10-07

Found on a CYD (classic ESP32, no PSRAM) with `display-spi-gs4-cyd-test` running (38 KB framebuffer). Two effects:

- Decoding an 11 KB protocol message (a whole library) failed with MemoryError: the MicroPython heap had enough free
  bytes in total but no 11 KB block. Fixed by sending libraries in 1 KB pieces (`flow-dependencies-scoping.md`).
  Any message that carries a large `bytes` field (DEPLOY's bytecode too) has the same exposure; flows are small today.
- HELLO then reported ESP-IDF heap 1 KB free (MicroPython 79 KB free). On ESP32 the MicroPython heap grows by taking
  ESP-IDF memory when it runs short, and keeps it until reset. WiFi allocates from the ESP-IDF heap, so after a
  display flow has grown the heap, a WiFi/MQTT flow deployed without a reset has nothing to join with. Same mechanism
  as the 2026-09-25 ESP32-C3 entry. A deploy that starts the new flow from a fresh boot would avoid it.
- Checked on the CYD the same day (Mike): a soft reset (`machine.soft_reset()`) does NOT give that ESP-IDF memory
  back; the figure stayed low until a hard reset. The grown MicroPython heap survives a soft reset. So the console's
  advice for low ESP-IDF memory is the hard reset (`memory-advice.ts`'s `HARD_RESET_HINT`); the soft restart is
  only offered for a `MemoryError` (fragmentation).
- Where a classic ESP32's 520 KB goes (CYD, display flow, `micropython.mem_info()` plus
  `esp32.idf_heap_info(esp32.HEAP_DATA)`): six ESP-IDF heap regions total 233 KB, so ~287 KB is gone before any
  heap (code in IRAM, flash cache, static data, Bluetooth's reservation -- not visible at run time; a component
  split needs `idf.py size-components`). Of the 233 KB: MicroPython's GC heap 109 KB (`GC total: 112000`),
  ESP-IDF/FreeRTOS/WiFi ~85 KB, free 33 KB, all of it in the last region as one 32 KB block. Five regions had 4
  bytes free: filled by MicroPython's grown blocks and ESP-IDF. `max new split: 32768` means MicroPython may still
  grow into that last block, which is what leaves WiFi ~1 KB. Inside the GC heap, 23 KB free but the largest gap
  ~9 KB (`max free sz: 575` blocks of 16 bytes). User-facing summary: `docs/user-guide/faq.md`.

## A USB-UART board has no flow control: pace what you send, 2026-10-07

Found on a CYD (classic ESP32 behind a CH340 bridge), sending a library in 1 KB pieces back to back. The board
reported `CBOR map key must be a text string` and `incorrect padding` for pieces the editor had encoded correctly.
The bridge has no flow control: while the board was busy writing one piece to flash, the next overran MicroPython's
UART input buffer and bytes were lost mid-line. Native-USB boards (Pico W, ESP32-C3/S3) didn't show it, since USB
CDC applies backpressure. Fix: the board answers each piece (`DEP_ACK`) and the sender waits for it. Any bulk
transfer to a board should be paced by a reply, not just kept small.

2026-10-19, same class on an ESP32-C3 board that also uses a USB-UART bridge (CH343, not native USB): while the
previous WiFi/MQTT flow was still running and printing, a dependency install reported `incorrect padding` and then
`timed out waiting for DEP_ACK`, and the following DEPLOY missed its ACK. The pacing is in place; the flow's own
WiFi/MQTT work can still delay the ACK past the host's wait. Deploying a quiet flow first (or simply retrying, since
the installed pieces stay installed) clears it. Stop the old flow before a dependency install when the board is
busy, rather than treating the first failure as a compile error.

## font_to_py's height isn't the size you ask for, 2026-10-07

`font_to_py <font> 16` gave Atkinson Hyperlegible a 17px line height; 48 gave 47px. The size argument is a
target, not the result. Anything laying out text must read `height()` from the generated module (the editor's
font JSON carries it), never assume the nominal size. `gui-font-pipeline-scoping.md`.

## framebuf won't wrap a read-only buffer, 2026-10-08

`framebuf.FrameBuffer(memoryview(some_bytes), ...)` raises "object with buffer protocol required" on the unix
port: it needs a writable buffer. A font_to_py glyph is a memoryview into the module's `bytes`, so drawing it
needs either a copy (`bytearray(glyph)`, an allocation per glyph) or `uctypes.bytearray_at(addressof(glyph),
len(glyph))`, which nano-gui's `CWriter` uses and our GUI surface now does (falling back to the copy where
`uctypes` is missing). `vendor/thingstudio_gui/gui.py`, `FrameSurface.text`.

## Fragmentation makes module loads erratic; a stock ESP32 is nearly full with one MQTT flow, 2026-10-08

Mike's experience, not yet measured. On a CYD, loading `mqtt_basic` after the test display flow was erratic: it
sometimes failed. Total free heap was not the limit; the largest free block was, since an imported `.mpy` needs
its code and constants as large allocations. Same mechanism as the 11 KB message above. Separately, stock ESP32s
(no PSRAM) have little room left with a single `mqtt_as` flow.

Frozen modules run from flash and never touch the heap, so they would avoid both. Scoped as a spike:
`frozen-firmware-spike-briefing.md`. Note `gc` has no largest-free-block call; use `micropython.mem_info()`
(`max free sz`, in 16-byte blocks) or bisect with `bytearray(n)`. User-facing: `docs/user-guide/debugging.md`.

## ESP32 MicroPython uses a split heap: "116 KB free" is not a 116 KB block, 2026-10-22

`ports/esp32/mpconfigport.h` sets `MICROPY_GC_SPLIT_HEAP (1)` and `MICROPY_GC_SPLIT_HEAP_AUTO (1)`. The heap is
several regions carved out of ESP-IDF memory as it becomes available, and `gc.mem_free()` **sums them**. Ask for one
big block and it must fit inside a single region.

The CYD showed it: 116 KB free, and a 9,538-byte allocation still failed — with IDF heap down to 12 KB free, the
regions were small. Worse, it varies with history: a 16 KB probe succeeded 40 seconds earlier on the same board.

Consequences worth remembering:

- A "free RAM" figure says nothing about whether a particular message will fit. For a fit check, try the allocation
  (the listener's old `LISTENER_FREED` probe did exactly that; the probe went with the recovery chain in 12.0.0, but
  the technique is the right one if a fit check is ever needed again).
- The fix for a big payload is pieces, not more free space — which is why libraries went to `DEP_PUT` pieces and
  the flow bytecode does the same (`FLOW_PUT`/`FLOW_COMMIT`). Piece size is 5 KB since 12.0.0: 1 KB pieces were
  correct about the heap and wrong about the wallet — each piece waits for an ack, so hundreds of them make a
  deploy slow.
- A soft reset (or a reflash) is the only way to get a fresh interpreter; freeing objects scatters the heap
  further. It is **not** the way to get a bigger block: `gc_init()` runs again over the same regions, so a
  fragmented heap stays fragmented. Only a power cycle (a full chip reset) rebuilds the heap from the chip's own
  memory, which is why the user-facing recipe for "too full to receive the flow" is Remove flow… → power cycle →
  deploy (`docs/user-guide/debugging.md`, 2026-10-22).

## The ESP32 REPL input buffer is 260 bytes, and the display can outlast it, 2026-10-22

`ports/esp32/mphalport.c` hardcodes `stdin_ringbuf_array[260]` (rp2 makes it a macro,
`MICROPY_HW_STDIN_BUFFER_LEN`, default 512). The UART interrupt fills that ring; `ringbuf_put()` **drops
bytes silently** when it is full. At 115200, 260 bytes is 22 ms.

That is shorter than a GUI frame: a full-screen SPI draw blocks the VM for ~30 ms. So while a display flow is
painting, a long line arriving from the editor loses its middle, and what reaches the CBOR decoder is garbage —
on the CYD, `MessageDecodeError('unsupported CBOR additional-info value 29 ...')`. The board logs and recovers,
but the editor was waiting for an acknowledgement of a message that never existed: three 10 s timeouts, then
"no reply to flow byte 0".

What this rules out and what it leaves:

- **Smaller pieces do not fix it.** Any stall longer than 22 ms loses bytes mid-line, so the probability drops
  with piece size while the failure stays. That is also what the earlier "resend a dropped library piece"
  retry was really papering over (1 KB pieces, 2026-10-22).
- **Pacing does not fix it.** The editor already sends one piece at a time and waits for the ack; the loss is
  inside a single line, driven by how long the board is busy, not by how fast pieces are sent.
- **Buffer size does.** `firmware/classic-esp32/patches/0001-esp32-stdin-ringbuf-8192.patch` raises it to
  8192 (~690 ms of tolerance, covers a 5 KB piece's ~6.9 KB base64 line). 8 KB of static RAM.
- **A silent drop should not be silent.** Since 12.1.0 an unreadable line answers `FLOW_ACK{ok:false,
  code:"Garbled"}` for the offset the board has stored, so the editor reports the real problem at once instead
  of timing out. Nothing else is repaired: the piece is resent (bounded), then reported.

General lesson: when a device drops input without saying so, the host's timeout is the only symptom, and it
points at the wrong layer. Make the drop visible before making anything bigger.

**Confirmed on hardware, 2026-10-23:** with the 8192-byte buffer in the image, the hero GUI flow deployed three
times in a row over the running flow, no garbled pieces. The 260-byte version failed two out of three at the same
place.

## Repeated deploys eat the chip's heap, even when they work, 2026-10-23

Measured on the CYD with the 12.1.0 image, one connection, GUI hero flow (9.5 KB of bytecode). Figures are KB,
MicroPython free / largest block, and ESP-IDF free / largest:

| State | MicroPython | ESP-IDF |
|---|---|---|
| Just booted, no flow | 142 / 105 | 129 / 108 |
| GUI flow running | 108 / 50 | 70 / 52 |
| After two more deploys over the running flow | 120 / 27 | 18 / 14 |

Two different things are happening, and both matter:

- **The largest MicroPython block falls every deploy** (105 → 50 → 27 KB): the split heap grows and the flow's
  buffers land in new places. A 9.5 KB flow still starts at 27 KB, which is why repeated deploys work at all.
- **The chip heap goes down and stays down** (129 → 70 → 18 KB): `MICROPY_GC_SPLIT_HEAP_AUTO` takes blocks from
  ESP-IDF when MicroPython needs room, and nothing gives them back until a reset. At 18 KB, WiFi may fail to start --
  that is below `memory-advice.ts`'s 30 KB warning line, which is why the editor says a power cycle is needed rather
  than a soft restart.

Also worth remembering when measuring this: the probe itself perturbs the numbers. `gc.mem_free()` after a big
allocation bisect reports a bigger heap than the board had before the probe, because the probe made the heap grow.
Read the ESP-IDF figures *first*, then bisect for the largest block, and don't compare an idle-boot HELLO (149 KB)
with a probe's free figure (145 KB) as if they were the same measurement.

## Redeploy over a running GUI flow: stopping the flow isn't freeing it, 2026-10-22

Deploying a GUI flow while another GUI flow runs on a CYD failed every time with
`MemoryError ... allocating 13309 bytes` — the DEPLOY message (9.5 KB of bytecode, 12.7 KB base64) had
to be received while the running flow held its framebuffer. Two device-side facts matter:

- **`runtime.cancel_running()` stops tasks, it does not reclaim the flow's memory.** The framebuffer and
  screen objects live in the flow module's own globals (`sys.modules['_flow']`), so free RAM barely
  moved: 50 KB before the free, 49 KB after. The deploy path releases them by deleting the module just
  before `import _flow`; any other path that needs the memory has to do the same. After that the retry
  fits.
- **The editor must wait past the board's own free before retrying.** The board answers `DEPLOY_ERROR`
  immediately and frees 200 ms later; a HELLO asked for straight after the error reports the *old*
  numbers, so gating the retry on it proves nothing. The editor now waits, then asks, and logs the
  figures it got.

Both are easy to get wrong in a way that looks like "not enough memory": three separate retries failed
before the log showed free RAM unchanged across `LISTENER_FREED`. When a free is claimed, measure it.

**Superseded the same evening (12.0.0).** Both behaviours above were removed: the listener no longer frees anything
for a retry, and the editor no longer retries. The facts stay true and are the reason the deploy cannot succeed on
this board while a GUI flow runs — `_deploy_flow` already deletes `_flow` just before `import _flow`, and even then
the import failed on 376 bytes. What changed is the conclusion: it is a board limit to state and design around, not
an error to recover from. See `decisions/classic-esp32-firmware.md`, second pass.

## A FROZEN_MANIFEST replaces the port's manifest; it does not add to it, 2026-10-22

The first classic-ESP32 image booted with no filesystem at all: `listdir("/")` empty, `os.mkdir`
answering ENODEV, and the console printing `could not find module '_boot.py'` on every reboot. The
cause was `FROZEN_MANIFEST` pointing at our own manifest: the port's default
(`ports/esp32/boards/manifest.py`, which freezes `_boot.py`, `flashbdev.py`, `inisetup.py`, `webref`
and friends) is then **not** used, and nothing at boot mounts or formats the "vfs" partition. The fix
is one line at the top of our manifest: `include("$(PORT_DIR)/boards/manifest.py")`.

Two symptoms worth recognising next time: `import flashbdev` failing with `ImportError` on a running
board, and the REPL's soft-reboot line `could not find module '_boot.py'`. Either means the image is
missing the port's own frozen modules, not that the partition table is wrong.

## Frozen modules: `.frozen` precedes `/lib`, and a frozen module can't be the boot script, 2026-10-22

Two facts that shaped the custom classic-ESP32 image
(`docs/working-notes/decisions/classic-esp32-firmware.md`):

- **`sys.path` puts `.frozen` before `/lib`** on both the unix and ESP32 ports, so a library pushed into `/lib`
  does *not* override a frozen copy by default. `deps.ensure_on_path()` appended `/lib`, which would have left
  the frozen copy winning and a pushed update silently doing nothing. It now inserts at position 0 (runtime
  11.1.0). Worth remembering for any other "freeze it, keep it updatable" plan: the order is the whole
  mechanism, and it is not the order you get by default.
- **A frozen module cannot be the boot script.** MicroPython runs `/main.py` from the filesystem, and frozen
  code isn't a file, so an image that freezes the listener still needs a tiny `/main.py` doing
  `import listener; listener.main()` (`firmware/classic-esp32/main.py`).

Also: `HELLO.runtimeBuild` is `null` on such an image -- there is no build-marker file to read. That already
means "can't confirm" to the editor's check, so it is not a fault, but it will read oddly to anyone comparing
SHAs.

## On an ESP32, network.WLAN(STA_IF) starts WiFi, 2026-10-08

Just constructing the station object initialises the WiFi driver and its netif, which takes tens of KB of
ESP-IDF memory, even if `active()` is never called. Our transport's watcher did that every 2 s on every board to
check for an IP. With a GUI flow's framebuffer using the memory, the start failed each time and ESP-IDF logged
`wifi:Expected to init 10 rx buffer, actual is 0` and `esp_netif_new_api: ... duplicate key` every 2 s (CYD,
Mike). Don't touch `network.WLAN` unless the board or flow actually wants WiFi; back off when it fails.

## FrameBuffer subclasses must call `super()`, not the unbound method, 2026-10-07

Found in the nano-gui spike (`nano-gui-spike-briefing.md`, Q4). In a Python subclass of `framebuf.FrameBuffer`,
an override that calls `framebuf.FrameBuffer.fill_rect(self, ...)` raises
`TypeError: argument should be a 'FrameBuffer' not a '<subclass>'`. `super().fill_rect(...)` works. Matters for
any surface wrapper that translates or clips drawing calls (banded rendering does exactly this).

## nano-gui's `DObject` moves widgets that touch the screen edge, 2026-10-07

Also from the nano-gui spike (Q1). `DObject.__init__` clamps with `row + height >= device.height` (same for
columns), so a widget whose rect ends exactly on the bottom or right edge is silently moved 1px, with only a
`print` warning. Its borders are drawn 2px outside the rect, and text isn't clipped to the widget. Relevant if
any nano-gui widget code is used with rects from our layout compiler.

## The stm32 port mounts its filesystem at `/flash`, not `/`, 2026-10-14

Found connecting a pyboard v1.0 (`stm32-pyboard-support.md`): every runtime write failed with
`OSError [Errno 19] ENODEV` because the paths were absolute under `/` (`/_flow.mpy`, `/lib`,
`/_board.json`, ...). The stm32 port mounts the flash filesystem at `/flash` (or `/sd` when booted from a
card), and `/` holds only the mount points, so opening `/x` is ENODEV. ESP32 and RP2 mount at `/`, which is
why it never showed before. `os.getcwd()` is the mount root on every port (the installer already relied on it,
copying files by relative name). Fix (`board_fs.py`): take the root once and build every persisted path from
it. A relative path (`_runtime_build.txt`) already worked, since cwd is the root.

## The unix port's `time.time()` is a float, 2026-10-14

Running the `ntp` node's generated helpers on the MicroPython unix port gave `unix` as a float
(`1792069509.24`): the unix port's `time.time()` returns a float, while ESP32 and RP2 return an int. CPython tests
with `time_mock` (which returns whatever the test sets) can't see this. Fix in `ntp.ts`: `int(time.time())`. Any
generated code that sends `time.time()` on a port typed `int` should do the same.

## This build's `set()` rejects a single iterable argument, 2026-10-17

Writing `device_settings.prune()` with `keep = set(keep)` failed under the unix port with
`TypeError: set() takes 2 positional arguments but 1 were given`. This minimal build's `set` does not accept the
CPython `set(iterable)` form. Build a membership dict instead (`for name in keep: wanted[name] = True`), and avoid
`set([...])` comparisons in tests -- use `sorted(list)` or a dict. Caught by `test_device_settings.py`'s prune
case, not by inspection.

- **mpy-cross embeds the source *path* in the `.mpy`, so the same library compiles to different bytes from a
  different directory.** 2026-10-17, while building the device CLI: `hil_common.compile_flow()` wrote each
  dependency to a random temporary directory and compiled it by absolute path, so `dependency_hash()` -- a hash of
  the `.mpy` bytes -- changed on every deploy. Every deploy then looked like a new library to the board despite
  identical source. Compiling with a relative file name and `cwd=tmpdir` makes the bytes stable
  (`device-runtime/test`'s own suite and the editor's WASM path already use stable names). If a dependency hash
  changes without a source change, suspect the path in the `.mpy`, not a real change.

## Sequential deploys on an ESP32-C3 can starve the next one, 2026-10-19

After five `device_cli.py flow deploy` runs, HELLO on an ESP32-C3 showed `freeIdfHeapBytes: 8668` and
`largestIdfHeapBlockBytes: 5632`; the next deploy then timed out after 20s waiting for `DEPLOY_ACK`. A DTR/RTS hard
reset restored roughly 37 KB of free IDF heap and the same flow deployed and ran a 600s soak. The same five flows
also failed at 20s per flow and passed at 40s. Before a hardware pass on a C3: reset the board, and give each flow
at least 40s. This is the heap-fragmentation effect recorded above, measured on the deploy path itself.

## Never reconnect a client that `mqtt_as` is already reconnecting, 2026-10-19

First cut of `ts_mqtt`'s `ensure_connected()` called `client.connect()` whenever `isconnected()` was false, so a
subscribe node's one-second wait loop raced mqtt_as's own `_keep_connected()` reconnect. On an ESP32-C3 that produced
`E (...) wifi:sta is connecting, cannot set config` followed by a connected/disconnected cycle every ~18s for the
whole 600s soak -- the exact flapping the network pass exists to catch, introduced by the new code rather than the
WiFi stack. The old generated code only ever connected once, which is why it never showed this. Rule: after the first
successful connect, leave reconnection to mqtt_as; `ensure_connected()` only observes `isconnected()`, reports the
state, and resubscribes the registry when the link returns. `ts-mqtt.test.ts` pins "a link blip does not call
connect() again".

## A large HTTP response is one allocation, 2026-10-19

`http_request` reads the body with `readexactly(content_length)` (or accumulates 512-byte reads when there is no
`Content-Length`), so a page larger than the largest free block fails with `MemoryError` even when `freeRamBytes`
is larger than the page. A 56,722-byte response failed on a C3 reporting 41,120 free RAM; a 48-byte page worked.
`run()` catches `OSError` only, so the error surfaces as a bare `MemoryError` with no http attribution. Backlog:
`docs/working-notes/outstanding-items/http-response-size-limit.md`.

## A flow-only deploy is not a deploy: libraries are half of it, 2026-10-23

The CYD showed no GUI cards after the card support landed (`a4f1e2f`) and the card flow was deployed, and the
symptom read as a drawing bug. It was not: the image on the board was built at `19c3dbf`, one commit before
`a4f1e2f`, and `a4f1e2f` is the commit that added `page_cards()`/`_fill_round()` to `thingstudio_gui`. The editor
emitted `"cards": [...]` into the page table correctly; the library on the board had no code that read the key, and
nothing reported an error -- the flow deployed clean and the panel simply drew the old thing.

**A frozen image is the fallback source, not the last word** -- worth stating because the first write-up of this got
it backwards. `deps.ensure_on_path()` puts `/lib` at `sys.path[0]` (runtime 11.1.0), ahead of `.frozen`, and the
editor's Deploy sends any library whose hash differs from the one HELLO reports (`librariesToSend()`). So an ordinary
**Deploy from the editor replaces a frozen library and would have shown the cards with no reflash at all**.

What actually happened is narrower: the flow was pushed by `deploy_flow.py`, a scratch script that sends only
`FLOW_PUT`/`FLOW_COMMIT`. That is the flow half of a deploy, not the library half, so the board kept running the
library frozen at the image's build SHA. Any script that pushes a flow and not its libraries has this behaviour;
`test-flows/deploy_runtime.py` and the editor's Deploy both push libraries.

Two things follow:

- Before debugging a device behaviour that the source plainly implements, compare what is *on the board* against
  HEAD. The frozen module is at the image's stamped SHA:

  ```
  git show <image-sha>:device-runtime/src/vendor/thingstudio_gui/gui.py
  ```

  The image filename carries the SHA (`thingstudio-classic-esp32-<version>-<sha>.bin`). HELLO's `runtimeBuild` is
  diagnostic only and reads `null` when it can't confirm.

- Reflashing is the expensive way to fix this: it erases flows, WiFi credentials and board settings, so it costs a
  full redeploy plus re-entering credentials. Measured on this box -- an incremental rebuild off an existing tree
  took a couple of minutes, and flashing 1.7 MB took about 97 s at the install script's baud rate. A Deploy that
  pushes the library costs seconds.


**The headless device CLI installs every library, so it cannot show a frozen image's skip** (2026-10-24).
`test/hil/hil_common.py`'s `install_dependencies()` compiles every library the flow imports and `DEP_PUT`s it,
unconditionally -- it never consults HELLO's `dependencies`. Only the editor's `librariesToSend()` compares hashes.
On a custom image a `device_cli.py flow deploy` therefore copies libraries into `/lib`, where
`deps.ensure_on_path()` puts them ahead of the frozen ones: correct, but it loses the heap saving the image exists
for, and the board's reported hashes now describe the pushed copies rather than the image. Two ways to check the
skip without a browser: deploy from the editor, or verify the index offline --
`node firmware/classic-esp32/gen_deps_index.mjs firmware/classic-esp32/out/stage /tmp/deps.json` must reproduce
`out/_deps.json` (34/34 identical on the 13.0.0 image). If a CLI deploy has already run, reflash to get the frozen
state back (a reflash is the only reset; deleting `/lib` copies by hand is not the same thing).
