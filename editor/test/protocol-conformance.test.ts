// SPDX-License-Identifier: Apache-2.0
// editor/test/protocol-conformance.test.ts
//
// Runs the editor's wire codec against the shared, language-neutral
// specification in protocol/ (SPEC.md, messages.json, vectors/). This is
// the editor's side of the cross-implementation conformance check: the
// same vectors are run by device-runtime/test/test_conformance.py and
// backend/test/test_conformance.py, so the three implementations can't
// drift from each other without one of the three failing.
//
// Byte strings cross the JSON boundary as {"$bytes": "<hex>"}; see
// interfaces/protocol/README.md.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeMessageBody } from "../src/protocol/codec.js";
import { encodeMessage, ProtocolStreamDecoder } from "../src/protocol/protocol.js";
import { FrameDecoder } from "../src/protocol/framing.js";
import { MessageType, NODE_STATUS_STATES, type Message } from "../src/protocol/messages.js";

const PROTOCOL_DIR = new URL("../../interfaces/protocol/", import.meta.url);
function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(rel, PROTOCOL_DIR), "utf8")) as T;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(u8: Uint8Array): string {
  return Buffer.from(u8).toString("hex");
}
/** {"$bytes": hex} -> Uint8Array, recursively, matching interfaces/protocol/README.md. */
function fromJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromJson);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.$bytes === "string") return hexToBytes(o.$bytes);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) out[k] = fromJson(val);
    return out;
  }
  return v;
}

interface MessageVectors { vectors: { name: string; type: string; typeId: number; message: Record<string, unknown>; frameHex: string }[] }
interface FramingVectors { vectors: { name: string; chunks: string[]; expect: ({ frame: { type: number; bodyHex: string } } | { error: true })[] }[] }
interface InvalidVectors { vectors: { name: string; frameHex: string; errorAt: "framing" | "decode" }[] }

describe("wire protocol conformance (editor)", () => {
  const messagesJson = readJson<{ nodeStatusStates: string[]; messages: { id: number; name: string }[] }>("messages.json");
  const table = readJson<MessageVectors>("vectors/messages.json");
  const framing = readJson<FramingVectors>("vectors/framing.json");
  const invalid = readJson<InvalidVectors>("vectors/invalid.json");

  it("message type table matches the specification", () => {
    for (const { id, name } of messagesJson.messages) {
      expect(MessageType[name as keyof typeof MessageType], `type id for ${name}`).toBe(id);
    }
    expect(Object.keys(MessageType)).toHaveLength(messagesJson.messages.length);
  });

  it("NODE_STATUS state vocabulary matches the specification", () => {
    expect([...NODE_STATUS_STATES]).toEqual(messagesJson.nodeStatusStates);
  });

  it("every message vector encodes byte-identically and decodes back", () => {
    expect(table.vectors.length).toBeGreaterThan(0);
    for (const v of table.vectors) {
      const message = fromJson(v.message) as Message;
      expect(bytesToHex(encodeMessage(message)), `${v.name} encode`).toBe(v.frameHex);

      const frame = hexToBytes(v.frameHex);
      const typeId = frame[2]!;
      const body = frame.slice(3);
      expect(typeId, `${v.name} type byte`).toBe(v.typeId);
      expect(decodeMessageBody(typeId, body), `${v.name} decode`).toEqual(message);
    }
  });

  it("every framing vector reassembles as specified", () => {
    for (const v of framing.vectors) {
      const decoder = new FrameDecoder();
      const results = v.chunks.flatMap((c) => decoder.push(hexToBytes(c)));
      const actual = results.map((r) =>
        "error" in r ? { error: true } : { frame: { type: r.frame.type, bodyHex: bytesToHex(r.frame.payload) } },
      );
      expect(actual, v.name).toEqual(v.expect);
    }
  });

  it("every invalid vector is rejected at the specified stage", () => {
    for (const v of invalid.vectors) {
      const frame = hexToBytes(v.frameHex);
      if (v.errorAt === "framing") {
        const results = new FrameDecoder().push(frame);
        expect(results.some((r) => "error" in r), v.name).toBe(true);
      } else {
        const decoder = new ProtocolStreamDecoder();
        const results = decoder.push(frame);
        expect(results.length, v.name).toBeGreaterThan(0);
        expect(results.every((r) => !r.ok), v.name).toBe(true);
      }
    }
  });
});
