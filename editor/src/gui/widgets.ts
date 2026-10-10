// SPDX-License-Identifier: Apache-2.0
// editor/src/gui/widgets.ts
//
// The GUI widgets' natural sizes, as the layout engine (layout.ts) needs them. Each mirrors its board-side
// draw routine in device-runtime/src/vendor/thingstudio_gui/<widget>.py exactly: both are checked against
// the same fixture (test/fixtures/gui-widget-sizes.json, by gui-widgets.test.ts here and
// device-runtime/test/test_gui_widgets.py on the board side), so what the editor lays out is what the board
// draws. Change one, change both.

import { getFont, textWidth } from "./font-metrics.js";
import type { Size } from "./layout.js";

export const UNKNOWN_TEXT = "--";
const DIGITS = "0123456789";

export interface LabelConfig {
  readonly font: string;
  /** Static text; absent: shows the bound value. */
  readonly text?: string;
  /** For a bound label: room for this many of the font's widest glyph. */
  readonly max_chars?: number;
}

export interface ReadoutConfig {
  readonly font: string;
  readonly units_font?: string;
  readonly units?: string;
  readonly decimals?: number;
  /** The value range the field is sized for. */
  readonly lo?: number;
  readonly hi?: number;
  readonly gap?: number;
}

export interface ButtonConfig {
  readonly font: string;
  /** The button's text; absent: room for max_chars of the font's widest glyph (a bound value replaces the text). */
  readonly text?: string;
  readonly max_chars?: number;
  /** Space between the text and the button's edge, all round. */
  readonly pad?: number;
}

export interface BarConfig {
  readonly min_width?: number;
  readonly height?: number;
}

export interface TrendConfig {
  readonly columns?: number;
  readonly col_width?: number;
  readonly height?: number;
}

export interface LedConfig {
  readonly diameter?: number;
}

export interface PageDotsConfig {
  readonly pages: number;
  readonly diameter?: number;
  readonly gap?: number;
}

function glyphWidth(font: string, ch: string): number {
  return textWidth(font, ch);
}

function widestPrintable(font: string): number {
  let w = 0;
  for (let c = 32; c < 127; c++) w = Math.max(w, glyphWidth(font, String.fromCharCode(c)));
  return w;
}

export function labelNatural(cfg: LabelConfig): Size {
  const height = getFont(cfg.font).height;
  if (cfg.text !== undefined) return { width: textWidth(cfg.font, cfg.text), height };
  return { width: widestPrintable(cfg.font) * (cfg.max_chars ?? 8), height };
}

/** Python's "%.Nf" for the range ends. toFixed matches it for the values a readout range holds. */
function formatFixed(v: number, decimals: number): string {
  return v.toFixed(decimals);
}

/** Width of the readout's number field: the widest of lo and hi formatted, each digit at the widest digit's
 * width, other characters as drawn; never narrower than "--". */
export function readoutField(font: string, lo: number, hi: number, decimals: number): number {
  let dw = 0;
  for (const c of DIGITS) dw = Math.max(dw, glyphWidth(font, c));
  let best = 0;
  for (const v of [lo, hi]) {
    let w = 0;
    for (const c of formatFixed(v, decimals)) w += DIGITS.includes(c) ? dw : glyphWidth(font, c);
    best = Math.max(best, w);
  }
  return Math.max(best, textWidth(font, UNKNOWN_TEXT));
}

export function readoutNatural(cfg: ReadoutConfig): Size {
  const f = getFont(cfg.font);
  let width = readoutField(cfg.font, cfg.lo ?? -99, cfg.hi ?? 999, cfg.decimals ?? 1);
  let height = f.height;
  if (cfg.units) {
    if (!cfg.units_font) throw new Error("readout with units needs a units font");
    const u = getFont(cfg.units_font);
    width += (cfg.gap ?? 4) + textWidth(cfg.units_font, cfg.units);
    height = Math.max(height, Math.max(0, f.baseline - u.baseline) + u.height);
  }
  return { width, height };
}

export function buttonNatural(cfg: ButtonConfig): Size {
  const pad = cfg.pad ?? 8;
  const t = labelNatural({ font: cfg.font, text: cfg.text || undefined, max_chars: cfg.max_chars });
  return { width: t.width + 2 * pad, height: t.height + 2 * pad };
}

export function barNatural(cfg: BarConfig = {}): Size {
  return { width: cfg.min_width ?? 40, height: cfg.height ?? 12 };
}

export function trendNatural(cfg: TrendConfig = {}): Size {
  return { width: (cfg.columns ?? 60) * (cfg.col_width ?? 3) + 4, height: cfg.height ?? 48 };
}

export function ledNatural(cfg: LedConfig = {}): Size {
  const d = cfg.diameter ?? 12;
  return { width: d, height: d };
}

export function pageDotsNatural(cfg: PageDotsConfig): Size {
  const d = cfg.diameter ?? 6;
  return { width: cfg.pages * d + Math.max(0, cfg.pages - 1) * (cfg.gap ?? 4), height: d };
}

export type WidgetKind = "label" | "readout" | "bar" | "trend" | "led" | "pagedots" | "button";

/** Natural size of any widget kind from its config (the fixture's shape). */
export function widgetNatural(kind: WidgetKind, cfg: Record<string, unknown>): Size {
  switch (kind) {
    case "label":
      return labelNatural(cfg as unknown as LabelConfig);
    case "readout":
      return readoutNatural(cfg as unknown as ReadoutConfig);
    case "bar":
      return barNatural(cfg as BarConfig);
    case "trend":
      return trendNatural(cfg as TrendConfig);
    case "led":
      return ledNatural(cfg as LedConfig);
    case "pagedots":
      return pageDotsNatural(cfg as unknown as PageDotsConfig);
    case "button":
      return buttonNatural(cfg as unknown as ButtonConfig);
  }
}
