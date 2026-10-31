# Briefing: RP2350 (Pico 2) bring-up — the second half of the rp2 pair

For the next chat. Read `CLAUDE.md` in full, as always.

**Check `git log` before assuming anything is committed.** This session's
output — two per-board flow files, the W-board external-LED variant, the
memcheck flow variant, `test-flows/rp2-pin-notes.md`, and
`docs/working-notes/rp2040-bringup-findings.md` — was handed to Mike as
finished files written directly onto disk (not a diff), same session-to-
session pattern as always. Confirm they're actually committed before
assuming any of this is available; if not, it's still there on disk, just
uncommitted.

## Context

`docs/working-notes/rp2-bringup-interrupt-briefing.md` is the session
before this one — read it in full for the original scope and reasoning.
`docs/working-notes/rp2040-bringup-findings.md` is that session's actual
result: RP2040 (plain Pico) is done — MicroPython + runtime + the
interrupt flow all confirmed stable, debounce holds, redeploy-over-running
doesn't leak, and free RAM stayed flat (~208–209KB free of 264KB, no
downward trend) across repeated presses. Read it in full before starting
here; this session doesn't re-derive any of that, it's the RP2350 half of
the same pair.

## What kind of session this is

Same kind as last time — hardware bring-up/verification, not new node
work. The difference: **RP2350 (Pico 2 / Pico 2 W) is the comfortable
case, not the interesting one.** §3 already expects RP2350 (520KB SRAM) to
clear the baseline easily; this session mostly exists to (a) get the
actual confirmation on record rather than leave it as "presumably fine,"
and (b) produce a same-methodology comparison number against RP2040's
~209KB-free result, not to answer an open question the way the RP2040 leg
did.

## What's already done, don't redo it

- **Pin research is already complete and reusable as-is.**
  `test-flows/rp2-pin-notes.md` covers RP2040 *and* RP2350 together — the
  pinout is identical across the two chip generations within the same
  form factor (confirmed via Raspberry Pi's own docs during the prior
  session's research), so the pin choices (GP16 button, GP25 onboard LED
  for non-W boards, GP17 external LED for W boards) and the GP23/24/25/29
  reservation reasoning both carry over unchanged. No new pin research
  needed — only confirm the specific board in hand matches (plain Pico 2
  vs. Pico 2 W changes which flow file to use, see below).
- **Flow files already exist and don't need editing**, just picking the
  right one:
  - Plain Pico 2 (non-W): `test-flows/interrupt-basic.pico-onboard-led.flow.json`
    (same file RP2040 used — GP25 is a plain GPIO on both non-W chip
    generations).
  - Pico 2 W: `test-flows/interrupt-basic.pico-w-external-led.flow.json`
    (external LED on GP17 — Pico 2 W's onboard LED is wireless-chip-wired
    same as Pico W's, not reachable by `gpio_out`).
  - Either way, also deploy `test-flows/interrupt-basic.pico-onboard-led.memcheck.flow.json`
    (or hand-adapt the W-board flow the same way — add the same
    `function`-node branch printing `gc.collect()` + `gc.mem_free()` off
    the interrupt node) for the free-RAM comparison number. That memcheck
    approach is proven now, not new to design.
- **The Thonny boot-watching gotcha is documented** in
  `rp2040-bringup-findings.md` — `listener.py`'s boot-delay window treats
  Thonny's connect-time interrupt as a request to drop to REPL, which
  looks exactly like "never reaches HELLO" if you're not expecting it.
  Watch boot with a passive `mpremote connect <port>` (no interrupt) or
  serial monitor instead, from the start this time.

## What to actually do

1. Flash the **Pico 2** (or **Pico 2 W**) -specific UF2 from
   micropython.org — not the RP2040 one, they're different builds. Confirm
   REPL over USB before anything else.
2. Deploy the runtime the same way as RP2040: `mpremote cp` the seven
   `device-runtime/src/*.py` files (six as-is, `listener.py` as
   `:main.py`) plus `threadsafe_event.py`. Verify with `ls` before
   power-cycling.
3. Power-cycle, watch boot passively, confirm `LISTENER_BOOTING` →
   `LISTENER_READY` → HELLO.
4. Wire the button (GP16, pull-down to GND, button to 3.3V — press reads
   HIGH) and, if it's a W-family board, the external LED (GP17 + resistor
   to GND).
5. Deploy the matching flow file (see above), run the same manual pass as
   RP2040: press/release toggles the LED with a debug line per
   transition; fast repeated presses don't double-fire within the 50ms
   debounce window; redeploy the same flow without power-cycling and
   confirm no leak/crash.
6. Deploy the memcheck variant, note the `DEPLOY_ACK` baseline
   `freeRamBytes`, then press a handful of times (burst) and a few more
   spread over a couple of minutes (occasional), watching for drift the
   same way the RP2040 leg did. Expect a much larger absolute number
   (520KB total vs. RP2040's 264KB) — the point isn't whether it's
   comfortable, it almost certainly will be, it's having the same-shape
   data point for the write-up comparison.

## Worth flagging explicitly, not resolving silently

- **This still isn't the session to decide §3 outright**, even with both
  boards' data in hand. Two flows' worth of headroom data on one specific
  interrupt-node flow is good evidence, not proof against every flow
  shape v1 will ever ship. Write the finding, flag it clearly, leave the
  actual "is the provisional language resolved" call to Mike, same as the
  RP2040 session.
- If the board in hand is Pico 2 W and the external-LED wiring is more
  hassle than it's worth, it's fine to only run the plain Pico 2 (non-W)
  leg and note the W-board LED limitation as still-unverified-on-RP2350-
  specifically rather than forcing the wiring — the onboard-LED
  architectural gap (`gpio_out` can't drive `machine.Pin("LED")`) was
  already established on the RP2040/Pico W pairing in the pin-notes doc;
  re-confirming it's identical on Pico 2 W is low-value if time's short.

## Stop conditions

Same two as last time, restated for RP2350 specifically — genuinely
unlikely given RP2040 already passed on the same rp2 port codebase, but
stated for parity rather than silently assumed:

- `ThreadSafeFlag` or `Pin.irq()` trigger behavior turns out different on
  RP2350 specifically (would be a surprising finding given RP2040 already
  confirmed both against the same underlying rp2 port — but if it
  happens, that's a real, reportable divergence, not something to paper
  over).
- RP2350 can't run the runtime + flow stably — essentially impossible
  given the RAM margin, included only for completeness.

## Real costs and traps to respect

- **Git writes go to Mike as exact commands, always** — standing sandbox
  bug, unchanged.
- **This is real hardware, real UF2 flashing, real wiring** — none of it
  sandbox-executable. The chat's job is prep, diagnostic questions, and
  interpreting results, same as last session.
- **Watch boot passively, not through Thonny** — see above, this cost
  real time last session before being diagnosed.

## Not in scope for this chat

- Any new node work.
- Deciding §3's RP2040-vs-RP2350 floor question outright, even with both
  boards now confirmed — that's still Mike's sign-off call.
- Building a heavier stress-test flow to probe RAM limits further — worth
  considering as a *future* follow-up if the §3 question stays open after
  this, but not this session's job to invent new scope for.

## Success criteria

RP2350 (Pico 2 or Pico 2 W) confirmed running stock MicroPython + the
runtime + the interrupt flow. Same functional checks as RP2040: press/
release, debounce under real bounce, redeploy-over-running-flow all
confirmed clean. A `DEPLOY_ACK`-baseline-plus-under-load free-RAM reading
taken with the same memcheck-flow methodology, and a short written
comparison against RP2040's ~209KB-free/no-drift result, feeding into the
same §3 write-up RP2040's findings doc started — not a new document
necessarily, could be an addendum to `rp2040-bringup-findings.md` or its
own file, Mike's preference either way.

## Git

Same standing rule as every other session: git writes (`add`/`commit`) go
to Mike as exact commands to run himself in a real Terminal, not run from
the sandbox. Read-only git commands are fine.
