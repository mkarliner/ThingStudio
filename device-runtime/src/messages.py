# SPDX-License-Identifier: Apache-2.0
# device-runtime/src/messages.py
#
# §13 message types + CBOR body encode/decode, device side -- the
# MicroPython mirror of editor/src/protocol/messages.ts and codec.ts
# combined into one file (no TypeScript-style interface layer to keep
# separate here; a message is just a dict with a "type" key, validated by
# the functions below).
#
# The numeric type-byte table below MUST match
# editor/src/protocol/messages.ts's MessageType exactly -- that file's own
# header comment says it is "the only source of truth right now" for these
# values, and this is the real device-side listener that comment was
# waiting on. Copied 1:1, not re-derived:
#   HELLO=1 DEPLOY=2 DEPLOY_ACK=3 DEPLOY_ERROR=4 VALUE_STREAM=5
#   NODE_ERROR=6 STATE_READ=7 STATE_WRITE=8 TRIGGER=9
#
# TRIGGER (2026-09-02, inject click-only live-fire feature) is newer than
# the rest of this table -- editor -> device, "fire this source node's
# live-trigger event right now" (see messages.ts's own TriggerMessage doc
# comment for the full contract). Fire-and-forget, no ack, same as
# STATE_WRITE."
#
# Field names/shapes below are likewise copied from messages.ts, including
# its two documented spec-filling decisions: STATE_READ carries both
# request (no "value" key) and response (with "value") in one shape, and
# DEPLOY_ACK includes free-space fields even though §13 didn't require them.

from errors import MessageDecodeError
import cbor

MessageType = {
    "HELLO": 1,
    "DEPLOY": 2,
    "DEPLOY_ACK": 3,
    "DEPLOY_ERROR": 4,
    "VALUE_STREAM": 5,
    "NODE_ERROR": 6,
    "STATE_READ": 7,
    "STATE_WRITE": 8,
    "TRIGGER": 9,
}

MESSAGE_NAME_BY_TYPE = {v: k for k, v in MessageType.items()}


def message_type_id(message):
    return MessageType[message["type"]]


def encode_message_body(message):
    """Encode a message dict (must have a "type" key naming one of
    MessageType) to its CBOR body only -- no frame header, see
    framing.encode_frame."""
    body = {k: v for k, v in message.items() if k != "type"}
    return cbor.encode(body)


def decode_message_body(type_id, body):
    """Decode a CBOR body into a typed message dict, given the frame's
    1-byte message type. Raises MessageDecodeError -- never anything else --
    for: an unknown type byte, CBOR that fails to parse, or CBOR that
    parses fine but doesn't have the shape its declared type requires."""
    name = MESSAGE_NAME_BY_TYPE.get(type_id)
    if name is None:
        raise MessageDecodeError("unknown message type byte: %r" % (type_id,))

    try:
        raw = cbor.decode(body)
    except Exception as e:  # noqa: BLE001 -- cbor.CBORDecodeError, or anything else cbor.py didn't already convert
        raise MessageDecodeError("malformed CBOR body for %s: %r" % (name, e))

    if not isinstance(raw, dict):
        raise MessageDecodeError("%s body must be a CBOR map, got %r" % (name, type(raw)))

    validator = _VALIDATORS.get(name)
    if validator is None:
        raise MessageDecodeError("no validator registered for message type %s" % (name,))
    fields = validator(raw, name)
    fields["type"] = name
    return fields


# --- per-field validators (mirrors codec.ts's expect*/require* helpers) --


def _fail(name, detail):
    raise MessageDecodeError("%s: %s" % (name, detail))


def _expect_string(obj, key, name):
    v = obj.get(key)
    if not isinstance(v, str):
        _fail(name, 'field "%s" must be a string, got %r' % (key, type(v)))
    return v


def _expect_finite_number(obj, key, name):
    v = obj.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        _fail(name, 'field "%s" must be a finite number, got %r' % (key, type(v)))
    return v


def _expect_non_negative_int(obj, key, name):
    v = _expect_finite_number(obj, key, name)
    if not isinstance(v, int) or v < 0:
        _fail(name, 'field "%s" must be a non-negative integer, got %r' % (key, v))
    return v


def _expect_bytes(obj, key, name):
    v = obj.get(key)
    if not isinstance(v, (bytes, bytearray)):
        _fail(name, 'field "%s" must be a byte string, got %r' % (key, type(v)))
    return bytes(v)


def _expect_version(obj, key, name):
    v = obj.get(key)
    if not isinstance(v, dict):
        _fail(name, 'field "%s" must be a version map with major/minor/patch' % (key,))
    scoped = "%s.%s" % (name, key)
    return {
        "major": _expect_non_negative_int(v, "major", scoped),
        "minor": _expect_non_negative_int(v, "minor", scoped),
        "patch": _expect_non_negative_int(v, "patch", scoped),
    }


def _require_present(obj, key, name):
    if key not in obj:
        _fail(name, 'missing required field "%s"' % (key,))
    return obj[key]


def _validate_hello(obj, name):
    return {
        "chipType": _expect_string(obj, "chipType", name),
        "runtimeVersion": _expect_version(obj, "runtimeVersion", name),
        "freeFlashBytes": _expect_non_negative_int(obj, "freeFlashBytes", name),
        "freeRamBytes": _expect_non_negative_int(obj, "freeRamBytes", name),
    }


def _validate_deploy(obj, name):
    return {
        "bytecode": _expect_bytes(obj, "bytecode", name),
        "staticData": _expect_bytes(obj, "staticData", name),
    }


def _validate_deploy_ack(obj, name):
    return {
        "freeFlashBytes": _expect_non_negative_int(obj, "freeFlashBytes", name),
        "freeRamBytes": _expect_non_negative_int(obj, "freeRamBytes", name),
    }


def _validate_deploy_error(obj, name):
    return {
        "code": _expect_string(obj, "code", name),
        "message": _expect_string(obj, "message", name),
    }


def _validate_value_stream(obj, name):
    return {
        "nodeId": _expect_string(obj, "nodeId", name),
        "portId": _expect_string(obj, "portId", name),
        "payload": _require_present(obj, "payload", name),
        "timestampMs": _expect_non_negative_int(obj, "timestampMs", name),
    }


def _validate_node_error(obj, name):
    return {
        "nodeId": _expect_string(obj, "nodeId", name),
        "exceptionType": _expect_string(obj, "exceptionType", name),
        "exceptionMessage": _expect_string(obj, "exceptionMessage", name),
    }


def _validate_state_read(obj, name):
    fields = {
        "nodeId": _expect_string(obj, "nodeId", name),
        "key": _expect_string(obj, "key", name),
    }
    if "value" in obj:
        fields["value"] = obj["value"]
    return fields


def _validate_state_write(obj, name):
    return {
        "nodeId": _expect_string(obj, "nodeId", name),
        "key": _expect_string(obj, "key", name),
        "value": _require_present(obj, "value", name),
    }


def _validate_trigger(obj, name):
    return {
        "nodeId": _expect_string(obj, "nodeId", name),
    }


_VALIDATORS = {
    "HELLO": _validate_hello,
    "DEPLOY": _validate_deploy,
    "DEPLOY_ACK": _validate_deploy_ack,
    "DEPLOY_ERROR": _validate_deploy_error,
    "VALUE_STREAM": _validate_value_stream,
    "NODE_ERROR": _validate_node_error,
    "STATE_READ": _validate_state_read,
    "STATE_WRITE": _validate_state_write,
    "TRIGGER": _validate_trigger,
}
