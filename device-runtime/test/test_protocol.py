# SPDX-License-Identifier: Apache-2.0
# device-runtime/test/test_protocol.py
#
# Off-device tests for messages.py + protocol.py, run against the headless
# MicroPython unix-port build -- ports editor/test/protocol.roundtrip.test.ts's
# scenarios to the Python side (same convention as test_framing.py). Covers
# CBOR round-trip for every §13 message type and the "valid CBOR, wrong
# shape" rejection path.

import minitest

minitest.add_src_to_path()

import cbor
import messages
import protocol
from errors import MessageDecodeError

SAMPLE_MESSAGES = [
    {
        "type": "HELLO",
        "chipType": "ESP32-C3",
        "runtimeVersion": {"major": 1, "minor": 2, "patch": 3},
        "runtimeBuild": None,  # board predates the runtime-build marker, or deploy_runtime.py couldn't determine git info
        "freeFlashBytes": 3500000,
        "freeRamBytes": 168000,
    },
    {
        # Same message type, second variant: a board that DOES have a
        # runtime-build SHA -- mirrors editor/test/protocol.roundtrip.test.ts.
        "type": "HELLO",
        "chipType": "Raspberry Pi Pico W with RP2040",
        "runtimeVersion": {"major": 0, "minor": 1, "patch": 0},
        "runtimeBuild": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        "freeFlashBytes": 757760,
        "freeRamBytes": 179200,
    },
    {"type": "DEPLOY", "bytecode": bytes([0x4D, 0x06, 0x00, 0x01, 0x02, 0x03]), "staticData": b""},
    {"type": "DEPLOY_ACK", "freeFlashBytes": 3400000, "freeRamBytes": 160000},
    {"type": "DEPLOY_ERROR", "code": "insufficient_space", "message": "flow needs 12000 bytes flash, 8000 available"},
    {"type": "VALUE_STREAM", "nodeId": "n3", "portId": "out0", "payload": True, "timestampMs": 1723000000123},
    {"type": "VALUE_STREAM", "nodeId": "n4", "portId": "out0", "payload": 3.14, "timestampMs": 1},
    {"type": "VALUE_STREAM", "nodeId": "n5", "portId": "out0", "payload": "hello", "timestampMs": 1},
    {"type": "VALUE_STREAM", "nodeId": "n6", "portId": "out0", "payload": bytes([1, 2, 3]), "timestampMs": 1},
    {"type": "NODE_ERROR", "nodeId": "n7", "exceptionType": "ZeroDivisionError", "exceptionMessage": "division by zero"},
    {"type": "STATE_READ", "nodeId": "n8", "key": "counter"},  # request form: no value
    {"type": "STATE_READ", "nodeId": "n8", "key": "counter", "value": 42},  # response form: value present
    {"type": "STATE_WRITE", "nodeId": "n8", "key": "counter", "value": 0},
    # TRIGGER added 2026-09-02 (inject click-only live-fire feature).
    {"type": "TRIGGER", "nodeId": "n9"},
]


def _close_enough(a, b):
    if isinstance(a, float) or isinstance(b, float):
        return abs(a - b) < 1e-9
    return a == b


def _messages_equal(a, b):
    if set(a.keys()) != set(b.keys()):
        return False
    return all(_close_enough(a[k], b[k]) for k in a)


def test_roundtrip_every_message_type():
    for original in SAMPLE_MESSAGES:
        body = messages.encode_message_body(original)
        type_id = messages.MessageType[original["type"]]
        decoded = messages.decode_message_body(type_id, body)
        assert _messages_equal(decoded, original), "roundtrip mismatch for %s: %r != %r" % (original["type"], decoded, original)


def test_roundtrip_through_full_frame():
    decoder = protocol.ProtocolStreamDecoder()
    for original in SAMPLE_MESSAGES:
        frame = protocol.encode_message(original)
        results = decoder.push(frame)
        assert len(results) == 1
        result = results[0]
        assert "message" in result, "expected ok decode for %s, got %r" % (original["type"], result)
        assert _messages_equal(result["message"], original)


def test_bytes_fields_are_native_cbor_byte_strings():
    msg = {"type": "DEPLOY", "bytecode": bytes([9, 9, 9]), "staticData": bytes([1])}
    body = messages.encode_message_body(msg)
    raw = cbor.decode(body)
    assert isinstance(raw["bytecode"], bytes)


def test_rejects_unknown_message_type_byte():
    body = cbor.encode({})
    try:
        messages.decode_message_body(99, body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_non_map_body_for_every_type():
    # No CBOR array support in cbor.py at all -- encode a map that decodes
    # fine, then hand-build a tiny array fixture (major type 4, 0 elements)
    # to exercise "valid CBOR, wrong top-level shape" the same way the JS
    # test does with an actual array value.
    body = bytes([0x80])  # empty array
    for type_id in messages.MessageType.values():
        try:
            messages.decode_message_body(type_id, body)
            assert False, "expected MessageDecodeError for type %d" % type_id
        except MessageDecodeError:
            pass


def test_rejects_hello_missing_required_field():
    body = cbor.encode({"chipType": "ESP32-C3", "freeFlashBytes": 1, "freeRamBytes": 1})  # no runtimeVersion
    try:
        messages.decode_message_body(messages.MessageType["HELLO"], body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_hello_wrong_typed_field():
    body = cbor.encode(
        {
            "chipType": "ESP32-C3",
            "runtimeVersion": {"major": 1, "minor": 0, "patch": 0},
            "freeFlashBytes": "not a number",
            "freeRamBytes": 1,
        }
    )
    try:
        messages.decode_message_body(messages.MessageType["HELLO"], body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_hello_negative_byte_count():
    body = cbor.encode(
        {
            "chipType": "ESP32-C3",
            "runtimeVersion": {"major": 1, "minor": 0, "patch": 0},
            "freeFlashBytes": -1,
            "freeRamBytes": 1,
        }
    )
    try:
        messages.decode_message_body(messages.MessageType["HELLO"], body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_malformed_runtime_version():
    body = cbor.encode({"chipType": "x", "runtimeVersion": "1.2.3", "freeFlashBytes": 1, "freeRamBytes": 1})
    try:
        messages.decode_message_body(messages.MessageType["HELLO"], body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_hello_non_string_non_null_runtime_build():
    body = cbor.encode(
        {
            "chipType": "x",
            "runtimeVersion": {"major": 1, "minor": 0, "patch": 0},
            "runtimeBuild": 123,
            "freeFlashBytes": 1,
            "freeRamBytes": 1,
        }
    )
    try:
        messages.decode_message_body(messages.MessageType["HELLO"], body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_accepts_hello_with_runtime_build_entirely_absent():
    body = cbor.encode(
        {
            "chipType": "x",
            "runtimeVersion": {"major": 1, "minor": 0, "patch": 0},
            "freeFlashBytes": 1,
            "freeRamBytes": 1,
        }
    )
    decoded = messages.decode_message_body(messages.MessageType["HELLO"], body)
    assert decoded["runtimeBuild"] is None


def test_rejects_deploy_non_bytes_field():
    body = cbor.encode({"bytecode": "not bytes", "staticData": b""})
    try:
        messages.decode_message_body(messages.MessageType["DEPLOY"], body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_state_write_missing_value():
    body = cbor.encode({"nodeId": "n1", "key": "x"})
    try:
        messages.decode_message_body(messages.MessageType["STATE_WRITE"], body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_trigger_missing_node_id():
    body = cbor.encode({})
    try:
        messages.decode_message_body(messages.MessageType["TRIGGER"], body)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_truncated_garbage_cbor():
    garbage = bytes([0xFF, 0x00, 0x9F, 0x9F, 0x9F])
    try:
        messages.decode_message_body(messages.MessageType["HELLO"], garbage)
        assert False, "expected MessageDecodeError"
    except MessageDecodeError:
        pass


def test_rejects_empty_body_for_every_type():
    body = b""
    for type_id in messages.MessageType.values():
        try:
            messages.decode_message_body(type_id, body)
            assert False, "expected MessageDecodeError for type %d" % type_id
        except MessageDecodeError:
            pass


def test_decoder_deliberately_permissive_on_non_minimal_ints():
    # Documented asymmetry vs. cborg's strict decode (see cbor.py's own
    # header comment): {"a": 1} hand-encoded with "1" as a non-minimal
    # 4-byte uint instead of its 1-byte form. cborg's strict mode on the
    # editor side rejects this; this decoder accepts it, since the only
    # sender is the editor's own strict encoder and this isn't a safety
    # boundary on the device side. Asserted explicitly so this stays a
    # documented decision, not an accidental gap discovered later.
    non_minimal = bytes([0xA1, 0x61, 0x61, 0x1A, 0x00, 0x00, 0x00, 0x01])
    decoded = cbor.decode(non_minimal)
    assert decoded == {"a": 1}


def test_50_malformed_message_bodies_soak():
    # Same soak-test spirit as the fault-isolation plan's 50-frame test,
    # applied at the message-decode layer: 50 garbage bodies against a
    # real message type, none may raise anything but MessageDecodeError.
    seed = 999
    for i in range(50):
        seed = (1103515245 * seed + 12345) & 0x7FFFFFFF
        length = seed % 30
        body = bytes([(seed >> (j % 24)) & 0xFF for j in range(length)])
        try:
            messages.decode_message_body(messages.MessageType["NODE_ERROR"], body)
        except MessageDecodeError:
            pass  # expected outcome for essentially all garbage inputs


minitest.run(
    [
        test_roundtrip_every_message_type,
        test_roundtrip_through_full_frame,
        test_bytes_fields_are_native_cbor_byte_strings,
        test_rejects_unknown_message_type_byte,
        test_rejects_non_map_body_for_every_type,
        test_rejects_hello_missing_required_field,
        test_rejects_hello_wrong_typed_field,
        test_rejects_hello_negative_byte_count,
        test_rejects_malformed_runtime_version,
        test_rejects_hello_non_string_non_null_runtime_build,
        test_accepts_hello_with_runtime_build_entirely_absent,
        test_rejects_deploy_non_bytes_field,
        test_rejects_state_write_missing_value,
        test_rejects_trigger_missing_node_id,
        test_rejects_truncated_garbage_cbor,
        test_rejects_empty_body_for_every_type,
        test_decoder_deliberately_permissive_on_non_minimal_ints,
        test_50_malformed_message_bodies_soak,
    ]
)
