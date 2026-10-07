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
