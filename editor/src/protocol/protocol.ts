// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/protocol.ts
//
// Ties framing.ts (byte-level frame extraction) and codec.ts (CBOR <->
// typed Message) together into the shape a transport client actually
// wants: push in raw bytes as they arrive, get back decoded messages or
// recoverable per-frame/per-message errors. Deliberately no WebSerial (or
// any transport) plumbing here -- per this chat's briefing, scope is
// message types + framing + CBOR codec; the actual serial connection is
// Tier 3's "real editor shell" work (repo-structure-and-conventions.md
// lists a WebSerial transport client as belonging in this same
// editor/src/protocol/ directory once that's built).

import { decodeMessageBody, encodeMessageBody, messageTypeId, MessageDecodeError } from "./codec.js";
import { encodeFrame, FrameDecoder, FramingError } from "./framing.js";
import type { Message } from "./messages.js";

export { MessageDecodeError, FramingError };

export type ProtocolDecodeResult =
  | { readonly ok: true; readonly message: Message }
  | { readonly ok: false; readonly error: FramingError | MessageDecodeError };

/** Encode a typed message into one complete on-wire frame, ready to write to a transport. */
export function encodeMessage(message: Message): Uint8Array {
  return encodeFrame(messageTypeId(message), encodeMessageBody(message));
}

/**
 * Stateful stream decoder: feed it raw bytes as they arrive from any
 * transport, get back zero or more decode results per call, in arrival
 * order. A bad frame or a bad message body never throws out of `push()`
 * and never stalls decoding of whatever comes after it -- each result is
 * independent, matching the "never a hang or a crash" bar this whole
 * layer is built against.
 */
export class ProtocolStreamDecoder {
  #frames = new FrameDecoder();

  push(chunk: Uint8Array): ProtocolDecodeResult[] {
    return this.#frames.push(chunk).map((result): ProtocolDecodeResult => {
      if ("error" in result) return { ok: false, error: result.error };
      try {
        return { ok: true, message: decodeMessageBody(result.frame.type, result.frame.payload) };
      } catch (err) {
        if (err instanceof MessageDecodeError) return { ok: false, error: err };
        throw err; // an unexpected (non-protocol) error should NOT be swallowed as if it were adversarial input
      }
    });
  }

  /** See FrameDecoder.reset() -- drop any buffered, incomplete bytes. */
  reset(): void {
    this.#frames.reset();
  }

  /** Bytes buffered but not yet part of a complete frame. Diagnostic/test use. */
  get pendingByteCount(): number {
    return this.#frames.pendingByteCount;
  }
}
