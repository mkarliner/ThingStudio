// The node catalog (src/cli/describe.ts): generated from the editor's node classes and node definitions, and the
// docs page docs/user-guide/nodes-catalog.md generated from it. The page must be current: regenerate it with
//   cd editor && npm run build:cli && node dist-cli/thingstudio-compile.mjs --describe-all --markdown > ../docs/user-guide/nodes-catalog.md

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NODE_PURPOSES, PROPERTY_NOTES, buildCatalog, findNode, renderMarkdown, renderNode } from "../src/cli/describe.js";
import { NODE_FACTORIES } from "../src/app/rete/nodes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("node catalog", () => {
  const catalog = buildCatalog();

  it("has an entry for every node the canvas can create, with its type, ports and defaults", () => {
    expect(catalog.nodes.length).toBe(Object.keys(NODE_FACTORIES).length);
    const timer = findNode(catalog, "timer")!;
    expect(timer).toMatchObject({ type: "thingstudio/timer", kind: "source", inputs: [], outputs: [{ name: "msg", type: "int" }] });
    expect(timer.properties).toEqual([{ name: "intervalMs", label: expect.any(String), type: "number", default: 1000, note: expect.stringMatching(/milliseconds between messages/) }]);
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

  it("lists no compile-only types any more -- every registered type has a canvas node", () => {
    expect(catalog.compileOnly).toEqual([]);
  });

  it("every hand-written property note names a property that exists", () => {
    const have = new Set(catalog.nodes.flatMap((n) => n.properties.map((p) => `${n.type.replace("thingstudio/", "")}.${p.name}`)));
    for (const key of Object.keys(PROPERTY_NOTES)) expect(have.has(key), `${key} is not a property of any node`).toBe(true);
  });

  it("every node has a one-line purpose, and every purpose names a node", () => {
    for (const n of catalog.nodes) {
      expect(n.purpose, `${n.kind} has no purpose`).not.toBe("");
      expect(n.purpose, `${n.kind}: purpose is more than one line`).not.toMatch(/\n/);
    }
    const kinds = new Set(catalog.nodes.map((n) => n.type.replace("thingstudio/", "")));
    for (const key of Object.keys(NODE_PURPOSES)) expect(kinds.has(key), `${key} is not a node kind`).toBe(true);
  });

  it("every node links to a node page that exists", () => {
    const dir = join(__dirname, "..", "..", "docs", "user-guide");
    for (const n of catalog.nodes) expect(existsSync(join(dir, n.page)), `${n.kind}: ${n.page} does not exist`).toBe(true);
  });

  it("a node entry leads with its purpose, then type and kind, then its page, ports and a properties table", () => {
    const md = renderNode(findNode(catalog, "wifi_status")!);
    const lines = md.split("\n");
    expect(lines[0]).toMatch(/^### wifi status$/i);
    expect(lines[2]).toBe(findNode(catalog, "wifi_status")!.purpose);
    expect(lines[4]).toMatch(/^Type: `wifi_status`\. Kind: source\./);
    expect(lines[6]).toBe("Properties explained: https://docs.thingstudio.net/nodes/wifi-status/");
    expect(md).toContain("- Outputs: message, payload bool");
    expect(md).not.toContain("thingstudio/wifi_status");
    expect(md).toMatch(/\| `pollMs` \| poll interval \(ms\) \| number \| `5000` \|/);
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
