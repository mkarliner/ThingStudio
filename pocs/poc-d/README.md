# POC-D: canvas → compile → deploy → run

Tests design doc §15.5: does the full pipeline — author a flow on the real
(Litegraph) canvas, compile it to real MicroPython, cross-compile that to
real `.mpy` bytecode client-side via POC-B's WASM toolchain, and deploy+run
it on real ESP32-C3 hardware over a WebSerial transport extending POC-A's —
actually hold together end to end. Added after POC-A/B/C landed, scoped
deliberately smaller than v1 (§10): one flow shape only
(`inject → function → gpio_out`), not the full v1 node set.

**Result: yes, confirmed on real hardware (2026-08-11, LuatOS CORE-ESP32-C3,
same board as POC-A).** A flow authored on the canvas compiles client-side to
real MicroPython, cross-compiles to real `.mpy` bytecode, deploys over
WebSerial, and correctly drives a real GPIO pin/LED, tracking the inject
node's payload value across redeploys. Getting there surfaced a real
sequence of hardware-only problems — see "What broke and how it was fixed"
below; none of them were visible from off-device testing alone, which is the
whole reason §15.4 treats a hardware run as required rather than optional.

**Files**

- `index.html`, `app.js` — the browser page: canvas + Compile/Deploy panel + device console.
- `nodes.js` — the 3 node types this compiler handles, trimmed from `poc-c/nodes.js`.
- `compiler.js` — the graph→Python compiler (deliberately hardcoded to this one flow shape, not general-purpose).
- `litegraph.min.js`, `litegraph.css` — vendored from `poc-c/` (same hash-verified copy).
- `mpy-cross.mjs`, `mpy-cross.wasm` — vendored from `poc-b/` (same hash-verified copy).
- `harness.py` — extends `poc-a/harness.py` with a base64-encoded `.mpy` deploy path, alongside the original raw-text path (kept working, unchanged).

## Test board pinout (LuatOS CORE-ESP32-C3)

Same board as POC-A. Pins 12 and 13 are wired to visible onboard LEDs —
`gpio_out`'s default pin is 12 for exactly this reason (an earlier default of
2 "worked" with zero visible feedback, which briefly looked like a logic bug
and wasn't one). Change the `gpio_out` node's "pin" field on the canvas if
testing on different hardware, or to watch pin 13 instead.

## Running

### 1. Flash the harness

```bash
pip install mpremote
mpremote connect <PORT> fs cp poc-d/harness.py :main.py
mpremote connect <PORT> reset
```

Close `mpremote` (and Thonny/`screen`/any other serial monitor) before
opening the browser page — Web Serial needs exclusive port access. If a
harness from a previous POC or an older version of this one is already
resident, reflashing is what fixes it — see "stuck harness" below if a
reflash is itself blocked.

### 2. Serve the page over http://

`file://` leaves Chrome's WebSerial port picker empty — same as POC-A/B.

```bash
cd poc-d
python3 -m http.server 8000
# open http://localhost:8000/index.html
```

### 3. Run it

1. Click **Connect**, pick the device's serial port.
2. This board doesn't reset when the port opens (no auto-reset circuit
   wired the way `esptool`-flashable boards usually are), so you're
   attaching to whatever's already running. Confirm you're seeing a fresh
   boot: watch for `HARNESS_BOOTING -- Ctrl-C within 3s...` followed ~3s
   later by `HARNESS_READY`. If you don't see that, click **"Reset device
   (best-effort)"** (toggles RTS via `port.setSignals()`, the same trick
   `esptool` uses — works on this board, but depends on USB-serial wiring
   that varies, so **won't work on all boards**) or press the board's
   physical reset button, which always works regardless of wiring.
3. Click **Load example flow** — builds `inject → function → gpio_out` with
   default properties (bool payload `true`, manual repeat, pin 12). Edit the
   inject node's "value" field (commit it, e.g. click elsewhere) and/or the
   function node's "edit code…" to change behavior — the default function
   body is a no-op passthrough.
4. Click **Compile (preview only)** any time to see the generated
   MicroPython without deploying.
5. Click **Compile → mpy-cross → Deploy**. Watch for
   `MPY_OK before=... after=... dt_ms=...` in the console (success) or
   `MPY_ERR ...`/`LISTENER_ERR ...` (something broke, and now says what).
   With the default `manual` repeat, the flow fires exactly once, at the
   moment it's deployed — there's no live re-fire without redeploying, by
   design (§15.5 explicitly scopes that out). Edit inject's value or the
   function's code and click Deploy again to see a new result.

## What broke and how it was fixed

In the order each was found, first real hardware run onward:

1. **Old harness silently dropped the new protocol.** A POC-A harness was
   still resident, didn't recognize the new binary frame, and its listener
   task died silently (uasyncio's generic "Task exception wasn't
   retrieved") with no way back to a REPL, since the runtime deliberately
   disables Ctrl-C while it owns the transport (§9) — the only recovery was
   a full `esptool` reflash. **Fixed:** `_listener` now wraps every phase in
   `try/except` so no single bad exchange can kill the task, logs an
   `*_ERR` line and keeps going instead; and a 3-second boot-time window
   where Ctrl-C still works normally (before the runtime commits to owning
   stdin) gives a reflash-free way back to a REPL if something still gets
   through. Folded into design doc §5's fault-isolation discussion as a gap
   worth carrying into the real runtime, not just this POC.
2. **This board doesn't auto-reset on connect.** Opening the WebSerial port
   doesn't reset the target MCU here (no auto-reset circuit the way
   `esptool`-flashable boards usually have) — you just attach to whatever's
   already running, which can silently be stale. **Fixed:** added a
   best-effort "Reset device" button (RTS pulse via `port.setSignals()`),
   confirmed working on this board; physical reset documented as the
   reliable fallback since the button won't work on all boards' wiring.
3. **Client/device deploy-timeout mismatch.** The browser gave up waiting
   for `MPY_OK`/`MPY_ERR` sooner than the device's own internal timeout
   could legitimately still be working, making a possibly-fine deploy look
   like a failure. **Fixed:** client wait increased to comfortably exceed
   the device's worst case.
4. **Real bug: reading a byte count from `sys.stdin` hangs this port
   outright.** `MPY_STEP` checkpoint logging localized a full event-loop
   freeze (confirmed via the independent `_mem_monitor` heartbeat also
   stopping) to `sreader.readexactly(n)`/`read(n)` — not slow, genuinely
   non-yielding, since even the device's own internal timeout on that exact
   call never fired. `readline()` had been reliable throughout, including
   the header line read immediately before every hang. **Fixed:** removed
   `read(n)` from the protocol entirely — the `.mpy` bytecode now rides as a
   single base64-encoded text line, decoded with `binascii.a2b_base64`,
   verified byte-identical round-trip off-device before ever touching
   hardware again (see "Verified without touching a board" below). Worth
   carrying forward: whatever the real §13 protocol uses for binary
   payloads needs checking against this same failure mode on whatever
   ports/boards v1 actually targets, not assumed safe from browser-side
   testing alone.
5. **Two UX footguns**, once the pipeline was actually working: `gpio_out`
   defaulting to a pin with no visible LED on this board (fixed — see
   pinout section above), and a leftover "inject now" preview button
   (harmless in POC-C, where it was purely a canvas flash) that looked like
   a live trigger in this build but touched nothing real — removed, since
   Deploy itself is the only real trigger here.

## Verified without touching a board

Before and alongside the hardware debugging above, exercised for real
rather than assumed:

- **Compiler correctness** — 4 unit-test cases (valid flow, string payload +
  manual repeat, missing wiring, out-of-range pin) all pass; generated
  source parses as valid Python (`ast.parse`).
- **Real cross-compilation** — generated MicroPython actually fed through
  `mpy-cross.wasm` (same module the page uses, run under plain Node.js) and
  produced real `.mpy` bytecode with a correct magic header — the exact
  compiler → mpy-cross handoff "Deploy" performs.
- **Base64 framing round-trips real bytecode byte-identical** — the current
  protocol (`###MPY-B64:<base64>###\n`) was verified against real generated
  `.mpy` bytes using the same JS encode logic `app.js` uses and the same
  `binascii.a2b_base64` call `harness.py` makes, before this was ever tried
  on the device.

## Recovering from a stuck harness

If a reflash itself seems blocked (device unresponsive, stuck in a loop from
an older/broken harness): Ctrl-C within 3 seconds of a reset should drop to
a normal REPL (item 1 above). If that doesn't work either — e.g. a harness
predating that fix — full recovery is the same as POC-A's appendix: `esptool
erase_flash` + reflash MicroPython + `mpremote fs cp` the harness back on.
`poc-a/README.md`'s appendix has the exact commands.

## Protocol

Extends POC-A's raw-text `###DEPLOY-BEGIN###`/`###DEPLOY-END###` framing
(untouched, still works, useful for debugging) with:

```
browser -> device : b"###MPY-B64:<base64 of .mpy bytecode>###\n"
device  -> browser: b"MPY_OK before=<int> after=<int> dt_ms=<int>\n"
                  or b"MPY_ERR <exception repr>\n"
```

See `harness.py`'s file header for the full story of why this replaced an
earlier length-prefixed raw-binary framing.

## What this does and doesn't tell us

This is a walking-skeleton spike, not v1 (§10) — success here means "the
pipeline holds together for one hardcoded flow shape on one board," not "the
compiler is general" or "the protocol is real." Explicitly out of scope, per
§15.5: the full v1 node set, the real `msg` envelope/type system beyond the
bool case, §13's actual wire protocol, persistence, fault isolation, live
value streaming back to the editor. Treat a clean run here as license to
scope the *real* §6 compiler and §13 protocol next, not as evidence they're
already built — and per item 4 above, specifically re-check whatever binary
transport mechanism gets chosen for v1 against real hardware early, since
that's exactly the kind of problem that doesn't show up until it's tried on
a real board.
