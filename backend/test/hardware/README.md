# backend/test/hardware/

Manual, human-in-the-loop real-hardware tests for the backend's serial layer.
Unlike `backend/test/`'s pytest suite (all of which runs against a fake serial
connection), these need a real board plugged in and a human watching it —
they are deliberately not named `test_*.py` so pytest doesn't try to collect
them, and they don't run from the agent sandbox (no real serial hardware is
reachable from there).

Run from a real Terminal, against the backend's own real venv:

```
cd backend
source .venv/bin/activate
python3 test/hardware/dtr_rts_disconnect_pass.py
```

## dtr_rts_disconnect_pass.py

Closes the gap named in `backend-platform-decision.md` §5 and
`outstanding-items/backend-auth-overview.md` ("what's still open" — a
real-hardware pass for DTR/RTS behavior and actual disconnect timing).
Exercises `thingstudio_backend.serial_relay.SerialConnection` directly (the
real shipped code, not a reimplementation).

Two parts, run back to back against one board:

1. **DTR/RTS sweep** — opens the port with five DTR/RTS combinations in turn
   (leave-alone/today's-default, both-low, both-high, and the two mixed
   combos), sniffing raw bytes right after each open and asking you to watch
   the board and say whether it visibly reset. A reset usually shows up as
   either a plaintext ESP32 ROM-bootloader banner in the sniffed bytes, or
   (RP2040/RP2350) the port itself erroring out as the board re-enumerates.
2. **Disconnect timing** — opens the port with whichever combo didn't reset
   the board, then asks you to physically unplug it whenever you're ready.
   Measures and prints how long the backend takes to notice and what error
   message it produces.

Prints a `FULL RESULTS` block at the end — paste that back to Claude so it
can update `outstanding-items/backend-auth-overview.md` and
`docs/working-notes/decisions.md` with a real per-board answer instead of the
current "not decided here."

Run it once per board type you have (ESP32, RP2040/Pico W, RP2350, ...) —
the answer is expected to be board-specific.
