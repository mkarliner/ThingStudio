// SPDX-License-Identifier: Apache-2.0
// editor/test/node-descriptor-schema.test.ts
//
// Runs the published custom-node JSON Schema against the validator that
// enforces it (interfaces/node-descriptor/SPEC.md). Users write .node.json
// packages against this format, so the schema is a contract; this test keeps
// its enums and type-id pattern from drifting from
// editor/src/node-library/custom-node.ts. The validator's cross-field rules
// (port counts, one output, source intervalMs) are covered by
// custom-node.test.ts.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NODE_KINDS, PAYLOAD_TYPES, PROPERTY_KINDS, TYPE_ID_RE } from "../src/node-library/custom-node.js";

const schema = JSON.parse(readFileSync(new URL("../../interfaces/node-descriptor/custom-node.schema.json", import.meta.url), "utf8"));

describe("custom node descriptor schema conformance", () => {
  it("kind enum matches the validator", () => {
    expect(schema.properties.kind.enum).toEqual([...NODE_KINDS]);
  });

  it("port type enum matches the validator", () => {
    expect(schema.$defs.port.properties.type.enum).toEqual([...PAYLOAD_TYPES]);
  });

  it("property kind enum matches the validator", () => {
    expect(schema.$defs.propertyField.properties.kind.enum).toEqual([...PROPERTY_KINDS]);
  });

  it("type id pattern and reserved namespace match the validator", () => {
    // Compare behaviour, not the source string: a JSON pattern writes "/" literally while a JS
    // regex literal escapes it as "\/", so the two sources differ while matching the same ids.
    const schemaRe = new RegExp(schema.properties.type.pattern);
    for (const id of ["custom/dht22", "a/b", "thingstudio/x", "Bad/Id", "no-slash", "a/b/c"]) {
      expect(schemaRe.test(id), id).toBe(TYPE_ID_RE.test(id));
    }
    expect(schema.properties.type.not.pattern).toBe("^thingstudio/");
  });

  it("required keys are the ones the validator insists on", () => {
    expect(schema.required.sort()).toEqual(["kind", "label", "type"]);
  });
});
