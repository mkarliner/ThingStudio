// SPDX-License-Identifier: Apache-2.0
// editor/src/protocol/envelope.ts
//
// The msg envelope every node's generated code reads and writes, per
// design doc §6: `payload` (the primary value), `topic` (a routing/
// identification string), and arbitrary extra properties a node can
// attach. §6 is explicit this isn't a v1-only shortcut -- every node
// built after this depends on the envelope shape, and changing it later
// breaks every node already written. See docs/working-notes/repo-
// structure-and-conventions.md's open follow-ups: this is the first
// real (not just conceptual) version of the contract sketched there.

/** The fixed payload type set from §6. */
export type PayloadType = "int" | "number" | "bool" | "string" | "bytes" | "any";

/**
 * TS-side representation of a `bytes` payload. JSON (the flow file
 * format, §6) has no native bytes type, so bytes payloads are carried as
 * base64 in the flow file / wire protocol and decoded to this at the
 * boundary. Working assumption, not yet cross-checked against the
 * device-side CBOR encoding (§13) -- flagged as an open follow-up in
 * repo-structure-and-conventions.md, not a final decision.
 */
export interface BytesValue {
  readonly kind: "bytes";
  readonly base64: string;
}

export type PayloadValue<T extends PayloadType = PayloadType> = T extends "int" | "number"
  ? number
  : T extends "bool"
    ? boolean
    : T extends "string"
      ? string
      : T extends "bytes"
        ? BytesValue
        : unknown; // "any"

/**
 * The envelope itself: `payload` + `topic`, plus arbitrary extra
 * properties a node can attach (§6) -- deliberately open, not every key
 * is known ahead of time, so this isn't a closed interface.
 */
export interface Msg<T extends PayloadType = PayloadType> {
  payload: PayloadValue<T>;
  topic: string;
  [extra: string]: unknown;
}

/**
 * §6's wire-connect-time type check: can a port emitting `from` feed a
 * port wanting `to`? Exact match always works; `any` on either side
 * always works (matches anything); `int` widens to `number` because
 * every int is a valid number. Nothing else is compatible -- in
 * particular `bytes` never silently converts to `string` (or vice
 * versa): §6 requires an explicit conversion node for that, the editor
 * refuses the direct connection.
 */
export function isPayloadTypeCompatible(from: PayloadType, to: PayloadType): boolean {
  if (from === to) return true;
  if (from === "any" || to === "any") return true;
  if (from === "int" && to === "number") return true;
  return false;
}

export const PAYLOAD_TYPES: readonly PayloadType[] = ["int", "number", "bool", "string", "bytes", "any"];
