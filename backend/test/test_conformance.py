# SPDX-License-Identifier: Apache-2.0
# backend/test/test_conformance.py
#
# The backend's side of the shared wire-protocol conformance check
# (interfaces/protocol/SPEC.md, interfaces/protocol/vectors/). The backend relays frames and
# never decodes CBOR, so it does not run the message-body vectors -- it
# runs the framing vectors (framing.py) and the transport-encoding
# vectors (line_framing.py's base64 "F64:" lines). The same vectors are
# run by editor/test/protocol-conformance.test.ts and
# device-runtime/test/test_conformance.py, so the three implementations
# can't drift apart without one of the three failing.

import json
from pathlib import Path

from thingstudio_backend.framing import FrameDecoder
from thingstudio_backend.line_framing import F64_PREFIX, LineDecoder, encode_f64_line

PROTOCOL_DIR = Path(__file__).resolve().parents[2] / "interfaces" / "protocol"


def _load(rel: str) -> dict:
    return json.loads((PROTOCOL_DIR / rel).read_text())


def _hex_to_bytes(hex_str: str) -> bytes:
    return bytes.fromhex(hex_str)


def test_framing_vectors() -> None:
    vectors = _load("vectors/framing.json")["vectors"]
    assert vectors, "no framing vectors"
    for v in vectors:
        decoder = FrameDecoder()
        results = []
        for chunk in v["chunks"]:
            results.extend(decoder.push(_hex_to_bytes(chunk)))
        actual = [
            {"error": True}
            if r.error is not None
            else {"frame": {"type": r.frame.type, "bodyHex": r.frame.payload.hex()}}
            for r in results
        ]
        assert actual == v["expect"], v["name"]


def test_invalid_frames_are_rejected_at_framing_stage() -> None:
    vectors = _load("vectors/invalid.json")["vectors"]
    framing_cases = [v for v in vectors if v["errorAt"] == "framing"]
    for v in framing_cases:
        results = FrameDecoder().push(_hex_to_bytes(v["frameHex"]))
        assert any(r.error is not None for r in results), v["name"]


def test_transport_encoding_round_trips_every_message_frame() -> None:
    vectors = _load("vectors/messages.json")["vectors"]
    assert vectors, "no message vectors"
    for v in vectors:
        frame = _hex_to_bytes(v["frameHex"])
        line = encode_f64_line(frame)
        assert line.startswith(F64_PREFIX.encode("ascii")), v["name"]
        events = LineDecoder().push(line)
        assert len(events) == 1, v["name"]
        assert events[0].error is None, v["name"]
        # The relay must recover the exact frame bytes it would forward verbatim.
        assert events[0].frame == frame, v["name"]


def test_debug_lines_pass_through_as_text() -> None:
    events = LineDecoder().push(b"LISTENER_READY\nF64:AAAA\n")
    assert events[0].debug_text == "LISTENER_READY"
    assert events[1].frame == b"\x00\x00\x00"
