// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/codec.ts
//
// CBOR encode/decode for each §13 message type, on top of the raw cborg
// codec (see docs/third-party-licenses.md for why cborg specifically).
// This is the layer that turns a typed Message (messages.ts) into, or
// out of, a CBOR-encoded body -- framing.ts owns the length-header/
// type-byte mechanics around that body and never looks inside it; this
// file never looks outside the body it's given.
//
// Strictness is deliberate, not cborg's defaults: the wire protocol's
// adversarial-input bar (docs/working-notes/validation/mvp-validation-
// plan.md, "Real wire protocol (§13)") is "every case should degrade to
// a logged, recoverable error, never a hang or a crash." cborg's strict-
// decode options (DECODE_OPTIONS below) are how that's enforced at the
// CBOR-syntax level; the per-message validate* functions below enforce
// it at the "valid CBOR, wrong shape" level, which cborg has no opinion
// on since it doesn't know about this protocol's message schemas.

import { decode, encode } from "cborg";
import { MessageDecodeError } from "./errors.js";
import {
  MESSAGE_NAME_BY_TYPE,
  MESSAGE_TYPE_BY_NAME,
  NODE_STATUS_STATES,
  type DeployAckMessage,
  type DeployErrorMessage,
  type DeployMessage,
  type HelloMessage,
  type HelloRequestMessage,
  type Message,
  type MessageTypeId,
  type NodeErrorMessage,
  type NodeStatusMessage,
  type ProtocolVersion,
  type StateReadMessage,
  type StateWriteMessage,
  type TriggerMessage,
  type ValueStreamMessage,
} from "./messages.js";

export { MessageDecodeError };

/**
 * cborg options chosen to reject exactly the ambiguous/non-canonical CBOR
 * forms this protocol has no legitimate use for (see cborg's own
 * "Deterministic encoding recommendations" docs for what each relaxes by
 * default): non-minimal int/length encodings, indefinite-length items,
 * duplicate map keys, NaN/Infinity, CBOR `undefined`, and integers
 * outside the safe-integer range (this protocol's numeric fields -- byte
 * counts, version numbers, timestamps -- never legitimately need a
 * BigInt; a message claiming one is malformed, not just unusual).
 */
const DECODE_OPTIONS = {
  strict: true,
  allowIndefinite: false,
  allowUndefined: false,
  allowNaN: false,
  allowInfinity: false,
  allowBigInt: false,
  rejectDuplicateMapKeys: true,
} as const;

/** Encode a typed message to its CBOR body only (no frame header -- see framing.encodeFrame). */
export function encodeMessageBody(message: Message): Uint8Array {
  const { type: _discriminant, ...body } = message;
  return encode(body);
}

export function messageTypeId(message: Message): MessageTypeId {
  return MESSAGE_TYPE_BY_NAME[message.type];
}

/**
 * Decode a CBOR body into a typed Message, given the frame's 1-byte
 * message type. Throws MessageDecodeError -- never anything else, and
 * never lets a raw cborg exception escape -- for: an unknown type byte,
 * CBOR that fails cborg's strict decode, or CBOR that decodes fine but
 * doesn't have the shape its declared type requires.
 */
export function decodeMessageBody(typeId: number, body: Uint8Array): Message {
  const name = MESSAGE_NAME_BY_TYPE[typeId as MessageTypeId];
  if (name === undefined) {
    throw new MessageDecodeError(`unknown message type byte: ${typeId}`);
  }

  let raw: unknown;
  try {
    raw = decode(body, DECODE_OPTIONS);
  } catch (err) {
    throw new MessageDecodeError(`malformed CBOR body for ${name}: ${(err as Error).message}`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MessageDecodeError(`${name} body must be a CBOR map, got ${Array.isArray(raw) ? "array" : typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;

  switch (name) {
    case "HELLO":
      return { type: "HELLO", ...validateHello(obj) };
    case "DEPLOY":
      return { type: "DEPLOY", ...validateDeploy(obj) };
    case "DEPLOY_ACK":
      return { type: "DEPLOY_ACK", ...validateDeployAck(obj) };
    case "DEPLOY_ERROR":
      return { type: "DEPLOY_ERROR", ...validateDeployError(obj) };
    case "VALUE_STREAM":
      return { type: "VALUE_STREAM", ...validateValueStream(obj) };
    case "NODE_ERROR":
      return { type: "NODE_ERROR", ...validateNodeError(obj) };
    case "NODE_STATUS":
      return { type: "NODE_STATUS", ...validateNodeStatus(obj) };
    case "STATE_READ":
      return { type: "STATE_READ", ...validateStateRead(obj) };
    case "STATE_WRITE":
      return { type: "STATE_WRITE", ...validateStateWrite(obj) };
    case "TRIGGER":
      return { type: "TRIGGER", ...validateTrigger(obj) };
    case "HELLO_REQUEST":
      return { type: "HELLO_REQUEST", ...validateHelloRequest(obj) };
  }
}

// -- per-field validators -----------------------------------------------

function fail(name: string, detail: string): never {
  throw new MessageDecodeError(`${name}: ${detail}`);
}

function expectString(obj: Record<string, unknown>, key: string, name: string): string {
  const v = obj[key];
  if (typeof v !== "string") fail(name, `field "${key}" must be a string, got ${typeof v}`);
  return v;
}

/** Same as expectString, but a missing key or an explicit null/undefined
 * both mean "not provided" -- used for fields a device running an older
 * listener simply never sends (runtimeBuild, HELLO). */
function expectOptionalString(obj: Record<string, unknown>, key: string, name: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(name, `field "${key}" must be a string or absent/null, got ${typeof v}`);
  return v;
}

/** Same "missing/null both mean not provided" convention as expectOptionalString -- used for
 * wifiProvision's own two fields below, and for wifiProvision itself being absent (mirrors
 * messages.py's _expect_optional_bool). */
function expectOptionalBool(obj: Record<string, unknown>, key: string, name: string): boolean | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "boolean") fail(name, `field "${key}" must be a bool or absent/null, got ${typeof v}`);
  return v;
}

/** DEPLOY's own optional `wifiProvision` field (messages.ts's DeployMessage doc comment; mirrors
 * messages.py's _expect_optional_wifi_provision) -- {selfProvision, allowReprovision} or null/absent. */
function expectOptionalWifiProvision(
  obj: Record<string, unknown>,
  key: string,
  name: string,
): { selfProvision: boolean; allowReprovision: boolean } | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) fail(name, `field "${key}" must be a map or absent/null, got ${typeof v}`);
  const inner = v as Record<string, unknown>;
  return {
    selfProvision: expectOptionalBool(inner, "selfProvision", name) ?? false,
    allowReprovision: expectOptionalBool(inner, "allowReprovision", name) ?? false,
  };
}

/** Same as expectString, but the value must also be one of `allowed` --
 * used for NODE_STATUS's fixed state enum (mirrors messages.py's
 * _expect_one_of). A device sending a state string outside this list is
 * malformed input, not a new state the editor should silently accept. */
function expectOneOf<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  name: string,
  allowed: readonly T[],
): T {
  const v = obj[key];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    fail(name, `field "${key}" must be one of ${JSON.stringify(allowed)}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}

function expectFiniteNumber(obj: Record<string, unknown>, key: string, name: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(name, `field "${key}" must be a finite number, got ${typeof v}`);
  }
  return v;
}

function expectNonNegativeInt(obj: Record<string, unknown>, key: string, name: string): number {
  const v = expectFiniteNumber(obj, key, name);
  if (!Number.isInteger(v) || v < 0) {
    fail(name, `field "${key}" must be a non-negative integer, got ${v}`);
  }
  return v;
}

function expectBytes(obj: Record<string, unknown>, key: string, name: string): Uint8Array {
  const v = obj[key];
  if (!(v instanceof Uint8Array)) fail(name, `field "${key}" must be a byte string, got ${typeof v}`);
  return v;
}

function expectVersion(obj: Record<string, unknown>, key: string, name: string): ProtocolVersion {
  const v = obj[key];
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    fail(name, `field "${key}" must be a version map with major/minor/patch`);
  }
  const rec = v as Record<string, unknown>;
  const scopedName = `${name}.${key}`;
  return {
    major: expectNonNegativeInt(rec, "major", scopedName),
    minor: expectNonNegativeInt(rec, "minor", scopedName),
    patch: expectNonNegativeInt(rec, "patch", scopedName),
  };
}

function requirePresent(obj: Record<string, unknown>, key: string, name: string): unknown {
  if (!(key in obj)) fail(name, `missing required field "${key}"`);
  return obj[key];
}

function validateHello(obj: Record<string, unknown>): Omit<HelloMessage, "type"> {
  return {
    chipType: expectString(obj, "chipType", "HELLO"),
    runtimeVersion: expectVersion(obj, "runtimeVersion", "HELLO"),
    runtimeBuild: expectOptionalString(obj, "runtimeBuild", "HELLO"),
    currentFlowName: expectOptionalString(obj, "currentFlowName", "HELLO"),
    currentFlowDeployId: expectOptionalString(obj, "currentFlowDeployId", "HELLO"),
    freeFlashBytes: expectNonNegativeInt(obj, "freeFlashBytes", "HELLO"),
    freeRamBytes: expectNonNegativeInt(obj, "freeRamBytes", "HELLO"),
  };
}

function validateDeploy(obj: Record<string, unknown>): Omit<DeployMessage, "type"> {
  return {
    bytecode: expectBytes(obj, "bytecode", "DEPLOY"),
    staticData: expectBytes(obj, "staticData", "DEPLOY"),
    flowName: expectOptionalString(obj, "flowName", "DEPLOY"),
    deployId: expectOptionalString(obj, "deployId", "DEPLOY"),
    wifiProvision: expectOptionalWifiProvision(obj, "wifiProvision", "DEPLOY"),
  };
}

function validateDeployAck(obj: Record<string, unknown>): Omit<DeployAckMessage, "type"> {
  return {
    freeFlashBytes: expectNonNegativeInt(obj, "freeFlashBytes", "DEPLOY_ACK"),
    freeRamBytes: expectNonNegativeInt(obj, "freeRamBytes", "DEPLOY_ACK"),
  };
}

function validateDeployError(obj: Record<string, unknown>): Omit<DeployErrorMessage, "type"> {
  return {
    code: expectString(obj, "code", "DEPLOY_ERROR"),
    message: expectString(obj, "message", "DEPLOY_ERROR"),
  };
}

function validateValueStream(obj: Record<string, unknown>): Omit<ValueStreamMessage, "type"> {
  return {
    nodeId: expectString(obj, "nodeId", "VALUE_STREAM"),
    portId: expectString(obj, "portId", "VALUE_STREAM"),
    payload: requirePresent(obj, "payload", "VALUE_STREAM"),
    timestampMs: expectNonNegativeInt(obj, "timestampMs", "VALUE_STREAM"),
  };
}

function validateNodeError(obj: Record<string, unknown>): Omit<NodeErrorMessage, "type"> {
  return {
    nodeId: expectString(obj, "nodeId", "NODE_ERROR"),
    exceptionType: expectString(obj, "exceptionType", "NODE_ERROR"),
    exceptionMessage: expectString(obj, "exceptionMessage", "NODE_ERROR"),
  };
}

/** `text` is present-only-when-provided, not present-but-null -- same
 * convention validateStateRead uses for its own optional `value` key,
 * and matches messages.py's _validate_node_status exactly (it only sets
 * the "text" dict key when the field was given). */
function validateNodeStatus(obj: Record<string, unknown>): Omit<NodeStatusMessage, "type"> {
  const nodeId = expectString(obj, "nodeId", "NODE_STATUS");
  const state = expectOneOf(obj, "state", "NODE_STATUS", NODE_STATUS_STATES);
  const text = expectOptionalString(obj, "text", "NODE_STATUS");
  return text === null ? { nodeId, state } : { nodeId, state, text };
}

function validateStateRead(obj: Record<string, unknown>): Omit<StateReadMessage, "type"> {
  const nodeId = expectString(obj, "nodeId", "STATE_READ");
  const key = expectString(obj, "key", "STATE_READ");
  return "value" in obj ? { nodeId, key, value: obj.value } : { nodeId, key };
}

function validateStateWrite(obj: Record<string, unknown>): Omit<StateWriteMessage, "type"> {
  return {
    nodeId: expectString(obj, "nodeId", "STATE_WRITE"),
    key: expectString(obj, "key", "STATE_WRITE"),
    value: requirePresent(obj, "value", "STATE_WRITE"),
  };
}

function validateTrigger(obj: Record<string, unknown>): Omit<TriggerMessage, "type"> {
  return {
    nodeId: expectString(obj, "nodeId", "TRIGGER"),
  };
}

/** No fields to validate -- HELLO_REQUEST is a pure signal (messages.ts's
 * own doc comment). `obj` is accepted but ignored: an editor sending
 * extra/unexpected keys here isn't this layer's problem to reject. */
function validateHelloRequest(_obj: Record<string, unknown>): Omit<HelloRequestMessage, "type"> {
  return {};
}
