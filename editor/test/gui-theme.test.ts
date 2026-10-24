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
  applyThemePreset,
  defaultTheme,
  resolveScreenTheme,
  resolveThemeForFormat,
  themeLiteral,
  type Theme,
} from "../src/node-library/gui-theme-shared.js";
import { buildRegistry } from "../src/node-library/registry.js";
import { CONFIG_TYPES } from "../src/app/rete/config-types.js";
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
  it("the theme config can save and load a named preset in ~/.thingstudio", () => {
    expect(CONFIG_TYPES["thingstudio/config/gui-theme"]?.presetType).toBe("gui_theme");
  });

  it("each preset has every role", () => {
    for (const [name, preset] of Object.entries(THEME_PRESETS)) {
      for (const role of THEME_ROLES) {
        expect(preset.roles[role], `${name}.${role}`).toBeTypeOf("number");
      }
    }
  });

  it("the vivid preset carries the CYD card demo's colours", () => {
    expect(THEME_PRESETS.vivid!.roles).toEqual({
      bg: 0x0844,
      card: 0x695b,
      fg: 0xffff,
      muted: 0xb559,
      track: 0x396b,
      accent: 0x073f,
      on_accent: 0x0083,
      ok: 0x072e,
      warn: 0xfe20,
      alarm: 0xf8a8,
    });
  });

  it("the vivid preset folds to the indexed formats like any other", () => {
    const gs4 = resolveThemeForFormat(THEME_PRESETS.vivid!.roles, "gs4");
    expect(gs4.shades).toBe(true);
    expect(gs4.palette?.slice(0, 3)).toEqual([0x0844, 0x695b, 0xffff]);
    const mono = resolveThemeForFormat(THEME_PRESETS.vivid!.roles, "mono");
    expect(mono.shades).toBe(false);
    expect(mono.palette).toEqual([0x0844, 0xffff]);
  });

  it("reads the screen's theme config, with roles overriding the preset", () => {
    const ctx = {
      resolveConfig: () => ({ preset: "light-paper", accent: 0x1234 }),
    } as unknown as CodegenContext;
    const theme = resolveScreenTheme(ctx, { id: "s", type: "thingstudio/gui_screen", properties: { themeConfigId: "t1" } });
    expect(theme.bg).toBe(THEME_PRESETS["light-paper"]!.roles.bg);
    expect(theme.accent).toBe(0x1234);
  });

  it("choosing a starting point replaces the colours, and custom keeps them", () => {
    const props: Record<string, unknown> = { preset: "dark-slate", ...THEME_PRESETS["dark-slate"]!.roles };
    applyThemePreset(props, "preset", "light-paper");
    expect(props.preset).toBe("light-paper");
    for (const role of THEME_ROLES) expect(props[role]).toBe(THEME_PRESETS["light-paper"]!.roles[role]);
    const before = { ...props };
    applyThemePreset(props, "preset", "");
    expect(props).toEqual({ ...before, preset: "" });
  });

  it("reads the theme from the screen's own fields, and they win over a shared config", () => {
    const ctx = { resolveConfig: () => ({ preset: "light-paper" }) } as unknown as CodegenContext;
    const theme = resolveScreenTheme(ctx, {
      id: "s",
      type: "thingstudio/gui_screen",
      properties: { themeConfigId: "t1", themePreset: "vivid", accent: 0x1234 },
    });
    expect(theme.bg).toBe(THEME_PRESETS.vivid!.roles.bg);
    expect(theme.accent).toBe(0x1234);
  });

  it("refuses a starting point it does not know", () => {
    const ctx = {} as unknown as CodegenContext;
    expect(() => resolveScreenTheme(ctx, { id: "s", type: "thingstudio/gui_screen", properties: { themePreset: "not-a-preset" } })).toThrow(
      /unknown starting point/,
    );
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

  it("writes the theme dict the GUI library takes, byte-swapped for colour and not for indexes", () => {
    const lit = themeLiteral({ ...defaultTheme(), fg: 0xffff, bg: 0x0000, accent: 0x3ef1 }, true);
    expect(lit).toContain(`'fg': 0xffff`);
    expect(lit).toContain(`'accent': 0xf13e`);
    expect(buildRegistry().has("thingstudio/gui_screen")).toBe(true);
  });

  it("does not byte-swap an indexed theme: its values are palette indexes", () => {
    const gs2 = resolveThemeForFormat(defaultTheme(), "gs2");
    expect(themeLiteral(gs2.values, false)).toContain(`'fg': 0x0001`);
    expect(themeLiteral(gs2.values, false)).toContain(`'bg': 0x0`);
  });
});
