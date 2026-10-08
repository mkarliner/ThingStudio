// SPDX-License-Identifier: Apache-2.0
// editor/test/gui-compile.test.ts -- GUI nodes and the `screens` section through the compiler (2026-10-08).
//
// The last test runs the compiled flow on the real MicroPython unix port when MICROPYTHON_BIN is set (as
// device-runtime/test/test_listener_integration.py does), with the board-side GUI libraries installed under
// their board names, and checks values, navigation and rendered frames end to end. Skipped otherwise.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import type { ScreensSection } from "../src/gui/screens.js";
import { frameBytes } from "../src/node-library/gui.js";
import { buildRegistry } from "../src/node-library/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(__dirname, "..", "..", "device-runtime", "src");

const node = (id: string, type: string, properties: Record<string, unknown> = {}): GraphNode => ({ id, type: `thingstudio/${type}`, properties });

function heroGraph(screens?: ScreensSection): GraphData {
  return {
    nodes: [
      node("start", "startup", { payloadType: "bool", payloadValue: true }),
      node("fn_temp", "function", { code: "msg['payload'] = -10.5\nreturn msg" }),
      node("fn_press", "function", { code: "msg['payload'] = 1013\nreturn msg" }),
      node("temp", "gui_readout", { name: "Temperature", units: "°C", decimals: 1, lo: -20, hi: 50, staleAfter: 60 }),
      node("press", "gui_readout", { name: "Pressure", units: "hPa", decimals: 0, lo: 900, hi: 1100 }),
      node("pbar", "gui_bar", { name: "Pressure bar", lo: 950, hi: 1050 }),
      node("alive", "gui_led", { name: "Alive" }),
      node("nav_in", "inject", { payloadType: "string", payloadValue: "next" }),
      node("nav", "gui_navigator", { name: "nav" }),
      node("nav_dbg", "debug"),
      node("screen", "gui_screen", { name: "tft", width: 320, height: 240, frameFormat: "gs4", minInterval: 50 }),
      node("frame_fn", "function", { code: "print('FRAME', len(msg['payload']))\nreturn None" }),
      node("alarm", "gui_modal", { name: "alarm", priority: 1 }),
    ],
    links: [
      [1, "start", 0, "fn_temp", 0, "any"],
      [2, "start", 0, "fn_press", 0, "any"],
      [3, "fn_temp", 0, "temp", 0, "any"],
      [4, "fn_press", 0, "press", 0, "any"],
      [5, "fn_press", 0, "pbar", 0, "any"],
      [6, "start", 0, "alive", 0, "any"],
      [7, "nav_in", 0, "nav", 0, "string"],
      [8, "nav", 0, "nav_dbg", 0, "string"],
      [9, "screen", 0, "frame_fn", 0, "bytes"],
      [10, "start", 0, "alarm", 0, "any"],
    ],
    screens: screens ?? {
      screen: {
        pages: [
          {
            name: "home",
            root: {
              kind: "column",
              padding: 6,
              gap: 6,
              children: [
                { kind: "row", alignSelf: "stretch", children: [{ kind: "text", text: "Living room", font: "font_body20", grow: 1 }, { kind: "widget", node: "alive", diameter: 14 }] },
                { kind: "text", text: "Temperature", font: "font_body16" },
                { kind: "widget", node: "temp", font: "font_digits64", unitsFont: "font_body24" },
                { kind: "row", gap: 8, children: [{ kind: "text", text: "Pressure", font: "font_body16" }, { kind: "widget", node: "press", font: "font_digits24" }] },
                { kind: "widget", node: "pbar", alignSelf: "stretch" },
                { kind: "spacer", grow: 1 },
                { kind: "pagedots", alignSelf: "center" },
              ],
            },
          },
          { name: "climate", root: { kind: "column", children: [{ kind: "text", text: "Climate", font: "font_body24" }] } },
          { name: "detail", parent: "climate", root: { kind: "column", children: [{ kind: "text", text: "Detail", font: "font_body16" }] } },
        ],
        modals: [{ node: "alarm", root: { kind: "column", padding: 10, children: [{ kind: "text", text: "Alarm!", font: "font_body24" }] } }],
      },
    },
  };
}

describe("compiling a GUI flow", () => {
  it("emits one GUI, every widget registered once, the screen's surface and frame source", () => {
    const { source, warnings } = compile(heroGraph(), buildRegistry());
    expect(warnings).toEqual([]);
    expect(source.match(/_gui = thingstudio_gui\.GUI/g)).toHaveLength(1);
    for (const id of ["temp", "press", "pbar", "alive"]) expect(source.match(new RegExp(`_gui\\.widget\\("${id}"`, "g")), id).toHaveLength(1);
    expect(source).toContain('tsgui_readout.make(font_digits64, font_body24, "°C", 1, -20, 50)');
    expect(source).toContain(`bytearray(${frameBytes(320, 240, "gs4")})`);
    expect(source).toMatch(/_gui\.add_surface\(thingstudio_gui\.FrameSurface\("screen"/);
    expect(source).toContain('"alarm": {"widgets": [');
    for (const mod of ["thingstudio_gui", "tsgui_readout", "tsgui_bar", "tsgui_led", "tsgui_label", "tsgui_pagedots", "font_digits64", "font_body24", "font_body20"]) {
      expect(source).toContain(`import ${mod}\n`);
    }
    // the core block comes before the surface that uses it
    expect(source.indexOf("_gui = thingstudio_gui.GUI")).toBeLessThan(source.indexOf("_gui.add_surface"));
  });

  it("reports layout problems with the widget, page and screen named", () => {
    const g = heroGraph();
    const screens = g.screens as ScreensSection;
    const wide: ScreensSection = {
      screen: { ...screens.screen!, pages: [{ name: "home", root: { kind: "row", children: [{ kind: "widget", node: "temp", font: "font_digits64", unitsFont: "font_body24" }, { kind: "widget", node: "press", font: "font_digits64", unitsFont: "font_body24" }] } }] },
    };
    expect(() => compile({ ...g, screens: wide }, buildRegistry())).toThrow(/GUI layout:[\s\S]*contents need \d+px of width but it has 320px on page "home" of display "tft": widget "Temperature" \d+px, widget "Pressure" \d+px/);
  });

  it("refuses a widget placed twice, a font missing a character, and an unknown node", () => {
    const g = heroGraph();
    const base = (g.screens as ScreensSection).screen!;
    const twice: ScreensSection = { screen: { ...base, pages: [{ name: "home", root: { kind: "column", children: [{ kind: "widget", node: "temp" }, { kind: "widget", node: "temp" }] } }] } };
    expect(() => compile({ ...g, screens: twice }, buildRegistry())).toThrow(/widget "Temperature" is placed twice/);
    const glyph: ScreensSection = { screen: { ...base, pages: [{ name: "home", root: { kind: "text", text: "Größe", font: "font_body16" } }] } };
    expect(() => compile({ ...g, screens: glyph }, buildRegistry())).toThrow(/font font_body16 has no "ö", "ß"/);
    const ghost: ScreensSection = { screen: { ...base, pages: [{ name: "home", root: { kind: "widget", node: "nope" } }] } };
    expect(() => compile({ ...g, screens: ghost }, buildRegistry())).toThrow(/"nope" isn't a GUI widget node/);
  });

  it("warns about a widget that isn't on any screen", () => {
    const g = heroGraph();
    g.nodes.push(node("lonely", "gui_led", { name: "Lonely" }));
    g.links.push([99, "start", 0, "lonely", 0, "any"]);
    expect(compile(g, buildRegistry()).warnings).toContain('widget "Lonely" isn\'t placed on any screen, so nothing shows it');
  });

  it("asks which screen a navigator drives when there are two, and wants a modal laid out", () => {
    const g = heroGraph();
    g.nodes.push(node("screen2", "gui_screen", { name: "oled", width: 128, height: 64, frameFormat: "mono" }));
    const screens = { ...(g.screens as ScreensSection), screen2: { pages: [{ name: "only", root: { kind: "text", text: "hi", font: "font_body12" } }] } } as ScreensSection;
    expect(() => compile({ ...g, screens }, buildRegistry())).toThrow(/choose which GUI screen it acts on \(the flow has 2\)/);
    const noModal = heroGraph({ screen: { pages: [{ name: "home", root: { kind: "text", text: "x", font: "font_body12" } }] } });
    noModal.nodes = noModal.nodes.filter((n) => !["temp", "press", "pbar", "alive"].includes(n.id));
    noModal.links = noModal.links.filter((l) => !["temp", "press", "pbar", "alive"].includes(l[3]));
    expect(() => compile(noModal, buildRegistry())).toThrow(/modal "alarm" isn't laid out on its screen yet/);
  });

  it("a screen with no layout says so", () => {
    const g = heroGraph({});
    g.nodes = g.nodes.filter((n) => ["screen", "frame_fn"].includes(n.id));
    g.links = g.links.filter((l) => l[1] === "screen");
    expect(() => compile(g, buildRegistry())).toThrow(/GUI screen "tft" has no pages yet/);
  });
});

const MP = process.env.MICROPYTHON_BIN;
describe.skipIf(!MP || !existsSync(MP))("the compiled GUI flow on the MicroPython unix port", () => {
  it("shows values, navigates and pushes frames of the right size", () => {
    const { source } = compile(heroGraph(), buildRegistry());
    const dir = mkdtempSync(join(tmpdir(), "ts-gui-"));
    // Board names, as flow dependencies install them.
    const lib = join(dir, "lib");
    mkdirSync(lib);
    copyFileSync(join(RUNTIME, "vendor", "thingstudio_gui", "gui.py"), join(lib, "thingstudio_gui.py"));
    for (const w of ["label", "readout", "bar", "led", "pagedots"]) copyFileSync(join(RUNTIME, "vendor", "thingstudio_gui", `${w}.py`), join(lib, `tsgui_${w}.py`));
    for (const f of readdirSync(join(RUNTIME, "vendor", "fonts"))) if (f.endsWith(".py")) copyFileSync(join(RUNTIME, "vendor", "fonts", f), join(lib, f));
    copyFileSync(join(RUNTIME, "vendor", "threadsafe_event", "threadsafe_event.py"), join(lib, "threadsafe_event.py"));
    writeFileSync(join(dir, "flow.py"), source);
    writeFileSync(
      join(dir, "driver.py"),
      [
        "import sys",
        `sys.path.insert(0, ${JSON.stringify(lib)})`,
        `sys.path.insert(0, ${JSON.stringify(RUNTIME)})`,
        `sys.path.insert(0, ${JSON.stringify(dir)})`,
        "import asyncio",
        "import runtime",
        "async def main():",
        "    import flow",
        "    await asyncio.sleep_ms(300)",
        "    g = flow._gui",
        "    s = g.surfaces['screen']",
        "    print('TEMP', g.state('temp'), g.value('temp'))",
        "    print('VISIBLE', s.visible(), s.queued())",
        "    g.navigate('screen', 'back')",  // acknowledge the alarm the startup node opened
        "    runtime.fire_trigger('nav_in')",
        "    await asyncio.sleep_ms(300)",
        "    print('PAGE', s.page, 'PUSHES', s.pushes)",
        "    raise SystemExit",
        "try:",
        "    asyncio.run(main())",
        "except SystemExit:",
        "    pass",
      ].join("\n"),
    );
    const out = execFileSync(MP!, [join(dir, "driver.py")], { encoding: "utf8", timeout: 20000 });
    expect(out).toContain("TEMP 1 -10.5");
    expect(out).toContain("VISIBLE alarm 0");
    expect(out).toContain(`FRAME ${frameBytes(320, 240, "gs4")}`);
    expect(out).toContain("DEBUG node=nav_dbg payload='climate'");
    expect(out).toMatch(/PAGE climate PUSHES [2-9]/);
    expect(out).not.toContain("NODE_ERROR");
  });
});

describe("the example GUI flow in test-flows/", () => {
  it("gui-hero-cyd.flow.json loads and compiles without warnings", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseFlowFile } = await import("../src/flow-file/flow-file.js");
    const f = parseFlowFile(readFileSync(join(__dirname, "..", "..", "test-flows", "gui-hero-cyd.flow.json"), "utf8"));
    const links = f.edges.map((e, i) => [i, e[0], e[1], e[2], e[3], "any"] as [number, string, number, string, number, string]);
    const r = compile({ nodes: f.nodes, links, configs: f.configs, screens: f.screens }, buildRegistry());
    expect(r.warnings.filter((w) => w.includes("widget") || w.includes("GUI"))).toEqual([]);
    expect(r.source).toContain("_gui.add_surface");
  });
});
