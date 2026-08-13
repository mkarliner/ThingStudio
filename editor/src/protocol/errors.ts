// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/errors.ts
//
// Error types for the §13 wire protocol layer. Split into their own file
// for the same reason editor/src/compiler/errors.ts is: framing.ts,
// codec.ts, and protocol.ts all need to construct and catch these without
// a circular import between them.
//
// Both are deliberately *recoverable*-by-design errors, not exceptions
// meant to propagate and kill a connection -- see
// docs/working-notes/validation/mvp-validation-plan.md's "Real wire
// protocol (§13)" section: "Every case should degrade to a logged,
// recoverable error, never a hang or a crash." Callers (ProtocolStreamDecoder
// in protocol.ts) catch these per-frame/per-message, not per-connection.

/** A malformed frame: bad length header, or a declared length that can't be trusted (framing.ts). */
export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramingError";
  }
}

/** A frame that parsed fine but whose body is bad CBOR, or valid CBOR with the wrong shape for its declared message type (codec.ts). */
export class MessageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageDecodeError";
  }
}
