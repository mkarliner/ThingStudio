// SPDX-License-Identifier: Apache-2.0
// editor/test/remote-compile.test.ts
//
// The remote display's editor authoring story (2026-11-06, built on the spike): compiles a whole remote
// flow through the real registry and checks the exact generated lines the board runs -- the ts_wifi
// bring-up, the shared ts_http_server on the web server config's port, the compiled definition (grid to
// flex), the ts_remote.Remote call and its start, and what remote widgets contribute (or don't contribute)
// to the flow's own gui_core block. Panel-path invariants stay green in gui-compile.test.ts; the board
// side's half is device-runtime/test/test_remote_display.py.

import { describe, expect, it } from "vitest";
import { compile } from "../src/compiler/compile.js";
import type { Target } from "../src/definitions/target.js";
import { BUILTIN_DEFINITION_FILES } from "../src/definitions/builtin.js";
import { buildDefinitionSet } from "../src/definitions/definitions.js";
import { resolveTarget } from "../src/definitions/target.js";
import { REMOTE_DISPLAY_MEASUREMENTS } from "../src/definitions/remote-display-measurements.js";
import type { GraphData, GraphNode } from "../src/compiler/graph.js";
import { buildRegistry } from "../src/node-library/registry.js";

const node = (id: string, type: string, properties: Record<string, unknown> = {}): GraphNode => ({
  id,
  type: `thingstudio/${type}`,
  properties,
});

function remoteGraph(): GraphData {
  return {
    nodes: [
      node("boot", "startup", { payloadType: "bool", payloadValue: true }),
      node("fn_temp", "function", { code: "msg['payload'] = 20.5\nreturn msg" }),
      node("temp", "gui_readout", { name: "Temperature", units: "°C", decimals: 1 }),
      node("hum", "gui_readout", { name: "Humidity", units: "%", decimals: 0 }),
      node("bar", "gui_bar", { lo: 0, hi: 100 }),
      node("led", "gui_led", { name: "Ready" }),
      node("pump", "gui_button", { name: "Pump", mode: "toggle", controlled: "input", onText: "PUMP ON", offText: "PUMP OFF" }),
      node("boop", "gui_button", { name: "Boop", mode: "momentary", text: "BOOP" }),
      node("th", "gui_number", { name: "Threshold", settingsKey: "threshold", form: "cfg", defaultValue: 21 }),
      node("nm", "gui_text", { name: "Name", settingsKey: "name", form: "cfg" }),
      node("save", "gui_submit", { name: "Save", form: "cfg" }),
      node("pos", "gui_slider", { name: "LED level", lo: 0, hi: 100 }),
      node("dbg", "debug"),
      node(
        "screen",
        "gui_screen",
        { name: "main", displayKind: "remote", webServerConfigId: "websrv", wifiConfigId: "wifi1" },
      ),
    ],
    links: [
      [0, "boot", 0, "fn_temp", 0, "any"],
      [1, "fn_temp", 0, "temp", 0, "any"],
      [2, "fn_temp", 0, "hum", 0, "any"],
      [3, "fn_temp", 0, "bar", 0, "any"],
      [4, "fn_temp", 0, "led", 0, "any"],
      [5, "fn_temp", 0, "dbg", 0, "any"],
    ],
    configs: [
      { id: "websrv", type: "thingstudio/config/web-server", properties: { port: 80 } },
      { id: "wifi1", type: "thingstudio/config/wifi", properties: { ssid: "net", password: "pw", security: "password" } },
    ],
    // The screens tree: one page with a two-readout row, a bar, the buttons, the fields, the slider.
    screens: {
      screen: {
        pages: [
          {
            name: "home",
            elements: [
              { kind: "widget", node: "temp", row: 0, col: 0, rowSpan: 1, colSpan: 6 },
              { kind: "widget", node: "hum", row: 0, col: 6, rowSpan: 1, colSpan: 6 },
              { kind: "widget", node: "bar", row: 1, col: 0, colSpan: 12 },
              { kind: "widget", node: "led", row: 2, col: 0, colSpan: 2 },
              { kind: "widget", node: "pump", row: 2, col: 2, colSpan: 4 },
              { kind: "widget", node: "boop", row: 2, col: 6, colSpan: 4 },
              { kind: "text", text: "Settings", row: 3, col: 0, colSpan: 6 },
              { kind: "widget", node: "th", row: 4, col: 0, colSpan: 6 },
              { kind: "widget", node: "nm", row: 4, col: 6, colSpan: 6 },
              { kind: "widget", node: "save", row: 5, col: 0, colSpan: 3 },
              { kind: "widget", node: "pos", row: 6, col: 0, colSpan: 12 },
            ],
          },
        ],
      },
    },
  };
}

describe("compiling a remote display flow", () => {
  it("emits the WiFi bring-up, the shared server on the config's port, and ts_remote.Remote with the compiled definition", async () => {
    const { source, warnings } = compile(remoteGraph(), buildRegistry());
    expect(warnings).toEqual([
      "button \"Pump\" sends its state nowhere: wire its output to something.",
      "button \"Boop\" sends its value nowhere: wire its output to something.",
      'GUI screen "main" is a remote display: no board or processor is selected, so its memory needs are not checked.',
    ]);
    expect(source).toContain("import ts_remote\nimport ts_http_server");
    // WiFi: the flow's config, its own statement, idempotent bring-up.
    expect(source).toContain(`_wifi_sta = ts_wifi.ensure_station("net", "pw", "password", False)`);
    // The server: keyed singleton from the web server config's port, mounting nothing of its own
    // (the remote display's routes are ts_remote's business).
    expect(source).toContain(`runtime.shared('http_server', 80, 'v1', lambda: ts_http_server.Server(80, [], {}))`);
    expect(source).toContain("ts_remote.Remote(_gui, ");
    expect(source).toContain(".stage()");
    expect(source).toContain('.set_link_policy("stale")');
    expect(source).toContain("runtime.spawn(");
  });

  it("the compiled definition is the grid, converted to flex with the spans as weights", () => {
    const { source } = compile(remoteGraph(), buildRegistry());
    console.log("=== REMOTE SOURCE ===\n" + source.split("\n").filter((l) => l.includes("_refresh") || l.includes("remote") || l.includes("def")).join("\n"));
    expect(source).toContain(`"display": "main"`);
    expect(source).toContain(`{"kind": "column", "gap": 8, "padding": 8, "children": [`);
    // the readouts' row: two children, one each half the page (colSpan 6 of 12 -> equal weight)
    expect(source).toContain(`{"wid": "temp", "kind": "readout", "config": {"caption": "", "units": "°C", "decimals": 1}, "grow": 6, "flex": True}`);
    // the fields carry their settings key and form
    expect(source).toContain(`"key": "threshold", "form": "cfg", "default": 21`);
    expect(source).toContain(`"kind": "submit", "config": {"form": "cfg", "label": "Save"}`);
    // the button carries its editor mode; the row's own children keep the page's controls
    expect(source).toContain(`"mode": "toggle"`);
  });

  it("a widget on a remote screen is not registered twice: gui_core skips it and ts_remote owns it", async () => {
    const { source } = compile(remoteGraph(), buildRegistry());
    // The flow registers the panel-time pieces it needs; the remote widgets' registration lives in ts_remote.
    expect(source).toContain(`_gui = thingstudio_gui.GUI(on_error=runtime._report_error)`);
    expect(source).not.toContain(`_gui.widget("temp"`);
    expect(source).not.toContain(`_gui.widget("th"`);
  });

  it("the screen's own source coroutine waits on the page-change stream", async () => {
    const { source } = compile(remoteGraph(), buildRegistry());
    expect(source).toContain("await _gui.page_changed(");
    expect(source).toContain(`'payload': _page, 'topic': "main"`);
  });

  it("a remote screen wired to no web server config is a loud compile error", async () => {
    const g = remoteGraph();
    (g.nodes.find((n) => n.id === "screen")!.properties as Record<string, unknown>).webServerConfigId = "";
    expect(() => compile(g, buildRegistry())).toThrow(/web server config/);
  });

  it("fields on a physical panel screen are refused by name", () => {
    expect(() => compile(g2WithPanelTable(), buildRegistry())).toThrow(/remote screen/);
  });
});

describe("the untested-board warning (definitions/remote-display-measurements.ts)", () => {
  const defs = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);
  const targetFor = (choice: string): Target => {
    const r = resolveTarget(defs, choice, null);
    if (!r.target) throw new Error(`no target for ${choice}`);
    return r.target;
  };
  const remoteWarning = (target: Target | null): string =>
    compile(remoteGraph(), buildRegistry(), { target }).warnings.find((w) => w.includes("remote display")) ?? "";

  it("names the measured image for a processor measured comfortable, and still warns about a stock install", () => {
    const w = remoteWarning(targetFor("processor:esp32-s3"));
    expect(w).toContain("measured comfortable on the ESP32-S3 custom image");
    expect(w).toContain("a stock install is unmeasured");
  });

  it("names the measured below-floor case", () => {
    expect(remoteWarning(targetFor("processor:esp32-c3"))).toContain(
      "measured below the feature's floor on a stock install");
  });

  it("says unmeasured for any other target", () => {
    expect(remoteWarning(targetFor("processor:rp2040"))).toContain("not measured for remote displays");
  });

  it("says the memory needs are unchecked when no target is known", () => {
    expect(remoteWarning(null)).toContain("no board or processor is selected");
  });

  it("every registered measurement names a real processor", () => {
    // the registry rule: a new entry that doesn't resolve fails here, not in a user's compile
    for (const id of REMOTE_DISPLAY_MEASUREMENTS.keys()) {
      expect(defs.processors.has(id), id).toBe(true);
    }
  });
});

/** g2WithPanelTable: the same graph with a panel-shaped screens section, so "fields on a panel" is exercised
 * against the real placement checker, not just the string branch. */
function g2WithPanelTable(): GraphData {
  const g = remoteGraph() as unknown as { configs: { id: string; type: string; properties: Record<string, unknown> }[]; screens: Record<string, { pages: unknown[]; modals?: unknown[] }>; nodes: { id: string; properties: Record<string, unknown> }[] };
  g.configs[1] = { id: "wifi1", properties: { ssid: "net", password: "pw", security: "password" }, type: "thingstudio/config/wifi" };
  // Recast the screen as a panel wired to no display: the panel path still needs its grid size (defaults
  // kick in) and the placement check finds the field widgets where a physical screen can't show them.
  const screenNode = g.nodes.find((n) => n.id === "screen")!;
  screenNode.properties = { name: "screen", displayKind: "panel" };
  g.screens = {
    screen: {
      // (checked through the real placement path: the page's own shape is what a physical screen sees)
      pages: [{
        name: "home",
        elements: [{ kind: "widget", node: "th", row: 0, col: 0 }],
      }],
    } as never,
  };
  return g as unknown as GraphData;
}
