// SPDX-License-Identifier: Apache-2.0
// editor/test/display-spi-theme-palette.test.ts
//
// A gui screen's theme owns the palette of the display it is wired to (gui-widget-styles-and-colour-scoping.md,
// decided 2026-10-23). display_spi is a package, so its compile hook runs in Python (WASI) and has to fold the
// theme itself; gui-theme-shared.ts resolves the same fold for the screen's own indexes. These tests run the real
// hook against the real resolver for every indexed format and both presets, so the two cannot drift apart.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GraphData } from "../src/compiler/graph.js";
import { runHookOnce } from "../src/compile-hook/run-hook.js";
import { runCompileHooks } from "../src/node-library/compile-hooks.js";
import { buildRegistry } from "../src/node-library/registry.js";
import {
  THEME_PRESETS,
  resolveThemeForFormat,
  type Theme,
} from "../src/node-library/gui-theme-shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmBytes = new Uint8Array(readFileSync(join(__dirname, "../../micropython-wasi/micropython-wasi.wasm")));
const runner = {
  run: (src: string, ctx: unknown, props: Record<string, unknown>) =>
    runHookOnce({ wasmBytes, hookSource: src, context: ctx, properties: props }),
};
const registry = buildRegistry();

const THEME_CONFIG = "thingstudio/config/gui-theme";

function graph(format: string, themeProps: Record<string, unknown> | null): GraphData {
  const themeConfig = themeProps === null ? [] : [{ id: "theme1", type: THEME_CONFIG, properties: themeProps }];
  return {
    nodes: [
      { id: "screen1", type: "thingstudio/gui_screen", properties: { themeConfigId: themeProps === null ? "" : "theme1" } },
      { id: "display1", type: "thingstudio/display_spi", properties: { frameFormat: format } },
    ],
    links: [["screen1", 0, "display1", 0]],
    configs: [
      { id: "bus0", type: "thingstudio/config/spi-bus", properties: { spiBus: 2 } },
      ...themeConfig,
    ],
  } as unknown as GraphData;
}

async function paletteOf(format: string, themeProps: Record<string, unknown> | null): Promise<number[]> {
  const g = graph(format, themeProps);
  const hooks = await runCompileHooks(g, registry, runner);
  const display = hooks.results.get("display1");
  return (display?.properties?.palette as number[]) ?? [];
}

const cases = ["gs4", "gs2", "mono"] as const;

describe("the display takes its palette from the wired screen's theme", () => {
  for (const presetName of Object.keys(THEME_PRESETS)) {
    for (const format of cases) {
      it(`${presetName} on ${format} matches resolveThemeForFormat`, async () => {
        const want = resolveThemeForFormat(THEME_PRESETS[presetName]!.roles, format).palette!;
        expect(await paletteOf(format, { preset: presetName })).toEqual(want);
      });
    }
  }

  it("a role edited on the theme reaches the palette", async () => {
    const roles: Theme = { ...THEME_PRESETS["dark-slate"]!.roles, accent: 0x1234 };
    const want = resolveThemeForFormat(roles, "gs2").palette!;
    expect(await paletteOf("gs2", { preset: "dark-slate", accent: 0x1234 })).toEqual(want);
  });

  it("no theme leaves the display's own palette alone", async () => {
    const gs4Default = [
      0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0x07ff, 0xf81f,
      0x8410, 0x4208, 0xc618, 0xfd20, 0x8000, 0x0400, 0x0010, 0x0410,
    ];
    expect(await paletteOf("gs4", null)).toEqual(gs4Default);
  });
});
