// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/port-type-data.ts
//
// The serializable port-type form for the three nodes whose output tracks `payloadType` (2026-10-20). It used to be
// a function per node; data means the custom `.node.json` schema can express the same thing (data-equivalent rule).

import type { PortTypeFromProperty } from "../compiler/node-descriptor.js";

export const PAYLOAD_TYPE_PORT: PortTypeFromProperty = {
  property: "payloadType",
  map: { bool: "bool", number: "number", string: "string" },
  default: "bool",
};

export const STARTUP_PAYLOAD_TYPE_PORT: PortTypeFromProperty = {
  property: "payloadType",
  map: { bool: "bool", number: "number", string: "string", reason: "string" },
  default: "bool",
};
