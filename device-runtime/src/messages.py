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
#   NODE_ERROR=6 STATE_READ=7 STATE_WRITE=8 TRIGGER=9 HELLO_REQUEST=10
#   NODE_STATUS=11 EXEC=12 STOP_TO_PROMPT=13 SET_BOARD_SETTINGS=14
#   BOARD_SETTINGS_RESULT=15 DEP_PUT=16 DEP_RESULT=17 DEP_COMMIT=18 RESTART=19
#
# NODE_STATUS (2026-09-10, outstanding-items/node-status-indicators.md):
# device -> editor, a lightweight per-node connection-status push,
# deliberately separate from VALUE_STREAM. VALUE_STREAM's shape (nodeId,
# portId, payload, timestampMs) is reserved for real wire/port values --
# the still-unbuilt full live-value-streaming feature (design doc §5) --
# and a connection status isn't a port's value, so it gets its own type
# rather than a synthetic portId hack. Deliberately NOT part of the
# emit-on-change `msg` a node sends downstream on its own wires (wifi-
# status.ts/mqtt-shared.ts) -- those two mechanisms happen to source from
# the same internal state, but a NODE_STATUS push doesn't depend on
# anything being wired downstream to see it, the same way NODE_ERROR
# doesn't. Small, fixed shape for v1 (nodeId, state, optional text) --
# not Node-RED's full free-form fill/shape/text -- Mike's own design call,
# 2026-09-09: the canvas owns a shared state->color mapping rather than
# pushing that choice onto every node type's own codegen. Additive later
# if a node type ever needs more nuance.
#
# TRIGGER (2026-09-02, inject click-only live-fire feature) is newer than
# the rest of this table -- editor -> device, "fire this source node's
# live-trigger event right now" (see messages.ts's own TriggerMessage doc
# comment for the full contract). Fire-and-forget, no ack, same as
# STATE_WRITE.
#
# HELLO_REQUEST (2026-09-05, real RP2040 hardware pass -- no reset button
# on the Pico W) is editor -> device, "resend your current HELLO right
# now" -- listener.py's _send_hello() only ever runs once, at boot, so a
# board that's been running a while (or a reconnected editor) has no way
# to get back to a known state without a physical reset. No fields; the
# device's only response is a normal HELLO, not a distinct ack. See
# messages.ts's own HelloRequestMessage doc comment.
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
    "HELLO_REQUEST": 10,
    "NODE_STATUS": 11,
    # Added 2026-09-23 (Mike: a text box to send basic commands to the board, output to the
    # console). Editor -> device: run `code` in the listener, print the result. Append-only
    # numbering, same as every type above.
    "EXEC": 12,
    # Added 2026-09-23. Editor -> device: stop the flow and the listener, leaving the board at the
    # normal ">>>" prompt with Ctrl-C re-enabled. Soft reset (Ctrl-D) or a real reset restarts it.
    "STOP_TO_PROMPT": 13,
    # Added 2026-09-24 (WiFi transport, MVP item 6 -- wifi-transport-scoping.md). Editor -> device:
    # save this board's hostname and/or WiFi-session password (board_settings.py). Accepted over
    # USB serial only; the device answers BOARD_SETTINGS_RESULT, then a fresh HELLO on success.
    "SET_BOARD_SETTINGS": 14,
    "BOARD_SETTINGS_RESULT": 15,
    # Added 2026-10-07 (flow dependencies, flow-dependencies-scoping.md). Editor -> device: one small
    # piece of one file of a library the next flow imports (deps.py), no reply; then DEP_COMMIT, which
    # the device answers with DEP_RESULT (ok, or an error naming the library). Pieces, not whole
    # libraries: one big message needs one big block of RAM, which a fragmented heap may not have.
    "DEP_PUT": 16,
    "DEP_RESULT": 17,
    "DEP_COMMIT": 18,
    # Added 2026-10-07 (Mike: manual soft and hard reset, suggested by the editor when memory is the
    # likely problem). Editor -> device: restart the board. hard False: soft reset (the interpreter only,
    # USB stays up); hard True: full chip reset (native-USB boards drop off the bus and come back). No
    # reply: the board's boot output and HELLO are the answer.
    "RESTART": 19,
}

MESSAGE_NAME_BY_TYPE = {v: k for k, v in MessageType.items()}

# NODE_STATUS's fixed state vocabulary -- the one enum this protocol
# validates by value, not just by field type. Shared with runtime.py's
# report_status() (the one legitimate caller) so the valid set is defined
# in exactly one place, not duplicated between "what's accepted on
# decode" and "what a caller is allowed to send".
NODE_STATUS_STATES = ("connected", "disconnected", "connecting", "error")


def message_type_id(message):
    return MessageType[message["type"]]


def encode_message_body(message):
    """Encode a message dict (must have a "type" key naming one of
    MessageType) to its CBOR body only -- no frame header, see
    framing.encode_frame.

    Any key whose value is None is dropped before encoding -- not just
    "type". This is the write-side half of _expect_optional_string's own
    "a missing key or an explicit None both mean 'not provided'" contract
    (this file, and codec.ts's expectOptionalString on the editor side):
    an optional field a caller doesn't have a value for (e.g. HELLO's
    runtimeBuild on a board with no _runtime_build.txt marker) should
    round-trip as "field absent," the same as an older sender that never
    knew the field existed at all. Required, not just tidy: cbor.py has no
    null/undefined support at all (its own header note -- "this
    protocol's optional fields are omitted from the map entirely, never
    encoded as CBOR null/undefined"), so passing an explicit None straight
    through to cbor.encode() would raise TypeError instead of encoding
    anything -- confirmed the hard way (2026-09-05): this file's own
    SAMPLE_MESSAGES round-trip fixture for HELLO's "board doesn't know its
    build" case used exactly this shape and failed exactly this way before
    this filter existed."""
    body = {k: v for k, v in message.items() if k != "type" and v is not None}
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


def _expect_optional_string(obj, key, name):
    """Same as _expect_string, but a missing key or an explicit None both
    mean "not provided" -- used for fields a board running an older
    runtime/listener simply never sends (runtimeBuild, HELLO)."""
    v = obj.get(key)
    if v is None:
        return None
    if not isinstance(v, str):
        _fail(name, 'field "%s" must be a string or absent/None, got %r' % (key, type(v)))
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


def _expect_optional_non_negative_int(obj, key, name):
    """Same "missing/None both mean not provided" convention as _expect_optional_string -- used for
    the ESP-IDF heap fields (HELLO, DEPLOY_ACK), which only ESP32-family boards send."""
    if obj.get(key) is None:
        return None
    return _expect_non_negative_int(obj, key, name)


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


def _expect_one_of(obj, key, name, allowed):
    v = _expect_string(obj, key, name)
    if v not in allowed:
        _fail(name, 'field "%s" must be one of %r, got %r' % (key, allowed, v))
    return v


def _expect_optional_bool(obj, key, name):
    """Same "missing/None both mean not provided" convention as _expect_optional_string -- used for
    wifiProvision's own two fields below, and for wifiProvision itself being absent (an editor
    predating this feature never sends it, same additive-field convention every DEPLOY field since
    flowName/deployId already follows)."""
    v = obj.get(key)
    if v is None:
        return None
    if not isinstance(v, bool):
        _fail(name, 'field "%s" must be a bool or absent/None, got %r' % (key, type(v)))
    return v


def _expect_optional_wifi_provision(obj, key, name):
    """DEPLOY's own optional `wifiProvision` field (added 2026-09-14, wifi-provisioning-captive-
    portal.md) -- {selfProvision, allowReprovision} or None/absent. Computed editor-side by
    wifi-status.ts's computeWifiProvisionMarker() from the flow's own wifi_status node config, not
    authored directly -- an old editor that predates this feature simply never sends the key, which
    must degrade to "this feature is not in play for this flow," not a MessageDecodeError, same
    additive-field convention flowName/deployId already established here."""
    v = obj.get(key)
    if v is None:
        return None
    if not isinstance(v, dict):
        _fail(name, 'field "%s" must be a map or absent/None, got %r' % (key, type(v)))
    return {
        "selfProvision": _expect_optional_bool(v, "selfProvision", name) or False,
        "allowReprovision": _expect_optional_bool(v, "allowReprovision", name) or False,
    }


def _expect_optional_string_map(obj, key, name):
    """{str: str} or absent/None (absent means {}) -- the dependency inventory (HELLO) and the
    dependencies a flow needs (DEPLOY). A sender predating flow dependencies never sends either."""
    v = obj.get(key)
    if v is None:
        return None
    if not isinstance(v, dict):
        _fail(name, 'field "%s" must be a map or absent/None, got %r' % (key, type(v)))
    out = {}
    for k, val in v.items():
        if not isinstance(k, str) or not isinstance(val, str):
            _fail(name, 'field "%s" must map strings to strings' % (key,))
        out[k] = val
    return out


def _validate_dep_put(obj, name):
    return {
        "name": _expect_string(obj, "name", name),
        "file": _expect_string(obj, "file", name),
        "offset": _expect_non_negative_int(obj, "offset", name),
        "total": _expect_non_negative_int(obj, "total", name),
        "data": _expect_bytes(obj, "data", name),
    }


def _validate_dep_commit(obj, name):
    # files: {file name: size in bytes}. A map, not a list: cbor.py deliberately supports no arrays.
    files = obj.get("files")
    if not isinstance(files, dict) or not files:
        _fail(name, 'field "files" must be a non-empty map of file name to size')
    out = {}
    for fname, size in files.items():
        if not isinstance(fname, str) or isinstance(size, bool) or not isinstance(size, int) or size < 0:
            _fail(name, 'field "files" must map file names to sizes (non-negative integers)')
        out[fname] = size
    return {"name": _expect_string(obj, "name", name), "hash": _expect_string(obj, "hash", name), "files": out}


def _validate_restart(obj, name):
    return {"hard": _expect_optional_bool(obj, "hard", name) or False}


def _validate_dep_result(obj, name):
    ok = _require_present(obj, "ok", name)
    if not isinstance(ok, bool):
        _fail(name, 'field "ok" must be a bool, got %r' % (type(ok),))
    return {
        "name": _expect_string(obj, "name", name),
        "ok": ok,
        "code": _expect_optional_string(obj, "code", name),
        "error": _expect_optional_string(obj, "error", name),
        "freeFlashBytes": _expect_optional_non_negative_int(obj, "freeFlashBytes", name),
    }


def _validate_hello(obj, name):
    return {
        "chipType": _expect_string(obj, "chipType", name),
        "runtimeVersion": _expect_version(obj, "runtimeVersion", name),
        "runtimeBuild": _expect_optional_string(obj, "runtimeBuild", name),
        # Flow identity, added 2026-09-05 -- see messages.ts's HelloMessage
        # doc comment for the full reasoning (Mike's own call: the stable,
        # human-editable flowName is what answers "is this the flow I have
        # open," not the per-deploy deployId; matching an opaque uuid
        # against flow files on disk "would be painful"). Both null means
        # no flow has successfully started this boot.
        "currentFlowName": _expect_optional_string(obj, "currentFlowName", name),
        "currentFlowDeployId": _expect_optional_string(obj, "currentFlowDeployId", name),
        "freeFlashBytes": _expect_non_negative_int(obj, "freeFlashBytes", name),
        "freeRamBytes": _expect_non_negative_int(obj, "freeRamBytes", name),
        # Added 2026-09-25: ESP-IDF's own heap, outside the MicroPython heap freeRamBytes counts. On
        # ESP32-family boards the WiFi stack allocates from here, so a low value explains a failed
        # WiFi join. Absent on other ports and on runtimes older than 5.1.0.
        "freeIdfHeapBytes": _expect_optional_non_negative_int(obj, "freeIdfHeapBytes", name),
        "largestIdfHeapBlockBytes": _expect_optional_non_negative_int(obj, "largestIdfHeapBlockBytes", name),
        # Added 2026-09-23: True when the listener skipped the saved flow after repeated failed
        # boots (listener.py's safe mode). Absent from older runtimes, meaning False.
        "safeMode": _expect_optional_bool(obj, "safeMode", name) or False,
        # Added 2026-09-24 (WiFi transport). All optional: a runtime older than 3.0.0 sends none of
        # them. hostname: the board's network name (board_settings.py). authRequired/authScheme:
        # the reserved one-way-door pair (transport-auth-design.md) -- true once a password is set,
        # which is also what turns the WiFi transport on. hasWifi: the firmware has network.WLAN.
        # networkAddress: the station IP while the WiFi transport is listening, else absent.
        "hostname": _expect_optional_string(obj, "hostname", name),
        "authRequired": _expect_optional_bool(obj, "authRequired", name) or False,
        "authScheme": _expect_optional_string(obj, "authScheme", name),
        "hasWifi": _expect_optional_bool(obj, "hasWifi", name) or False,
        "networkAddress": _expect_optional_string(obj, "networkAddress", name),
        # Added 2026-10-07 (flow dependencies): {name: hash} of the libraries installed for flows
        # (deps.py). Absent from runtimes older than 7.0.0, which hold every library in the root.
        "dependencies": _expect_optional_string_map(obj, "dependencies", name),
    }


def _validate_set_board_settings(obj, name):
    return {
        "hostname": _expect_optional_string(obj, "hostname", name),
        "password": _expect_optional_string(obj, "password", name),
        "clearPassword": _expect_optional_bool(obj, "clearPassword", name) or False,
    }


def _validate_board_settings_result(obj, name):
    ok = _require_present(obj, "ok", name)
    if not isinstance(ok, bool):
        _fail(name, 'field "ok" must be a bool, got %r' % (type(ok),))
    return {"ok": ok, "error": _expect_optional_string(obj, "error", name)}


def _validate_exec(obj, name):
    return {"code": _expect_string(obj, "code", name)}


def _validate_stop_to_prompt(obj, name):
    return {}


def _validate_deploy(obj, name):
    return {
        "bytecode": _expect_bytes(obj, "bytecode", name),
        "staticData": _expect_bytes(obj, "staticData", name),
        # Flow identity (see _validate_hello's own note just above) --
        # optional/nullable here specifically so an old editor that
        # predates this feature can still DEPLOY successfully against a
        # new device-runtime (missing key degrades to None, not a
        # MessageDecodeError), matching this file's own established
        # additive-field convention.
        "flowName": _expect_optional_string(obj, "flowName", name),
        "deployId": _expect_optional_string(obj, "deployId", name),
        # wifi_provision.py's own boot-time marker, same optional/additive
        # convention as flowName/deployId above -- see
        # _expect_optional_wifi_provision's own doc comment.
        "wifiProvision": _expect_optional_wifi_provision(obj, "wifiProvision", name),
        # Flow dependencies (2026-10-07): {name: hash} the flow imports. The listener checks every one
        # is installed before touching the running flow, and removes the rest after a good import.
        # Absent (an older editor): no check and nothing removed.
        "dependencies": _expect_optional_string_map(obj, "dependencies", name),
    }


def _validate_deploy_ack(obj, name):
    return {
        "freeFlashBytes": _expect_non_negative_int(obj, "freeFlashBytes", name),
        "freeRamBytes": _expect_non_negative_int(obj, "freeRamBytes", name),
        # Same optional ESP-IDF heap pair as HELLO (see _validate_hello).
        "freeIdfHeapBytes": _expect_optional_non_negative_int(obj, "freeIdfHeapBytes", name),
        "largestIdfHeapBlockBytes": _expect_optional_non_negative_int(obj, "largestIdfHeapBlockBytes", name),
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


def _validate_hello_request(obj, name):
    # No fields -- a pure signal. `obj`/`name` unused, but kept in the
    # signature so this matches every other validator's shape (_VALIDATORS
    # calls all of them the same way).
    return {}


def _validate_node_status(obj, name):
    fields = {
        "nodeId": _expect_string(obj, "nodeId", name),
        "state": _expect_one_of(obj, "state", name, NODE_STATUS_STATES),
    }
    text = _expect_optional_string(obj, "text", name)
    if text is not None:
        fields["text"] = text
    return fields


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
    "HELLO_REQUEST": _validate_hello_request,
    "NODE_STATUS": _validate_node_status,
    "EXEC": _validate_exec,
    "STOP_TO_PROMPT": _validate_stop_to_prompt,
    "SET_BOARD_SETTINGS": _validate_set_board_settings,
    "BOARD_SETTINGS_RESULT": _validate_board_settings_result,
    "DEP_PUT": _validate_dep_put,
    "DEP_RESULT": _validate_dep_result,
    "DEP_COMMIT": _validate_dep_commit,
    "RESTART": _validate_restart,
}
