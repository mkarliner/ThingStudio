// CBOR round-trip for every §13 message type, per the validation plan's
// Tier 0 bar (docs/working-notes/validation/mvp-validation-plan.md, "Real
// wire protocol (§13)"): "CBOR encode/decode round-trip for every message
// type... off-device." Also covers codec.ts's "valid CBOR, wrong shape"
// rejection path, which is this layer's half of the adversarial bar (byte-
// level adversarial framing is framing.adversarial.test.ts's job).

import { describe, expect, it } from "vitest";
import { decode as cborDecode, encode as cborEncode } from "cborg";
import { decodeMessageBody, encodeMessageBody, MessageDecodeError } from "../src/protocol/codec.js";
import { encodeMessage, ProtocolStreamDecoder } from "../src/protocol/protocol.js";
import { MessageType, type Message } from "../src/protocol/messages.js";

const SAMPLE_MESSAGES: Message[] = [
  {
    type: "HELLO",
    chipType: "ESP32-C3",
    runtimeVersion: { major: 1, minor: 2, patch: 3 },
    runtimeBuild: null, // board predates the runtime-build marker, or deploy_runtime.py couldn't determine git info
    // Flow identity (added 2026-09-05, same "board doesn't know" shape as
    // runtimeBuild's own null case): no flow has successfully started
    // this boot.
    currentFlowName: null,
    currentFlowDeployId: null,
    freeFlashBytes: 3_500_000,
    freeRamBytes: 168_000,
    safeMode: false,
    hostname: null,
    authRequired: false,
    authScheme: null,
    hasWifi: false,
    networkAddress: null,
  },
  {
    // Same message type, second variant: a board that DOES have a runtime-build
    // SHA, covering checkRuntimeBuild's non-null path through the actual wire
    // codec, not just its own unit tests below. Also has a currently-running,
    // named flow.
    type: "HELLO",
    chipType: "Raspberry Pi Pico W with RP2040",
    runtimeVersion: { major: 0, minor: 1, patch: 0 },
    runtimeBuild: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    currentFlowName: "basic mqtt smoke test",
    currentFlowDeployId: "6f1c9b2a-8e3d-4a5b-9c1e-2d3f4a5b6c7d",
    freeFlashBytes: 757_760,
    freeRamBytes: 179_200,
    safeMode: true, // board in boot-loop safe mode (2026-09-23)
    // WiFi transport fields (2026-09-24): a board with a password set, listening.
    hostname: "ts-kitchen",
    authRequired: true,
    authScheme: "hmac-sha256-nonce",
    hasWifi: true,
    networkAddress: "192.168.1.42",
  },
  // SET_BOARD_SETTINGS/BOARD_SETTINGS_RESULT (2026-09-24, WiFi transport).
  { type: "SET_BOARD_SETTINGS", hostname: "ts-kitchen", password: "correct horse", clearPassword: false },
  { type: "SET_BOARD_SETTINGS", hostname: null, password: null, clearPassword: true },
  { type: "BOARD_SETTINGS_RESULT", ok: true, error: null },
  { type: "BOARD_SETTINGS_RESULT", ok: false, error: "password must be 8-64 characters" },
  {
    type: "DEPLOY",
    bytecode: new Uint8Array([0x4d, 0x06, 0x00, 0x01, 0x02, 0x03]),
    staticData: new Uint8Array([]),
    // Flow identity (added 2026-09-05): an old editor that predates this
    // feature simply doesn't send these -- null here exercises exactly
    // that degrade, not just the happy path.
    flowName: null,
    deployId: null,
    // wifiProvision (added 2026-09-14, wifi-provisioning-captive-portal.md): same "an old editor
    // simply doesn't send this" degrade as flowName/deployId just above.
    wifiProvision: null,
  },
  {
    // Second DEPLOY variant: a current editor, which always has a name
    // (flow-file.ts's DEFAULT_FLOW_NAME at worst) and always generates a
    // fresh deployId per Deploy click.
    type: "DEPLOY",
    bytecode: new Uint8Array([0x4d, 0x06, 0x00, 0x04, 0x05, 0x06]),
    staticData: new Uint8Array([1, 2, 3]),
    flowName: "untitled flow",
    deployId: "9d8c7b6a-5e4f-3d2c-1b0a-f9e8d7c6b5a4",
    // wifiProvision's happy path (see above for the null/"absent" case): a flow whose WiFi config is
    // "unmanaged" with the reprovisioning fallback left off, the default this feature ships with
    // (wifi-provisioning-captive-portal.md's confirmed trigger semantics).
    wifiProvision: { selfProvision: true, allowReprovision: false },
  },
  { type: "DEPLOY_ACK", freeFlashBytes: 3_400_000, freeRamBytes: 160_000 },
  { type: "DEPLOY_ERROR", code: "insufficient_space", message: "flow needs 12000 bytes flash, 8000 available" },
  { type: "VALUE_STREAM", nodeId: "n3", portId: "out0", payload: true, timestampMs: 1_723_000_000_123 },
  { type: "VALUE_STREAM", nodeId: "n4", portId: "out0", payload: 3.14, timestampMs: 1 },
  { type: "VALUE_STREAM", nodeId: "n5", portId: "out0", payload: "hello", timestampMs: 1 },
  { type: "VALUE_STREAM", nodeId: "n6", portId: "out0", payload: new Uint8Array([1, 2, 3]), timestampMs: 1 },
  { type: "NODE_ERROR", nodeId: "n7", exceptionType: "ZeroDivisionError", exceptionMessage: "division by zero" },
  // NODE_STATUS added 2026-09-10 (connection-status-indicator feature).
  // Two variants: text present (wifi_status's IP-address detail) and
  // text absent (a node type with nothing supplementary to say) --
  // exercises validateNodeStatus's "present-only-when-provided" branch
  // both ways, same convention as STATE_READ's request/response pair.
  { type: "NODE_STATUS", nodeId: "n10", state: "connected", text: "192.168.1.42" },
  { type: "NODE_STATUS", nodeId: "n11", state: "disconnected" },
  { type: "STATE_READ", nodeId: "n8", key: "counter" }, // request form: no value
  { type: "STATE_READ", nodeId: "n8", key: "counter", value: 42 }, // response form: value present
  { type: "STATE_WRITE", nodeId: "n8", key: "counter", value: 0 },
  // TRIGGER added 2026-09-02 (inject click-only live-fire feature).
  { type: "TRIGGER", nodeId: "n9" },
  // HELLO_REQUEST added 2026-09-05 (no reset button on the Pico W) -- no
  // fields at all, the minimal possible message shape.
  { type: "HELLO_REQUEST" },
  // EXEC / STOP_TO_PROMPT added 2026-09-23 (console command box, stop to prompt).
  { type: "EXEC", code: "import machine; machine.Pin(15).value()" },
  { type: "STOP_TO_PROMPT" },
];

describe("message CBOR round-trip (codec.ts, per message type)", () => {
  for (const original of SAMPLE_MESSAGES) {
    it(`round-trips ${original.type} (${JSON.stringify(Object.keys(original))})`, () => {
      const body = encodeMessageBody(original);
      const typeId = MessageType[original.type];
      const decoded = decodeMessageBody(typeId, body);
      expect(decoded).toEqual(original);
    });
  }

  it("round-trips through the full frame (protocol.ts: encodeMessage + ProtocolStreamDecoder)", () => {
    const decoder = new ProtocolStreamDecoder();
    for (const original of SAMPLE_MESSAGES) {
      const frame = encodeMessage(original);
      const results = decoder.push(frame);
      expect(results).toHaveLength(1);
      const [result] = results;
      if (!result || !result.ok) throw new Error(`expected ok decode for ${original.type}, got ${JSON.stringify(result)}`);
      expect(result.message).toEqual(original);
    }
  });

  it("bytes fields round-trip as native CBOR byte strings, not base64 text", () => {
    const msg: Message = {
      type: "DEPLOY",
      bytecode: new Uint8Array([9, 9, 9]),
      staticData: new Uint8Array([1]),
      flowName: null,
      deployId: null,
      wifiProvision: null,
    };
    const body = encodeMessageBody(msg);
    const raw = cborDecode(body) as { bytecode: unknown };
    expect(raw.bytecode).toBeInstanceOf(Uint8Array);
  });

  // Confirmed the hard way on real hardware, 2026-09-14 (codec.ts's own
  // encodeMessageBody header has the full story): a null-valued field
  // reaching the device crashes its hand-rolled cbor.py decoder
  // (CBORDecodeError, "unsupported CBOR simple/float value") -- cborg
  // itself decodes its own CBOR null just fine, so the plain round-trip
  // tests above (encode with cborg, decode with cborg) can never catch
  // this; only inspecting the raw decoded structure for an actual CBOR
  // null value proves the on-wire body has none, which is the real
  // constraint the device's decoder requires. Recurses (not just a
  // top-level check) since wifiProvision is itself a nested map -- a
  // structural check, not a raw-byte scan for 0xf6, since bytecode/
  // staticData are arbitrary binary and could coincidentally contain
  // that byte as data, not as a CBOR null marker. Every null-valued
  // sample message above is exercised here, not just DEPLOY's own
  // fields.
  function containsCborNull(value: unknown): boolean {
    if (value === null) return true;
    if (Array.isArray(value)) return value.some(containsCborNull);
    if (value instanceof Uint8Array) return false;
    if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(containsCborNull);
    return false;
  }

  it("never encodes a CBOR null for a null-valued optional field (device's cbor.py can't decode one)", () => {
    for (const original of SAMPLE_MESSAGES) {
      const body = encodeMessageBody(original);
      const raw = cborDecode(body);
      expect(containsCborNull(raw)).toBe(false);
    }
  });
});

describe("codec.ts rejects valid CBOR with the wrong shape (per message type)", () => {
  it("rejects an unknown message type byte", () => {
    const body = cborEncode({});
    expect(() => decodeMessageBody(99, body)).toThrow(MessageDecodeError);
  });

  it("rejects a body that isn't a CBOR map (e.g. an array) for every message type", () => {
    const body = cborEncode([1, 2, 3]);
    for (const typeId of Object.values(MessageType)) {
      expect(() => decodeMessageBody(typeId, body)).toThrow(MessageDecodeError);
    }
  });

  it("rejects HELLO missing a required field", () => {
    const body = cborEncode({ chipType: "ESP32-C3", freeFlashBytes: 1, freeRamBytes: 1 }); // no runtimeVersion
    expect(() => decodeMessageBody(MessageType.HELLO, body)).toThrow(MessageDecodeError);
  });

  it("rejects HELLO with a wrong-typed field", () => {
    const body = cborEncode({
      chipType: "ESP32-C3",
      runtimeVersion: { major: 1, minor: 0, patch: 0 },
      freeFlashBytes: "not a number",
      freeRamBytes: 1,
    });
    expect(() => decodeMessageBody(MessageType.HELLO, body)).toThrow(MessageDecodeError);
  });

  it("rejects HELLO with a negative byte count", () => {
    const body = cborEncode({
      chipType: "ESP32-C3",
      runtimeVersion: { major: 1, minor: 0, patch: 0 },
      freeFlashBytes: -1,
      freeRamBytes: 1,
    });
    expect(() => decodeMessageBody(MessageType.HELLO, body)).toThrow(MessageDecodeError);
  });

  it("rejects a malformed runtimeVersion (not a major/minor/patch map)", () => {
    const body = cborEncode({ chipType: "x", runtimeVersion: "1.2.3", freeFlashBytes: 1, freeRamBytes: 1 });
    expect(() => decodeMessageBody(MessageType.HELLO, body)).toThrow(MessageDecodeError);
  });

  it("rejects HELLO with a non-string, non-null runtimeBuild", () => {
    const body = cborEncode({
      chipType: "x",
      runtimeVersion: { major: 1, minor: 0, patch: 0 },
      runtimeBuild: 123,
      freeFlashBytes: 1,
      freeRamBytes: 1,
    });
    expect(() => decodeMessageBody(MessageType.HELLO, body)).toThrow(MessageDecodeError);
  });

  it("accepts HELLO with runtimeBuild entirely absent (older-listener case)", () => {
    const body = cborEncode({
      chipType: "x",
      runtimeVersion: { major: 1, minor: 0, patch: 0 },
      freeFlashBytes: 1,
      freeRamBytes: 1,
    });
    const decoded = decodeMessageBody(MessageType.HELLO, body);
    expect((decoded as { runtimeBuild: unknown }).runtimeBuild).toBeNull();
  });

  it("rejects HELLO with a non-string currentFlowName or currentFlowDeployId", () => {
    const base = { chipType: "x", runtimeVersion: { major: 1, minor: 0, patch: 0 }, freeFlashBytes: 1, freeRamBytes: 1 };
    for (const badField of ["currentFlowName", "currentFlowDeployId"] as const) {
      const body = cborEncode({ ...base, [badField]: 123 });
      expect(() => decodeMessageBody(MessageType.HELLO, body)).toThrow(MessageDecodeError);
    }
  });

  it("accepts HELLO with currentFlowName/currentFlowDeployId entirely absent (no flow running)", () => {
    const body = cborEncode({
      chipType: "x",
      runtimeVersion: { major: 1, minor: 0, patch: 0 },
      freeFlashBytes: 1,
      freeRamBytes: 1,
    });
    const decoded = decodeMessageBody(MessageType.HELLO, body);
    expect((decoded as { currentFlowName: unknown }).currentFlowName).toBeNull();
    expect((decoded as { currentFlowDeployId: unknown }).currentFlowDeployId).toBeNull();
  });

  it("rejects DEPLOY with a non-string flowName or deployId", () => {
    const base = { bytecode: new Uint8Array([0]), staticData: new Uint8Array([]) };
    for (const badField of ["flowName", "deployId"] as const) {
      const body = cborEncode({ ...base, [badField]: 123 });
      expect(() => decodeMessageBody(MessageType.DEPLOY, body)).toThrow(MessageDecodeError);
    }
  });

  it("accepts DEPLOY with flowName/deployId entirely absent (older-editor case)", () => {
    const body = cborEncode({ bytecode: new Uint8Array([1, 2]), staticData: new Uint8Array([]) });
    const decoded = decodeMessageBody(MessageType.DEPLOY, body);
    expect((decoded as { flowName: unknown }).flowName).toBeNull();
    expect((decoded as { deployId: unknown }).deployId).toBeNull();
  });

  it("accepts DEPLOY with wifiProvision entirely absent (older-editor case)", () => {
    const body = cborEncode({ bytecode: new Uint8Array([1, 2]), staticData: new Uint8Array([]) });
    const decoded = decodeMessageBody(MessageType.DEPLOY, body);
    expect((decoded as { wifiProvision: unknown }).wifiProvision).toBeNull();
  });

  it("defaults wifiProvision's own two fields to false when absent inside a present map", () => {
    const body = cborEncode({ bytecode: new Uint8Array([1, 2]), staticData: new Uint8Array([]), wifiProvision: {} });
    const decoded = decodeMessageBody(MessageType.DEPLOY, body) as { wifiProvision: { selfProvision: boolean; allowReprovision: boolean } };
    expect(decoded.wifiProvision).toEqual({ selfProvision: false, allowReprovision: false });
  });

  it("rejects DEPLOY with a non-map wifiProvision", () => {
    const body = cborEncode({ bytecode: new Uint8Array([1, 2]), staticData: new Uint8Array([]), wifiProvision: "unmanaged" });
    expect(() => decodeMessageBody(MessageType.DEPLOY, body)).toThrow(MessageDecodeError);
  });

  it("rejects DEPLOY with a non-bytes field", () => {
    const body = cborEncode({ bytecode: "not bytes", staticData: new Uint8Array([]) });
    expect(() => decodeMessageBody(MessageType.DEPLOY, body)).toThrow(MessageDecodeError);
  });

  it("rejects STATE_WRITE missing its required value", () => {
    const body = cborEncode({ nodeId: "n1", key: "x" });
    expect(() => decodeMessageBody(MessageType.STATE_WRITE, body)).toThrow(MessageDecodeError);
  });

  it("rejects TRIGGER missing its required nodeId", () => {
    const body = cborEncode({});
    expect(() => decodeMessageBody(MessageType.TRIGGER, body)).toThrow(MessageDecodeError);
  });

  it("rejects TRIGGER with a wrong-typed nodeId", () => {
    const body = cborEncode({ nodeId: 42 });
    expect(() => decodeMessageBody(MessageType.TRIGGER, body)).toThrow(MessageDecodeError);
  });

  it("rejects truncated/garbage CBOR bytes outright", () => {
    const garbage = new Uint8Array([0xff, 0x00, 0x9f, 0x9f, 0x9f]);
    expect(() => decodeMessageBody(MessageType.HELLO, garbage)).toThrow(MessageDecodeError);
  });

  it("rejects an empty body for every message type", () => {
    const body = new Uint8Array([]);
    for (const typeId of Object.values(MessageType)) {
      expect(() => decodeMessageBody(typeId, body)).toThrow(MessageDecodeError);
    }
  });

  it("codec.ts's chosen decode options actually reject non-minimal integer encoding (strict mode)", () => {
    // Hand-built CBOR for {"a": 1}, but with the value 1 written as a 4-byte
    // uint (0x1a-prefixed) instead of its 1-byte minimal form (0x01) --
    // cborg's encoder never produces this itself (it always emits minimal
    // forms), so this has to be a raw fixture to exercise the rejection.
    const nonMinimalFixture = new Uint8Array([0xa1, 0x61, 0x61, 0x1a, 0x00, 0x00, 0x00, 0x01]);
    expect(() => cborDecode(nonMinimalFixture, { strict: false })).not.toThrow(); // permissive mode: fine
    expect(() => cborDecode(nonMinimalFixture, { strict: true })).toThrow(); // codec.ts's actual setting: rejected
  });
});
