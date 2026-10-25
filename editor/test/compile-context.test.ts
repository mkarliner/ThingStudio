// The compile-hook context (interfaces/node-compile-context/SPEC.md v1 draft): what a package's
// <name>.compile.py sees. Pure builder, so no interpreter here.

import { describe, expect, it } from "vitest";
import type { GraphData } from "../src/compiler/graph.js";
import type { NodeDescriptor } from "../src/compiler/node-descriptor.js";
import type { Target } from "../src/definitions/target.js";
import { buildCompileContext, COMPILE_CONTEXT_VERSION } from "../src/node-library/compile-context.js";

const descriptor: NodeDescriptor = {
  type: "custom/sensor",
  kind: "source",
  label: "sensor",
  paletteId: "custom",
  ports: {
    inputs: [],
    outputs: [
      { name: "out", type: "any" },
      { name: "err", type: "string" },
    ],
  },
  properties: [
    { name: "bus", label: "bus", kind: "configRef", configType: "thingstudio/config/i2c-bus", default: "" },
    { name: "net", label: "WiFi", kind: "configRef", configType: "thingstudio/config/wifi", singleton: true, default: "" },
  ],
};

const target: Target = {
  processor: {
    id: "esp32",
    name: "ESP32",
    match: [],
    nativeArch: "xtensawin",
    nativeArchConfirmed: true,
    capabilities: new Set(["wifi", "bled"]),
    gpio: new Set(),
    inputOnly: new Set(),
    noPull: new Set(),
    adc2: new Set(),
    reserved: new Map(),
    avoid: new Map(),
    spi: null,
    i2c: null,
    notes: "",
  flash: null,
  },
  board: null,
  label: "ESP32",
  gpio: new Set(),
  inputOnly: new Set(),
  noPull: new Set(),
  reserved: new Map(),
  avoid: new Map(),
  pinLabels: new Map(),
  capabilities: new Set(["wifi", "bled"]),
};

const graph: GraphData = {
  nodes: [
    { id: "s1", type: "custom/sensor", properties: { bus: "bus1", net: "ignored" } },
    { id: "d1", type: "thingstudio/debug", properties: {} },
  ],
  links: [[1, "s1", 1, "d1", 0, "string"]],
  configs: [
    { id: "bus1", type: "thingstudio/config/i2c-bus", properties: { bus: 0, scl: 22, sda: 21 } },
    { id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "net", password: "secret" } },
  ],
};

describe("buildCompileContext", () => {
  it("describes the node, its wiring and the flow", () => {
    const ctx = buildCompileContext({ graphData: graph, node: graph.nodes[0]!, descriptor, target });
    expect(ctx.version).toBe(COMPILE_CONTEXT_VERSION);
    expect(ctx.node).toEqual({
      id: "s1",
      type: "custom/sensor",
      properties: { bus: "bus1", net: "ignored" },
      wired: { inputs: [], outputs: [false, true] },
    });
    expect(ctx.flow.nodes.map((n) => n.id)).toEqual(["s1", "d1"]);
    expect(ctx.flow.nodes[0]).not.toHaveProperty("wired");
  });

  it("lists only this node's own type in nodesOfType, including itself", () => {
    const ctx = buildCompileContext({ graphData: graph, node: graph.nodes[0]!, descriptor, target });
    expect(ctx.nodesOfType).toEqual([{ id: "s1", type: "custom/sensor", properties: { bus: "bus1", net: "ignored" } }]);
  });

  it("resolves a named configRef and a singleton config into referencedConfigs", () => {
    const ctx = buildCompileContext({ graphData: graph, node: graph.nodes[0]!, descriptor, target });
    expect(ctx.referencedConfigs).toEqual({
      bus1: { bus: 0, scl: 22, sda: 21 },
      wifi1: { ssid: "net", password: "secret" },
    });
  });

  it("redacts flow.configs but not referencedConfigs", () => {
    const ctx = buildCompileContext({
      graphData: graph,
      node: graph.nodes[0]!,
      descriptor,
      target,
      redactConfig: (c) => (c.type === "thingstudio/config/wifi" ? { ssid: c.properties.ssid } : c.properties),
    });
    expect(ctx.flow.configs.find((c) => c.id === "wifi1")!.properties).toEqual({ ssid: "net" });
    expect(ctx.referencedConfigs.wifi1).toEqual({ ssid: "net", password: "secret" });
  });

  it("leaves a singleton field out when zero or many configs match", () => {
    const twoConfigs: GraphData = { ...graph, configs: [...graph.configs!, { id: "wifi2", type: "thingstudio/config/wifi", properties: {} }] };
    const ctx = buildCompileContext({ graphData: twoConfigs, node: twoConfigs.nodes[0]!, descriptor, target });
    expect(ctx.referencedConfigs).not.toHaveProperty("wifi2");
    // The named config still resolves; the ambiguous singleton is simply not offered.
    expect(ctx.referencedConfigs.bus1).toBeDefined();
    const none: GraphData = { ...graph, configs: graph.configs!.filter((c) => c.type !== "thingstudio/config/wifi") };
    expect(buildCompileContext({ graphData: none, node: none.nodes[0]!, descriptor, target }).referencedConfigs).not.toHaveProperty("wifi1");
  });

  it("target is the board/processor identity, or null when unknown", () => {
    expect(buildCompileContext({ graphData: graph, node: graph.nodes[0]!, descriptor, target }).target).toEqual({
      boardId: null,
      boardName: null,
      processorId: "esp32",
      processorName: "ESP32",
      label: "ESP32",
      capabilities: ["bled", "wifi"],
    });
    expect(buildCompileContext({ graphData: graph, node: graph.nodes[0]!, descriptor }).target).toBeNull();
  });
});
