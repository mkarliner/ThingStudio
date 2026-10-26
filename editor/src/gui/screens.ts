// SPDX-License-Identifier: Apache-2.0
// editor/src/gui/screens.ts
//
// The `screens` section of a flow and its compile step (gui-layout-widget-system-scoping.md; the grid model is
// gui-grid-layout-scoping.md, 2026-10-24). Wiring says how data moves; `screens` says where widgets sit: per GUI
// screen node, its pages and modals as elements placed on a cell grid. Widget nodes are referenced by id, so the
// flow view and the GUI view share one record.
//
// A screen declares `gridColumns` x `gridRows` (rows 0 = from the display's shape). An element has a row, a
// column and spans; the compiler maps cells to pixels for the wired display and auto-fits each font to its span,
// so no layout value is in pixels. Every problem -- an overlap, a span outside the grid, text that cannot fit --
// is collected with its screen and page named, never thrown one at a time.

import { getFont, fontIds, missingChars, textWidth } from "./font-metrics.js";
import type { Rect } from "./layout.js";
import { readoutField } from "./widgets.js";
import type { GraphNode } from "../compiler/graph.js";

// ---- the format ------------------------------------------------------------------------------------------

/** One element placed on a page's or modal's grid. Row/col are 0-based cells; spans default to 1. */
export interface GridElement {
  readonly row: number;
  readonly col: number;
  readonly rowSpan?: number;
  readonly colSpan?: number;
  /** A panel drawn behind this span (and anything placed on it). Its own `node`/`text` are not used. */
  readonly card?: boolean;
  /** Defaults to "widget" when `node` is set, else "text". */
  readonly kind?: "widget" | "text" | "pagedots";
  /** A widget node's id (kind "widget"). */
  readonly node?: string;
  /** Static text (kind "text"). */
  readonly text?: string;
  /** Text alignment inside the span (text, and a label's value). */
  readonly align?: "left" | "center" | "right";
}

export interface PageSpec {
  readonly name: string;
  /** A child page (drill-down); absent for a carousel page. */
  readonly parent?: string;
  readonly elements: readonly GridElement[];
}

export interface ModalSpec {
  /** The gui_modal node this is the GUI face of. */
  readonly node: string;
  readonly elements: readonly GridElement[];
}

export interface ScreenSpec {
  readonly pages: readonly PageSpec[];
  /** Top-level page order; default: the pages without a parent, in order. */
  readonly carousel?: readonly string[];
  readonly modals?: readonly ModalSpec[];
}

/** The flow's `screens` section: gui_screen node id -> its screen. */
export type ScreensSection = Readonly<Record<string, ScreenSpec>>;

// ---- node types this compile step knows --------------------------------------------------------------------

export const GUI_SCREEN = "thingstudio/gui_screen";
export const GUI_MODAL = "thingstudio/gui_modal";
export const GUI_BUTTON = "thingstudio/gui_button";
export const WIDGET_TYPES = {
  "thingstudio/gui_label": "label",
  "thingstudio/gui_readout": "readout",
  "thingstudio/gui_bar": "bar",
  "thingstudio/gui_trend": "trend",
  "thingstudio/gui_led": "led",
  "thingstudio/gui_button": "button",
} as const;
export type WidgetNodeType = keyof typeof WIDGET_TYPES;

export function isWidgetType(type: string): type is WidgetNodeType {
  return type in WIDGET_TYPES;
}

/** How errors name a node: its `name` property, else its type and short id. */
export function nodeLabel(node: GraphNode): string {
  const pick = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const n = pick(node.properties.label) || pick(node.properties.name);
  return n ? `"${n}"` : `${node.type.replace("thingstudio/", "")} ${node.id.slice(0, 6)}`;
}

export interface CompiledSurface {
  /** gui_screen node id. */
  readonly screen: string;
  /** Python dict literal: {page: {"parent": ..., "widgets": [(id, (x, y, w, h)), ...]}} */
  readonly pagesPy: string;
  readonly carouselPy: string;
  readonly modalsPy: string;
  /** Static elements (text, page dots) registered for this screen: Python statements. */
  readonly staticRegistrations: string[];
  /** Every leaf's rect, for the editor's preview and tests: element id -> rect, per page or modal name. */
  readonly rects: ReadonlyMap<string, ReadonlyMap<string, Rect>>;
}

export interface CompiledScreens {
  readonly surfaces: CompiledSurface[];
  /** Widget node id -> Python expression building its draw routine. */
  readonly widgetDraws: ReadonlyMap<string, string>;
  /** Histogram node id -> how many columns its rect holds, at the column width codegen gave it. A series shorter
   * than this draws only what it has, right-aligned, and leaves the rest of the rect empty (2026-10-26). */
  readonly trendColumns: ReadonlyMap<string, number>;
  /** Font modules and widget libraries the generated code imports. */
  readonly imports: ReadonlySet<string>;
  readonly errors: string[];
  readonly warnings: string[];
}

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

export function pyStr(s: string): string {
  return JSON.stringify(s);
}

function pyNum(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${n}`);
  return Number.isInteger(n) ? String(n) : String(n);
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? fallback : n;
}

/** How many cells a screen has: `gridColumns` (default 12) and `gridRows` (0 = from the display's shape). */
export function gridSize(screen: GraphNode, display: ScreenSize): { columns: number; rows: number } {
  const columns = Math.max(2, Math.round(num(screen.properties.gridColumns, 12)));
  const declared = Math.round(num(screen.properties.gridRows, 0));
  const rows = declared > 0 ? declared : Math.max(1, Math.round((columns * display.height) / Math.max(1, display.width)));
  return { columns, rows };
}

const byHeight = (ids: readonly string[]): string[] => [...ids].sort((a, b) => getFont(b).height - getFont(a).height);
const BODY_FONTS = byHeight(fontIds().filter((f) => f.startsWith("font_body")));
const DIGITS_FONTS = byHeight(fontIds().filter((f) => f.startsWith("font_digits")));

/** The largest font of `family` whose height fits `height` and whose text passes `fits`, or an error. An
 * explicit `chosen` font (a widget's `font` property) is used when it fits, else reported. */
function pickFont(height: number, family: readonly string[], fits?: (font: string) => boolean, chosen?: string): string {
  if (chosen) {
    if (getFont(chosen).height <= height && (!fits || fits(chosen))) return chosen;
    throw new Error(`the chosen font ${chosen} does not fit its cells`);
  }
  for (const font of family) {
    if (getFont(font).height <= height && (!fits || fits(font))) return font;
  }
  throw new Error(`does not fit its cells (no font fits ${height}px high)`);
}

// ---- compile -----------------------------------------------------------------------------------------------

/** Lays out and checks every screen. `sizeOf` gives a gui_screen node's pixel size; `modalName` a gui_modal
 * node's name. Nothing here throws for a problem in the flow: they come back in `errors`. */
export function compileScreens(
  screens: ScreensSection,
  nodes: readonly GraphNode[],
  sizeOf: (screen: GraphNode) => ScreenSize,
): CompiledScreens {
  const errors: string[] = [];
  const warnings: string[] = [];
  const imports = new Set<string>();
  const widgetDraws = new Map<string, string>();
  // Histogram node id -> the columns its rect holds, so the journal feeding it can be checked against them.
  const trendColumns = new Map<string, number>();
  const surfaces: CompiledSurface[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placedOn = new Map<string, { screen: string; where: string }>(); // widget node id -> first placement

  for (const [screenId, spec] of Object.entries(screens)) {
    const screen = byId.get(screenId);
    if (!screen || screen.type !== GUI_SCREEN) {
      errors.push(`screens: "${screenId}" isn't a GUI screen node in this flow`);
      continue;
    }
    const sname = nodeLabel(screen);
    const size = sizeOf(screen);
    const { columns, rows } = gridSize(screen, size);
    const pageNames = new Set<string>();
    for (const p of spec.pages) {
      if (pageNames.has(p.name)) errors.push(`screen ${sname}: two pages are called "${p.name}"`);
      pageNames.add(p.name);
    }
    for (const p of spec.pages) {
      if (p.parent !== undefined && !pageNames.has(p.parent)) errors.push(`screen ${sname}: page "${p.name}" has unknown parent "${p.parent}"`);
    }
    const carousel = spec.carousel ?? spec.pages.filter((p) => p.parent === undefined).map((p) => p.name);
    if (carousel.length === 0) errors.push(`screen ${sname} has no pages`);
    for (const c of carousel) if (!pageNames.has(c)) errors.push(`screen ${sname}: carousel names unknown page "${c}"`);

    let staticCount = 0;
    const staticRegistrations: string[] = [];
    const rectsByPage = new Map<string, ReadonlyMap<string, Rect>>();
    const cellW = size.width / columns;
    const cellH = size.height / rows;
    // A gutter in the gap between spans, derived from the cell so it scales with the display; also used as a
    // card's inside padding (a widget on the card insets by the same amount).
    const gutter = Math.max(0, Math.round(0.10 * Math.min(cellW, cellH)));
    const round = Math.round;

    const spanOf = (e: GridElement): { rs: number; cs: number } => ({
      rs: Math.max(1, Math.round(num(e.rowSpan, 1))),
      cs: Math.max(1, Math.round(num(e.colSpan, 1))),
    });

    const rectOf = (e: GridElement): Rect => {
      const { rs, cs } = spanOf(e);
      const x0 = round(e.col * cellW) + gutter;
      const y0 = round(e.row * cellH) + gutter;
      const x1 = round((e.col + cs) * cellW) - gutter;
      const y1 = round((e.row + rs) * cellH) - gutter;
      return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
    };

    const elementLabel = (e: GridElement): string => {
      if (e.card) return `panel at row ${e.row}, column ${e.col}`;
      if (e.kind === "text") return `text "${e.text ?? ""}"`;
      if (e.kind === "pagedots") return "page dots";
      const n = e.node ? byId.get(e.node) : undefined;
      return n ? `widget ${nodeLabel(n)}` : `widget "${e.node ?? "?"}"`;
    };

    /** Bounds and overlap checks for one page or modal. Cards may sit under elements, not under each other. */
    const checkPlacement = (elements: readonly GridElement[], where: string): void => {
      const leafCells = new Map<string, string>();
      const cardCells = new Map<string, string>();
      for (const e of elements) {
        const { rs, cs } = spanOf(e);
        const label = elementLabel(e);
        if (!Number.isInteger(e.row) || !Number.isInteger(e.col) || e.row < 0 || e.col < 0) {
          errors.push(`${label} ${where}: row and column must be whole cells, got row ${String(e.row)}, column ${String(e.col)}`);
          continue;
        }
        if (e.row + rs > rows || e.col + cs > columns) {
          errors.push(
            `${label} ${where}: ${rs}x${cs} cells at row ${e.row}, column ${e.col} goes outside the ${rows}x${columns} grid`,
          );
          continue;
        }
        const grid = e.card ? cardCells : leafCells;
        for (let r = e.row; r < e.row + rs; r++) {
          for (let c = e.col; c < e.col + cs; c++) {
            const key = `${r},${c}`;
            const other = grid.get(key);
            if (other) {
              errors.push(`${label} ${where} overlaps ${other} at row ${r}, column ${c}`);
              break;
            }
            grid.set(key, label);
          }
        }
      }
    };

    const placeWidget = (node: GraphNode, rect: Rect, where: string, align: "left" | "center" | "right"): string | null => {
      const kind = WIDGET_TYPES[node.type as WidgetNodeType];
      const label = nodeLabel(node);
      const p = node.properties;
      const w = rect.width;
      const h = rect.height;
      let draw: string;
      try {
        switch (kind) {
          case "label": {
            const font = pickFont(h, BODY_FONTS, (f) => textWidth(f, "--") <= w, typeof p.font === "string" ? p.font : undefined);
            draw = `tsgui_label.make(${font}, None, ${pyStr(align)})`;
            imports.add(font);
            break;
          }
          case "readout": {
            const units = typeof p.units === "string" ? p.units : "";
            const caption = typeof p.caption === "string" ? p.caption.trim() : "";
            const decimals = Math.max(0, Math.round(num(p.decimals, 1)));
            const lo = num(p.lo, 0);
            const hi = num(p.hi, 100);
            if (hi < lo) throw new Error(`range low ${lo} is above high ${hi}`);
            const gap = Math.max(2, Math.round(Math.min(w, h) * 0.05));
            // A caption takes the top third at most; the number and units share what is left.
            const captionFont = caption
              ? pickFont(Math.max(1, Math.floor(h / 3)), BODY_FONTS, (f) => textWidth(f, caption) <= w && missingChars(f, caption).length === 0)
              : undefined;
            const capH = captionFont ? getFont(captionFont).height + 2 : 0;
            const digits = pickFont(h - capH, DIGITS_FONTS, (f) => {
              const field = readoutField(f, lo, hi, decimals);
              if (!units) return field <= w;
              return BODY_FONTS.some((u) => getFont(u).height <= h - capH && field + gap + textWidth(u, units) <= w);
            }, typeof p.font === "string" && p.font !== "" ? p.font : undefined);
            const field = readoutField(digits, lo, hi, decimals);
            const unitsFont = units
              ? pickFont(h - capH, BODY_FONTS, (u) => field + gap + textWidth(u, units) <= w && missingChars(u, units).length === 0)
              : undefined;
            draw =
              `tsgui_readout.make(${digits}, ${unitsFont ?? "None"}, ${pyStr(units)}, ${decimals}, ${pyNum(lo)}, ${pyNum(hi)}, ${gap}` +
              (captionFont ? `, ${pyStr(caption)}, ${captionFont})` : ")");
            imports.add(digits);
            if (unitsFont) imports.add(unitsFont);
            if (captionFont) imports.add(captionFont);
            break;
          }
          case "bar": {
            const lo = num(p.lo, 0);
            const hi = num(p.hi, 100);
            if (hi <= lo) throw new Error(`range low ${lo} must be below high ${hi}`);
            draw =
              p.style === "segments"
                ? `tsgui_bar.make(${pyNum(lo)}, ${pyNum(hi)}, "segments", ${Math.max(1, Math.round(num(p.segments, 10)))})`
                : `tsgui_bar.make(${pyNum(lo)}, ${pyNum(hi)})`;
            break;
          }
          case "trend": {
            const lo = num(p.lo, 0);
            const hi = num(p.hi, 100);
            if (hi <= lo) throw new Error(`range low ${lo} must be below high ${hi}`);
            // Bars are a fraction of a cell, so the histogram scales with the panel (8 bars per cell by default).
            const colWidth = Math.max(1, Math.round(cellW / 8));
            draw = `tsgui_trend.make(${pyNum(lo)}, ${pyNum(hi)}, ${colWidth})`;
            // The same arithmetic tsgui_trend.draw() uses: inner width, one column every colWidth px.
            trendColumns.set(node.id, Math.max(0, Math.floor((w - 4) / colWidth)));
            break;
          }
          case "button": {
            const pad = Math.max(2, Math.round(Math.min(w, h) / 8));
            const style = p.style === "switch" ? "switch" : p.style === "filled" ? "filled" : "box";
            if (style === "switch" && p.mode !== "toggle") throw new Error("a switch style needs a toggle button (set mode to toggle)");
            if (p.mode === "toggle") {
              const onText = typeof p.onText === "string" && p.onText !== "" ? p.onText : "ON";
              const offText = typeof p.offText === "string" && p.offText !== "" ? p.offText : "OFF";
              const widest = [onText, offText, "--"].reduce((a, b) => (textWidth("font_body16", b) > textWidth("font_body16", a) ? b : a));
              const font = pickFont(h - 2 * pad, BODY_FONTS, (f) => textWidth(f, widest) <= w - 2 * pad && missingChars(f, widest).length === 0);
              draw = `tsgui_button.make(${font}, None, ${pyStr(onText)}, ${pyStr(offText)}${style === "box" ? "" : `, ${pyStr(style)}`})`;
              imports.add(font);
              break;
            }
            const text = [p.text, p.label].map((v) => (typeof v === "string" ? v.trim() : "")).find((v) => v !== "") || undefined;
            const font = pickFont(h - 2 * pad, BODY_FONTS, (f) => textWidth(f, text ?? "--") <= w - 2 * pad && missingChars(f, text ?? "--").length === 0);
            draw = `tsgui_button.make(${font}, ${text === undefined ? "None" : pyStr(text)}${style === "box" ? "" : `, None, None, ${pyStr(style)}`})`;
            imports.add(font);
            break;
          }
          case "led": {
            const diameter = Math.max(2, Math.min(w, h));
            if (p.style === "chip") {
              const onText = typeof p.onText === "string" && p.onText !== "" ? p.onText : "On";
              const offText = typeof p.offText === "string" && p.offText !== "" ? p.offText : "Off";
              const widest = [onText, offText, "--"].reduce((a, b) => (textWidth("font_body12", b) > textWidth("font_body12", a) ? b : a));
              const font = pickFont(h - 4, BODY_FONTS, (f) => textWidth(f, widest) <= w - 8 && missingChars(f, widest).length === 0);
              draw = `tsgui_led.make(${diameter}, "chip", ${pyStr(onText)}, ${pyStr(offText)}, ${font})`;
              imports.add(font);
            } else {
              draw = `tsgui_led.make(${diameter})`;
            }
            break;
          }
        }
      } catch (e) {
        errors.push(`widget ${label}: ${e instanceof Error ? e.message : String(e)} ${where}`);
        return null;
      }
      imports.add(`tsgui_${kind}`);
      const earlier = widgetDraws.get(node.id);
      if (earlier !== undefined && earlier !== draw) {
        errors.push(`widget ${label} is drawn differently on two pages; give it the same size on each`);
        return null;
      }
      widgetDraws.set(node.id, draw);
      return draw;
    };

    const buildTable = (elements: readonly GridElement[], where: string): { leaves: [string, Rect][]; cards: Rect[]; rects: Map<string, Rect> } => {
      checkPlacement(elements, where);
      const leaves: [string, Rect][] = [];
      const cards: Rect[] = [];
      const rects = new Map<string, Rect>();
      const here = new Set<string>();
      for (const e of elements) {
        const rect = rectOf(e);
        if (e.card) {
          cards.push(rect);
          continue;
        }
        if (e.kind === "text") {
          const id = `${screenId.slice(0, 8)}_s${staticCount++}`;
          rects.set(id, rect);
          const text = e.text ?? "";
          let font: string;
          try {
            font = pickFont(rect.height, BODY_FONTS, (f) => textWidth(f, text) <= rect.width && missingChars(f, text).length === 0);
          } catch (err) {
            errors.push(`${where}: text "${text}" ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
          imports.add(font);
          imports.add("tsgui_label");
          staticRegistrations.push(`_gui.widget(${pyStr(id)}, tsgui_label.make(${font}, ${pyStr(text)}, ${pyStr(e.align ?? "left")}))`);
          leaves.push([id, rect]);
          continue;
        }
        if (e.kind === "pagedots") {
          const id = `${screenId.slice(0, 8)}_s${staticCount++}`;
          rects.set(id, rect);
          const diameter = Math.max(2, Math.round(Math.min(cellW, cellH) / 4));
          const gap = Math.max(1, Math.round(diameter / 2));
          imports.add("tsgui_pagedots");
          staticRegistrations.push(`_gui.widget(${pyStr(id)}, tsgui_pagedots.make(${diameter}, ${gap}))`);
          leaves.push([id, rect]);
          continue;
        }
        const node = e.node ? byId.get(e.node) : undefined;
        if (!node || !isWidgetType(node.type)) {
          errors.push(`${where}: "${e.node ?? "?"}" isn't a GUI widget node in this flow`);
          continue;
        }
        if (here.has(node.id)) {
          errors.push(`"${node.id}" appears twice ${where}`);
          continue;
        }
        here.add(node.id);
        const prev = placedOn.get(node.id);
        if (prev && prev.screen !== screenId) {
          errors.push(`widget ${nodeLabel(node)} is placed on two screens (${prev.where} and ${where}); a widget belongs to one screen`);
          continue;
        }
        if (!prev) placedOn.set(node.id, { screen: screenId, where });
        const draw = placeWidget(node, rect, where, e.align ?? "left");
        if (draw === null) continue;
        rects.set(node.id, rect);
        leaves.push([node.id, rect]);
      }
      return { leaves, cards, rects };
    };

    const rectPy = ([id, r]: [string, Rect]): string => `(${pyStr(id)}, (${r.x}, ${r.y}, ${r.width}, ${r.height}))`;
    const rectsPy = (list: Rect[]): string => `[${list.map((r) => `(${r.x}, ${r.y}, ${r.width}, ${r.height})`).join(", ")}]`;

    const pageEntries = spec.pages.map((p) => {
      const where = `on page "${p.name}" of screen ${sname}`;
      const table = buildTable(p.elements, where);
      rectsByPage.set(p.name, table.rects);
      return `${pyStr(p.name)}: {"parent": ${p.parent === undefined ? "None" : pyStr(p.parent)}, "widgets": [${table.leaves.map(rectPy).join(", ")}], "cards": ${rectsPy(table.cards)}}`;
    });

    const modalEntries: string[] = [];
    const modalNames = new Set<string>();
    for (const m of spec.modals ?? []) {
      const node = byId.get(m.node);
      if (!node || node.type !== GUI_MODAL) {
        errors.push(`screen ${sname}: modal "${m.node}" isn't a GUI modal node in this flow`);
        continue;
      }
      const mname = modalName(node);
      if (modalNames.has(mname) || pageNames.has(mname)) errors.push(`screen ${sname}: two pages or modals are called "${mname}"`);
      modalNames.add(mname);
      const table = buildTable(m.elements, `in modal "${mname}" of screen ${sname}`);
      rectsByPage.set(mname, table.rects);
      const priority = Math.round(num(node.properties.priority, 0));
      const timeoutMs = Math.round(num(node.properties.timeout, 0) * 1000);
      modalEntries.push(`${pyStr(mname)}: {"widgets": [${table.leaves.map(rectPy).join(", ")}], "cards": ${rectsPy(table.cards)}, "priority": ${priority}, "timeout_ms": ${timeoutMs}}`);
    }

    surfaces.push({
      screen: screenId,
      pagesPy: `{${pageEntries.join(", ")}}`,
      carouselPy: `[${carousel.map(pyStr).join(", ")}]`,
      modalsPy: `{${modalEntries.join(", ")}}`,
      staticRegistrations,
      rects: rectsByPage,
    });
  }

  for (const n of nodes) {
    if (isWidgetType(n.type) && !placedOn.has(n.id)) {
      warnings.push(`widget ${nodeLabel(n)} isn't placed on any screen, so nothing shows it`);
    }
  }
  return { surfaces, widgetDraws, trendColumns, imports, errors, warnings };
}

/** A gui_modal node's name: its `name` property, else its short id. Unique per screen. */
export function modalName(node: GraphNode): string {
  const n = typeof node.properties.name === "string" ? node.properties.name.trim() : "";
  return n || `modal_${node.id.slice(0, 6)}`;
}
