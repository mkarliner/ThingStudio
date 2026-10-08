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
//   gui_modal      opens a full-screen modal with its payload; payload None closes it
//
// Every GUI node's codegen returns the same "gui_core" setup block (deduplicated by key), built once per
// compile from the whole flow: the imports, the GUI object, and every widget's registration. Each screen adds
// its own block after it: its static elements, framebuffer and surface. So the order of nodes in the graph
// never matters.

import { CompileError } from "../compiler/errors.js";
import type { GraphNode } from "../compiler/graph.js";
import type {
  CodegenContext,
  EventSourceCodegenResult,
  NodeDefinition,
  SinkCodegenResult,
  TransformCodegenResult,
} from "../compiler/node-definition.js";
import { compileScreens, GUI_SCREEN, GUI_MODAL, isWidgetType, modalName, nodeLabel, pyStr, WIDGET_TYPES, type CompiledScreens, type ScreenSize } from "../gui/screens.js";

export type GuiFrameFormat = "gs4" | "gs2" | "mono" | "rgb565";
const FRAMEBUF_FORMAT: Record<GuiFrameFormat, string> = { gs4: "GS4_HMSB", gs2: "GS2_HMSB", mono: "MONO_HMSB", rgb565: "RGB565" };

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

function screenSize(node: GraphNode): ScreenSize & { format: GuiFrameFormat } {
  const width = Math.round(Number(node.properties.width ?? 320));
  const height = Math.round(Number(node.properties.height ?? 240));
  if (!(width > 0 && height > 0)) throw new CompileError(`GUI screen ${nodeLabel(node)}: width and height must be positive, got ${String(node.properties.width)}x${String(node.properties.height)}`);
  const format = String(node.properties.frameFormat ?? "gs4") as GuiFrameFormat;
  if (!(format in FRAMEBUF_FORMAT)) throw new CompileError(`GUI screen ${nodeLabel(node)}: frameFormat must be one of ${Object.keys(FRAMEBUF_FORMAT).join(", ")}`);
  return { width, height, format };
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
    c = compileScreens(ctx.screens ?? {}, nodes, (n) => screenSize(n));
    if (c.errors.length > 0) throw new CompileError(`GUI layout:\n  ${c.errors.join("\n  ")}`);
    for (const w of c.warnings) ctx.warn?.(w);
    compiled.set(ctx, c);
  }
  return c;
}

function coreBlock(ctx: CodegenContext): { imports: string[]; statements: { key: string; code: string }[] } {
  const c = screensFor(ctx);
  const lines = ["_gui = thingstudio_gui.GUI(on_error=runtime._report_error)"];
  for (const n of guiNodes(ctx)) {
    if (!isWidgetType(n.type)) continue;
    const staleMs = Math.max(0, Math.round(Number(n.properties.staleAfter ?? 0) * 1000)) || 0;
    const draw = c.widgetDraws.get(n.id) ?? "lambda _s, _r, _v, _st: None";
    lines.push(`_gui.widget(${pyStr(n.id)}, ${draw}, ${staleMs})`);
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
    const { width, height, format } = screenSize(node);
    const core = coreBlock(ctx);
    const c = screensFor(ctx);
    const surface = c.surfaces.find((s) => s.screen === node.id);
    if (!surface) throw new CompileError(`GUI screen ${nodeLabel(node)} has no pages yet: lay it out in the GUI view`);
    const base = ctx.uniqueName("gui_screen");
    const fmt = `framebuf.${FRAMEBUF_FORMAT[format]}`;
    const minInterval = Math.max(0, Math.round(Number(node.properties.minInterval ?? 200)));
    const wrap = node.properties.wrap === false ? "False" : "True";
    const code = [
      ...surface.staticRegistrations,
      `${base}_buf = bytearray(${frameBytes(width, height, format)})`,
      `${base}_fb = framebuf.FrameBuffer(${base}_buf, ${width}, ${height}, ${fmt})`,
      `${base}_evt = asyncio.Event()`,
      `_gui.add_surface(thingstudio_gui.FrameSurface(${pyStr(node.id)}, ${base}_fb, lambda _f: ${base}_evt.set(), ` +
        `${surface.pagesPy}, ${surface.carouselPy}, ${surface.modalsPy}, ${wrap}, ${minInterval}, ${fmt}))`,
    ].join("\n");
    const name = typeof node.properties.name === "string" && node.properties.name ? node.properties.name : node.id;
    return {
      imports: core.imports,
      statements: [...core.statements, { key: `gui_screen_${node.id}`, code }],
      waitStatement: `await ${base}_evt.wait()\n${base}_evt.clear()`,
      buildMsg: `msg = {'payload': ${base}_buf, 'topic': ${pyStr(name)}}`,
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

export const guiModalNode: NodeDefinition = {
  type: GUI_MODAL,
  kind: "sink",
  ports: { inputs: [{ name: "msg", type: "any" }] },
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    const core = coreBlock(ctx);
    const sid = screenId(ctx, node);
    const c = screensFor(ctx);
    if (!c.surfaces.some((s) => s.modalsPy.includes(pyStr(modalName(node)) + ":"))) {
      throw new CompileError(`modal ${nodeLabel(node)} isn't laid out on its screen yet: add it in the GUI view`);
    }
    return {
      imports: core.imports,
      statements: core.statements,
      functionName: ctx.uniqueName("gui_modal"),
      functionBody: `_gui.open_modal(${pyStr(sid)}, ${pyStr(modalName(node))}, msg.get('payload'))`,
    };
  },
};

export const GUI_NODES: NodeDefinition[] = [guiScreenNode, guiLabelNode, guiReadoutNode, guiBarNode, guiLedNode, guiNavigatorNode, guiModalNode];
