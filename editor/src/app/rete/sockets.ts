// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/sockets.ts
//
// §6 wire-type system, real implementation
// (docs/working-notes/wire-type-system-scoping.md, "Coercion matrix" and
// "Governing call" sections -- read that note before touching this file,
// the rule set below is transcribed from its resolved matrix, not
// re-derived here). Supersedes sub-decision 3's placeholder (rete-
// migration-decision.md): AnySocket was deliberately the one-and-only
// socket class then, "preserve current behavior exactly" until this task
// landed. That task is this file now.
//
// Six socket classes, one per docs/thingstudio-design-doc.md §6's fixed
// payload type set (`int`/`number`/`bool`/`string`/`bytes`/`any`), each
// with a real (not always-true) `isCompatibleWith`. `target.isCompatibleWith
// (source)` is the call validation.ts makes -- the *target* (input) socket
// decides what it accepts, so every isCompatibleWith below is read as
// "can I, the target, accept a wire from this source class". The three
// buckets from the scoping note, restated here as the actual rule each
// class implements:
//
//   1. Truthiness into `bool` -- allow, unconditionally, from every
//      source, including `any`. Python's `bool(x)` is total (never
//      raises) and this is already what gpio_out's codegen does
//      (`1 if msg.get('payload') else 0`) regardless of the feeding
//      type -- BoolSocket.isCompatibleWith adds no friction to something
//      already hardware-proven.
//   2. Numeric widening -- `int -> number` allowed (can't fail or lose
//      information); `number -> int` refused (silent truncation, a
//      quiet-wrong-answer case worth keeping refused); `string ->
//      number`/`int` allowed but can fail at runtime (reported via
//      NODE_ERROR, §5 -- not a wire-connect-time concern).
//   3. Ambiguous/format conversions -- refused, explicit conversion node
//      required (not built this session, scoping note question 4):
//      `bytes` <-> `string` (encoding is a real decision), and `any` into
//      any concrete non-bool type (genuinely ambiguous for an
//      arbitrary-typed value, unlike total `bool(x)`).
//
// `X -> X` (same type) and `anything -> any` are both unconditionally
// allowed identities, handled per-class below rather than factored into a
// shared base -- six small, independently-readable classes matching the
// coercion-matrix table's six rows/columns beats one clever generic
// dispatcher here, same "explicit over clever" bias the rest of this
// project's codegen already follows.

import { ClassicPreset } from "rete";
import type { PayloadType } from "../../compiler/node-definition.js";

export interface ThingstudioSocket extends ClassicPreset.Socket {
  isCompatibleWith(socket: ClassicPreset.Socket): boolean;
}

export class BoolSocket extends ClassicPreset.Socket implements ThingstudioSocket {
  constructor() {
    super("bool");
  }
  // Bucket 1: truthiness is total and safe from every source type,
  // concrete or `any` -- see wire-type-system-scoping.md's self-correction
  // (an earlier draft's blanket "any -> anything typed: refuse" wrongly
  // caught this case too; fixed there, and never reintroduced here).
  isCompatibleWith(): boolean {
    return true;
  }
}

export class NumberSocket extends ClassicPreset.Socket implements ThingstudioSocket {
  constructor() {
    super("number");
  }
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    return (
      socket instanceof NumberSocket || // identity
      socket instanceof IntSocket || // bucket 2: widening, never fails
      socket instanceof StringSocket // bucket 2: allowed, can fail at runtime (NODE_ERROR)
    );
  }
}

export class IntSocket extends ClassicPreset.Socket implements ThingstudioSocket {
  constructor() {
    super("int");
  }
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    // number -> int deliberately excluded: narrowing truncates silently
    // (int(3.7) -> 3, no error) -- bucket 2's one refused case.
    return (
      socket instanceof IntSocket || // identity
      socket instanceof StringSocket // bucket 2: allowed, can fail at runtime (NODE_ERROR)
    );
  }
}

export class StringSocket extends ClassicPreset.Socket implements ThingstudioSocket {
  constructor() {
    super("string");
  }
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    // Identity only. Numeric-to-string and bytes<->string are both
    // outside the matrix's allowed set (the latter is bucket 3,
    // explicitly refused -- encoding is a real decision, needs a
    // conversion node this session doesn't build).
    return socket instanceof StringSocket;
  }
}

export class BytesSocket extends ClassicPreset.Socket implements ThingstudioSocket {
  constructor() {
    super("bytes");
  }
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    // Identity, plus `any -> bytes` (added 2026-09-17 -- self-correction
    // matching the `any -> bool` fix this same file's header already
    // documents): bucket 3's blanket "any into any concrete non-bool
    // type: refuse" was written when no bytes-typed *input* existed
    // anywhere on the canvas (archive/wire-type-system-scoping.md's
    // "Former open questions" #4 explicitly deferred this "until a real
    // node with a bytes/string-typed port that actually needs one gets
    // added"). That node exists now -- display_spi/display_i2c's "frame"
    // input, the only two bytes-typed inputs in the entire node library
    // (grep-confirmed) -- and the refusal's own stated reason ("genuinely
    // ambiguous or can fail for an arbitrary unknown-typed value")
    // doesn't actually hold for bytes the way it does for
    // number/int/string: there's no encoding decision buried in "is this
    // already bytes-shaped," unlike `bytes <-> string` (still refused
    // below, unchanged -- that IS a real encoding choice: utf-8, hex,
    // base64 all differ). A wrong-shaped value reaching
    // display_spi/display_i2c at runtime already gets a clear
    // ValueError (their own length check, NODE_ERROR-attributed via
    // §5's fault boundary) -- the same "fails later, not never" contract
    // already accepted for `string -> number`, not a new failure mode.
    // Caught for real, not just reasoned about: a hand-authored
    // `function -> display_spi` edge in a flow file silently failed to
    // connect on load (main.ts's connectNodes() returning false, logged
    // to the console but easy to miss) -- the exact "function -> a
    // bytes-typed sink" pattern the `any -> bool` fix's own comment
    // called "probably the single most common real pattern," just for
    // bytes instead of bool.
    return socket instanceof BytesSocket || socket instanceof AnySocket;
  }
}

export class AnySocket extends ClassicPreset.Socket implements ThingstudioSocket {
  constructor() {
    super("any");
  }
  // "anything -> any: allow" -- an `any` input has to accept everything,
  // matching function/debug's real inputs today (untyped by design, not
  // untyped for lack of a type system anymore).
  isCompatibleWith(): boolean {
    return true;
  }
}

/** One socket instance per §6 payload type -- the single place a `PayloadType`
 * string becomes a real socket class, shared by rete/nodes.ts (constructing
 * node ports from node-library `ports` declarations) and InjectNode's own
 * retyping mechanic (payloadType property -> output socket). */
export function socketForPayloadType(type: PayloadType): ThingstudioSocket {
  switch (type) {
    case "bool":
      return new BoolSocket();
    case "number":
      return new NumberSocket();
    case "int":
      return new IntSocket();
    case "string":
      return new StringSocket();
    case "bytes":
      return new BytesSocket();
    case "any":
      return new AnySocket();
  }
}
