#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# backend/test/hardware/dtr_rts_disconnect_pass.py
#
# Manual, human-in-the-loop real-hardware pass for the backend's serial layer:
# DTR/RTS auto-reset behavior per board, and actual disconnect-detection
# timing. This is exactly the gap `backend-platform-decision.md` section 5
# and `outstanding-items/backend-auth-overview.md` ("what's still open")
# flag -- serial_relay.py exposes dtr/rts as explicit optional parameters but
# deliberately does not decide what the correct per-board default is, because
# that's a real hands-on check, not something to get right from
# documentation alone.
#
# Deliberately NOT named test_*.py and NOT part of the pytest suite -- this
# needs a human physically present to watch the board (LED/reset) and, for
# the disconnect-timing half, to physically unplug it. Nothing here can run
# unattended or from the agent sandbox (no real serial hardware is reachable
# from there) -- see CLAUDE.md's git/npm-from-sandbox rules for the same
# shared-mount reasoning applied to this case.
#
# Exercises thingstudio_backend.serial_relay.SerialConnection directly, the
# real production code path, not a reimplementation -- so a pass here says
# something real about the shipped module rather than a fresh guess at it.
#
# Run against the backend's own real venv, in a real Terminal (not the agent
# sandbox):
#
#     cd backend
#     source .venv/bin/activate
#     python3 test/hardware/dtr_rts_disconnect_pass.py
#
# Follow the prompts: pick the port, watch the board during the DTR/RTS
# sweep, then physically unplug it when asked for the disconnect-timing
# pass. Paste the "FULL RESULTS" block it prints at the end back to Claude.

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from thingstudio_backend.serial_relay import SerialConnection, SerialRelayError, list_ports  # noqa: E402

# Each combo: (human label, dtr, rts). None means "don't touch it" -- pyserial/
# serial_relay.py's own current default, i.e. today's shipped behavior.
DTR_RTS_COMBOS: list[tuple[str, bool | None, bool | None]] = [
    ("leave alone (dtr=None, rts=None -- today's backend default)", None, None),
    ("both held low (dtr=False, rts=False)", False, False),
    ("both held high (dtr=True, rts=True)", True, True),
    ("dtr low, rts high (dtr=False, rts=True)", False, True),
    ("dtr high, rts low (dtr=True, rts=False)", True, False),
]

SETTLE_SECONDS = 1.5  # pause between combos so the board can settle
READ_WINDOW_SECONDS = 2.0  # how long to sniff raw bytes right after open


def _prompt(msg: str) -> str:
    return input(msg).strip()


async def _sniff_raw_bytes(port: str, dtr: bool | None, rts: bool | None) -> bytes:
    """Open the port with the given DTR/RTS combo and read raw bytes for a short
    window. A reset tends to show up as a burst of bytes right after open -- on
    ESP32 that's typically a plaintext ROM-bootloader banner (recognizable ASCII
    like "rst:0x..", "ets_main.c", "boot:0x.."); on RP2040/RP2350 a reset can
    instead mean the port disappears and re-enumerates entirely, which surfaces
    here as a SerialRelayError rather than bytes.

    Bounded by asyncio.wait_for(), not by checking a deadline inside the `async
    for` body -- read_loop() deliberately only *yields* when it actually has
    bytes (an empty/timed-out poll is absorbed silently, per its own comment),
    so a deadline check that only runs after a yield never fires at all if the
    port stays quiet for the whole window. That bug is exactly what caused the
    first version of this script to hang indefinitely against a quiet port."""
    conn = SerialConnection(port, dtr=dtr, rts=rts)
    await conn.open()
    chunks: list[bytes] = []

    async def _collect() -> None:
        async for chunk in conn.read_loop():
            chunks.append(chunk)

    try:
        try:
            await asyncio.wait_for(_collect(), timeout=READ_WINDOW_SECONDS)
        except asyncio.TimeoutError:
            pass  # expected -- this is just the sniff window elapsing with nothing further to see
    finally:
        conn.request_stop()
        try:
            await conn.close()
        except SerialRelayError as exc:
            print(f"  (close after sniff raised, ignored: {exc})")
    return b"".join(chunks)


def _describe_bytes(data: bytes) -> str:
    if not data:
        return "(nothing read -- no boot banner, no re-enumeration seen)"
    printable = "".join(chr(b) if 32 <= b < 127 or b in (9, 10, 13) else "." for b in data)
    return f"{len(data)} bytes read. As text: {printable[:300]!r}"


async def run_dtr_rts_sweep(port: str, board_label: str) -> list[dict]:
    results = []
    print(f"\n=== DTR/RTS sweep on {port} ({board_label}) ===")
    for label, dtr, rts in DTR_RTS_COMBOS:
        print(f"\n--- {label} ---")
        print("Watch the board now (LED, USB re-enumeration). Opening in 2s...")
        await asyncio.sleep(2)
        try:
            data = await _sniff_raw_bytes(port, dtr, rts)
            evidence = _describe_bytes(data)
        except SerialRelayError as exc:
            evidence = f"SerialRelayError raised: {exc}"
        print(evidence)
        observed = _prompt("Did the board visibly reset (LED blink/reset, re-enumeration)? [y/n/unsure]: ")
        results.append(
            {"combo": label, "dtr": dtr, "rts": rts, "evidence": evidence, "observed_reset": observed}
        )
        print(f"Settling {SETTLE_SECONDS}s before next combo...")
        await asyncio.sleep(SETTLE_SECONDS)
    return results


async def run_disconnect_timing(port: str, board_label: str, dtr: bool | None, rts: bool | None) -> dict:
    print(f"\n=== Disconnect-timing pass on {port} ({board_label}) ===")
    print(f"Opening with dtr={dtr} rts={rts} (the combo that didn't reset the board above)...")
    conn = SerialConnection(port, dtr=dtr, rts=rts)
    await conn.open()
    start = time.monotonic()
    last_activity = start
    _prompt(
        "Press Enter once you're ready, THEN physically unplug the board whenever you like: "
    )
    print("Listening... (a heartbeat prints every ~2s so you know this hasn't hung)")

    # read_loop() only yields on an actual chunk, so a silent port -- expected
    # here, since we're waiting for you to unplug, not for traffic -- would
    # otherwise print nothing at all until either data arrives or the
    # disconnect is detected. This heartbeat runs independently of that, purely
    # for reassurance; it has no effect on the actual disconnect-detection
    # timing measured below (that's still read_loop() raising on real I/O
    # failure, unmodified).
    stop_heartbeat = asyncio.Event()

    async def _heartbeat() -> None:
        while True:
            try:
                await asyncio.wait_for(stop_heartbeat.wait(), timeout=2.0)
                return
            except asyncio.TimeoutError:
                print(f"  [{time.monotonic() - start:6.2f}s] still listening, no error yet")

    heartbeat_task = asyncio.create_task(_heartbeat())
    result: dict = {}
    try:
        async for chunk in conn.read_loop():
            now = time.monotonic()
            last_activity = now
            print(f"  [{now - start:6.2f}s] {len(chunk)} bytes")
    except SerialRelayError as exc:
        detected = time.monotonic()
        print(
            f"\nDisconnect detected after {detected - last_activity:.2f}s of silence "
            f"({detected - start:.2f}s since open)."
        )
        print(f"Raised error: {exc}")
        result = {
            "seconds_since_last_activity": round(detected - last_activity, 2),
            "seconds_since_open": round(detected - start, 2),
            "error_message": str(exc),
        }
    finally:
        stop_heartbeat.set()
        await heartbeat_task
        try:
            await conn.close()
        except SerialRelayError as exc:
            print(f"  (close after disconnect raised, ignored: {exc})")
    return result


async def main() -> None:
    ports = list_ports()
    if not ports:
        print("No serial ports found. Plug in a board and re-run.")
        return
    print("Available ports:")
    for i, p in enumerate(ports):
        print(f"  [{i}] {p.device} -- {p.description} (vid={p.vid} pid={p.pid})")
    idx = int(_prompt("Pick a port by index: "))
    port = ports[idx].device
    board_label = _prompt("Label this board (e.g. 'esp32-devkitc', 'rp2040-pico-w', 'rp2350'): ")

    sweep_results = await run_dtr_rts_sweep(port, board_label)

    print("\n--- Sweep summary ---")
    for r in sweep_results:
        print(f"  {r['combo']}: observed_reset={r['observed_reset']} | {r['evidence'][:80]}")

    safe = [r for r in sweep_results if r["observed_reset"].lower().startswith("n")]
    if safe:
        chosen = safe[0]
        print(f"\nUsing '{chosen['combo']}' for the disconnect-timing pass (no observed reset).")
        dtr, rts = chosen["dtr"], chosen["rts"]
    else:
        print(
            "\nNo combo was reported reset-free -- defaulting to leave-alone (None, None) for "
            "the disconnect-timing pass anyway."
        )
        dtr, rts = None, None

    print("\nRe-plug/power-cycle the board now if the sweep left it disconnected, then continue.")
    _prompt("Press Enter when the board is back and ready for the disconnect-timing pass: ")

    disconnect_result = await run_disconnect_timing(port, board_label, dtr, rts)

    print("\n=== FULL RESULTS (paste this back to Claude) ===")
    print(f"Board: {board_label} on {port}")
    print("DTR/RTS sweep:")
    for r in sweep_results:
        print(f"  - {r['combo']}: reset_observed={r['observed_reset']}")
        print(f"    evidence: {r['evidence']}")
    print("Disconnect timing:")
    print(f"  {disconnect_result}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
