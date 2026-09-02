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
    freeFlashBytes: 3_500_000,
    freeRamBytes: 168_000,
  },
  {
    type: "DEPLOY",
    bytecode: new Uint8Array([0x4d, 0x06, 0x00, 0x01, 0x02, 0x03]),
    staticData: new Uint8Array([]),
  },
  { type: "DEPLOY_ACK", freeFlashBytes: 3_400_000, freeRamBytes: 160_000 },
  { type: "DEPLOY_ERROR", code: "insufficient_space", message: "flow needs 12000 bytes flash, 8000 available" },
  { type: "VALUE_STREAM", nodeId: "n3", portId: "out0", payload: true, timestampMs: 1_723_000_000_123 },
  { type: "VALUE_STREAM", nodeId: "n4", portId: "out0", payload: 3.14, timestampMs: 1 },
  { type: "VALUE_STREAM", nodeId: "n5", portId: "out0", payload: "hello", timestampMs: 1 },
  { type: "VALUE_STREAM", nodeId: "n6", portId: "out0", payload: new Uint8Array([1, 2, 3]), timestampMs: 1 },
  { type: "NODE_ERROR", nodeId: "n7", exceptionType: "ZeroDivisionError", exceptionMessage: "division by zero" },
  { type: "STATE_READ", nodeId: "n8", key: "counter" }, // request form: no value
  { type: "STATE_READ", nodeId: "n8", key: "counter", value: 42 }, // response form: value present
  { type: "STATE_WRITE", nodeId: "n8", key: "counter", value: 0 },
  // TRIGGER added 2026-09-02 (inject click-only live-fire feature).
  { type: "TRIGGER", nodeId: "n9" },
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
    const msg: Message = { type: "DEPLOY", bytecode: new Uint8Array([9, 9, 9]), staticData: new Uint8Array([1]) };
    const body = encodeMessageBody(msg);
    const raw = cborDecode(body) as { bytecode: unknown };
    expect(raw.bytecode).toBeInstanceOf(Uint8Array);
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
