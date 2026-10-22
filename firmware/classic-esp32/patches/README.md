# Patches against the pinned MicroPython

`build.sh` applies every `*.patch` here to the `MICROPY_DIR` checkout, skipping ones already applied
and failing loudly if one no longer applies. Keep them minimal, with a comment in the source saying
why — a patch is the one place this image is not plain upstream MicroPython.

## 0001-esp32-stdin-ringbuf-8192.patch

Raises the esp32 port's REPL input ring buffer from a hardcoded 260 bytes to 8192
(`MICROPY_HW_STDIN_BUFFER_LEN`, the macro rp2 already has).

**Why (CYD, 2026-10-22):** at 115200 baud, 260 bytes is 22 ms of tolerance. The buffer is drained by
whatever polls stdin, and a GUI flow drawing a frame over SPI blocks the VM for ~30 ms — longer than
that — so `ringbuf_put()` silently drops the bytes in flight and a long incoming line arrives corrupt.
Deploys send 5 KB pieces (~6.9 KB of base64, 590 ms of streaming), which is when it showed: the board
logged `MessageDecodeError ... unsupported CBOR additional-info value 29`, never answered the piece,
and the editor timed out. 8192 bytes covers a whole piece for ~690 ms of stall. Cost: 8 KB of static
RAM out of ~149 KB free at boot.

The same overflow explains the "resend a dropped library piece" retry (2026-10-22 earlier): at 1 KB
pieces a lost tail was less likely, not impossible.
