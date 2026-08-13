// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/framing.ts
//
// §13's framing: "a 2-byte length header plus payload... kept identical
// across serial/BLE/WiFi so higher layers don't need to know which
// transport they're on -- with a 1-byte message type and a CBOR-encoded
// body." This file is deliberately unaware of message semantics -- it
// only knows "length, type byte, opaque payload bytes" -- which is what
// makes it transport-agnostic per that requirement. codec.ts is the
// layer that knows what the payload bytes actually mean.
//
// Two byte-layout decisions §13 leaves open, made explicit here since
// nothing forced them and the real device-side listener (a separate,
// future chat) will need to match them exactly:
//   - The 2-byte length is big-endian (network byte order -- the
//     conventional default for a wire protocol with no stated
//     preference).
//   - It counts the type byte plus CBOR body together, not itself --
//     i.e. length = 1 (type) + cborBodyLength. So the hard ceiling on
//     type+body combined is 0xffff (65535) bytes, whatever fits in a
//     uint16. That's a real, small limit inherited directly from §13's
//     own 2-byte-header sketch, not something this file invented or
//     silently worked around -- a DEPLOY payload larger than ~65KB
//     doesn't fit in one frame under the protocol as specified today.
//     Worth flagging in the validation plan Results rather than quietly
//     assuming it'll never matter.

import { FramingError } from "./errors.js";

export const FRAME_LENGTH_HEADER_BYTES = 2;
export const FRAME_TYPE_BYTES = 1;
/** Hard ceiling on (type byte + CBOR body) combined -- whatever fits in the 2-byte length header. */
export const MAX_FRAME_PAYLOAD_LENGTH = 0xffff;

export interface DecodedFrame {
  readonly type: number;
  readonly payload: Uint8Array;
}

export { FramingError };
export type FrameDecodeResult = { readonly frame: DecodedFrame } | { readonly error: FramingError };

/** Encode one complete frame: 2-byte big-endian length + 1-byte type + payload. */
export function encodeFrame(type: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(type) || type < 0 || type > 0xff) {
    throw new FramingError(`message type byte out of range (must be 0-255): ${type}`);
  }
  const frameLength = FRAME_TYPE_BYTES + payload.length;
  if (frameLength > MAX_FRAME_PAYLOAD_LENGTH) {
    throw new FramingError(
      `frame too large: type+body is ${frameLength} bytes, exceeds the 2-byte length header's ` +
        `${MAX_FRAME_PAYLOAD_LENGTH}-byte ceiling`,
    );
  }

  const frame = new Uint8Array(FRAME_LENGTH_HEADER_BYTES + frameLength);
  new DataView(frame.buffer).setUint16(0, frameLength, false);
  frame[FRAME_LENGTH_HEADER_BYTES] = type;
  frame.set(payload, FRAME_LENGTH_HEADER_BYTES + FRAME_TYPE_BYTES);
  return frame;
}

/**
 * Reassembles frames from an arbitrary stream of byte chunks -- handles
 * one frame split across multiple `push()` calls and multiple frames
 * arriving in a single `push()` call, the two adversarial cases the
 * validation plan calls out that a naive per-call parser gets wrong.
 * `push()` never throws and never blocks: a truncated frame just leaves
 * bytes buffered until more arrive (no hang -- this is an event-driven
 * accumulator, not a blocking read), and a bad frame becomes an
 * `{ error }` entry in the returned array rather than an exception, so
 * one malformed frame can't stop whatever's iterating a stream of these.
 *
 * Framing recovery is deliberately scoped to what a length-prefixed
 * protocol with no resync marker can actually guarantee. If the length
 * header itself is intact, a malformed *body* (garbage bytes, invalid
 * CBOR -- codec.ts's job to detect, not this file's) is isolated to that
 * one frame: byte-accounting here is driven entirely by the length
 * header, so the decoder still consumes exactly the bytes that frame
 * claims and resumes cleanly at the next one regardless of what codec.ts
 * later decides about its content. But if the length header itself is
 * corrupted, there's no way to tell where the next real frame boundary
 * is without a resync token, which §13 doesn't define -- that surfaces as
 * a FramingError and this decoder drops everything currently buffered
 * (see `#buffer = EMPTY` below), since holding onto bytes it can no
 * longer trust how to delimit isn't safe either. The caller (a future
 * transport layer) has to decide whether that warrants reconnecting.
 * Worth being honest that a byte-counting protocol without a checksum or
 * resync marker can't always recover from this case, rather than
 * pretending otherwise.
 */
export class FrameDecoder {
  #buffer = new Uint8Array(0);

  push(chunk: Uint8Array): FrameDecodeResult[] {
    this.#append(chunk);
    const results: FrameDecodeResult[] = [];

    for (;;) {
      if (this.#buffer.length < FRAME_LENGTH_HEADER_BYTES) break; // truncated: wait for more bytes

      const header = new DataView(this.#buffer.buffer, this.#buffer.byteOffset, this.#buffer.byteLength);
      const frameLength = header.getUint16(0, false);

      if (frameLength < FRAME_TYPE_BYTES) {
        results.push({
          error: new FramingError(
            `declared frame length ${frameLength} is shorter than the 1-byte type field -- length header is untrustworthy, dropping buffered bytes`,
          ),
        });
        this.reset();
        break;
      }

      const totalNeeded = FRAME_LENGTH_HEADER_BYTES + frameLength;
      if (this.#buffer.length < totalNeeded) break; // truncated: wait for more bytes

      const type = this.#buffer[FRAME_LENGTH_HEADER_BYTES]!;
      const payload = this.#buffer.slice(FRAME_LENGTH_HEADER_BYTES + FRAME_TYPE_BYTES, totalNeeded);
      results.push({ frame: { type, payload } });
      this.#buffer = this.#buffer.slice(totalNeeded);
    }

    return results;
  }

  /** Bytes buffered but not yet part of a complete frame. Diagnostic/test use, not part of the steady-state API. */
  get pendingByteCount(): number {
    return this.#buffer.length;
  }

  /**
   * Drop any buffered, not-yet-complete bytes. Exposed for a transport
   * layer to call after its own time-bound (e.g. "no complete frame in
   * N ms") -- the same "every blocking read must be time-bounded"
   * principle §5/the fault-isolation plan applies to the device-side
   * listener applies here too, just as a caller-driven safety valve
   * rather than an internal timer (this class has no clock of its own).
   */
  reset(): void {
    this.#buffer = new Uint8Array(0);
  }

  #append(chunk: Uint8Array): void {
    const combined = new Uint8Array(this.#buffer.length + chunk.length);
    combined.set(this.#buffer, 0);
    combined.set(chunk, this.#buffer.length);
    this.#buffer = combined;
  }
}
