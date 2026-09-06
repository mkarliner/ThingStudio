# RP2350 (Pico 2 / Pico 2 W) bring-up — not started

`rp2350-bringup-briefing.md` — written as the follow-up to the RP2040 bring-up session; never executed (no matching
commit in `git log`). RP2040 (plain Pico) is confirmed working, stable, with comfortable RAM headroom
(`rp2040-bringup-findings.md`) — RP2350 (Pico 2 / Pico 2 W) has not been touched on real hardware at all. Design
doc §3's RP2040-vs-RP2350 floor question is explicitly waiting on Mike's own sign-off once this data exists, not
decided anywhere yet (see the "RP2040-vs-RP2350 RAM floor" item under Hardware / rig).

**Started 2026-09-06 (plain Pico 2, non-W): MicroPython flash + runtime deploy + boot-to-HELLO confirmed
working.** `deploy_runtime.py` pushed cleanly, board reached `LISTENER_READY`/`HELLO` -- the same starting
confirmation the RP2040 leg needed before its own interrupt-flow pass could mean anything. **Deferred by Mike until
he has time to wire the button** (`rp2-pin-notes.md`'s GP16 pull-down): the functional interrupt-flow pass
(press/release, debounce, redeploy-over-running) and the memcheck-flow RAM comparison against RP2040's
~209KB-free baseline are both still outstanding. Resume with `rp2350-bringup-briefing.md`'s steps 4 onward
(wiring) once time allows -- steps 1-3 (flash, runtime deploy, boot confirmation) don't need repeating.
