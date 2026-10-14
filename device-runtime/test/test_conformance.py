# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_conformance.py
#
# The device runtime's side of the shared wire-protocol conformance check
# (interfaces/protocol/SPEC.md, interfaces/protocol/vectors/). Runs the same vectors as the
# editor (editor/test/protocol-conformance.test.ts) and the backend
# (backend/test/test_conformance.py) against the real MicroPython codec,
# so the three implementations can't drift apart without one of the three
# failing.
#
# Run with the headless MicroPython unix-port build (device-runtime/test/README.md):
#   micropython test_conformance.py
# Reads protocol/ relative to this file, so it works from any directory.

import minitest

minitest.add_src_to_path()

import binascii
import json
import messages
import framing
from errors import MessageDecodeError

_THIS_DIR = __file__.rsplit("/", 1)[0] if "/" in __file__ else "."
_PROTOCOL_DIR = _THIS_DIR + "/../../interfaces/protocol"


def _load(rel):
    with open(_PROTOCOL_DIR + "/" + rel, "r") as f:
        return json.loads(f.read())


def _hex_bytes(hex_str):
    return binascii.unhexlify(hex_str)


def _from_json(v):
    """{"$bytes": hex} -> bytes, recursively (interfaces/protocol/README.md)."""
    if isinstance(v, list):
        return [_from_json(x) for x in v]
    if isinstance(v, dict):
        if len(v) == 1 and isinstance(v.get("$bytes"), str):
            return _hex_bytes(v["$bytes"])
        return {k: _from_json(val) for k, val in v.items()}
    return v


def test_type_table_matches_spec():
    spec = _load("messages.json")
    by_name = {m["name"]: m["id"] for m in spec["messages"]}
    assert messages.MessageType == by_name, "device MessageType table has drifted from interfaces/protocol/messages.json"
    assert tuple(spec["nodeStatusStates"]) == messages.NODE_STATUS_STATES


def test_message_vectors_decode_to_expected():
    vectors = _load("vectors/messages.json")["vectors"]
    assert len(vectors) > 0
    for v in vectors:
        frame = _hex_bytes(v["frameHex"])
        type_id = frame[2]
        assert type_id == v["typeId"], v["name"]
        got = messages.decode_message_body(type_id, frame[3:])
        assert got == _from_json(v["message"]), "%s decode mismatch: %r" % (v["name"], got)


def test_message_vectors_round_trip():
    vectors = _load("vectors/messages.json")["vectors"]
    for v in vectors:
        expected = _from_json(v["message"])
        body = messages.encode_message_body(expected)
        again = messages.decode_message_body(messages.message_type_id(expected), body)
        assert again == expected, "%s re-encode mismatch: %r" % (v["name"], again)


def test_framing_vectors():
    vectors = _load("vectors/framing.json")["vectors"]
    assert len(vectors) > 0
    for v in vectors:
        decoder = framing.FrameDecoder()
        results = []
        for chunk in v["chunks"]:
            results.extend(decoder.push(_hex_bytes(chunk)))
        actual = []
        for r in results:
            if "error" in r:
                actual.append({"error": True})
            else:
                actual.append({"frame": {"type": r["frame"]["type"], "bodyHex": binascii.hexlify(r["frame"]["payload"]).decode()}})
        assert actual == v["expect"], "%s: %r" % (v["name"], actual)


def test_invalid_vectors_rejected():
    vectors = _load("vectors/invalid.json")["vectors"]
    assert len(vectors) > 0
    for v in vectors:
        frame = _hex_bytes(v["frameHex"])
        if v["errorAt"] == "framing":
            results = framing.FrameDecoder().push(frame)
            assert any("error" in r for r in results), v["name"]
        else:
            try:
                messages.decode_message_body(frame[2], frame[3:])
            except MessageDecodeError:
                pass
            else:
                raise AssertionError("%s: expected MessageDecodeError" % v["name"])


minitest.run([
    test_type_table_matches_spec,
    test_message_vectors_decode_to_expected,
    test_message_vectors_round_trip,
    test_framing_vectors,
    test_invalid_vectors_rejected,
])
