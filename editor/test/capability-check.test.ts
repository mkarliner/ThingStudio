// SPDX-License-Identifier: Apache-2.0
// editor/test/capability-check.test.ts
//
// Node -> board capability mapping (decisions/node-board-mapping.md): the processor/board capability
// vocabulary, effectiveCapabilities (board.wifi folded in), and the central compile-time check.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { CompileError } from "../src/compiler/errors.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { CodegenContext, NodeDefinition } from "../src/compiler/node-definition.js";
import { BUILTIN_DEFINITION_FILES } from "../src/definitions/builtin.js";
import { checkCapabilities } from "../src/definitions/capability-check.js";
import { buildDefinitionSet } from "../src/definitions/definitions.js";
import { effectiveCapabilities, resolveTarget, type Target } from "../src/definitions/target.js";

const defs = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);

function targetFor(choice: string): Target {
  const r = resolveTarget(defs, choice, null);
  if (!r.target) throw new Error(`no target for ${choice}`);
  return r.target;
}

const caps = (t: Target): string[] => [...t.capabilities].sort();

describe("effectiveCapabilities", () => {
  it("reports the processor's capabilities", () => {
    expect(caps(targetFor("processor:esp32"))).toEqual(["ble", "espnow", "wifi"]);
    expect(caps(targetFor("processor:esp32-s2"))).toEqual(["espnow", "wifi"]); // the S2 has no Bluetooth
    expect(caps(targetFor("processor:rp2040"))).toEqual(["pio"]);
    expect(caps(targetFor("processor:stm32f405"))).toEqual([]);
  });

  it("folds board.wifi in: true adds, false denies, unstated defers to the processor", () => {
    expect(caps(targetFor("board:pico-w"))).toEqual(["pio", "wifi"]);
    expect(caps(targetFor("board:pico"))).toEqual(["pio"]);
    expect(caps(targetFor("board:pyboard-v10"))).toEqual([]);
  });

  it("lets a board's own capabilities add to the processor's", () => {
    const proc = defs.processors.get("rp2040")!;
    const board = { ...defs.boards.get("pico")!, capabilities: new Set(["sdcard"]) };
    expect([...effectiveCapabilities(proc, board)].sort()).toEqual(["pio", "sdcard"]);
  });
});

describe("checkCapabilities", () => {
  function ctx(target: Target | null): CodegenContext & { warnings: string[] } {
    const warnings: string[] = [];
    return {
      warnings,
      target,
      warn: (m) => {
        if (!warnings.includes(m)) warnings.push(m);
      },
      uniqueName: (h) => `_${h}`,
      resolveConfig: () => ({}),
    };
  }
  const node = (type: string): GraphNode => ({ id: "1", type, properties: {} });

  it("throws naming the node, the target and the missing capability", () => {
    expect(() =>
      checkCapabilities(ctx(targetFor("board:pyboard-v10")), node("thingstudio/espnow_broadcast"), { capabilities: ["espnow"] }),
    ).toThrow(/node 1 \(thingstudio\/espnow_broadcast\) needs "espnow", which Pyboard v1\.0 \(STM32F405 \(pyboard\)\) doesn't provide\./);
  });

  it("passes when the target has the capability", () => {
    expect(() => checkCapabilities(ctx(targetFor("processor:esp32")), node("thingstudio/espnow_broadcast"), { capabilities: ["espnow"] })).not.toThrow();
  });

  it("warns, never blocks, with no target", () => {
    const c = ctx(null);
    checkCapabilities(c, node("thingstudio/espnow_broadcast"), { capabilities: ["espnow"] });
    expect(c.warnings).toEqual(['node 1 (thingstudio/espnow_broadcast) needs "espnow", not checked: no board or processor known.']);
  });
});

describe("compile() runs the check centrally for any node, including a custom one", () => {
  const radio: NodeDefinition = {
    type: "thingstudio/fake_radio",
    kind: "source",
    requires: { capabilities: ["espnow"] },
    codegenSource: () => ({ buildMsg: "msg = {'payload': 1, 'topic': ''}", repeatMs: 1000 }),
  };
  const graph: GraphData = { nodes: [{ id: "a", type: "thingstudio/fake_radio", properties: {} }], links: [] };

  it("refuses a flow using a node whose capability the target lacks", () => {
    expect(() => compile(graph, new Map([[radio.type, radio]]), { target: targetFor("board:pyboard-v10") })).toThrow(CompileError);
  });

  it("compiles it on a target that has the capability", () => {
    expect(() => compile(graph, new Map([[radio.type, radio]]), { target: targetFor("processor:esp32") })).not.toThrow();
  });
});
