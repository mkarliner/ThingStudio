// Adversarial graph shapes the compiler must reject with a clear error
// rather than misbehave silently -- the exact list from
// docs/working-notes/validation/mvp-validation-plan.md's Tier 0 section:
// cycles, disconnected nodes, unknown node types, fan-out. Plus a couple
// more the general compiler introduces beyond POC-D's hardcoded version:
// fan-in, no source at all, and a source with an incoming connection.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";

const registry = buildRegistry();

const passthroughFn = { code: "return msg\n" };

describe("general compiler: adversarial graph shapes", () => {
  it("rejects an unknown node type", () => {
    const graph: GraphData = {
      nodes: [{ id: 1, type: "thingstudio/does_not_exist", properties: {} }],
      links: [],
    };
    expect(() => compile(graph, registry)).toThrow(CompileError);
    expect(() => compile(graph, registry)).toThrow(/unknown node type/);
  });

  it("rejects a graph with no source node", () => {
    const graph: GraphData = {
      nodes: [{ id: 1, type: "thingstudio/gpio_out", properties: { pin: 12 } }],
      links: [],
    };
    expect(() => compile(graph, registry)).toThrow(/no source node/);
  });

  it("rejects a disconnected node", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/gpio_out", properties: { pin: 12 } },
        // node 3: never wired to anything
        { id: 3, type: "thingstudio/function", properties: passthroughFn },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    expect(() => compile(graph, registry)).toThrow(/disconnected/);
  });

  it("rejects fan-out (one output wired to two inputs)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/gpio_out", properties: { pin: 12 } },
        { id: 3, type: "thingstudio/gpio_out", properties: { pin: 13 } },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 1, 0, 3, 0, "bool"], // node 1's output wired a second time
      ],
    };
    expect(() => compile(graph, registry)).toThrow(/fan-out/);
  });

  it("rejects fan-in (two outputs wired to one input)", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "false", repeat: "manual" } },
        { id: 3, type: "thingstudio/gpio_out", properties: { pin: 12 } },
      ],
      links: [
        [1, 1, 0, 3, 0, "bool"],
        [2, 2, 0, 3, 0, "bool"], // node 3's input wired a second time
      ],
    };
    expect(() => compile(graph, registry)).toThrow(/fan-in/);
  });

  it("rejects a cycle with no source feeding it", () => {
    // A pure cycle (A -> B -> C -> A) has every node at exactly one
    // incoming/one outgoing link, so it never trips the fan-in/fan-out
    // checks -- but with no source node anywhere, nothing can ever
    // reach or drive it. See the comment in compile.ts's chain-walk loop
    // for why a cycle can't structurally survive past the fan-in check
    // *if* it's reachable from a source; this covers the case where it
    // isn't reachable from anything at all.
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/function", properties: passthroughFn },
        { id: 2, type: "thingstudio/function", properties: passthroughFn },
        { id: 3, type: "thingstudio/function", properties: passthroughFn },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 2, 0, 3, 0, "bool"],
        [3, 3, 0, 1, 0, "bool"],
      ],
    };
    expect(() => compile(graph, registry)).toThrow(/no source node/);
  });

  it("rejects a cycle sitting alongside a valid, unrelated chain", () => {
    // Same cycle as above, but this time there IS a source elsewhere in
    // the graph -- so the cycle is rejected as disconnected (unreached),
    // not as "no source", proving the cycle itself can never be
    // silently compiled just because *something* in the graph has a
    // source.
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/gpio_out", properties: { pin: 12 } },
        { id: 10, type: "thingstudio/function", properties: passthroughFn },
        { id: 11, type: "thingstudio/function", properties: passthroughFn },
        { id: 12, type: "thingstudio/function", properties: passthroughFn },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 10, 0, 11, 0, "bool"],
        [3, 11, 0, 12, 0, "bool"],
        [4, 12, 0, 10, 0, "bool"],
      ],
    };
    expect(() => compile(graph, registry)).toThrow(/disconnected/);
  });

  it("rejects a source node with an incoming connection", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "false", repeat: "manual" } },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    expect(() => compile(graph, registry)).toThrow(/takes? no input|incoming connection/);
  });

  it("rejects a node after a sink in the same chain", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/gpio_out", properties: { pin: 12 } },
        { id: 3, type: "thingstudio/function", properties: passthroughFn },
      ],
      links: [
        [1, 1, 0, 2, 0, "bool"],
        [2, 2, 0, 3, 0, "bool"], // gpio_out has no real output port; wiring past it is invalid
      ],
    };
    expect(() => compile(graph, registry)).toThrow(/sink/);
  });

  it("rejects an out-of-range gpio_out pin", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/gpio_out", properties: { pin: 99 } },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    expect(() => compile(graph, registry)).toThrow(/out of range/);
  });

  it("rejects an empty function node body", () => {
    const graph: GraphData = {
      nodes: [
        { id: 1, type: "thingstudio/inject", properties: { payloadType: "bool", payloadValue: "true", repeat: "manual" } },
        { id: 2, type: "thingstudio/function", properties: { code: "   " } },
      ],
      links: [[1, 1, 0, 2, 0, "bool"]],
    };
    expect(() => compile(graph, registry)).toThrow(/empty/);
  });
});
