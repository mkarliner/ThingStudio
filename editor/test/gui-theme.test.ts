// SPDX-License-Identifier: Apache-2.0
// editor/test/gui-theme.test.ts
//
// The GUI theme resolved per frame format (gui-widget-styles-and-colour-scoping.md, decided 2026-10-23).
// "Fold" (Mike): a format takes the roles it has room for and stands the rest in for the ones it has, rather than
// refusing a theme it cannot show. A theme is optional, so the default must stay exactly the colours the GUI drew
// with before themes existed -- that is what keeps every existing flow unchanged.

import { describe, expect, it } from "vitest";
import {
  THEME_PRESETS,
  THEME_ROLES,
  defaultTheme,
  resolveScreenTheme,
  resolveThemeForFormat,
  themeLiteral,
  type Theme,
} from "../src/node-library/gui-theme-shared.js";
import { buildRegistry } from "../src/node-library/registry.js";
import type { CodegenContext } from "../src/compiler/node-definition.js";

describe("the default theme", () => {
  it("is the colours the widgets already used", () => {
    const t = defaultTheme();
    expect([t.fg, t.muted, t.bg, t.accent]).toEqual([0xffff, 0x632c, 0x0000, 0x3ef1]);
  });

  it("resolves to those four on every format, so nothing changes without a theme", () => {
    expect(resolveThemeForFormat(defaultTheme(), "rgb565").values.fg).toBe(0xffff);
    const gs4 = resolveThemeForFormat(defaultTheme(), "gs4");
    expect(gs4.values.fg).toBe(2); // role index, not a colour
    expect(gs4.palette!.slice(0, 3)).toEqual([0x0000, 0x0000, 0xffff]);
  });
});

describe("folding", () => {
  const theme: Theme = { ...defaultTheme(), bg: 0x1111, fg: 0x2222, muted: 0x3333, accent: 0x4444, card: 0x5555, track: 0x6666, on_accent: 0x7777, ok: 0x8888, warn: 0x9999, alarm: 0xaaaa };

  it("gs4 gives every role its own index and a sixteen-entry palette", () => {
    const r = resolveThemeForFormat(theme, "gs4");
    expect(THEME_ROLES.map((role) => r.values[role])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.palette).toHaveLength(16);
    expect(r.palette![0]).toBe(0x1111);
    expect(r.palette!.slice(10)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(r.shades).toBe(true);
  });

  it("gs2 keeps four colours and folds the rest onto them", () => {
    const r = resolveThemeForFormat(theme, "gs2");
    expect(r.palette).toEqual([0x1111, 0x2222, 0x3333, 0x4444]);
    expect(r.values.card).toBe(0); // card -> background
    expect(r.values.on_accent).toBe(0);
    expect(r.values.track).toBe(2); // track -> muted
    expect(r.values.alarm).toBe(1); // alarm -> foreground
    expect(r.shades).toBe(true);
  });

  it("mono is ink and paper, with no dim shade", () => {
    const r = resolveThemeForFormat(theme, "mono");
    expect(r.palette).toEqual([0x1111, 0x2222]);
    expect(r.values.bg).toBe(0);
    expect(r.values.fg).toBe(1);
    expect(r.values.muted).toBe(1); // no dimmer shade: staleness is a dotted line on mono
    expect(r.shades).toBe(false);
  });
});

describe("presets and a screen's theme", () => {
  it("each preset has every role", () => {
    for (const [name, preset] of Object.entries(THEME_PRESETS)) {
      for (const role of THEME_ROLES) {
        expect(preset.roles[role], `${name}.${role}`).toBeTypeOf("number");
      }
    }
  });

  it("reads the screen's theme config, with roles overriding the preset", () => {
    const ctx = {
      resolveConfig: () => ({ preset: "light-paper", accent: 0x1234 }),
    } as unknown as CodegenContext;
    const theme = resolveScreenTheme(ctx, { id: "s", type: "thingstudio/gui_screen", properties: { themeConfigId: "t1" } });
    expect(theme.bg).toBe(THEME_PRESETS["light-paper"]!.roles.bg);
    expect(theme.accent).toBe(0x1234);
  });

  it("gives a screen with no theme the default", () => {
    const ctx = { resolveConfig: () => { throw new Error("should not be called"); } } as unknown as CodegenContext;
    expect(resolveScreenTheme(ctx, { id: "s", type: "thingstudio/gui_screen", properties: {} })).toEqual(defaultTheme());
  });

  it("refuses a role that is not an RGB565 colour", () => {
    const ctx = { resolveConfig: () => ({ preset: "dark-slate", fg: "#ffffff" }) } as unknown as CodegenContext;
    expect(() => resolveScreenTheme(ctx, { id: "s", type: "thingstudio/gui_screen", properties: { themeConfigId: "t1" } })).toThrow(
      /must be an RGB565 colour/,
    );
  });

  it("writes the theme dict the GUI library takes, byte-swapped", () => {
    const lit = themeLiteral({ ...defaultTheme(), fg: 0xffff, bg: 0x0000, accent: 0x3ef1 });
    expect(lit).toContain(`'fg': 0xffff`);
    expect(lit).toContain(`'accent': 0xf13e`);
    expect(buildRegistry().has("thingstudio/gui_screen")).toBe(true);
  });
});
