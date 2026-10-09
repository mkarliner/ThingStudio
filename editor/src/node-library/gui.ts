// SPDX-License-Identifier: Apache-2.0
// editor/src/node-library/gui.ts
//
// The GUI's canvas nodes (gui-layout-widget-system-scoping.md, phase 5). A widget is an ordinary msg-in node:
// its generated code only calls `_gui.set_value(id, payload)`; the board's GUI subsystem
// (device-runtime/src/vendor/thingstudio_gui/gui.py) owns drawing. Where widgets sit is the flow's `screens`
// section (gui/screens.ts), keyed by GUI screen node.
//
//   gui_screen     one per display. Emits a rendered frame (bytes) whenever the GUI redraws; wire it to a
//                  display node's input. Its size and frame format must match that display.
//   gui_label      a value shown as text
//   gui_readout    a number with units, sized for its value range
//   gui_bar        a bar between low and high
//   gui_led        on/off status light
//   gui_navigator  commands in (next, prev, back, home, or a page name); the page out when it changes
//   gui_button     a touch button: momentary, toggle or navigate. Two-faced: its input sets what it shows, its
//                  output sends when it is tapped. The screen polls the touch panel itself (its `touchPanelConfigId`).
//   gui_modal      opens a full-screen modal with its payload (payload None closes it). Two-faced: its output
//                  sends how it closed ('ack', 'timeout' or 'closed').
//
// Every GUI node's codegen returns the same "gui_core" setup block (deduplicated by key), built once per
// compile from the whole flow: the imports, the GUI object, and every widget's registration. Each screen adds
// its own block after it: its static elements, framebuffer and surface. So the order of nodes in the graph
// never matters.

import { CompileError } from "../compiler/errors.js";
import { placedWidgets } from "../gui/screen-edit.js";
import { pyPayloadLiteral } from "./py-literals.js";
import { resolveOrientation, turnedSize } from "./orientation-shared.js";
import { resolveTouchPanel } from "./touch-panel-shared.js";
import type { GraphNode } from "../compiler/graph.js";
import type {
  CodegenContext,
  EventSourceCodegenResult,
  NodeDefinition,
  SinkCodegenResult,
  TransformCodegenResult,
} from "../compiler/node-definition.js";
import { compileScreens, GUI_BUTTON, GUI_SCREEN, GUI_MODAL, isWidgetType, modalName, nodeLabel, pyStr, WIDGET_TYPES, type CompiledScreens, type ScreenSize } from "../gui/screens.js";

export type GuiFrameFormat = "gs4" | "gs2" | "mono" | "rgb565";
const FRAMEBUF_FORMAT: Record<GuiFrameFormat, string> = { gs4: "GS4_HMSB", gs2: "GS2_HMSB", mono: "MONO_HMSB", rgb565: "RGB565" };

/** Rows per strip: as many as fit in about 5 KB, at least 1, at most the whole screen. */
export function bandRowsFor(width: number, height: number, format: GuiFrameFormat): number {
  return Math.max(1, Math.min(height, Math.floor(5120 / frameBytes(width, 1, format))));
}

/** Colours for a full-colour (RGB565) screen: foreground, dimmed (stale), background, accent (bar fill, light on).
 * Written byte-swapped: framebuf.RGB565 stores a pixel little-endian but an SPI panel wants it big-endian, and
 * drawing the swapped constant puts the right bytes on the wire without touching a single pixel afterwards. */
export function rgb565Colours(): string {
  const swap = (c: number) => ((c & 0xff) << 8) | (c >> 8);
  const hex = (c: number) => `0x${swap(c).toString(16).padStart(4, "0")}`;
  return `(${hex(0xffff)}, ${hex(0x632c)}, ${hex(0x0000)}, ${hex(0x3ef1)})`;
}

/** Bytes in one frame, the same formula display_spi checks incoming frames against. */
export function frameBytes(width: number, height: number, format: GuiFrameFormat): number {
  switch (format) {
    case "gs4":
      return Math.ceil(width / 2) * height;
    case "gs2":
      return Math.ceil(width / 4) * height;
    case "mono":
      return Math.ceil(width / 8) * height;
    case "rgb565":
      return width * height * 2;
  }
}

function screenSize(node: GraphNode, ctx: CodegenContext): ScreenSize & { format: GuiFrameFormat } {
  let width = Math.round(Number(node.properties.width ?? 320));
  let height = Math.round(Number(node.properties.height ?? 240));
  if (!(width > 0 && height > 0)) throw new CompileError(`GUI screen ${nodeLabel(node)}: width and height must be positive, got ${String(node.properties.width)}x${String(node.properties.height)}`);
  // With an orientation config, width/height are the panel's own size and the picture is laid out turned.
  const angle = resolveOrientation(ctx, node, `GUI screen ${nodeLabel(node)}`);
  if (angle !== null) ({ width, height } = turnedSize(width, height, angle));
  const format = String(node.properties.frameFormat ?? "gs4") as GuiFrameFormat;
  if (!(format in FRAMEBUF_FORMAT)) throw new CompileError(`GUI screen ${nodeLabel(node)}: frameFormat must be one of ${Object.keys(FRAMEBUF_FORMAT).join(", ")}`);
  return { width, height, format };
}

/** A screen and the SPI display it is wired to must agree on the picture's size, or the display reads the frames at
 * the wrong width and shows scrambled rows. With an orientation, both nodes hold the panel's own size. */
function checkDisplaySize(node: GraphNode, ctx: CodegenContext, width: number, height: number): void {
  const display = ctx.findWiredTargets?.(node.id).find((n) => n.type === "thingstudio/display_spi");
  if (!display) return;
  const dw = Math.round(Number(display.properties.width));
  const dh = Math.round(Number(display.properties.height));
  if (!(dw > 0 && dh > 0)) return;
  const angle = resolveOrientation(ctx, display, "display_spi");
  const want = angle === null ? { width: dw, height: dh } : turnedSize(dw, dh, angle);
  if (want.width === width && want.height === height) return;
  const screenW = Math.round(Number(node.properties.width));
  const screenH = Math.round(Number(node.properties.height));
  const fix = angle === null ? `${want.width}x${want.height}` : `${dw}x${dh}, the panel's own size, since the display's orientation is ${angle}`;
  throw new CompileError(
    `GUI screen ${nodeLabel(node)} is ${screenW}x${screenH} but the display it is wired to (${nodeLabel(display)}) shows ${want.width}x${want.height}: set the screen's width and height to ${fix}`,
  );
}

const compiled = new WeakMap<CodegenContext, CompiledScreens>();

function guiNodes(ctx: CodegenContext): GraphNode[] {
  if (!ctx.findNodesOfType) throw new CompileError("GUI nodes need findNodesOfType in the codegen context");
  return [GUI_SCREEN, GUI_MODAL, ...Object.keys(WIDGET_TYPES), "thingstudio/gui_navigator"].flatMap((t) => ctx.findNodesOfType!(t));
}

/** The whole flow's screens, compiled once per compile. Throws one CompileError listing every problem. */
function screensFor(ctx: CodegenContext): CompiledScreens {
  let c = compiled.get(ctx);
  if (!c) {
    const nodes = guiNodes(ctx);
    c = compileScreens(ctx.screens ?? {}, nodes, (n) => screenSize(n, ctx));
    if (c.errors.length > 0) throw new CompileError(`GUI layout:\n  ${c.errors.join("\n  ")}`);
    for (const w of c.warnings) ctx.warn?.(w);
    compiled.set(ctx, c);
  }
  return c;
}

export type ButtonMode = "momentary" | "toggle" | "navigate";
export const BUTTON_PENDING_MIN_S = 5;
const NAV_COMMANDS = ["next", "prev", "back", "home"];

export interface ButtonConfig {
  mode: ButtonMode;
  /** Python literals for the values a button sends. */
  send: string;
  onVal: string;
  offVal: string;
  onPress: boolean;
  target: string;
  pendingS: number;
  initial: boolean;
  onText: string;
  offText: string;
}

/** A button's properties, validated. Defaults: a momentary button sending true on release. */
export function buttonConfig(node: GraphNode): ButtonConfig {
  const p = node.properties;
  const who = `button ${nodeLabel(node)}`;
  const mode = String(p.mode ?? "momentary");
  if (mode !== "momentary" && mode !== "toggle" && mode !== "navigate") throw new CompileError(`${who}: mode must be momentary, toggle or navigate, not "${mode}"`);
  const valueType = String(p.valueType ?? "bool");
  if (valueType !== "bool" && valueType !== "string" && valueType !== "number") throw new CompileError(`${who}: value type must be bool, string or number, not "${valueType}"`);
  const fire = String(p.fireOn ?? "release");
  if (fire !== "release" && fire !== "press") throw new CompileError(`${who}: send on must be release or press, not "${fire}"`);
  const pendingS = Number(p.pendingTimeout ?? BUTTON_PENDING_MIN_S);
  if (!(pendingS >= BUTTON_PENDING_MIN_S)) throw new CompileError(`${who}: the wait for confirmation must be ${BUTTON_PENDING_MIN_S} s or more, not "${String(p.pendingTimeout)}"`);
  const target = typeof p.target === "string" ? p.target.trim() : "";
  if (mode === "navigate" && !target) throw new CompileError(`${who}: choose where it goes (next, prev, back, home or a page name)`);
  // What a button sends when no value is set: true / false, "ON" / "OFF", 1 / 0 by value type.
  const dflt = { bool: ["true", "false"], string: ["ON", "OFF"], number: ["1", "0"] }[valueType]!;
  const lit = (key: string, fallback: string) => pyPayloadLiteral(valueType, p[key] === undefined || p[key] === "" ? fallback : p[key], `${who} ${key}`);
  return {
    mode,
    send: mode === "momentary" ? lit("value", dflt[0]!) : "None",
    onVal: lit("onValue", dflt[0]!),
    offVal: lit("offValue", dflt[1]!),
    onPress: fire === "press",
    target,
    pendingS,
    initial: p.initial === true,
    onText: typeof p.onText === "string" && p.onText !== "" ? p.onText : "ON",
    offText: typeof p.offText === "string" && p.offText !== "" ? p.offText : "OFF",
  };
}

/** The GUI.button() call giving a registered button widget its behaviour. A wired input means the flow owns it. */
function buttonRegistration(node: GraphNode, ctx: CodegenContext): string {
  const b = buttonConfig(node);
  const controlled = b.mode === "toggle" && ctx.isInputWired?.(node.id) === true;
  return (
    `_gui.button(${pyStr(node.id)}, ${pyStr(b.mode)}, controlled=${controlled ? "True" : "False"}, send=${b.send}, ` +
    `on_val=${b.onVal}, off_val=${b.offVal}, on_press=${b.onPress ? "True" : "False"}, target=${pyStr(b.target)}, ` +
    `pending_ms=${Math.round(b.pendingS * 1000)}, initial=${b.initial ? "True" : "False"})`
  );
}

function coreBlock(ctx: CodegenContext): { imports: string[]; statements: { key: string; code: string }[] } {
  const c = screensFor(ctx);
  const lines = ["_gui = thingstudio_gui.GUI(on_error=runtime._report_error)"];
  for (const n of guiNodes(ctx)) {
    if (!isWidgetType(n.type)) continue;
    const staleMs = Math.max(0, Math.round(Number(n.properties.staleAfter ?? 0) * 1000)) || 0;
    const draw = c.widgetDraws.get(n.id) ?? "lambda _s, _r, _v, _st: None";
    lines.push(`_gui.widget(${pyStr(n.id)}, ${draw}, ${staleMs}${n.type === GUI_BUTTON ? ", True" : ""})`);
    if (n.type === GUI_BUTTON) lines.push(buttonRegistration(n, ctx));
  }
  lines.push(`runtime.spawn(_gui.run(), None)`);
  const imports = ["import thingstudio_gui", "import framebuf", ...[...c.imports].sort().map((m) => `import ${m}`)];
  return { imports, statements: [{ key: "gui_core", code: lines.join("\n") }] };
}

function screenId(ctx: CodegenContext, node: GraphNode, prop = "screen"): string {
  const screens = ctx.findNodesOfType?.(GUI_SCREEN) ?? [];
  const raw = typeof node.properties[prop] === "string" ? (node.properties[prop] as string).trim() : "";
  if (raw) {
    // By screen name (what the property panel offers) or node id.
    const hits = screens.filter((s) => s.id === raw || s.properties.name === raw);
    if (hits.length === 1) return hits[0]!.id;
    throw new CompileError(`${nodeLabel(node)}: ${hits.length === 0 ? `no GUI screen is called "${raw}"` : `two GUI screens are called "${raw}"`}`);
  }
  if (screens.length === 1) return screens[0]!.id; // one screen: no need to pick
  throw new CompileError(`${nodeLabel(node)}: choose which GUI screen it acts on (the flow has ${screens.length})`);
}

export const guiScreenNode: NodeDefinition = {
  type: GUI_SCREEN,
  kind: "source",
  ports: { outputs: [{ name: "frame", type: "bytes" }] },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const { width, height, format } = screenSize(node, ctx);
    checkDisplaySize(node, ctx, width, height);
    const core = coreBlock(ctx);
    const c = screensFor(ctx);
    const surface = c.surfaces.find((s) => s.screen === node.id);
    if (!surface) throw new CompileError(`GUI screen ${nodeLabel(node)} has no pages yet: lay it out in the GUI view`);
    const base = ctx.uniqueName("gui_screen");
    const fmt = `framebuf.${FRAMEBUF_FORMAT[format]}`;
    const minInterval = Math.max(0, Math.round(Number(node.properties.minInterval ?? 200)));
    const wrap = node.properties.wrap === false ? "False" : "True";
    // Drawn in strips (BandSurface): only one strip is ever in RAM. A full 240x320 gs4 frame is 38,400 bytes,
    // which a classic ESP32's fragmented heap often can't give (CYD, 2026-10-08); a strip is ~4.8 KB.
    const stride = frameBytes(width, 1, format);
    const bandRows = bandRowsFor(width, height, format);
    const code = [
      ...surface.staticRegistrations,
      `${base}_s = _gui.add_surface(thingstudio_gui.BandSurface(${pyStr(node.id)}, ${width}, ${height}, ${fmt}, ` +
        `${surface.pagesPy}, ${surface.carouselPy}, ${surface.modalsPy}, ${wrap}, ${minInterval}, ${bandRows}, ${stride}` +
        `${format === "rgb565" ? `, ${rgb565Colours()}` : ""}))`,
    ].join("\n");
    const name = typeof node.properties.name === "string" && node.properties.name ? node.properties.name : node.id;
    // The touch panel (config node): the GUI polls it itself, no wire. Its faults show on this node's status.
    const imports = [...core.imports];
    const statements = [...core.statements, { key: `gui_screen_${node.id}`, code }];
    const spec = ctx.screens?.[node.id];
    const hasPanel = typeof node.properties.touchPanelConfigId === "string" && node.properties.touchPanelConfigId !== "";
    if (hasPanel) {
      const panel = resolveTouchPanel(ctx, node);
      imports.push(...panel.imports);
      statements.push(
        panel.bus.statement,
        {
          key: `gui_touch_${node.id}`,
          code:
            `runtime.spawn(_gui.poll_touch(${pyStr(node.id)}, lambda: ${panel.makeDevice}, ${panel.pollMs}, ` +
            `lambda st, text: runtime.report_status(${pyStr(node.id)}, st, text), ${pyStr(panel.where)}), ${pyStr(node.id)})`,
        },
      );
    } else if (spec) {
      const buttons = (ctx.findNodesOfType?.(GUI_BUTTON) ?? []).filter((b) => placedWidgets(spec).has(b.id));
      if (buttons.length > 0) ctx.warn?.(`GUI screen ${nodeLabel(node)} has buttons but no touch panel, so they can't be pressed. Pick a touch panel in its properties.`);
    }
    return {
      imports,
      statements,
      // One message per strip: `y` is its first row; display_spi writes it there.
      waitStatement: `_band_y, _band_rows = await ${base}_s.next_band()`,
      buildMsg: `msg = {'payload': memoryview(${base}_s.band_buf)[:_band_rows * ${stride}], 'topic': ${pyStr(name)}, 'y': _band_y}`,
    };
  },
};

function widgetNode(type: string): NodeDefinition {
  return {
    type,
    kind: "sink",
    ports: { inputs: [{ name: "msg", type: "any" }] },
    codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
      const core = coreBlock(ctx);
      return {
        imports: core.imports,
        statements: core.statements,
        functionName: ctx.uniqueName(type.replace("thingstudio/", "")),
        functionBody: `_gui.set_value(${pyStr(node.id)}, msg.get('payload'))`,
      };
    },
  };
}

export const guiLabelNode = widgetNode("thingstudio/gui_label");
export const guiReadoutNode = widgetNode("thingstudio/gui_readout");
export const guiBarNode = widgetNode("thingstudio/gui_bar");
export const guiLedNode = widgetNode("thingstudio/gui_led");
/** Two-faced (compiler/node-definition.ts, codegenEventSource): the input sets what the button shows -- a toggle's
 * state, or a value replacing its text -- and the output sends when it is tapped: {topic: <name>, payload: ...}.
 * A navigate button has no output; it acts on its own screen. */
export const guiButtonNode: NodeDefinition = {
  ...widgetNode(GUI_BUTTON),
  ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const core = coreBlock(ctx);
    const b = buttonConfig(node);
    const name = typeof node.properties.name === "string" && node.properties.name ? node.properties.name : node.id;
    if (b.mode === "navigate") {
      const spec = Object.values(ctx.screens ?? {}).find((sc) => placedWidgets(sc).has(node.id));
      if (spec && !NAV_COMMANDS.includes(b.target) && !spec.pages.some((pg) => pg.name === b.target)) {
        throw new CompileError(`button ${nodeLabel(node)}: "${b.target}" isn't next, prev, back, home or a page on its screen`);
      }
    } else if (ctx.isOutputWired?.(node.id) === false) {
      ctx.warn?.(`button ${nodeLabel(node)} sends ${b.mode === "toggle" ? "its state" : "its value"} nowhere: wire its output to something.`);
    }
    return {
      imports: core.imports,
      statements: core.statements,
      waitStatement: `_btn = await _gui.event(${pyStr(node.id)})`,
      buildMsg: `msg = {'payload': _btn, 'topic': ${pyStr(name)}}`,
    };
  },
};

export const guiNavigatorNode: NodeDefinition = {
  type: "thingstudio/gui_navigator",
  kind: "transform",
  // `any` in, checked when it arrives: a function or timer upstream is untyped, and a non-string command
  // gets a NODE_ERROR naming what's accepted (the canvas refused any -> string wires, 2026-10-08).
  ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "page", type: "string" }] },
  codegenTransform(node: GraphNode, ctx: CodegenContext): TransformCodegenResult {
    const core = coreBlock(ctx);
    const sid = screenId(ctx, node);
    const topic = typeof node.properties.name === "string" && node.properties.name ? node.properties.name : "navigator";
    return {
      imports: core.imports,
      statements: core.statements,
      functionName: ctx.uniqueName("gui_navigator"),
      functionBody: [
        `_cmd = msg.get('payload')`,
        `if not isinstance(_cmd, str):`,
        `    raise ValueError('navigator wants next, prev, back, home or a page name, got %r' % (_cmd,))`,
        `_before = _gui.surfaces[${pyStr(sid)}].page`,
        `_after = _gui.navigate(${pyStr(sid)}, _cmd)`,
        `_page = _gui.surfaces[${pyStr(sid)}].page`,
        `if _page == _before:`,
        `    return None`,
        `return {'topic': ${pyStr(topic)}, 'payload': _page}`,
      ].join("\n"),
    };
  },
};

/** Two-faced: msg in opens the modal (payload None closes it); the output says how it closed --
 * {topic: <modal name>, payload: 'ack' | 'timeout' | 'closed'} -- so a flow can escalate an unacknowledged alarm. */
export const guiModalNode: NodeDefinition = {
  type: GUI_MODAL,
  kind: "sink",
  ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const core = coreBlock(ctx);
    const sid = screenId(ctx, node);
    modalOnScreen(ctx, node);
    return {
      imports: core.imports,
      statements: core.statements,
      functionName: ctx.uniqueName("gui_modal"),
      functionBody: `_gui.open_modal(${pyStr(sid)}, ${pyStr(modalName(node))}, msg.get('payload'))`,
    };
  },
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const core = coreBlock(ctx);
    const sid = screenId(ctx, node);
    modalOnScreen(ctx, node);
    const mname = modalName(node);
    // Registered at import, before any task runs, so no close can slip past before the coroutine first waits.
    return {
      imports: core.imports,
      statements: [...core.statements, { key: `gui_modal_watch_${node.id}`, code: `_gui.watch_modal(${pyStr(sid)}, ${pyStr(mname)})` }],
      waitStatement: `_reason = await _gui.modal_closed(${pyStr(sid)}, ${pyStr(mname)})`,
      buildMsg: `msg = {'payload': _reason, 'topic': ${pyStr(mname)}}`,
    };
  },
};

function modalOnScreen(ctx: CodegenContext, node: GraphNode): void {
  const c = screensFor(ctx);
  if (!c.surfaces.some((s) => s.modalsPy.includes(pyStr(modalName(node)) + ":"))) {
    throw new CompileError(`modal ${nodeLabel(node)} isn't laid out on its screen yet: add it in the GUI view`);
  }
}

export const GUI_NODES: NodeDefinition[] = [guiScreenNode, guiLabelNode, guiReadoutNode, guiBarNode, guiLedNode, guiButtonNode, guiNavigatorNode, guiModalNode];
