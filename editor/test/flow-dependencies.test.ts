// SPDX-License-Identifier: Apache-2.0
// editor/test/flow-dependencies.test.ts -- flow dependencies (2026-10-07): imports -> libraries.

import { describe, expect, it } from "vitest";
import {
  dependencyHash,
  findImportedModules,
  librariesToSend,
  resolveDependencies,
  type DependencyInfo,
} from "../src/compiler/flow-dependencies.js";
import { compile } from "../src/compiler/compile.js";
import type { GraphData } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";

const LIST: DependencyInfo[] = [
  { name: "mqtt_as", requires: [], files: [{ name: "mqtt_as.py", source: "" }] },
  { name: "delay_ms", requires: [], files: [{ name: "delay_ms.py", source: "" }] },
  { name: "events", requires: ["delay_ms"], files: [{ name: "events.py", source: "" }] },
  { name: "st7789py", requires: [], files: [{ name: "st7789py.py", source: "" }] },
];

describe("findImportedModules", () => {
  it("finds import and from-import lines, indented or not, and multi-name imports", () => {
    const src = [
      "import runtime",
      "import machine, network",
      "from events import EButton",
      "    import mqtt_as",
      "\tfrom st7789py import ST7789, ST7789_MADCTL",
      "import os.path as p",
      "x = 1  # import notamodule",
      "s = 'from nowhere import x'",
    ].join("\n");
    expect([...findImportedModules(src)].sort()).toEqual(["events", "machine", "mqtt_as", "network", "os", "runtime", "st7789py"]);
  });

  it("returns nothing for a source with no imports", () => {
    expect(findImportedModules("x = 1\n").size).toBe(0);
  });
});

describe("resolveDependencies", () => {
  it("maps modules to libraries, adds what they require, ignores firmware modules", () => {
    const got = resolveDependencies(["machine", "events", "runtime"], LIST).map((d) => d.name);
    expect(got).toEqual(["events", "delay_ms"]);
  });

  it("lists a library once even when reached twice", () => {
    const got = resolveDependencies(["events", "delay_ms"], LIST).map((d) => d.name);
    expect(got).toEqual(["delay_ms", "events"]);
  });

  it("says plainly when the list names a library that isn't in it", () => {
    const broken: DependencyInfo[] = [{ name: "a", requires: ["ghost"], files: [{ name: "a.py", source: "" }] }];
    expect(() => resolveDependencies(["a"], broken)).toThrow(/"a" requires "ghost"/);
  });
});

describe("dependencyHash", () => {
  it("is order-independent, content-sensitive and matches hil_common.py's scheme", async () => {
    const a = await dependencyHash({ "b.mpy": new Uint8Array([0x32]), "a.mpy": new Uint8Array([0x31]) });
    const b = await dependencyHash({ "a.mpy": new Uint8Array([0x31]), "b.mpy": new Uint8Array([0x32]) });
    expect(a).toBe(b);
    // Same input through test/hil/hil_common.py's dependency_hash() gives this value.
    expect(a).toBe("62300688121da499");
    expect(await dependencyHash({ "a.mpy": new Uint8Array([0x31]), "b.mpy": new Uint8Array([0x33]) })).not.toBe(a);
  });
});

describe("librariesToSend", () => {
  it("sends missing and changed libraries only", () => {
    expect(librariesToSend({ a: "1", b: "2", c: "3" }, { a: "1", b: "old" })).toEqual(["b", "c"]);
  });
  it("sends everything when the board's inventory is unknown", () => {
    expect(librariesToSend({ b: "2", a: "1" }, null)).toEqual(["a", "b"]);
  });
});

describe("real compiled flows", () => {
  it("an MQTT publish flow's generated code imports mqtt_as, and nothing else from the list", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "x" } },
        { id: "2", type: "thingstudio/mqtt_publish", properties: { topic: "t", retain: false, qos: 0, brokerConfigId: "b1" } },
      ],
      links: [[1, "1", 0, "2", 0, "any"]],
      configs: [
        { id: "w1", type: "thingstudio/config/wifi", properties: { ssid: "HomeNet", password: "secret12", security: "password" } },
        { id: "b1", type: "thingstudio/config/mqtt-broker", properties: { broker: "broker.local", port: 1883 } },
      ],
    };
    const source = compile(graph, buildRegistry()).source;
    expect(resolveDependencies(findImportedModules(source), LIST).map((d) => d.name)).toEqual(["mqtt_as"]);
  });

  it("a function node's own import is found too", () => {
    const graph: GraphData = {
      nodes: [
        { id: "1", type: "thingstudio/inject", properties: { payloadType: "string", payloadValue: "x" } },
        { id: "2", type: "thingstudio/function", properties: { code: "import st7789py\nreturn msg" } },
      ],
      links: [[1, "1", 0, "2", 0, "any"]],
    };
    const source = compile(graph, buildRegistry()).source;
    expect(resolveDependencies(findImportedModules(source), LIST).map((d) => d.name)).toEqual(["st7789py"]);
  });
});
