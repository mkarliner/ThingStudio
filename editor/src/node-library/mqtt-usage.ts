// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/mqtt-usage.ts
//
// The one "does this node use MQTT?" rule (Home Assistant phase 0.5, 2026-11-25). A node uses MQTT if any of its
// properties holds the id of a `thingstudio/config/mqtt-broker` config in the flow. That covers mqtt_publish,
// mqtt_subscribe and any custom node with a broker configRef (a Home Assistant node, say), so WiFi is left to
// mqtt_as for all of them rather than managed twice. It replaces lists of the two built-in node types.
//
// The same rule runs in TypeScript (the compiler, the deploy marker) and in Python inside the compile-hook sandbox
// (MQTT_USAGE_PYTHON, used by compile-hooks.ts). It reads only `flow.nodes[].properties` and `flow.configs[].id`,
// both already in interfaces/node-compile-context/SPEC.md.

import type { GraphNode } from "../compiler/graph.js";

export const MQTT_BROKER_CONFIG_TYPE = "thingstudio/config/mqtt-broker";

/** Whether `node` has a property holding one of `brokerIds`. */
export function nodeUsesMqtt(node: { properties: Record<string, unknown> }, brokerIds: ReadonlySet<string>): boolean {
  if (brokerIds.size === 0) return false;
  return Object.values(node.properties ?? {}).some((v) => typeof v === "string" && brokerIds.has(v));
}

/** Whether any node in a plain graph uses MQTT. */
export function graphUsesMqtt(graph: {
  nodes: readonly { properties: Record<string, unknown> }[];
  configs?: readonly { id: string; type: string }[];
}): boolean {
  const brokerIds = new Set((graph.configs ?? []).filter((c) => c.type === MQTT_BROKER_CONFIG_TYPE).map((c) => c.id));
  return graph.nodes.some((n) => nodeUsesMqtt(n, brokerIds));
}

/** Whether any node in the flow being compiled uses MQTT. Hand-rolled test contexts without `flowNodes` or
 * `findConfigsOfType` fall back to the two built-in MQTT node types. */
export function flowUsesMqtt(ctx: {
  flowNodes?(): GraphNode[];
  findConfigsOfType?(type: string): { id: string }[];
  findNodesOfType?(type: string): GraphNode[];
}): boolean {
  if (ctx.flowNodes && ctx.findConfigsOfType) {
    const brokerIds = new Set(ctx.findConfigsOfType(MQTT_BROKER_CONFIG_TYPE).map((c) => c.id));
    return ctx.flowNodes().some((n) => nodeUsesMqtt(n, brokerIds));
  }
  return ["thingstudio/mqtt_publish", "thingstudio/mqtt_subscribe"].some((t) => (ctx.findNodesOfType?.(t).length ?? 0) > 0);
}

/** The same rule as a Python expression over a compile-hook `ctx`, for the hook sandbox. */
export const MQTT_USAGE_PYTHON = `def _ts_uses_mqtt(ctx):
    broker_ids = [c['id'] for c in ctx['flow']['configs'] if c['type'] == '${MQTT_BROKER_CONFIG_TYPE}']
    if not broker_ids:
        return False
    for n in ctx['flow']['nodes']:
        for v in (n.get('properties') or {}).values():
            if isinstance(v, str) and v in broker_ids:
                return True
    return False
`;
