# RP2040/RP2350 (Pico family) bring-up: pin notes and pre-flight research

Companion to `test-flows/README.md` (which documents the ESP32-C3 case) and
`docs/working-notes/rp2-bringup-interrupt-briefing.md` (the session this doc
was produced for). Same convention as `test/hil/pin-map.md`: config/findings,
not code — the actual hands-on flashing/wiring/testing is Mike's, this is
prep.

## What's confirmed vs. still needs a real board

Everything below is desk research (official MicroPython docs + GitHub issues,
cited inline) done *before* any Pico hardware was in hand this round. It
resolves the "likely fine, but not checked" items the briefing flagged as
needing confirmation against rp2-port sources rather than inferred from
ESP32 behavior. It does **not** replace the actual hands-on pass — treat the
findings below as "no known blocker found," not "confirmed working," until
a real board runs the flow.

### 1. `asyncio.ThreadSafeFlag` on rp2 — no port restriction found

The MicroPython `asyncio` docs describe `ThreadSafeFlag` as core `asyncio`
API with no port carve-out ([v1.24 docs](https://docs.micropython.org/en/v1.24.0/library/asyncio.html)).
It's implemented once in `extmod/asyncio` (shared C/Python code across
ports), not reimplemented per-port, and rp2 ships `asyncio` as a standard
part of the firmware (it's what the port's own WiFi/networking stack is
built on for Pico W/Pico 2 W). No open GitHub issue found describing
`ThreadSafeFlag` as broken or unsupported on rp2 specifically. Treat as
low-risk, not zero-risk — first real confirmation is still the hands-on
pass.

### 2. `machine.Pin.irq()` trigger constants — confirmed present, and a real correction to the "hard IRQ" framing

`Pin.IRQ_RISING` / `Pin.IRQ_FALLING` are documented as generic `Pin` class
constants with no port-specific variance
([machine.Pin docs](https://docs.micropython.org/en/latest/library/machine.Pin.html?highlight=irq)) —
`interrupt.ts`'s by-name codegen is fine as-is.

**Worth flagging, not silently correcting:** the vendored `ThreadSafeEvent`
README frames the safety case around *hard*-IRQ context ("matching this
file's own demonstrated hard-ISR usage example"). That's not quite what's
actually happening. `Pin.irq()`'s `hard` parameter **defaults to `False`**
project-wide, and `interrupt.ts`'s codegen never passes `hard=` at all — so
on both ESP32 and rp2, the interrupt handler runs as a **scheduled (soft)
callback** (via `mp_sched_schedule`), not a true hard-IRQ. This is worth
double-confirming on ESP32 too: the ESP32 port has never supported the
`hard` kwarg at all ([issue #4214](https://github.com/micropython/micropython/issues/4214),
[issue #14330](https://github.com/micropython/micropython/issues/14330),
closed "not planned") — so the ESP32-C3 hands-on pass that already succeeded
was *also* running in scheduled context, not hard-IRQ, despite the README's
framing.

This isn't a bug — it's a more favorable safety story than assumed, not a
worse one. MicroPython's own ISR-writing guide confirms scheduled callbacks
*can* allocate (the heap isn't locked when they run), and explicitly
recommends exactly this project's pattern — call `ThreadSafeFlag.set()` from
the callback to hand off to a waiting coroutine — as the documented-correct
approach regardless of hard/soft
([Writing interrupt handlers](https://docs.micropython.org/en/latest/reference/isr_rules.html)).
So: no code change needed, but the vendored README's "demonstrated hard-ISR
usage" line overstates what was actually exercised, on both chip families —
worth a doc correction next time that file is touched, not a functional
concern. (rp2 does support `hard=True` and has at least one open crash
report for it — [issue #6957](https://github.com/micropython/micropython/issues/6957)
— but since this node never sets `hard=True`, that's not this project's
exposure.)

### 3. Onboard LED handling — genuinely different per board, and `gpio_out` can't drive one variant of it

`gpio_out`'s codegen (`editor/src/node-library/gpio-out.ts`) only accepts a
numeric `pin` 0–39 and emits `machine.Pin(<number>, machine.Pin.OUT)`
literally — it has no path for a string pin handle.

- **Plain Pico (RP2040) and plain Pico 2 (RP2350):** onboard LED is a normal
  GPIO, always GP25, confirmed identical across both chip generations
  (pinout is unchanged between Pico and Pico 2 per Raspberry Pi's own
  docs). `gpio_out` with `pin: 25` works as-is, same pattern as the
  ESP32-C3 flow reusing that board's onboard LED.
- **Pico W and Pico 2 W:** the onboard LED is **not** a plain GPIO at all —
  it's wired through the CYW43439 wireless chip and only reachable via
  `machine.Pin("LED", ...)` (a string handle), confirmed via
  [Raspberry Pi's own NuttX board docs](https://nuttx.apache.org/docs/12.5.0/platforms/arm/rp2040/boards/raspberrypi-pico-w/index.html).
  **`gpio_out` architecturally cannot drive it** (`Number("LED")` is `NaN`,
  which the node's own range check rejects). This isn't a bug in this
  session's scope to fix (no new node work per the briefing) — the
  workaround is an external LED on a real GPIO pin for W-family boards,
  not the onboard one. Flagging this explicitly rather than letting it be
  a confusing on-hardware surprise.

### 4. GPIO23/24/25/29 — hard-reserved on W boards, only soft-reserved on non-W boards

Also confirmed via the same NuttX doc and a corroborating
[pico-sdk issue](https://github.com/raspberrypi/pico-sdk/issues/1222):
on **Pico W / Pico 2 W**, GP23/24/25/29 are wired directly into the
wireless chip's quasi-SPI interface (enable, data, chip-select, clock) and
are **not usable as general GPIO at all** — this is a hard reservation, not
a convention. On **plain Pico / Pico 2**, the same four numbers are only
*soft*-reserved (GP25 = LED, GP23 = SMPS mode select, GP24 = VBUS sense,
GP29 = ADC3/VSYS monitor) — each has a real effect if repurposed but isn't
electrically blocked the way the W-board wireless pins are. Pinout is
otherwise identical between the RP2040 and RP2350 variants of each
form factor, so pin choices below are keyed to **W vs. non-W**, not to
chip generation.

## Pin choices

| Board family | Button/interrupt pin | LED pin | Flow file |
|---|---|---|---|
| Pico, Pico 2 (non-W) | GP16 | GP25 (onboard LED, via `gpio_out`) | `interrupt-basic.pico-onboard-led.flow.json` |
| Pico W, Pico 2 W | GP16 | GP17 (external LED — onboard LED not reachable by `gpio_out`, see above) | `interrupt-basic.pico-w-external-led.flow.json` |

GP16 chosen as a plain, unreserved GPIO clear of GP23/24/25/29 on every
variant, clear of the default USB-CDC REPL (rp2's REPL is over USB, not a
UART pin, so GP0/1 are technically free too, but avoided here on the same
"don't reuse an obvious default" spirit `pin-map.md` used for ESP32-C3's
UART0 pins). GP17 (external LED) chosen adjacent to GP16 for wiring
convenience, same reasoning.

**Verify against your actual boards before wiring** — same caveat
`pin-map.md` gives for the ESP32-C3 table: this is corroborated from
official docs and cross-checked against a second source per claim, but if
a board turns out to be a different revision or a third-party variant,
check its own silkscreen/pinout first.

## Prerequisites (same two as the ESP32-C3 flow, unchanged)

1. `threadsafe_event.py` must already be on the device's filesystem before
   deploying — nothing in the compile/deploy pipeline pushes `vendor/`
   files yet (`device-runtime/src/vendor/threadsafe_event/README.md`'s own
   "Deploy note"):
   ```sh
   mpremote connect <dut-port> cp device-runtime/src/vendor/threadsafe_event/threadsafe_event.py :threadsafe_event.py
   ```
2. The button needs a real pull (GPIO16 floating will read noise, not a
   clean signal) — wire a pull-down with the button to 3.3V (idle LOW,
   press HIGH), or use `machine.Pin(16, machine.Pin.IN, machine.Pin.PULL_DOWN)`-equivalent
   external wiring, matching the ESP32-C3 flow's own note. `interrupt.ts`'s
   codegen still has no internal pull configured (`machine.Pin(pin, machine.Pin.IN)`,
   no pull arg) — same scope as the ESP32-C3 case, not new to rp2.
   For the W-board flow's external LED (GP17): LED + current-limiting
   resistor to GND, same as any bare-GPIO LED wiring.

## Bring-up sequence (per board)

1. Flash the official MicroPython UF2 for the specific board
   (micropython.org/download — Pico, Pico W, Pico 2, or Pico 2 W each have
   their own UF2, don't cross-flash) via BOOTSEL drag-and-drop. Confirm a
   REPL comes up over USB serial before anything else.
2. Copy `threadsafe_event.py` onto the device (step 1 above).
3. Open the editor, "Open Flow", pick the flow file matching the board
   (table above). Deploy as normal (same browser path `test-flows/README.md`
   describes) — or use `test-flows/deploy_flow.py` for a scriptable path,
   unchanged from the ESP32-C3 case.
4. Manual test, same three checks as the ESP32-C3 pass, plus the one gap
   still open from that session:
   - Press/release toggles the LED, with a debug line per transition.
   - Rapid presses don't flicker/double-fire within the 50ms debounce
     window.
   - **New this round:** deploy once, let it run, then deploy the *same*
     flow again without power-cycling the board — confirm the LED still
     responds correctly afterward (no leaked IRQ handler, no crash, no
     double-firing from a stale handler). This was the one item the
     ESP32-C3 pass didn't specifically exercise either.
5. Watch for `RuntimeError: name too long` on first deploy — last time
   (ESP32-C3) this was a stale-HELLO/skipped-version-check artifact, not a
   real bug, resolved by a board reset forcing a fresh `HELLO`. A fresh
   board family is exactly where the same symptom could resurface for a
   genuinely different reason (a real `mpy-cross`/firmware mismatch this
   time) — don't assume the prior diagnosis auto-explains a recurrence;
   re-check that the `HELLO`/version-check path actually ran before
   concluding it's the same non-bug.

## Stop conditions (unchanged from the briefing)

- `ThreadSafeFlag` missing or behaving differently in a way that breaks the
  IRQ→coroutine handoff on rp2.
- RP2040 can't get MicroPython + the runtime files running stably before
  even reaching the flow test (OOM or similar) — itself the §3 finding
  worth writing up, not a reason to push forward to a doomed flow test.

## RP2040 vs RP2350 — what to actually watch for

Per the briefing: RP2350 (520KB SRAM) comfortably clears the ESP32-C3
baseline and is expected to be the easy case. RP2040 (264KB SRAM) is below
it and is what §3's provisional-inclusion language is actually about — if
time is short, prioritize getting real data on RP2040. Memory headroom is
the thing to watch on RP2040 specifically (free-heap check after the
runtime + `threadsafe_event` + the flow's own footprint are all loaded, not
just "did it boot"), since that's the concrete, measurable version of the
§3 question rather than a vague impression.
