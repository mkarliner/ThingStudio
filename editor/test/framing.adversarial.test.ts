// Adversarial framing tests, per the validation plan's Tier 0 bar
// (docs/working-notes/validation/mvp-validation-plan.md, "Real wire
// protocol (§13)"): "truncated frames, oversized length headers, garbage
// bytes, one frame split across multiple reads, multiple frames in one
// read. Every case should degrade to a logged, recoverable error, never a
// hang or a crash." This tests framing.ts in isolation -- byte-level frame
// extraction only, no message-shape validation (that's codec.ts's job,
// covered in protocol.roundtrip.test.ts).

import { describe, expect, it } from "vitest";
import { encodeFrame, FrameDecoder, FramingError, FRAME_LENGTH_HEADER_BYTES, MAX_FRAME_PAYLOAD_LENGTH } from "../src/protocol/framing.js";

function isFrame(r: ReturnType<FrameDecoder["push"]>[number]): r is { frame: { type: number; payload: Uint8Array } } {
  return "frame" in r;
}
function isError(r: ReturnType<FrameDecoder["push"]>[number]): r is { error: FramingError } {
  return "error" in r;
}

describe("encodeFrame", () => {
  it("encodes a 2-byte big-endian length covering type+payload, then the type byte, then the payload", () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = encodeFrame(7, payload);
    expect(frame.length).toBe(2 + 1 + payload.length);
    expect(frame[0]).toBe(0); // length 4, big-endian high byte
    expect(frame[1]).toBe(4); // length 4, big-endian low byte
    expect(frame[2]).toBe(7); // type byte
    expect(Array.from(frame.slice(3))).toEqual([10, 20, 30]);
  });

  it("rejects a type byte outside 0-255", () => {
    expect(() => encodeFrame(256, new Uint8Array([]))).toThrow(FramingError);
    expect(() => encodeFrame(-1, new Uint8Array([]))).toThrow(FramingError);
  });

  it("rejects a payload that would make type+body exceed the 2-byte length header's ceiling", () => {
    const tooBig = new Uint8Array(MAX_FRAME_PAYLOAD_LENGTH); // +1 for the type byte pushes it over
    expect(() => encodeFrame(1, tooBig)).toThrow(FramingError);
  });

  it("accepts a payload right at the ceiling (type+body == MAX_FRAME_PAYLOAD_LENGTH)", () => {
    const atCeiling = new Uint8Array(MAX_FRAME_PAYLOAD_LENGTH - 1);
    expect(() => encodeFrame(1, atCeiling)).not.toThrow();
  });
});

describe("FrameDecoder: round-trip and basic framing", () => {
  it("decodes a single complete frame delivered in one push()", () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame(5, new Uint8Array([1, 2, 3]));
    const results = decoder.push(frame);
    expect(results).toHaveLength(1);
    const [r] = results;
    if (!r || !isFrame(r)) throw new Error("expected a frame");
    expect(r.frame.type).toBe(5);
    expect(Array.from(r.frame.payload)).toEqual([1, 2, 3]);
    expect(decoder.pendingByteCount).toBe(0);
  });

  it("multiple frames arriving in one read are all extracted, in order", () => {
    const decoder = new FrameDecoder();
    const f1 = encodeFrame(1, new Uint8Array([1]));
    const f2 = encodeFrame(2, new Uint8Array([2, 2]));
    const f3 = encodeFrame(3, new Uint8Array([]));
    const combined = new Uint8Array(f1.length + f2.length + f3.length);
    combined.set(f1, 0);
    combined.set(f2, f1.length);
    combined.set(f3, f1.length + f2.length);

    const results = decoder.push(combined);
    expect(results).toHaveLength(3);
    expect(results.every(isFrame)).toBe(true);
    const types = results.filter(isFrame).map((r) => r.frame.type);
    expect(types).toEqual([1, 2, 3]);
    expect(decoder.pendingByteCount).toBe(0);
  });

  it("one frame split across multiple reads is reassembled correctly", () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame(9, new Uint8Array([1, 2, 3, 4, 5]));

    // Feed it one byte at a time -- the hardest possible split.
    let results: ReturnType<FrameDecoder["push"]>[number][] = [];
    for (let i = 0; i < frame.length; i++) {
      const chunk = frame.slice(i, i + 1);
      const r = decoder.push(chunk);
      results = results.concat(r);
      if (i < frame.length - 1) {
        expect(r).toHaveLength(0); // nothing complete yet -- no premature/partial frame
      }
    }
    expect(results).toHaveLength(1);
    const [r] = results;
    if (!r || !isFrame(r)) throw new Error("expected a frame");
    expect(r.frame.type).toBe(9);
    expect(Array.from(r.frame.payload)).toEqual([1, 2, 3, 4, 5]);
  });

  it("truncated frame: waits for more bytes rather than emitting anything or hanging", () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame(1, new Uint8Array([1, 2, 3, 4, 5]));
    const truncated = frame.slice(0, frame.length - 2); // missing the last 2 payload bytes

    const results = decoder.push(truncated);
    expect(results).toHaveLength(0); // no frame, no error -- just pending
    expect(decoder.pendingByteCount).toBe(truncated.length);

    // completing the frame later should now succeed
    const rest = frame.slice(frame.length - 2);
    const results2 = decoder.push(rest);
    expect(results2).toHaveLength(1);
    expect(results2.some(isFrame)).toBe(true);
  });

  it("truncated length header itself (only 1 of 2 bytes delivered) waits, doesn't misparse", () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame(1, new Uint8Array([42]));
    const results = decoder.push(frame.slice(0, 1));
    expect(results).toHaveLength(0);
    expect(decoder.pendingByteCount).toBe(1);
  });

  it("empty push() is a no-op", () => {
    const decoder = new FrameDecoder();
    expect(decoder.push(new Uint8Array([]))).toHaveLength(0);
  });
});

describe("FrameDecoder: adversarial cases (never a hang or a crash)", () => {
  it("garbage bytes that happen to declare a plausible but wrong length don't crash -- they resolve once enough bytes arrive, content is opaque to framing", () => {
    const decoder = new FrameDecoder();
    // A random byte sequence which framing.ts will interpret as: length=0x1234
    // (a huge, "plausible" 2-byte value), then wait for that many bytes.
    // This is legitimate framing behavior (see framing.ts's own doc comment
    // on why byte-counting protocols without a resync marker can't always
    // tell "garbage" from "a frame that hasn't finished arriving yet") --
    // asserting it specifically so this behavior is a documented decision,
    // not an accident.
    const garbageHeader = new Uint8Array([0x12, 0x34, 0xde, 0xad, 0xbe, 0xef]);
    const results = decoder.push(garbageHeader);
    expect(results).toHaveLength(0); // waiting, not erroring -- length header looked structurally valid
    expect(decoder.pendingByteCount).toBe(garbageHeader.length);
  });

  it("a length header claiming fewer bytes than the 1-byte type field is rejected and buffered bytes are dropped", () => {
    const decoder = new FrameDecoder();
    // length = 0 is impossible (can't even hold the type byte)
    const bogus = new Uint8Array([0x00, 0x00, 0xff, 0xff, 0xff]);
    const results = decoder.push(bogus);
    expect(results).toHaveLength(1);
    const [r] = results;
    if (!r || !isError(r)) throw new Error("expected a FramingError");
    expect(r.error).toBeInstanceOf(FramingError);
    expect(decoder.pendingByteCount).toBe(0); // buffer dropped, not stuck forever

    // The decoder should still work normally afterward -- one bad frame
    // doesn't wedge it permanently.
    const goodFrame = encodeFrame(1, new Uint8Array([1, 2, 3]));
    const results2 = decoder.push(goodFrame);
    expect(results2).toHaveLength(1);
    expect(results2.some(isFrame)).toBe(true);
  });

  it("declared length right at the 2-byte header's ceiling (0xffff) doesn't throw or hang while waiting for the body", () => {
    const decoder = new FrameDecoder();
    const header = new Uint8Array([0xff, 0xff]); // length = 65535
    const results = decoder.push(header);
    expect(results).toHaveLength(0); // legitimately pending, not an error
    expect(decoder.pendingByteCount).toBe(2);
    decoder.reset(); // simulating a transport-layer timeout deciding to give up
    expect(decoder.pendingByteCount).toBe(0);
  });

  it("50 consecutive malformed frames in a row never crash or corrupt subsequent good frames (soak-style check)", () => {
    const decoder = new FrameDecoder();
    for (let i = 0; i < 50; i++) {
      const bogus = new Uint8Array([0x00, 0x00]); // length 0: always rejected
      const results = decoder.push(bogus);
      expect(results).toHaveLength(1);
      expect(results.some(isError)).toBe(true);
    }
    const goodFrame = encodeFrame(3, new Uint8Array([9, 9]));
    const results = decoder.push(goodFrame);
    expect(results).toHaveLength(1);
    expect(results.some(isFrame)).toBe(true);
  });

  it("interleaving a malformed frame between two good frames in the same read isolates the damage to just that frame", () => {
    const decoder = new FrameDecoder();
    const good1 = encodeFrame(1, new Uint8Array([1]));
    const badLengthHeader = new Uint8Array([0x00, 0x00]); // rejected outright, buffer dropped
    const good2 = encodeFrame(2, new Uint8Array([2]));

    // First chunk: good1 + bad header. The bad header causes the whole
    // buffer (including anything after it that arrived in the same push)
    // to be dropped, per framing.ts's documented "can't trust byte
    // accounting past a corrupted length header" limitation -- so good2 is
    // sent in a separate, later push() to confirm the decoder recovers for
    // frames that arrive *after* the bad one, not within the same corrupted
    // buffer.
    const combined = new Uint8Array(good1.length + badLengthHeader.length);
    combined.set(good1, 0);
    combined.set(badLengthHeader, good1.length);

    const results1 = decoder.push(combined);
    expect(results1.filter(isFrame).map((r) => r.frame.type)).toEqual([1]);
    expect(results1.some(isError)).toBe(true);

    const results2 = decoder.push(good2);
    expect(results2).toHaveLength(1);
    const [r2] = results2;
    if (!r2 || !isFrame(r2)) throw new Error("expected a frame");
    expect(r2.frame.type).toBe(2);
  });

  it("garbage payload bytes (not valid CBOR) are still framed correctly -- content validity is codec.ts's job, not framing.ts's", () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame(1, new Uint8Array([0xff, 0xff, 0xff, 0xff])); // not valid CBOR, but a well-formed frame
    const results = decoder.push(frame);
    expect(results).toHaveLength(1);
    expect(results.some(isFrame)).toBe(true); // framing succeeds; codec.ts would reject this payload, tested separately
  });
});

describe("FrameDecoder.reset()", () => {
  it("drops buffered bytes and lets the decoder start clean", () => {
    const decoder = new FrameDecoder();
    decoder.push(new Uint8Array([0x00, 0x05, 1, 2])); // partial frame, waiting
    expect(decoder.pendingByteCount).toBeGreaterThan(0);
    decoder.reset();
    expect(decoder.pendingByteCount).toBe(0);

    const frame = encodeFrame(1, new Uint8Array([7]));
    const results = decoder.push(frame);
    expect(results).toHaveLength(1);
    expect(results.some(isFrame)).toBe(true);
  });
});

// Sanity on the header layout constant used above.
describe("layout constants", () => {
  it("FRAME_LENGTH_HEADER_BYTES is 2, matching §13", () => {
    expect(FRAME_LENGTH_HEADER_BYTES).toBe(2);
  });
});
