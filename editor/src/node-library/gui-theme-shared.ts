// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/gui-theme-shared.ts
//
// A GUI theme: ten named roles, in a config node a gui screen references (gui-widget-styles-and-colour-scoping.md,
// decided 2026-10-23). One theme serves several screens and is copyable between flows, the same shape as the I2C
// bus and touch panel configs.
//
// Widgets draw by role, never by value, so one theme works on every frame format. Resolution ("fold", Mike,
// 2026-10-23) gives each format what it can hold:
//   rgb565  every role is its own colour
//   gs4     ten roles into palette indexes 0-9, six entries left for per-widget colours later
//   gs2     four entries: bg, fg, muted, accent. card/on_accent fold to bg, track to muted, ok/warn/alarm to fg
//   mono    ink and paper: fg/muted/accent/ok/warn/alarm are ink, bg/card/track/on_accent are paper
//
// A theme is optional: a screen with no theme keeps the GUI's built-in colours exactly as before.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type { CodegenContext } from "../compiler/node-definition.js";

export const GUI_THEME_CONFIG_TYPE = "thingstudio/config/gui-theme";

export type ThemeRole = "bg" | "card" | "fg" | "muted" | "track" | "accent" | "on_accent" | "ok" | "warn" | "alarm";

/** Role order, and the order an indexed palette uses. Fixed, so a gs4 theme's indexes are predictable. */
export const THEME_ROLES: readonly ThemeRole[] = [
  "bg",
  "card",
  "fg",
  "muted",
  "track",
  "accent",
  "on_accent",
  "ok",
  "warn",
  "alarm",
];

export type Theme = Record<ThemeRole, number>;

/** Field labels for the roles, shared by the theme config node and the gui screen's own theme fields, so the
 * two cannot drift (the descriptor is one vocabulary, `AGENTS.md`). */
export const THEME_ROLE_LABELS: Record<ThemeRole, string> = {
  bg: "background",
  card: "card",
  fg: "foreground",
  muted: "muted (stale values)",
  track: "track (bar and cell background)",
  accent: "accent (bars, lights)",
  on_accent: "text on accent",
  ok: "ok",
  warn: "warn",
  alarm: "alarm",
};

/** The theme presets as a select's options, plus "custom" (keep what is set). Used by the theme config and the
 * gui screen's `themePreset` field. */
export function themePresetOptions(): { value: string; label: string }[] {
  return [
    ...Object.entries(THEME_PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
    { value: "", label: "custom (keep what is set)" },
  ];
}

/** Choosing a starting point replaces the form's colours with its roles (2026-10-24). The field used to only
 * seed at creation, so switching light paper on an existing theme left dark slate's colours in place and
 * nothing changed on the panel. An empty name ("custom") keeps the current colours. */
export function applyThemePreset(props: Record<string, unknown>, presetKey: string, name: string): void {
  props[presetKey] = name;
  const preset = THEME_PRESETS[name];
  if (!preset) return;
  for (const role of THEME_ROLES) props[role] = preset.roles[role];
}

/** The colours the GUI has always drawn with, now named: what a screen with no theme uses. */
export function defaultTheme(): Theme {
  return {
    bg: 0x0000,
    card: 0x0000,
    fg: 0xffff,
    muted: 0x632c,
    track: 0x632c,
    accent: 0x3ef1,
    on_accent: 0x0000,
    ok: 0xffff,
    warn: 0xffff,
    alarm: 0xffff,
  };
}

/** The presets themes seed from (Mike, 2026-10-23: dark slate and light paper; vivid added 2026-10-24 from
 * the CYD card demo, so that demo's colours are a preset rather than a pile of overrides). Editing a role
 * makes the theme custom -- the preset is a starting point, not a lock. */
export const THEME_PRESETS: Record<string, { label: string; roles: Theme }> = {
  "dark-slate": {
    label: "dark slate",
    roles: {
      bg: 0x10a2,
      card: 0x2124,
      fg: 0xffff,
      muted: 0x8c71,
      track: 0x4208,
      accent: 0x3ef1,
      on_accent: 0x0841,
      ok: 0x3e66,
      warn: 0xfc60,
      alarm: 0xf800,
    },
  },
  "light-paper": {
    label: "light paper",
    roles: {
      bg: 0xffff,
      card: 0xef5d,
      fg: 0x0841,
      muted: 0x8c71,
      track: 0xce59,
      accent: 0x0250,
      on_accent: 0xffff,
      ok: 0x1c65,
      warn: 0xc400,
      alarm: 0xb000,
    },
  },
  vivid: {
    label: "vivid",
    roles: {
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
    },
  },
};

/** Role -> value for a format: colours for rgb565, palette indexes for the indexed formats. */
export interface ResolvedTheme {
  values: Theme;
  /** The palette the display must show, for indexed formats. Absent for rgb565 (it has no palette). */
  palette?: number[];
  /** Whether stale values can be drawn dimmer; mono cannot, and marks staleness with a dotted line instead. */
  shades: boolean;
}

export function resolveThemeForFormat(theme: Theme, format: "rgb565" | "gs4" | "gs2" | "mono"): ResolvedTheme {
  if (format === "rgb565") return { values: { ...theme }, shades: true };
  if (format === "gs4") {
    // Ten roles take indexes 0-9 in role order; the six spare entries stay black until per-widget colours exist.
    const palette: number[] = THEME_ROLES.map((role) => theme[role]);
    while (palette.length < 16) palette.push(0);
    const values = { ...theme } as Theme;
    THEME_ROLES.forEach((role, index) => {
      values[role] = index;
    });
    return { values, palette, shades: true };
  }
  // gs2 (4 entries) and mono (2): fold each role onto the entry that stands in for it.
  const four = format === "gs2";
  const palette = four ? [theme.bg, theme.fg, theme.muted, theme.accent] : [theme.bg, theme.fg];
  const foldTo: Record<ThemeRole, number> = {
    bg: 0,
    card: 0,
    fg: 1,
    muted: four ? 2 : 1,
    track: four ? 2 : 1,
    accent: four ? 3 : 1,
    on_accent: 0,
    ok: 1,
    warn: 1,
    alarm: 1,
  };
  const values = { ...theme } as Theme;
  for (const role of THEME_ROLES) values[role] = foldTo[role];
  return { values, palette, shades: four };
}

/** A theme as the Python dict the GUI library takes. RGB565 values are byte-swapped for the panel, as the
 * four-colour tuple was before it; an indexed theme's values are palette indexes and are not swapped. */
export function themeLiteral(values: Theme, swapBytes: boolean): string {
  const swap = (c: number) => (swapBytes ? ((c & 0xff) << 8) | (c >> 8) : c);
  const hex = (c: number) => `0x${swap(c).toString(16).padStart(4, "0")}`;
  const pairs = THEME_ROLES.map((role) => `'${role}': ${hex(values[role])}`);
  return `{${pairs.join(", ")}}`;
}

/** Roles and the starting point as a Theme. `where` names the owner in errors ("GUI theme", "GUI screen theme"). */
function themeFromProps(props: Record<string, unknown>, presetKey: string, where: string): Theme {
  const presetName = typeof props[presetKey] === "string" ? (props[presetKey] as string) : "";
  const preset = THEME_PRESETS[presetName];
  const theme: Theme = { ...(preset ? preset.roles : defaultTheme()) };
  for (const role of THEME_ROLES) {
    const raw = props[role];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new CompileError(`${where} "${role}" must be an RGB565 colour (0-65535), got "${String(raw)}"`);
    }
    theme[role] = value;
  }
  return theme;
}

/** Whether a gui screen has a theme of its own (a starting point or any role set). */
export function hasScreenTheme(props: Readonly<Record<string, unknown>>): boolean {
  const preset = typeof props.themePreset === "string" ? props.themePreset : "";
  return preset !== "" || THEME_ROLES.some((role) => props[role] !== undefined && props[role] !== null && props[role] !== "");
}

/** The theme a gui screen uses: its own starting point and roles first (the screen owns its colours), then a
 * `themeConfigId` config for older flows (a shared theme), then the built-in default. */
export function resolveScreenTheme(ctx: CodegenContext, screen: GraphNode): Theme {
  const own = screen.properties;
  if (hasScreenTheme(own)) {
    const presetName = typeof own.themePreset === "string" ? own.themePreset : "";
    if (presetName !== "" && !THEME_PRESETS[presetName]) {
      throw new CompileError(`GUI screen theme: unknown starting point "${presetName}"`);
    }
    return themeFromProps(own, "themePreset", "GUI screen theme");
  }
  const configId = own.themeConfigId;
  if (typeof configId !== "string" || configId === "") return defaultTheme();
  return themeFromProps(ctx.resolveConfig(configId), "preset", "GUI theme");
}
