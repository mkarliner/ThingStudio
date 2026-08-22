# RP2040 (Pico) bring-up: findings — 2026-08-18

> **Status: fully resolved as of 2026-08-19 — see
> `docs/working-notes/outstanding-items.md`.** This is itself a results
> doc (RP2040 leg complete, all checks passed). The one thing it leaves
> open — whether this data is enough to close §3's RP2040-vs-RP2350
> provisional language outright, and the still-unrun RP2350 leg
> (`rp2350-bringup-briefing.md`) — is carried forward in
> `outstanding-items.md`. Kept for historical reference, not active
> reading.

Companion to `docs/working-notes/rp2-bringup-interrupt-briefing.md` (this
session's briefing) and `test-flows/rp2-pin-notes.md` (pre-flight pin
research done before hardware was in hand). This is the actual hands-on
result for the RP2040 leg — the one the briefing flagged as the session's
real point, since it's the board §3's provisional-inclusion language is
about. RP2350 (Pico 2) wasn't attempted this session — deferred to a
follow-up, see `rp2350-bringup-briefing.md`.

## Board and setup

Plain Raspberry Pi Pico (RP2040, non-W). Stock MicroPython UF2 flashed via
BOOTSEL drag-and-drop, REPL confirmed over USB (Thonny). Runtime deployed
via `mpremote`: `device-runtime/src/{errors,cbor,framing,messages,protocol,
runtime}.py` copied as-is, `listener.py` copied as `:main.py`,
`threadsafe_event.py` copied from
`device-runtime/src/vendor/threadsafe_event/`. Flow deployed:
`test-flows/interrupt-basic.pico-onboard-led.flow.json` (button/interrupt
on GP16, onboard LED mirror on GP25), later re-run as
`interrupt-basic.pico-onboard-led.memcheck.flow.json` (same flow, plus a
third `function`-node branch off the interrupt node printing
`gc.collect()` + `gc.mem_free()` on every message, for the headroom
question below).

**One real process gotcha, worth recording so it doesn't eat time again:**
`listener.py`'s `main()` has a deliberate few-second boot-delay window
where a keyboard interrupt drops to REPL instead of starting the listener
(§5's documented physical-access-independent fallback). Thonny's Shell
sends exactly that interrupt when you open/reconnect to a running board —
so watching boot through Thonny reliably looks like "it keeps going back
to REPL, never reaches HELLO" even when `main.py` is correct and would
have booted fine. Diagnosis: use a passive connection (`mpremote connect
<port>` with no `repl`/interrupt step, or any serial monitor that doesn't
auto-send Ctrl-C on open) to actually observe `LISTENER_BOOTING` →
`LISTENER_READY` → HELLO. Not rp2-specific — this'll bite the same way on
any board if Thonny's used to watch first boot.

## Interrupt node — functional results

- **Press/release**: LED mirrors the button cleanly, one `DEBUG` line per
  transition. Confirmed.
- **Debounce under real bounce**: could not induce a stutter or
  double-fire with fast repeated presses within the 50ms cooldown window.
  Confirmed.
- **Redeploy over a running flow**: deployed the flow a second time
  without power-cycling — no crash, no leaked IRQ handler, LED continued
  responding correctly afterward. **This closes the one gap that was still
  open from the ESP32-C3 session** (never specifically exercised there
  either).
- `machine.Pin.irq()`'s `IRQ_RISING`/`IRQ_FALLING` trigger constants and
  `asyncio.ThreadSafeFlag` both work exactly as documented on the rp2
  port — no port-specific surprise found, matching the pre-flight desk
  research in `rp2-pin-notes.md`. Neither of the two stop conditions
  (`ThreadSafeFlag` missing/broken, RP2040 unable to run the runtime
  stably) was triggered.

## Memory headroom — the actual §3 question

`DEPLOY_ACK` baseline immediately after deploy, before any message
processed: **`freeRamBytes: 209792`** out of RP2040's 264KB (270,336
bytes) total — **~77.6% free** with the runtime, `threadsafe_event`, and
this flow all loaded.

First message processed: 208,816 free — a one-time ~976-byte drop, almost
certainly asyncio task/coroutine-frame allocation happening on first real
execution rather than at pure import/setup time (a normal one-time
warm-up cost, not a leak).

Across repeated press/release cycles — both a fast deliberate burst and
occasional presses spread over several minutes — the reading stayed flat
in a ~144-byte band (208,752–208,896 bytes), each figure taken after an
explicit `gc.collect()`. No downward trend across either the rapid burst
or the longer occasional-press window. That's the relevant signal for a
leak: a leaking hot path would show a steady decline under repeated
messages, not noise around a fixed point.

**Caveats on what this does and doesn't show:**

- `gc.collect()` is forced before every reading for accuracy; that's
  diagnostic-only overhead from the memcheck flow itself, not
  representative of the interrupt path's normal latency in a real deploy.
- Only one interrupt node was under test, fanning out to three sinks
  (`gpio_out`, `debug`, the memcheck `function` node). A flow with more
  nodes, larger `msg` payloads, or (once built) network sockets would
  consume proportionally more of the ~264KB — this result doesn't
  extrapolate to "any flow fits," only to "this flow, and flows of
  similar size, have comfortable room."

## Feeding back into §3

§3's provisional call is: *"if RP2040's headroom proves too tight once
real flows and the MicroPython + `uasyncio` footprint are running on it,
the fallback is to raise the Pico-family floor to RP2350."* This session's
data doesn't trigger that fallback — headroom was comfortable (>75% free)
and stable under repeated real interrupt traffic for this flow.

This is real v1 bring-up data the provisional language was explicitly
waiting for, not a paper judgment call anymore — but it's one small flow
on one board, not a stress test. Worth stating plainly rather than
over-claiming: this data supports keeping RP2040 in scope as currently
written, but doesn't by itself prove the floor is safe for every flow
shape v1 will ship. Whether that's enough to close the provisional
language outright, or whether it's worth waiting for the RP2350 comparison
first (`rp2350-bringup-briefing.md`) or a heavier test flow before
resolving §3 for good, is Mike's call — not decided here, per the
briefing's own "not this chat's job to decide §3 outright" scope note.
