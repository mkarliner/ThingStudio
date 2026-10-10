// The trend widget and journal node in a real flow (test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json):
// sizes, the draw call, refused ranges, and the journal's two outputs reaching the right places.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import { parseFlowFile } from "../src/flow-file/flow-file.js";
import { trendNatural, widgetNatural } from "../src/gui/widgets.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function load() {
  return parseFlowFile(readFileSync(join(__dirname, "..", "..", "test-flows", "gui-headliner-sensor-freenove-s3-4in.flow.json"), "utf8"));
}

function compileFlow(mutate?: (f: ReturnType<typeof load>) => void) {
  const f = load();
  mutate?.(f);
  const links = f.edges.map((e, i) => [i, e[0], e[1], e[2], e[3], "any"] as [number, string, number, string, number, string]);
  // Credentials are resolved by the editor from the backend at load; stand-ins here.
  const configs = f.configs.map((c) =>
    c.type === "thingstudio/config/mqtt-broker" ? { ...c, properties: { ...c.properties, broker: "broker.test", port: 1883 } }
    : c.type === "thingstudio/config/wifi" ? { ...c, properties: { ...c.properties, ssid: "net", password: "pw" } }
    : c);
  return compile({ nodes: f.nodes, links, configs, screens: f.screens }, buildRegistry());
}

describe("trend widget", () => {
  it("is as wide as its columns and tall as asked", () => {
    expect(trendNatural({ columns: 60, col_width: 3, height: 48 })).toEqual({ width: 184, height: 48 });
    expect(trendNatural()).toEqual({ width: 184, height: 48 });
    expect(widgetNatural("trend", { columns: 10, col_width: 2, height: 20 })).toEqual({ width: 24, height: 20 });
  });

  it("compiles to a tsgui_trend draw with its range and column width, and ships that library", () => {
    const { source } = compileFlow();
    expect(source).toContain('_gui.widget("n22-ttrend1", tsgui_trend.make(15, 30, 3), 30000)');
    expect(source).toContain("import tsgui_trend");
  });

  it("refuses a range with the top at or below the bottom, naming the widget", () => {
    expect(() =>
      compileFlow((f) => {
        const n = f.nodes.find((x) => x.id === "n22-ttrend1")!;
        n.properties.lo = 30;
        n.properties.hi = 30;
      }),
    ).toThrow(/range low 30 must be below high 30/);
  });
});

describe("journal in a flow", () => {
  it("compiles its ring once per journal, with the class written once", () => {
    const { source } = compileFlow();
    expect(source.match(/class _Journal/g)?.length).toBe(1);
    expect(source).toContain("_Journal(156, 10000, 6, 0.5)");
    expect(source).toContain("_Journal(156, 0, 0, 0.5)");
    expect(source).toContain("_Journal(156, 60000, 0, 0.5)");
  });

  it("the headliner also publishes each reading over MQTT", () => {
    const { source } = compileFlow();
    for (const t of ["temperature", "humidity", "pressure"]) expect(source).toContain(`thingstudio/headliner/${t}`);
  });

  it("a flow with a bad journal property says which one", () => {
    expect(() =>
      compileFlow((f) => {
        f.nodes.find((x) => x.id === "n20-tj1")!.properties.rows = 0;
      }),
    ).toThrow(/journal node's rows "0"/);
  });
});
