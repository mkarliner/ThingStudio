// The one "uses MQTT" rule (src/node-library/mqtt-usage.ts): a node uses MQTT if a property holds the id of the
// flow's mqtt-broker config. The hook-sandbox copy of the rule is covered in node-wifi-status.test.ts.

import { describe, expect, it } from "vitest";
import type { GraphNode } from "../src/compiler/graph.js";
import { flowUsesMqtt, graphUsesMqtt } from "../src/node-library/mqtt-usage.js";
import { computeWifiProvisionMarker } from "../src/node-library/wifi-status.js";

const broker = { id: "b1", type: "thingstudio/config/mqtt-broker", properties: { broker: "b", port: 1883 } };
const custom: GraphNode = { id: "h1", type: "custom/ha_light", properties: { name: "lamp", broker: "b1" } };

describe("uses MQTT", () => {
  it("counts a custom node whose property holds the broker config's id", () => {
    expect(graphUsesMqtt({ nodes: [custom], configs: [broker] })).toBe(true);
  });

  it("ignores a property that only names a config that isn't there, or isn't a broker", () => {
    expect(graphUsesMqtt({ nodes: [custom], configs: [] })).toBe(false);
    expect(graphUsesMqtt({ nodes: [custom], configs: [{ ...broker, type: "thingstudio/config/wifi" }] })).toBe(false);
  });

  it("reads the whole flow through a codegen context, and falls back to the built-in types without one", () => {
    const ctx = { flowNodes: () => [custom], findConfigsOfType: (t: string) => (t === broker.type ? [broker] : []) };
    expect(flowUsesMqtt(ctx)).toBe(true);
    const mock = { findNodesOfType: (t: string): GraphNode[] => (t === "thingstudio/mqtt_publish" ? [custom] : []) };
    expect(flowUsesMqtt(mock)).toBe(true);
    expect(flowUsesMqtt({})).toBe(false);
  });

  it("makes a custom MQTT node count as a WiFi user for the self-provision marker", () => {
    const wifi = { id: "w1", type: "thingstudio/config/wifi", properties: { security: "unmanaged" } };
    expect(computeWifiProvisionMarker({ nodes: [custom], configs: [wifi, broker] })).toEqual({
      selfProvision: true,
      allowReprovision: false,
    });
    expect(computeWifiProvisionMarker({ nodes: [{ ...custom, properties: {} }], configs: [wifi, broker] })).toBeNull();
  });
});
