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
        # Flow identity (added 2026-09-05, alongside runtimeBuild's own
        # "board doesn't know" shape): both null means no flow has
        # successfully started this boot.
        "currentFlowName": None,
        "currentFlowDeployId": None,
        "freeFlashBytes": 3500000,
        "freeRamBytes": 168000,
        # ESP-IDF heap (2026-09-25, runtime 5.1.0): an ESP32-family board reports it.
        "freeIdfHeapBytes": 65536,
        "largestIdfHeapBlockBytes": 31744,
        "safeMode": False,
        "hostname": None,
        "authRequired": False,
        "authScheme": None,
        "hasWifi": False,
        "networkAddress": None,
        "dependencies": None,  # runtime older than 7.0.0
    },
    {
        # Same message type, second variant: a board that DOES have a
        # runtime-build SHA and a currently-running, named flow -- mirrors
        # editor/test/protocol.roundtrip.test.ts.
        "type": "HELLO",
        "chipType": "Raspberry Pi Pico W with RP2040",
        "runtimeVersion": {"major": 0, "minor": 1, "patch": 0},
        "runtimeBuild": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        "currentFlowName": "basic mqtt smoke test",
        "currentFlowDeployId": "6f1c9b2a-8e3d-4a5b-9c1e-2d3f4a5b6c7d",
        "freeFlashBytes": 757760,
        "freeRamBytes": 179200,
        "freeIdfHeapBytes": None,  # not an ESP32
        "largestIdfHeapBlockBytes": None,
        "safeMode": False,
        # WiFi transport fields (2026-09-24): a board with a password set, listening.
        "hostname": "ts-kitchen",
        "authRequired": True,
        "authScheme": "hmac-sha256-nonce",
        "hasWifi": True,
        "networkAddress": "192.168.1.42",
        # Flow dependencies (2026-10-07, runtime 7.0.0): what the board holds in /lib.
        "dependencies": {"mqtt_as": "0123456789abcdef", "bme280": "fedcba9876543210"},
    },
    {
        "type": "DEPLOY",
        "bytecode": bytes([0x4D, 0x06, 0x00, 0x01, 0x02, 0x03]),
        "staticData": b"",
        # Flow identity (added 2026-09-05): an old editor that predates
        # this feature simply doesn't send these -- None here exercises
        # exactly that degrade, not just the happy path.
        "flowName": None,
        "deployId": None,
        # wifiProvision (added 2026-09-14, wifi-provisioning-captive-portal.md): same "an old editor
        # simply doesn't send this" degrade as flowName/deployId just above.
        "wifiProvision": None,
        "dependencies": None,  # an editor predating flow dependencies
    },
    {
        # Second DEPLOY variant: a current editor, which always has a
        # name (flow-file.ts's DEFAULT_FLOW_NAME at worst) and always
        # generates a fresh deployId per Deploy click.
        "type": "DEPLOY",
        "bytecode": bytes([0x4D, 0x06, 0x00, 0x04, 0x05, 0x06]),
        "staticData": bytes([1, 2, 3]),
        "flowName": "untitled flow",
        "deployId": "9d8c7b6a-5e4f-3d2c-1b0a-f9e8d7c6b5a4",
        # wifiProvision's happy path (see above for the None/"absent" case): a flow whose WiFi config
        # is "unmanaged" with the reprovisioning fallback left off, the default this feature ships
        # with (wifi-provisioning-captive-portal.md's confirmed trigger semantics).
        "wifiProvision": {"selfProvision": True, "allowReprovision": False},
        "dependencies": {"mqtt_as": "0123456789abcdef"},
    },
    {"type": "DEPLOY_ACK", "freeFlashBytes": 3400000, "freeRamBytes": 160000, "freeIdfHeapBytes": None, "largestIdfHeapBlockBytes": None},
    {"type": "DEPLOY_ACK", "freeFlashBytes": 3400000, "freeRamBytes": 160000, "freeIdfHeapBytes": 60000, "largestIdfHeapBlockBytes": 28000},
    {"type": "DEPLOY_ERROR", "code": "insufficient_space", "message": "flow needs 12000 bytes flash, 8000 available"},
    {"type": "VALUE_STREAM", "nodeId": "n3", "portId": "out0", "payload": True, "timestampMs": 1723000000123},
    {"type": "VALUE_STREAM", "nodeId": "n4", "portId": "out0", "payload": 3.14, "timestampMs": 1},
    {"type": "VALUE_STREAM", "nodeId": "n5", "portId": "out0", "payload": "hello", "timestampMs": 1},
    {"type": "VALUE_STREAM", "nodeId": "n6", "portId": "out0", "payload": bytes([1, 2, 3]), "timestampMs": 1},
    {"type": "NODE_ERROR", "nodeId": "n7", "exceptionType": "ZeroDivisionError", "exceptionMessage": "division by zero"},
    # NODE_STATUS added 2026-09-10 (connection-status-indicator feature).
    # Two variants: text present and text absent -- mirrors
    # editor/test/protocol.roundtrip.test.ts exactly.
    {"type": "NODE_STATUS", "nodeId": "n10", "state": "connected", "text": "192.168.1.42"},
    {"type": "NODE_STATUS", "nodeId": "n11", "state": "disconnected"},
    {"type": "STATE_READ", "nodeId": "n8", "key": "counter"},  # request form: no value
    {"type": "STATE_READ", "nodeId": "n8", "key": "counter", "value": 42},  # response form: value present
    {"type": "STATE_WRITE", "nodeId": "n8", "key": "counter", "value": 0},
    # TRIGGER added 2026-09-02 (inject click-only live-fire feature).
    {"type": "TRIGGER", "nodeId": "n9"},
    # HELLO_REQUEST added 2026-09-05 (no reset button on the Pico W) -- no
    # fields at all, the minimal possible message shape.
    {"type": "HELLO_REQUEST"},
    # EXEC / STOP_TO_PROMPT added 2026-09-23 (console command box, stop to prompt).
    {"type": "EXEC", "code": "import machine; machine.Pin(15).value()"},
    {"type": "STOP_TO_PROMPT"},
    # SET_BOARD_SETTINGS / BOARD_SETTINGS_RESULT added 2026-09-24 (WiFi transport).
    {"type": "SET_BOARD_SETTINGS", "hostname": "ts-kitchen", "password": "correct horse", "clearPassword": False},
    {"type": "SET_BOARD_SETTINGS", "hostname": None, "password": None, "clearPassword": True},
    {"type": "BOARD_SETTINGS_RESULT", "ok": True, "error": None},
    {"type": "BOARD_SETTINGS_RESULT", "ok": False, "error": "password must be 8-64 characters"},
    # DEP_PUT / DEP_RESULT added 2026-10-07 (flow dependencies).
    {"type": "DEP_PUT", "name": "mqtt_as", "file": "mqtt_as.mpy", "offset": 1024, "total": 11324, "data": bytes([0x4D, 6, 0, 31])},
    {"type": "DEP_ACK", "name": "mqtt_as", "file": "mqtt_as.mpy", "offset": 1024, "ok": True, "code": None, "error": None},
    {"type": "DEP_ACK", "name": "mqtt_as", "file": "mqtt_as.mpy", "offset": 0, "ok": False, "code": "NoSpace", "error": "no space for mqtt_as"},
    {"type": "RESTART", "hard": False},
    {"type": "RESTART", "hard": True},
    {"type": "DEP_COMMIT", "name": "mqtt_as", "hash": "0123456789abcdef", "files": {"mqtt_as.mpy": 11324}},
    {"type": "DEP_RESULT", "name": "mqtt_as", "ok": True, "code": None, "error": None, "freeFlashBytes": 1200000},
    {"type": "DEP_RESULT", "name": "mqtt_as", "ok": False, "code": "NoSpace", "error": "no space for mqtt_as: needs 11324 bytes, 9000 free", "freeFlashBytes": None},
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


def test_rejects_hello_non_string_current_flow_fields():
    # Same shape as test_rejects_hello_non_string_non_null_runtime_build,
    # for the two flow-identity fields added 2026-09-05.
    base = {"chipType": "x", "runtimeVersion": {"major": 1, "minor": 0, "patch": 0}, "freeFlashBytes": 1, "freeRamBytes": 1}
    for bad_field in ("currentFlowName", "currentFlowDeployId"):
        body = cbor.encode(dict(base, **{bad_field: 123}))
        try:
            messages.decode_message_body(messages.MessageType["HELLO"], body)
            assert False, "expected MessageDecodeError for bad %s" % (bad_field,)
        except MessageDecodeError:
            pass


def test_accepts_hello_with_current_flow_fields_entirely_absent():
    # No flow has ever been deployed to this board -- both fields must
    # degrade to None, not a validation error.
    body = cbor.encode(
        {
            "chipType": "x",
            "runtimeVersion": {"major": 1, "minor": 0, "patch": 0},
            "freeFlashBytes": 1,
            "freeRamBytes": 1,
        }
    )
    decoded = messages.decode_message_body(messages.MessageType["HELLO"], body)
    assert decoded["currentFlowName"] is None
    assert decoded["currentFlowDeployId"] is None


def test_accepts_hello_without_idf_heap_fields():
    # Non-ESP32 board, or a runtime older than 5.1.0.
    body = cbor.encode({"chipType": "x", "runtimeVersion": {"major": 5, "minor": 0, "patch": 0}, "freeFlashBytes": 1, "freeRamBytes": 1})
    decoded = messages.decode_message_body(messages.MessageType["HELLO"], body)
    assert decoded["freeIdfHeapBytes"] is None
    assert decoded["largestIdfHeapBlockBytes"] is None


def test_rejects_bad_idf_heap_fields():
    hello = {"chipType": "x", "runtimeVersion": {"major": 5, "minor": 1, "patch": 0}, "freeFlashBytes": 1, "freeRamBytes": 1}
    ack = {"freeFlashBytes": 1, "freeRamBytes": 1}
    for field in ("freeIdfHeapBytes", "largestIdfHeapBlockBytes"):
        for bad in (-1, 1.5, "big"):
            for type_name, base in (("HELLO", hello), ("DEPLOY_ACK", ack)):
                body = cbor.encode(dict(base, **{field: bad}))
                try:
                    messages.decode_message_body(messages.MessageType[type_name], body)
                    assert False, "expected MessageDecodeError for %s %s=%r" % (type_name, field, bad)
                except MessageDecodeError:
                    pass


def test_rejects_deploy_non_string_flow_identity_fields():
    base = {"bytecode": b"\x00", "staticData": b""}
    for bad_field in ("flowName", "deployId"):
        body = cbor.encode(dict(base, **{bad_field: 123}))
        try:
            messages.decode_message_body(messages.MessageType["DEPLOY"], body)
            assert False, "expected MessageDecodeError for bad %s" % (bad_field,)
        except MessageDecodeError:
            pass


def test_accepts_deploy_with_flow_identity_fields_entirely_absent():
    # An old editor that predates this feature (or a hand-crafted DEPLOY)
    # simply doesn't send flowName/deployId -- must degrade to None, not
    # a rejected deploy (messages.py's own "additive field" convention).
    body = cbor.encode({"bytecode": b"\x01\x02", "staticData": b""})
    decoded = messages.decode_message_body(messages.MessageType["DEPLOY"], body)
    assert decoded["flowName"] is None
    assert decoded["deployId"] is None


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


def test_hello_wifi_fields_default_when_absent():
    # A runtime older than 3.0.0 sends none of the 2026-09-24 WiFi transport fields.
    body = cbor.encode({"chipType": "x", "runtimeVersion": {"major": 2, "minor": 0, "patch": 0}, "freeFlashBytes": 1, "freeRamBytes": 1})
    decoded = messages.decode_message_body(messages.MessageType["HELLO"], body)
    assert decoded["hostname"] is None
    assert decoded["authRequired"] is False
    assert decoded["hasWifi"] is False
    assert decoded["networkAddress"] is None


def test_rejects_bad_dependency_shapes():
    for name, bad in (
        ("DEP_PUT", {"name": "x", "file": "x.mpy", "offset": 0, "total": 1}),
        ("DEP_PUT", {"name": "x", "file": "x.mpy", "offset": -1, "total": 1, "data": b"x"}),
        ("DEP_PUT", {"name": "x", "file": "x.mpy", "offset": 0, "total": 1, "data": "text"}),
        ("DEP_COMMIT", {"name": "x", "hash": "h", "files": {}}),
        ("DEP_COMMIT", {"name": "x", "hash": "h", "files": {"x.mpy": "big"}}),
        ("DEP_COMMIT", {"name": "x", "hash": "h", "files": {"x.mpy": True}}),
        ("DEP_COMMIT", {"name": "x", "files": {"x.mpy": 1}}),
        ("DEP_RESULT", {"name": "x"}),
        ("DEPLOY", {"bytecode": b"", "staticData": b"", "dependencies": 5}),
        ("DEPLOY", {"bytecode": b"", "staticData": b"", "dependencies": {"mqtt_as": 5}}),
        ("HELLO", {"chipType": "x", "runtimeVersion": {"major": 7, "minor": 0, "patch": 0}, "freeFlashBytes": 1, "freeRamBytes": 1, "dependencies": "mqtt_as"}),
    ):
        try:
            messages.decode_message_body(messages.MessageType[name], cbor.encode(bad))
            assert False, "expected MessageDecodeError for %s %r" % (name, bad)
        except MessageDecodeError:
            pass


def test_rejects_bad_board_settings_shapes():
    for name, bad in (
        ("SET_BOARD_SETTINGS", {"hostname": 5}),
        ("SET_BOARD_SETTINGS", {"password": b"x"}),
        ("SET_BOARD_SETTINGS", {"clearPassword": "yes"}),
        ("BOARD_SETTINGS_RESULT", {}),
        ("BOARD_SETTINGS_RESULT", {"ok": 1}),
    ):
        try:
            messages.decode_message_body(messages.MessageType[name], cbor.encode(bad))
            assert False, "expected MessageDecodeError for %s %r" % (name, bad)
        except MessageDecodeError:
            pass


minitest.run(
    [
        test_hello_wifi_fields_default_when_absent,
        test_rejects_bad_board_settings_shapes,
        test_rejects_bad_dependency_shapes,
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
        test_rejects_hello_non_string_current_flow_fields,
        test_accepts_hello_with_current_flow_fields_entirely_absent,
        test_accepts_hello_without_idf_heap_fields,
        test_rejects_bad_idf_heap_fields,
        test_rejects_deploy_non_string_flow_identity_fields,
        test_accepts_deploy_with_flow_identity_fields_entirely_absent,
        test_rejects_deploy_non_bytes_field,
        test_rejects_state_write_missing_value,
        test_rejects_trigger_missing_node_id,
        test_rejects_truncated_garbage_cbor,
        test_rejects_empty_body_for_every_type,
        test_decoder_deliberately_permissive_on_non_minimal_ints,
        test_50_malformed_message_bodies_soak,
    ]
)
