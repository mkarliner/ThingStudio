# backend/test/hardware/

Manual, human-in-the-loop real-hardware tests for the backend's serial layer.
Unlike `backend/test/`'s pytest suite (all of which runs against a fake serial
connection), these need a real board plugged in and a human watching it —
they are deliberately not named `test_*.py` so pytest doesn't try to collect
them, and they don't run from the agent sandbox (no real serial hardware is
reachable from there).

Run from a real Terminal, from the repo root, against the repo-root `.venv` that `make` builds
(there is no `backend/.venv`):

```
.venv/bin/python backend/test/hardware/dtr_rts_disconnect_pass.py
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

## s3_cdc_tx_pass.py

Do large board->host writes over an ESP32-S3's native USB (TinyUSB CDC) arrive intact? Written
2026-11-07 for the Freenove FNK0104S (stock `ESP32_GENERIC_S3`), where large messages from the board
arrived mangled. MicroPython's `mp_usbd_cdc_tx_strn` can lose the *start* of a write (TinyUSB thinks DTR
is off, so the 256-byte TX FIFO overwrites; upstream micropython#18029) or its *end/middle* (host stalls
500 ms, write times out).

For each board state (as found, port reopened, after soft reset, DTR held low, after hard reset) it
writes known-pattern lines of 200 B–4 KB plus an 8 x 1 KB burst, both as one `sys.stdout.write()` (what
`listener.py` does) and as 64-byte `sys.stdout.buffer.write()` pieces (the candidate fix), and reports
intact / lost start / lost middle / lost end / garbled for each. Disconnect the editor from the board
first, then:

```
# from the repo root (the venv is the repo-root .venv that `make` builds)
.venv/bin/python backend/test/hardware/s3_cdc_tx_pass.py [port]
```

About a minute. Leaves the board soft-reset (listener running). Paste the `FULL RESULTS` block back.

## live_line_check.py

Follow-up to `s3_cdc_tx_pass.py`, which found the S3's USB link clean at a bare prompt (2026-11-07: 40/40
intact, 8 KB bursts included; only DTR held low mangled whole writes). Sits on the port in place of the
editor while the listener and a flow run, and checks every `F64:` line the board sends: base64 clean,
frame length matching its header, known type, nothing else on the line. A bad line is kept raw, and the
kind of damage says which mechanism it is (other text written into it, bytes dropped, start lost).
Listens passively (use the board normally), then sends `RESTART` soft and hard (frames from the protocol
vectors) to capture boot `HELLO`s. Disconnect the editor first, then from the repo root:

```
.venv/bin/python backend/test/hardware/live_line_check.py [port] [--passive SECONDS]
```
