// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/py-literals.ts
//
// Shared helpers for turning a node's configured property (a JS value
// from the editor) into a Python literal for generated code -- factored
// out of inject.ts once comparator.ts and variable-get.ts needed the
// same typed-constant pattern (§6's small fixed payload type set:
// int/number/bool/string/bytes/any). `bytes`/`any` aren't handled as
// literals here -- no v1 node needs a configured bytes/any constant yet;
// add when one does rather than guessing at the encoding now.

import { CompileError } from "../compiler/errors.js";

export function pyStringLiteral(s: string): string {
  return JSON.stringify(String(s)); // double-quoted + escaping matches Python's for basic ASCII
}

/** `contextLabel` is prefixed onto the "not a valid number" error so a
 * caller's message stays specific (e.g. "inject payload value", "boolean
 * node operand") instead of a single generic wording across every node
 * type that uses this. */
export function pyPayloadLiteral(payloadType: string, rawValue: unknown, contextLabel: string): string {
  switch (payloadType) {
    case "bool":
      return rawValue === "true" || rawValue === true ? "True" : "False";
    case "number": {
      const n = Number(rawValue);
      if (Number.isNaN(n)) throw new CompileError(`${contextLabel} value "${String(rawValue)}" is not a valid number`);
      return String(n);
    }
    default:
      return pyStringLiteral(String(rawValue));
  }
}

/** Turns an arbitrary msg.payload into the bytes a socket/wire call
 * actually needs -- "encode whatever this is, sensibly": bytes/bytearray
 * pass through, str gets `.encode()`, anything else is stringified first.
 * Originally lived in mqtt-shared.ts (mqtt_publish's outgoing-payload
 * encoding); moved here 2026-08-18 when udp-send.ts needed the exact same
 * snippet -- two independent copies would have been the third
 * near-duplicate (http-request.ts's POST-body encoding already inlines
 * the same three-way isinstance check separately, which is fine as a
 * one-off but not worth a third copy-paste once a second real caller
 * showed up). `varName` is the local variable the caller wants the
 * result bound to. */
export function payloadToBytesSnippet(varName: string): string {
  return [
    "_payload = msg.get('payload')",
    "if isinstance(_payload, (bytes, bytearray)):",
    `    ${varName} = bytes(_payload)`,
    "elif isinstance(_payload, str):",
    `    ${varName} = _payload.encode()`,
    "else:",
    `    ${varName} = str(_payload).encode()`,
  ].join("\n");
}
