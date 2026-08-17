# Briefing: RP2040/RP2350 bring-up, via the interrupt node

For the next chat. Read `CLAUDE.md` in full, as always.

**Check `git log` before assuming anything is committed.** The interrupt
node itself (Tier 1 item 5, event-driven source codegen, `gpio_in`
removal, full canvas wiring) was handed to Mike as an uncommitted diff
across two rounds this session — confirm both landed before starting here.

## Context

`docs/working-notes/tier1-interrupt-node-implementation-briefing.md` is
the prior session's briefing — read it for the interrupt node's design
(event-source codegen pattern, `ThreadSafeEvent` vendoring, cooldown
debounce). That session's hands-on hardware pass (button press/release,
debounce, browser-load-and-deploy) is done and confirmed, on an ESP32-C3
LuatOS board — see `test-flows/README.md`'s "What this experiment is
actually checking" section, now marked confirmed. `test-flows/
interrupt-basic.flow.json` is the flow used; it currently targets pin 1
(GPIO1), chosen to avoid `test/hil/pin-map.md`'s already-wired
GPIO4/witness-GPIO5 pair — that constraint is ESP32-C3-board-specific and
does not carry over to a different board.

## What kind of session this is

**Not new node/feature work — a hardware bring-up exercise**, deliberately
using the now-working interrupt flow as the test payload rather than
building anything new. Every board this project has actually run on
so far has been an ESP32-C3 LuatOS CORE board. RP2040 (Pico/Pico W) and
RP2350 (Pico 2) are both in the design doc's target-hardware table (§3)
and have never had a real device in hand running any Thingstudio flow —
they're "in scope on paper," not "confirmed working." This session
changes that, or finds out why not.

This matters beyond just "more boards work now." §3 already flags RP2040
specifically as a **provisional** inclusion: "below the C3 RAM baseline
(264KB vs. 400KB) but kept in scope for price/ecosystem reasons... This is
a provisional call: if RP2040's headroom proves too tight once real flows
and the MicroPython + `uasyncio` footprint are running on it, the fallback
is to raise the Pico-family floor to RP2350." No real flow has run on
RP2040 before this session — the provisional call has been sitting
unconfirmed since the design doc's 2026-08-09 draft. This session is
where that finally gets real data instead of staying a paper judgment
call. Worth treating that as the actual point of the session, not a side
note — if RP2040 turns out too tight, that's a design-doc-level finding,
not a shrug.

## What to actually do

1. **Confirm stock MicroPython even runs on both boards first**, before
   touching Thingstudio at all. `device-runtime/` ships plain `.py`
   source files copied onto the device's filesystem over an existing
   MicroPython install (confirmed this session by reading the directory —
   no custom firmware build step anywhere in this repo, matching design
   doc §5's "MicroPython already has mature, actively-maintained ports for
   both target chip families" framing). So bring-up is: flash the
   official MicroPython UF2 for Pico / Pico W / Pico 2 from
   micropython.org (drag-and-drop BOOTSEL mode, standard for this family,
   no `esptool`-equivalent needed), confirm a REPL comes up over USB
   serial, before any Thingstudio-specific step.
2. **Check `asyncio.ThreadSafeFlag` actually exists on the rp2 port**,
   the same primitive `device-runtime/src/vendor/threadsafe_event/
   threadsafe_event.py` wraps and the whole interrupt node depends on.
   The vendoring README's hard-IRQ-safety case (read it in full) was
   built entirely against upstream's general `THREADING.md` docs, not
   verified against the rp2 port specifically — don't assume it
   transfers untested. If it's missing or behaves differently on rp2,
   that's a stop condition (see below), not a workaround-and-continue.
3. **Confirm `machine.Pin.irq()`'s trigger-flag values match** across
   ports. `interrupt.ts` codegens `machine.Pin.IRQ_RISING` /
   `machine.Pin.IRQ_FALLING` by name, not by raw integer — these are
   real MicroPython constants on both ESP32 and rp2 ports, so this is
   likely fine, but "likely fine" isn't the same as checked; confirm
   against actual rp2 port docs/source rather than inferring from the
   ESP32 behavior already observed.
4. **Re-point `test-flows/interrupt-basic.flow.json` at real pins for
   whichever board is in hand.** Pin 1 (GPIO1) was chosen for the
   ESP32-C3 board specifically to dodge that board's HIL wiring; Pico
   boards have their own numbering and their own onboard LED pin (the
   original Pico's onboard LED is a fixed `machine.Pin("LED")` /
   GP25-equivalent depending on board revision, and the Pico W's onboard
   LED is wired through the wireless chip, not a plain GPIO at all —
   confirm the actual pin/handle for whichever Pico variant is on hand
   before assuming pin 12's `gpio_out` node in the existing flow file
   still points at anything useful). Likely needs a second flow-file
   variant per board family rather than one shared file, given the LED
   pin difference alone.
5. **Deploy and run the same manual test** already done on ESP32-C3:
   button press/release toggles the LED, rapid presses don't flicker
   or double-fire within the debounce window, and — the one item the
   prior session's hands-on pass didn't specifically exercise either,
   still open there too — a redeploy over an already-running flow
   doesn't leak the IRQ handler or crash the device. Worth closing that
   gap on whichever board is easiest to iterate on first, since it's a
   real open item from the previous session, not new scope invented
   here.
6. **Watch for the qstr/version-mismatch failure mode already seen once**
   this project (`RuntimeError: name too long`, resolved last session by
   confirming it was a skipped-HELLO/stale-version-check artifact, not a
   literal overlong name). That was diagnosed on ESP32-C3; a fresh board
   family is exactly where the same class of bug could resurface for a
   genuinely different reason (a real mpy-cross/firmware feature-flag
   mismatch this time, not just a skipped handshake) — don't assume the
   prior diagnosis automatically explains a recurrence here without
   re-checking the HELLO/version-check path actually ran.

## Worth flagging explicitly, not resolving silently

- **RP2040 vs RP2350 are genuinely different asks, not one bring-up
  twice.** RP2350 clears the ESP32-C3 RAM baseline comfortably (520KB);
  RP2040 doesn't (264KB) and is the board §3's provisional-inclusion
  language is actually about. If time is short, RP2040 is the one that
  produces a real answer to an open design question; RP2350 mostly
  confirms the already-comfortable case.
- **No custom device firmware build exists in this repo for either
  port** — confirmed by directory inspection this session, not assumed.
  If that turns out wrong (some board-specific native module the plain
  `.py` runtime secretly needs), that's a bigger finding than this
  briefing anticipates and worth stopping to reconsider, not patching
  around silently.

## Stop conditions

- `asyncio.ThreadSafeFlag` doesn't exist, or behaves differently in a way
  that breaks the hard-IRQ-to-coroutine handoff, on the rp2 port — that's
  the same "whole approach rests on this" premise the original interrupt
  node briefing flagged for ESP32; treat an rp2-port failure the same way.
- RP2040 can't even get MicroPython + the existing runtime files running
  stably before touching the interrupt flow at all (out-of-memory or
  similar) — that's itself the §3 finding, worth writing up as such
  rather than pushing through to a flow test that was never going to
  succeed.

## Real costs and traps to respect

- **Git writes go to Mike as exact commands, always** — standing sandbox
  bug, unchanged.
- **This is real hardware, real UF2 flashing, real BOOTSEL-mode
  drag-and-drop** — none of it is sandbox-executable; every step here is
  Mike's hands-on work, same as the button-and-resistor pass last
  session. The chat's job is to prep the flow file(s), the diagnostic
  questions, and interpret results, not to attempt any of it itself.
- **Whatever pin numbering / LED-handle facts get confirmed for each
  board should go into `test-flows/README.md` or a new board-specific
  note**, not just live in chat — same "records, not just conversation"
  convention the rest of `docs/working-notes/` already follows.

## Not in scope for this chat

- Any new node work — this is a bring-up/verification session against
  the existing interrupt node, not a place to add features.
- Deciding the §3 RP2040-vs-RP2350 floor question outright based on one
  session's data — flag findings clearly, but that's a design-doc-level
  call worth Mike's own sign-off, not something to silently rewrite §3
  over.

## Success criteria

MicroPython confirmed running on both RP2040 and RP2350 hardware.
`asyncio.ThreadSafeFlag` and `machine.Pin.irq()` trigger flags confirmed
equivalent (or documented as different, with the difference handled) on
the rp2 port. The interrupt flow, re-pointed at real per-board pins,
deployed and manually verified on both boards: press/release works,
debounce holds, and — closing the one gap left open last session — a
redeploy over a running flow doesn't leak the handler or crash. A written
finding on whether RP2040's headroom is actually tight with a real flow
running, feeding back into §3's provisional-call language.

## Git

Same standing rule as every other session: git writes (`add`/`commit`) go
to Mike as exact commands to run himself in a real Terminal, not run from
the sandbox. Read-only git commands are fine.
