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
import { bandRowsFor, frameBytes } from "../src/node-library/gui.js";
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
    // Drawn in strips: no full-frame buffer anywhere in the flow.
    expect(source).not.toContain(`bytearray(${frameBytes(320, 240, "gs4")})`);
    expect(source).toMatch(/_gui\.add_surface\(thingstudio_gui\.BandSurface\("screen", 320, 240, framebuf\.GS4_HMSB,/);
    expect(source).toMatch(/_band_y, _band_rows = await \w+_s\.next_band\(\)/);
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
    // strips of bandRowsFor() rows; 240 rows of 320 px gs4 is 32 rows a strip, 7 full and one of 16
    expect(out).toContain(`FRAME ${bandRowsFor(320, 240, "gs4") * frameBytes(320, 1, "gs4")}`);
    expect(out).toContain("DEBUG node=nav_dbg payload='climate'");
    expect(out).toMatch(/PAGE climate PUSHES [2-9]/);
    expect(out).not.toContain("NODE_ERROR");
  });
  it("a tap on a toggle asks for the opposite state out of its output, goes pending, and settles when the flow confirms; a navigate button changes page", () => {
    const g = buttonFlow({ mode: "toggle", valueType: "string", onValue: "ON", offValue: "OFF" }, { wiredIn: true, wiredOut: true, navigate: true });
    const { source } = compile(g, buildRegistry());
    const dir = mkdtempSync(join(tmpdir(), "ts-gui-btn-"));
    const lib = join(dir, "lib");
    mkdirSync(lib);
    copyFileSync(join(RUNTIME, "vendor", "thingstudio_gui", "gui.py"), join(lib, "thingstudio_gui.py"));
    for (const w of ["label", "readout", "bar", "led", "pagedots", "button"]) copyFileSync(join(RUNTIME, "vendor", "thingstudio_gui", `${w}.py`), join(lib, `tsgui_${w}.py`));
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
        "def mid(g, wid):",
        "    r = g.widgets[wid].placements[0][2]",
        "    return r[0] + r[2] // 2, r[1] + r[3] // 2",
        "async def main():",
        "    import flow",
        "    await asyncio.sleep_ms(300)",
        "    g = flow._gui",
        "    print('START', g.state('light'), g.value('light'))",  // the flow said OFF
        "    x, y = mid(g, 'light')",
        "    g.tap('screen', 'down', x, y)",
        "    g.tap('screen', 'up', x, y)",
        "    await asyncio.sleep_ms(300)",
        "    print('PENDING', g.state('light'), g.value('light'))",
        "    g.set_value('light', 'ON')",
        "    print('CONFIRMED', g.state('light'), g.value('light'))",
        "    x, y = mid(g, 'go')",
        "    g.tap('screen', 'down', x, y)",
        "    g.tap('screen', 'up', x, y)",
        "    print('PAGE', g.surfaces['screen'].page)",
        "    raise SystemExit",
        "try:",
        "    asyncio.run(main())",
        "except SystemExit:",
        "    pass",
      ].join("\n"),
    );
    const out = execFileSync(MP!, [join(dir, "driver.py")], { encoding: "utf8", timeout: 20000 });
    expect(out).toContain("START 1 False");
    expect(out).toContain("DEBUG node=out payload='ON'");
    expect(out).toContain("PENDING 4 True");
    expect(out).toContain("CONFIRMED 1 True");
    expect(out).toContain("PAGE second");
    expect(out).not.toContain("NODE_ERROR");
  });
});

/** One screen with a button "light" (properties given) and, optionally, a navigate button "go" to page "second".
 * wiredIn: a startup node feeds the button 'OFF'. wiredOut: its output goes to a debug node "out". */
function buttonFlow(props: Record<string, unknown>, o: { wiredIn?: boolean; wiredOut?: boolean; navigate?: boolean; panel?: boolean } = {}): GraphData {
  const children: unknown[] = [{ kind: "widget", node: "light", font: "font_body20" }];
  if (o.navigate) children.push({ kind: "widget", node: "go", font: "font_body20" });
  const g: GraphData = {
    nodes: [
      node("screen", "gui_screen", { name: "tft", width: 320, height: 240, frameFormat: "gs4", minInterval: 50, ...(o.panel ? { touchPanelConfigId: "panel" } : {}) }),
      node("frame_fn", "function", { code: "return None" }),
      node("light", "gui_button", { name: "light", text: "Light", ...props }),
    ],
    links: [[1, "screen", 0, "frame_fn", 0, "bytes"]],
    screens: {
      screen: {
        pages: [
          { name: "home", root: { kind: "column", padding: 6, gap: 6, children } as never },
          { name: "second", root: { kind: "column", children: [{ kind: "text", text: "Two", font: "font_body16" }] } },
        ],
      },
    },
  };
  if (o.wiredIn) {
    g.nodes.push(node("start", "startup", { payloadType: "string", payloadValue: "OFF" }));
    g.links.push([2, "start", 0, "light", 0, "any"]);
  }
  if (o.wiredOut) {
    g.nodes.push(node("out", "debug"));
    g.links.push([3, "light", 0, "out", 0, "any"]);
  }
  if (o.navigate) g.nodes.push(node("go", "gui_button", { name: "go", mode: "navigate", text: "Go", target: "second" }));
  if (o.panel) {
    g.configs = [
      { id: "bus", type: "thingstudio/config/i2c-bus", properties: { bus: 0, scl: 15, sda: 16, freq: 400000 } },
      { id: "panel", type: "thingstudio/config/touch-panel", properties: { controller: "ft6336u", i2cConfigId: "bus", address: "0x38", rstPin: 18, pollMs: 20, width: 320, height: 480 } },
    ] as never;
  }
  return g;
}

/** Warnings other than the unrelated "no board known" pin note. */
const ownWarnings = (w: string[]): string[] => w.filter((x) => !x.startsWith("No board or processor known"));

describe("touch buttons", () => {
  it("registers a flow-controlled toggle: touchable, its on/off values, and a two-faced node (input call + output coroutine)", () => {
    const { source, warnings } = compile(buttonFlow({ mode: "toggle", valueType: "string", onValue: "ON", offValue: "OFF" }, { wiredIn: true, wiredOut: true, panel: true }), buildRegistry());
    expect(ownWarnings(warnings)).toEqual([]);
    expect(source).toContain('_gui.widget("light", tsgui_button.make(font_body20, None, "ON", "OFF"), 0, True)');
    expect(source).toContain('_gui.button("light", "toggle", controlled=True, send=None, on_val="ON", off_val="OFF", on_press=False, target="", pending_ms=5000, initial=False)');
    expect(source).toContain('_btn = await _gui.event("light")');
    expect(source).toContain("msg = {'payload': _btn, 'topic': \"light\"}");
    expect(source).toMatch(/_gui\.set_value\("light", msg\.get\('payload'\)\)/);
    expect(source).not.toContain("_gui.touch(");
  });

  it("an unwired toggle keeps its own state, and a momentary one sends true by default", () => {
    const own = compile(buttonFlow({ mode: "toggle", initial: true }, { wiredOut: true, panel: true }), buildRegistry()).source;
    expect(own).toContain('_gui.button("light", "toggle", controlled=False, send=None, on_val=True, off_val=False, on_press=False, target="", pending_ms=5000, initial=True)');
    const mom = compile(buttonFlow({}, { wiredOut: true, panel: true }), buildRegistry()).source;
    expect(mom).toContain('_gui.button("light", "momentary", controlled=False, send=True,');
    const num = compile(buttonFlow({ valueType: "number", value: "3", fireOn: "press" }, { wiredOut: true, panel: true }), buildRegistry()).source;
    expect(num).toContain("send=3, on_val=1");
    expect(num).toContain("on_press=True");
  });

  it("warns about a toggle or momentary button whose output goes nowhere, but not a navigate button", () => {
    for (const mode of ["toggle", "momentary"]) {
      const w = compile(buttonFlow({ mode }, { panel: true }), buildRegistry()).warnings;
      expect(w.some((x) => x.includes('button "light"') && x.includes("nowhere")), mode).toBe(true);
    }
    expect(ownWarnings(compile(buttonFlow({ mode: "navigate", target: "next" }, { panel: true }), buildRegistry()).warnings)).toEqual([]);
  });

  it("checks a navigate target against the screen's pages, and wants a target at all", () => {
    expect(() => compile(buttonFlow({ mode: "navigate", target: "nowhere" }), buildRegistry())).toThrow(/"nowhere" isn't next, prev, back, home or a page on its screen/);
    expect(() => compile(buttonFlow({ mode: "navigate", target: "second" }), buildRegistry())).not.toThrow();
    expect(() => compile(buttonFlow({ mode: "navigate", target: "" }), buildRegistry())).toThrow(/choose where it goes/);
  });

  it("rejects bad button settings with the button named", () => {
    expect(() => compile(buttonFlow({ mode: "wobble" }, { wiredOut: true }), buildRegistry())).toThrow(/mode must be momentary, toggle or navigate/);
    expect(() => compile(buttonFlow({ mode: "toggle", pendingTimeout: 2 }, { wiredOut: true }), buildRegistry())).toThrow(/wait for confirmation must be 5 s or more/);
    expect(() => compile(buttonFlow({ valueType: "number", value: "x" }, { wiredOut: true }), buildRegistry())).toThrow(/not a valid number/);
  });

  it("the screen polls its touch panel itself: driver, status on the screen node, no touch wire", () => {
    const { source } = compile(buttonFlow({ mode: "toggle" }, { wiredOut: true, panel: true }), buildRegistry());
    expect(source).toContain("import ft6336u\n");
    expect(source).toMatch(/runtime\.spawn\(_gui\.poll_touch\("screen", lambda: ft6336u\.FT6336U\(_i2c_bus_0, 56, machine\.Pin\(18, machine\.Pin\.OUT\), 320, 480, False, False, False\), 20, lambda st, text: runtime\.report_status\("screen", st, text\), "FT6336U at 0x38 on I2C bus 0"\), "screen"\)/);
    expect(source).toContain("_i2c_bus_0 = runtime.shared('i2c', 0,");
  });

  it("warns when a screen has buttons but no touch panel", () => {
    const w = compile(buttonFlow({ mode: "toggle" }, { wiredOut: true }), buildRegistry()).warnings;
    expect(w.some((x) => x.includes('GUI screen "tft"') && x.includes("no touch panel"))).toBe(true);
    expect(compile(buttonFlow({ mode: "toggle" }, { wiredOut: true, panel: true }), buildRegistry()).warnings.some((x) => x.includes("no touch panel"))).toBe(false);
  });

  it("a button draws its board label, else its flow label", () => {
    const src = (props: Record<string, unknown>) => compile(buttonFlow(props, { wiredOut: true }), buildRegistry()).source;
    expect(src({ text: "Go", label: "Fire!" })).toContain('tsgui_button.make(font_body20, "Go")');
    expect(src({ text: "", label: "Fire!" })).toContain('tsgui_button.make(font_body20, "Fire!")');
  });

  it("a panel with no I2C bus is refused, naming the screen that uses it", () => {
    const g = buttonFlow({ mode: "toggle" }, { wiredOut: true, panel: true });
    for (const n of g.configs ?? []) if (n.type === "thingstudio/config/touch-panel") n.properties.i2cConfigId = "";
    expect(() => compile(g, buildRegistry())).toThrow(/touch panel for .*"tft".* has no I2C bus/);
  });

  it("a panel used by a gui screen and a touch node is refused, naming both", () => {
    const g = buttonFlow({ mode: "toggle" }, { wiredOut: true, panel: true });
    g.nodes.push(node("raw", "touch_i2c", { touchPanelConfigId: "panel" }), node("raw_dbg", "debug"));
    g.links.push([40, "raw", 0, "raw_dbg", 0, "any"]);
    expect(() => compile(g, buildRegistry())).toThrow(/both use the same touch panel/);
    expect(() => compile(g, buildRegistry())).toThrow(/"tft"/);
  });

  it("a modal's output sends how it closed; the screen's modal is watched from import", () => {
    const g = heroGraph();
    g.nodes.push(node("closed_dbg", "debug"));
    g.links.push([50, "alarm", 0, "closed_dbg", 0, "any"]);
    const { source, warnings } = compile(g, buildRegistry());
    expect(warnings).toEqual([]);
    expect(source).toContain('_gui.watch_modal("screen", "alarm")');
    expect(source).toContain('_reason = await _gui.modal_closed("screen", "alarm")');
    expect(source).toContain("msg = {'payload': _reason, 'topic': \"alarm\"}");
  });
});

describe("a full-colour (RGB565) GUI screen", () => {
  it("passes byte-swapped colours, so the strips are already in the panel's byte order", () => {
    const g = heroGraph();
    const screen = g.nodes.find((n) => n.type === "thingstudio/gui_screen")!;
    screen.properties.frameFormat = "rgb565";
    const { source } = compile(g, buildRegistry());
    expect(source).toMatch(/BandSurface\("screen", 320, 240, framebuf\.RGB565,/);
    expect(source).toContain(`, ${bandRowsFor(320, 240, "rgb565")}, 640, (0xffff, 0x2c63, 0x0000, 0xf13e))`);
    expect(bandRowsFor(320, 240, "rgb565")).toBe(8);
  });
  it("leaves the grey formats without a colours argument", () => {
    const { source } = compile(heroGraph(), buildRegistry());
    expect(source).not.toContain("0xf13e");
  });
});

describe.each(["gui-hero-cyd.flow.json", "gui-hero-cyd-dummy.flow.json", "gui-hero-freenove-s3-4in.flow.json", "gui-hero-freenove-s3-4in-colour.flow.json", "gui-hero-freenove-s3-4in-landscape.flow.json", "gui-touch-freenove-s3-4in.flow.json"])("the example GUI flow test-flows/%s", (file) => {
  it("loads and compiles without warnings", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseFlowFile } = await import("../src/flow-file/flow-file.js");
    const f = parseFlowFile(readFileSync(join(__dirname, "..", "..", "test-flows", file), "utf8"));
    const links = f.edges.map((e, i) => [i, e[0], e[1], e[2], e[3], "any"] as [number, string, number, string, number, string]);
    // Credentials are resolved by the editor from the backend at load; stand-ins here.
    const configs = f.configs.map((c) =>
      c.type === "thingstudio/config/mqtt-broker" ? { ...c, properties: { ...c.properties, broker: "broker.test", port: 1883 } }
      : c.type === "thingstudio/config/wifi" ? { ...c, properties: { ...c.properties, ssid: "net", password: "pw" } }
      : c);
    const r = compile({ nodes: f.nodes, links, configs, screens: f.screens }, buildRegistry());
    expect(r.warnings.filter((w) => w.includes("widget") || w.includes("GUI"))).toEqual([]);
    expect(r.source).toContain("_gui.add_surface");
  });

  it("every wire in it is one the canvas accepts (a refused wire drops on load)", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseFlowFile } = await import("../src/flow-file/flow-file.js");
    const { socketForPayloadType } = await import("../src/app/rete/sockets.js");
    const { resolvePortType } = await import("../src/compiler/node-definition.js");
    const f = parseFlowFile(readFileSync(join(__dirname, "..", "..", "test-flows", file), "utf8"));
    const reg = buildRegistry();
    const byId = new Map(f.nodes.map((n) => [n.id, n]));
    for (const [from, slot, to] of f.edges) {
      const a = byId.get(from)!;
      const b = byId.get(to)!;
      const outs = reg.get(a.type)!.ports?.outputs ?? [];
      const out = resolvePortType(outs[slot] ?? outs[0]!, a.properties);
      const inp = resolvePortType(reg.get(b.type)!.ports!.inputs![0]!, b.properties);
      expect(socketForPayloadType(inp).isCompatibleWith(socketForPayloadType(out)), `${from} (${out}) -> ${to} (${inp})`).toBe(true);
    }
  });
});
