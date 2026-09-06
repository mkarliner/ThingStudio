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
