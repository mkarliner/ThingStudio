// SPDX-License-Identifier: Apache-2.0
// editor/test/sockets.test.ts
//
// Unit coverage for the §6 wire-type coercion matrix (app/rete/sockets.ts,
// docs/working-notes/archive/wire-type-system-scoping.md's "Resolved"
// table) -- pure data-model classes, no DOM/Rete-canvas instance needed
// (vitest's own `environment: "node"`, vite.config.ts), so this runs the
// real isCompatibleWith() methods directly rather than standing up an
// editor instance. No test file covered this before today; added
// alongside the `any -> bytes` self-correction below (sockets.ts's own
// header comment on BytesSocket has the full story) because that was
// found as a real bug -- a hand-authored `function -> display_spi`
// flow-file edge silently failing to connect on load -- not just
// reasoned into place, and per CLAUDE.md's own fault-handling priority a
// fix like that needs a real regression test, not just a comment.
//
// `compat()` below, not a direct `.isCompatibleWith()` call: BoolSocket
// and AnySocket both declare their override as a zero-arg
// `isCompatibleWith(): boolean` (they ignore the source entirely --
// unconditional `true`), which is a narrower signature than the
// `ThingstudioSocket` interface's `(socket: ClassicPreset.Socket):
// boolean` that every class satisfies structurally. Calling
// `.isCompatibleWith(x)` directly against a concrete `BoolSocket`/
// `AnySocket` instance is therefore a real `tsc` arity error (confirmed:
// "Expected 0 arguments, but got 1"), not a test-authoring nitpick --
// `compat()`'s own `target: ThingstudioSocket` parameter widens back to
// the interface's 1-arg signature, the same call shape
// validation.ts's real `canCreateConnection()` uses.

import { describe, expect, it } from "vitest";
import { AnySocket, BoolSocket, BytesSocket, IntSocket, NumberSocket, StringSocket } from "../src/app/rete/sockets.js";
import type { ThingstudioSocket } from "../src/app/rete/sockets.js";
import type { ClassicPreset } from "rete";

function compat(target: ThingstudioSocket, source: ClassicPreset.Socket): boolean {
  return target.isCompatibleWith(source);
}

describe("wire-type coercion matrix (sockets.ts)", () => {
  it("allows identity for every socket class", () => {
    expect(compat(new BoolSocket(), new BoolSocket())).toBe(true);
    expect(compat(new NumberSocket(), new NumberSocket())).toBe(true);
    expect(compat(new IntSocket(), new IntSocket())).toBe(true);
    expect(compat(new StringSocket(), new StringSocket())).toBe(true);
    expect(compat(new BytesSocket(), new BytesSocket())).toBe(true);
    expect(compat(new AnySocket(), new AnySocket())).toBe(true);
  });

  it("bucket 1: allows anything, including any, into bool", () => {
    const bool = new BoolSocket();
    expect(compat(bool, new NumberSocket())).toBe(true);
    expect(compat(bool, new StringSocket())).toBe(true);
    expect(compat(bool, new BytesSocket())).toBe(true);
    expect(compat(bool, new AnySocket())).toBe(true);
  });

  it("bucket 2: allows int -> number, refuses number -> int, allows string -> number/int", () => {
    expect(compat(new NumberSocket(), new IntSocket())).toBe(true);
    expect(compat(new IntSocket(), new NumberSocket())).toBe(false);
    expect(compat(new NumberSocket(), new StringSocket())).toBe(true);
    expect(compat(new IntSocket(), new StringSocket())).toBe(true);
  });

  it("bucket 3: refuses bytes <-> string (still an encoding decision, unchanged)", () => {
    expect(compat(new BytesSocket(), new StringSocket())).toBe(false);
    expect(compat(new StringSocket(), new BytesSocket())).toBe(false);
  });

  it("bucket 3: refuses any into number/int/string (unchanged)", () => {
    expect(compat(new NumberSocket(), new AnySocket())).toBe(false);
    expect(compat(new IntSocket(), new AnySocket())).toBe(false);
    expect(compat(new StringSocket(), new AnySocket())).toBe(false);
  });

  it("any input accepts every source, including untyped any", () => {
    const any = new AnySocket();
    expect(compat(any, new BoolSocket())).toBe(true);
    expect(compat(any, new NumberSocket())).toBe(true);
    expect(compat(any, new IntSocket())).toBe(true);
    expect(compat(any, new StringSocket())).toBe(true);
    expect(compat(any, new BytesSocket())).toBe(true);
    expect(compat(any, new AnySocket())).toBe(true);
  });

  it("self-correction 2026-09-17: allows any -> bytes (unblocks function -> display_spi/display_i2c), keeps identity as the only other accepted source", () => {
    const bytes = new BytesSocket();
    expect(compat(bytes, new AnySocket())).toBe(true);
    expect(compat(bytes, new BytesSocket())).toBe(true);
    expect(compat(bytes, new BoolSocket())).toBe(false);
    expect(compat(bytes, new NumberSocket())).toBe(false);
    expect(compat(bytes, new IntSocket())).toBe(false);
    expect(compat(bytes, new StringSocket())).toBe(false);
  });
});
