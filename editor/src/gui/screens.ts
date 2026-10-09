// SPDX-License-Identifier: Apache-2.0
// editor/src/gui/screens.ts
//
// The `screens` section of a flow and its compile step (gui-layout-widget-system-scoping.md, "Two views, one
// model"). Wiring says how data moves; `screens` says where widgets sit: per GUI screen node, its pages and
// modals as trees of rows, columns and elements. Widget nodes are referenced by id, so the flow view and
// the GUI view share one record. Placement properties (font, size, alignment) live here, on the placement;
// data properties (range, decimals, staleAfter) stay on the node.
//
// compileScreens() lays every page and modal out with layout.ts, measuring each element with widgets.ts,
// and returns the device tables plus the Python that registers each widget's draw routine. Every problem --
// overflow, a widget placed twice, an unknown node, a font missing a character -- is collected with its
// screen and page named, never thrown one at a time.

import { getFont, missingChars } from "./font-metrics.js";
import { layoutPage, type Align, type Container, type Justify, type LayoutNode, type Rect } from "./layout.js";
import { barNatural, buttonNatural, labelNatural, ledNatural, pageDotsNatural, readoutNatural } from "./widgets.js";
import type { GraphNode } from "../compiler/graph.js";

// ---- the format ------------------------------------------------------------------------------------------

interface Placed {
  readonly grow?: number;
  readonly alignSelf?: Align;
}

export interface ContainerSpec extends Placed {
  readonly kind: "row" | "column";
  readonly children: readonly ElementSpec[];
  readonly gap?: number;
  readonly padding?: number;
  readonly align?: Align;
  readonly justify?: Justify;
}

/** A widget node placed here. Which font and size it uses on this screen are placement properties. */
export interface WidgetSpec extends Placed {
  readonly kind: "widget";
  readonly node: string;
  readonly font?: string;
  readonly unitsFont?: string;
  /** label: text alignment inside its rect. */
  readonly align?: "left" | "center" | "right";
  /** bound label: room for this many characters. */
  readonly maxChars?: number;
  /** bar */
  readonly minWidth?: number;
  readonly height?: number;
  /** status light */
  readonly diameter?: number;
}

/** Static text: GUI view only, no node. */
export interface TextSpec extends Placed {
  readonly kind: "text";
  readonly text: string;
  readonly font: string;
  readonly align?: "left" | "center" | "right";
}

/** Page indicator: GUI view only, no node. */
export interface PageDotsSpec extends Placed {
  readonly kind: "pagedots";
  readonly diameter?: number;
  readonly gap?: number;
}

/** Empty space; with grow, pushes its neighbours apart. */
export interface SpacerSpec extends Placed {
  readonly kind: "spacer";
  readonly width?: number;
  readonly height?: number;
}

export type ElementSpec = ContainerSpec | WidgetSpec | TextSpec | PageDotsSpec | SpacerSpec;

export interface PageSpec {
  readonly name: string;
  /** A child page (drill-down); absent for a carousel page. */
  readonly parent?: string;
  readonly root: ElementSpec;
}

export interface ModalSpec {
  /** The gui_modal node this is the GUI face of. */
  readonly node: string;
  readonly root: ElementSpec;
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
export const GUI_TOUCH = "thingstudio/gui_touch";
export const WIDGET_TYPES = {
  "thingstudio/gui_label": "label",
  "thingstudio/gui_readout": "readout",
  "thingstudio/gui_bar": "bar",
  "thingstudio/gui_led": "led",
  "thingstudio/gui_button": "button",
} as const;
export type WidgetNodeType = keyof typeof WIDGET_TYPES;

export function isWidgetType(type: string): type is WidgetNodeType {
  return type in WIDGET_TYPES;
}

/** How errors name a node: its `name` property, else its type and short id. */
export function nodeLabel(node: GraphNode): string {
  const n = typeof node.properties.name === "string" ? node.properties.name.trim() : "";
  return n ? `"${n}"` : `${node.type.replace("thingstudio/", "")} ${node.id.slice(0, 6)}`;
}

// ---- compile -----------------------------------------------------------------------------------------------

export interface CompiledSurface {
  /** gui_screen node id. */
  readonly screen: string;
  /** Python dict literal: {page: {"parent": ..., "widgets": [(id, (x, y, w, h)), ...]}} */
  readonly pagesPy: string;
  readonly carouselPy: string;
  readonly modalsPy: string;
  /** Static elements (text, page dots) registered for this screen: Python statements. */
  readonly staticRegistrations: string[];
  /** Every rect, for the editor's preview and tests: element id -> rect, per page or modal name. */
  readonly rects: ReadonlyMap<string, ReadonlyMap<string, Rect>>;
}

export interface CompiledScreens {
  readonly surfaces: CompiledSurface[];
  /** Widget node id -> Python expression building its draw routine. */
  readonly widgetDraws: ReadonlyMap<string, string>;
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
  const surfaces: CompiledSurface[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placedOn = new Map<string, string>(); // widget node id -> where

  for (const [screenId, spec] of Object.entries(screens)) {
    const screen = byId.get(screenId);
    if (!screen || screen.type !== GUI_SCREEN) {
      errors.push(`screens: "${screenId}" isn't a GUI screen node in this flow`);
      continue;
    }
    const sname = nodeLabel(screen);
    const size = sizeOf(screen);
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

    // Turns an element into a layout node, registering what it draws. `where` names it in errors.
    const toLayout = (el: ElementSpec, where: string, path: string): LayoutNode | null => {
      const common = { grow: el.grow, alignSelf: el.alignSelf };
      switch (el.kind) {
        case "row":
        case "column": {
          const children = el.children.map((c, i) => toLayout(c, where, `${path}.${i}`)).filter((c): c is LayoutNode => c !== null);
          const c: Container = { kind: el.kind, id: `${screenId}:${path}`, label: `${el.kind} ${path}`, children, gap: el.gap, padding: el.padding, align: el.align, justify: el.justify, ...common };
          return c;
        }
        case "spacer":
          return { kind: "leaf", id: `${screenId}:${path}`, label: "spacer", natural: { width: el.width ?? 0, height: el.height ?? 0 }, ...common };
        case "text": {
          const id = `${screenId.slice(0, 8)}_s${staticCount++}`;
          if (!fontOk(el.font, el.text, `text "${el.text}" ${where}`)) return null;
          imports.add(el.font);
          imports.add("tsgui_label");
          staticRegistrations.push(`_gui.widget(${pyStr(id)}, tsgui_label.make(${el.font}, ${pyStr(el.text)}, ${pyStr(el.align ?? "left")}))`);
          return { kind: "leaf", id, label: `text "${el.text}"`, natural: labelNatural({ font: el.font, text: el.text }), ...common };
        }
        case "pagedots": {
          const id = `${screenId.slice(0, 8)}_s${staticCount++}`;
          imports.add("tsgui_pagedots");
          staticRegistrations.push(`_gui.widget(${pyStr(id)}, tsgui_pagedots.make(${el.diameter ?? 6}, ${el.gap ?? 4}))`);
          return { kind: "leaf", id, label: "page dots", natural: pageDotsNatural({ pages: Math.max(1, carousel.length), diameter: el.diameter, gap: el.gap }), ...common };
        }
        case "widget":
          return placeWidget(el, where, common);
      }
    };

    const fontOk = (font: string, text: string, what: string): boolean => {
      try {
        getFont(font);
      } catch {
        errors.push(`${what}: unknown font "${font}"`);
        return false;
      }
      const missing = missingChars(font, text);
      if (missing.length > 0) {
        errors.push(`${what}: font ${font} has no ${missing.map((c) => `"${c}"`).join(", ")}`);
        return false;
      }
      return true;
    };

    const placeWidget = (el: WidgetSpec, where: string, common: Placed): LayoutNode | null => {
      const node = byId.get(el.node);
      if (!node || !isWidgetType(node.type)) {
        errors.push(`${where}: "${el.node}" isn't a GUI widget node in this flow`);
        return null;
      }
      const label = nodeLabel(node);
      const prev = placedOn.get(node.id);
      if (prev) {
        errors.push(`widget ${label} is placed twice (${prev} and ${where}); place it once, or wire its input to a second widget`);
        return null;
      }
      placedOn.set(node.id, where);
      const kind = WIDGET_TYPES[node.type];
      const p = node.properties;
      let natural;
      let draw: string;
      try {
        switch (kind) {
          case "label": {
            const font = el.font ?? "font_body16";
            if (!fontOk(font, "--", `widget ${label} ${where}`)) return null;
            const maxChars = el.maxChars ?? num(p.maxChars, 8);
            natural = labelNatural({ font, max_chars: maxChars });
            draw = `tsgui_label.make(${font}, None, ${pyStr(el.align ?? "left")})`;
            imports.add(font);
            break;
          }
          case "readout": {
            const font = el.font ?? "font_digits32";
            const units = typeof p.units === "string" ? p.units : "";
            const unitsFont = units ? (el.unitsFont ?? "font_body16") : undefined;
            const decimals = Math.max(0, Math.round(num(p.decimals, 1)));
            const lo = num(p.lo, 0);
            const hi = num(p.hi, 100);
            if (hi < lo) throw new Error(`range low ${lo} is above high ${hi}`);
            const sample = `${lo.toFixed(decimals)}${hi.toFixed(decimals)}--`;
            if (!fontOk(font, sample, `widget ${label} ${where}`)) return null;
            if (unitsFont && !fontOk(unitsFont, units, `widget ${label}'s units ${where}`)) return null;
            natural = readoutNatural({ font, units_font: unitsFont, units, decimals, lo, hi });
            draw = `tsgui_readout.make(${font}, ${unitsFont ?? "None"}, ${pyStr(units)}, ${decimals}, ${pyNum(lo)}, ${pyNum(hi)})`;
            imports.add(font);
            if (unitsFont) imports.add(unitsFont);
            break;
          }
          case "bar": {
            const lo = num(p.lo, 0);
            const hi = num(p.hi, 100);
            if (hi <= lo) throw new Error(`range low ${lo} must be below high ${hi}`);
            natural = barNatural({ min_width: el.minWidth, height: el.height });
            draw = `tsgui_bar.make(${pyNum(lo)}, ${pyNum(hi)})`;
            break;
          }
          case "button": {
            const font = el.font ?? "font_body16";
            const text = typeof p.text === "string" && p.text !== "" ? p.text : undefined;
            const maxChars = el.maxChars ?? num(p.maxChars, 8);
            // A bound value replaces the text, so the font must have "--" and (for a bound-only button) the room.
            if (!fontOk(font, text ?? "--", `widget ${label} ${where}`)) return null;
            natural = buttonNatural({ font, text, max_chars: maxChars });
            draw = `tsgui_button.make(${font}, ${text === undefined ? "None" : pyStr(text)})`;
            imports.add(font);
            break;
          }
          case "led": {
            natural = ledNatural({ diameter: el.diameter });
            draw = `tsgui_led.make(${el.diameter ?? 12})`;
            break;
          }
        }
      } catch (e) {
        errors.push(`widget ${label}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
      imports.add(`tsgui_${kind}`);
      widgetDraws.set(node.id, draw);
      return { kind: "leaf", id: node.id, label: `widget ${label}`, natural, ...common };
    };

    const tableFor = (name: string, root: ElementSpec, where: string): [string, Rect][] => {
      const tree = toLayout(root, where, "root");
      if (!tree) return [];
      const out = layoutPage(tree, size, { display: sname.replace(/"/g, ""), page: name });
      for (const e of out.errors) errors.push(e.message);
      rectsByPage.set(name, out.rects);
      // Only drawable leaves go in the device table (containers and spacers don't draw).
      const leaves: [string, Rect][] = [];
      const collect = (n: LayoutNode): void => {
        if (n.kind === "leaf") {
          if (n.label !== "spacer") leaves.push([n.id, out.rects.get(n.id)!]);
        } else n.children.forEach(collect);
      };
      collect(tree);
      return leaves;
    };

    const rectPy = ([id, r]: [string, Rect]): string => `(${pyStr(id)}, (${r.x}, ${r.y}, ${r.width}, ${r.height}))`;
    const pageEntries = spec.pages.map((p) => {
      const leaves = tableFor(p.name, p.root, `on page "${p.name}" of screen ${sname}`);
      return `${pyStr(p.name)}: {"parent": ${p.parent === undefined ? "None" : pyStr(p.parent)}, "widgets": [${leaves.map(rectPy).join(", ")}]}`;
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
      const leaves = tableFor(mname, m.root, `in modal "${mname}" of screen ${sname}`);
      const priority = Math.round(num(node.properties.priority, 0));
      const timeoutMs = Math.round(num(node.properties.timeout, 0) * 1000);
      modalEntries.push(`${pyStr(mname)}: {"widgets": [${leaves.map(rectPy).join(", ")}], "priority": ${priority}, "timeout_ms": ${timeoutMs}}`);
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
  return { surfaces, widgetDraws, imports, errors, warnings };
}

/** A gui_modal node's name: its `name` property, else its short id. Unique per screen. */
export function modalName(node: GraphNode): string {
  const n = typeof node.properties.name === "string" ? node.properties.name.trim() : "";
  return n || `modal_${node.id.slice(0, 6)}`;
}
