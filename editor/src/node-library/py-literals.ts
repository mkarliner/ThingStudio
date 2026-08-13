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
