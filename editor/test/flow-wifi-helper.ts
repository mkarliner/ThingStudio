// Shared by the network-node tests (2026-09-25, WiFi config became a singleton -- wifi-status.ts's
// resolveFlowWifiCredentials()). These tests set up "the flow's WiFi" the way flows used to hold it, as
// a wifi_status node's wifiConfigId; this turns those references into what a real compile's
// ctx.findConfigsOfType("thingstudio/config/wifi") would return -- one entry per distinct config, so
// two wifi_status nodes pointing at different configs still model "two WiFi configs in one flow".

import type { GraphNode } from "../src/compiler/graph.js";

export function flowWifiConfigsFrom(
  wifiStatusNodes: GraphNode[],
  lookup: (id: string) => Record<string, unknown> | undefined,
): { id: string; properties: Record<string, unknown> }[] {
  const ids = [
    ...new Set(
      wifiStatusNodes
        .map((n) => n.properties.wifiConfigId)
        .filter((id): id is string => typeof id === "string" && id !== ""),
    ),
  ];
  return ids.map((id) => ({ id, properties: lookup(id) ?? {} }));
}
