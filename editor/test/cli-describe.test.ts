// The node catalog (src/cli/describe.ts): generated from the editor's node classes and node definitions, and the
// docs page docs/user-guide/nodes-catalog.md generated from it. The page must be current: regenerate it with
//   cd editor && npm run build:cli && node dist-cli/thingstudio-compile.mjs --describe-all --markdown > ../docs/user-guide/nodes-catalog.md

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROPERTY_NOTES, buildCatalog, findNode, renderMarkdown } from "../src/cli/describe.js";
import { NODE_FACTORIES } from "../src/app/rete/nodes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("node catalog", () => {
  const catalog = buildCatalog();

  it("has an entry for every node the canvas can create, with its type, ports and defaults", () => {
    expect(catalog.nodes.length).toBe(Object.keys(NODE_FACTORIES).length);
    const timer = findNode(catalog, "timer")!;
    expect(timer).toMatchObject({ type: "thingstudio/timer", kind: "source", inputs: [], outputs: [{ name: "msg", type: "int" }] });
    expect(timer.properties).toEqual([{ name: "intervalMs", type: "number", default: 1000, note: expect.stringMatching(/milliseconds between messages/) }]);
  });

  it("finds a node by short or full name", () => {
    expect(findNode(catalog, "thingstudio/journal")).toBe(findNode(catalog, "journal"));
    expect(findNode(catalog, "nope")).toBeUndefined();
  });

  it("names the config type a ...ConfigId property takes", () => {
    const bme = findNode(catalog, "bme280")!;
    expect(bme.properties.find((p) => p.name === "i2cConfigId")).toMatchObject({ configType: "thingstudio/config/i2c-bus" });
    const mqtt = findNode(catalog, "mqtt_publish")!;
    expect(mqtt.properties.find((p) => p.name === "brokerConfigId")).toMatchObject({ configType: "thingstudio/config/mqtt-broker" });
  });

  it("every property ending ConfigId is mapped to a config type", () => {
    for (const n of catalog.nodes) {
      for (const p of n.properties.filter((x) => /ConfigId$/.test(x.name))) {
        expect(p.configType, `${n.type}.${p.name}`).toBeDefined();
      }
    }
  });

  it("says the function node's outputs vary, and lists the config nodes", () => {
    expect(findNode(catalog, "function")!.variableOutputs).toBe(true);
    expect(catalog.configs.map((c) => c.type)).toEqual(expect.arrayContaining(["thingstudio/config/wifi", "thingstudio/config/i2c-bus", "thingstudio/config/touch-panel", "thingstudio/config/mqtt-broker"]));
  });

  it("lists the types the canvas has no node for, so the page doesn't hide them", () => {
    expect(catalog.compileOnly).toEqual(expect.arrayContaining(["thingstudio/variable_get", "thingstudio/variable_set"]));
  });

  it("every hand-written property note names a property that exists", () => {
    const have = new Set(catalog.nodes.flatMap((n) => n.properties.map((p) => `${n.type.replace("thingstudio/", "")}.${p.name}`)));
    for (const key of Object.keys(PROPERTY_NOTES)) expect(have.has(key), `${key} is not a property of any node`).toBe(true);
  });

  it("the properties authors most often get wrong carry a note", () => {
    expect(findNode(catalog, "bme280")!.properties.find((p) => p.name === "address")!.note).toMatch(/118 is 0x76/);
    expect(findNode(catalog, "gui_button")!.properties.find((p) => p.name === "target")!.note).toMatch(/page name/);
    expect(findNode(catalog, "journal")!.properties.find((p) => p.name === "stepSeconds")!.note).toMatch(/seconds per row/);
  });

  it("the docs page is the current generated output", () => {
    const page = readFileSync(join(__dirname, "..", "..", "docs", "user-guide", "nodes-catalog.md"), "utf8");
    expect(page, "docs/user-guide/nodes-catalog.md is out of date: regenerate it (see the comment at the top of this test)").toBe(renderMarkdown(catalog));
  });
});
