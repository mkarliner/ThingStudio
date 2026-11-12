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
//   gui_trend      a moving histogram of a journal's series (or any list of numbers)
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
import { fontIds } from "../gui/font-metrics.js";
import { resolveOrientation, turnedSize } from "./orientation-shared.js";
import { resolveTouchPanel } from "./touch-panel-shared.js";
import { GUI_THEME_CONFIG_TYPE, hasScreenTheme, resolveScreenTheme, resolveThemeForFormat, themeLiteral, THEME_ROLE_LABELS, THEME_ROLES, themePresetOptions } from "./gui-theme-shared.js";
import type { GraphNode } from "../compiler/graph.js";
import type {
  CodegenContext,
  EventSourceCodegenResult,
  NodeDefinition,
  SinkCodegenResult,
  TransformCodegenResult,
} from "../compiler/node-definition.js";
import { JOURNAL_DEFAULT_ROWS } from "./core-packages/journal.js";
import {
  compileScreens, GUI_BUTTON, GUI_MODAL, GUI_SCREEN, isWidgetType, modalName, nodeLabel, pyStr,
  WIDGET_TYPES, type CompiledScreens, type ScreenSize,
} from "../gui/screens.js";
import { resolveFlowWifiCredentials, wifiSetupStatement } from "./wifi-status.js";
import { REMOTE_DISPLAY_MEASUREMENTS } from "../definitions/remote-display-measurements.js";

export type GuiFrameFormat = "gs4" | "gs2" | "mono" | "rgb565";
const FRAMEBUF_FORMAT: Record<GuiFrameFormat, string> = { gs4: "GS4_HMSB", gs2: "GS2_HMSB", mono: "MONO_HMSB", rgb565: "RGB565" };

const DISPLAY_SPI_TYPE = "thingstudio/display_spi";
/** A screen not yet wired to a display uses these, so it still compiles while being laid out. */
const SCREEN_FALLBACK = { width: 320, height: 240, format: "gs4" as GuiFrameFormat };

/** Rows per strip: as many as fit in about 5 KB, at least 1, at most the whole screen. */
export function bandRowsFor(width: number, height: number, format: GuiFrameFormat): number {
  return Math.max(1, Math.min(height, Math.floor(5120 / frameBytes(width, 1, format))));
}

/** Colours for a full-colour (RGB565) screen: foreground, dimmed (stale), background, accent (bar fill, light on).
 * Written byte-swapped: framebuf.RGB565 stores a pixel little-endian but an SPI panel wants it big-endian, and
 * drawing the swapped constant puts the right bytes on the wire without touching a single pixel afterwards. */
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

/** The wired display owns the panel size and the frame format; the screen follows it, so there is one place to
 * set them. Orientation is the display's setting too (resolveOrientation finds it via the same wire). A screen not
 * yet wired to a display uses a default size and warns, so laying out before wiring still compiles. */
function screenSize(node: GraphNode, ctx: CodegenContext): ScreenSize & { format: GuiFrameFormat } {
  const display = ctx.findWiredTargets?.(node.id).find((n) => n.type === DISPLAY_SPI_TYPE);
  let width: number;
  let height: number;
  let format: GuiFrameFormat;
  if (display) {
    width = Math.round(Number(display.properties.width ?? SCREEN_FALLBACK.width));
    height = Math.round(Number(display.properties.height ?? SCREEN_FALLBACK.height));
    format = String(display.properties.frameFormat ?? SCREEN_FALLBACK.format) as GuiFrameFormat;
    if (!(width > 0 && height > 0)) {
      throw new CompileError(
        `GUI screen ${nodeLabel(node)}: the display it is wired to (${nodeLabel(display)}) has no size (${String(display.properties.width)}x${String(display.properties.height)})`,
      );
    }
  } else {
    // Not wired to a display yet (still being laid out): fall back to the screen's own hidden size/format,
    // seeded from the defaults, so a screen compiles while it is being built.
    width = Math.round(Number(node.properties.width ?? SCREEN_FALLBACK.width));
    height = Math.round(Number(node.properties.height ?? SCREEN_FALLBACK.height));
    format = String(node.properties.frameFormat ?? SCREEN_FALLBACK.format) as GuiFrameFormat;
    if (!(width > 0 && height > 0)) {
      throw new CompileError(`GUI screen ${nodeLabel(node)}: width and height must be positive, got ${String(node.properties.width)}x${String(node.properties.height)}`);
    }
  }
  // With an orientation the display holds the panel's own size and the picture is laid out turned.
  const angle = resolveOrientation(ctx, node, `GUI screen ${nodeLabel(node)}`);
  if (angle !== null) ({ width, height } = turnedSize(width, height, angle));
  if (!(format in FRAMEBUF_FORMAT)) {
    throw new CompileError(`GUI screen ${nodeLabel(node)}: the display's frameFormat "${format}" must be one of ${Object.keys(FRAMEBUF_FORMAT).join(", ")}`);
  }
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
    c = compileScreens(ctx.screens ?? {}, nodes, (n) => screenSize(n, ctx), {
      // Remote screens put "controlled" into a button's definition config, which only the wiring knows.
      isInputWired: (id) => ctx.isInputWired?.(id) === true,
    });
    if (c.errors.length > 0) throw new CompileError(`GUI layout:\n  ${c.errors.join("\n  ")}`);
    for (const w of c.warnings) ctx.warn?.(w);
    // A histogram draws as many columns as its rect holds, newest on the right, but only as many rows as its
    // series has (tsgui_trend.draw). A journal keeping fewer rows than the rect holds fills part of it and leaves
    // the rest empty, which reads as a widget that stopped drawing (Mike, 2026-10-26). Say the number to raise.
    for (const journal of ctx.findNodesOfType?.("thingstudio/journal") ?? []) {
      const rows = Math.round(Number(journal.properties.rows ?? JOURNAL_DEFAULT_ROWS));
      if (!(rows > 0)) continue;
      for (const target of ctx.findWiredTargets?.(journal.id) ?? []) {
        const columns = c.trendColumns.get(target.id);
        if (columns === undefined || columns <= rows) continue;
        ctx.warn?.(
          `journal ${nodeLabel(journal)} keeps ${rows} rows but histogram ${nodeLabel(target)} shows ${columns} columns, ` +
            `so the left of it stays empty -- raise rows kept to ${columns}`,
        );
      }
    }
    compiled.set(ctx, c);
  }
  return c;
}

export type ButtonMode = "momentary" | "toggle" | "navigate";
export const BUTTON_PENDING_MIN_S = 5;
const NAV_COMMANDS = ["next", "prev", "back", "home"];
export const GUI_SUBMIT = "thingstudio/gui_submit";
export const GUI_SLIDER = "thingstudio/gui_slider";
export const GUI_NUMBER = "thingstudio/gui_number";
export const GUI_TEXT = "thingstudio/gui_text";

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
    // A widget on a remote screen is registered by ts_remote (same _noop draw stubs; registering it here as
    // well would raise "registered twice" on the board).
    if (c.remoteWidgets.has(n.id)) continue;
    const staleMs = Math.max(0, Math.round(Number(n.properties.staleAfter ?? 0) * 1000)) || 0;
    const draw = c.widgetDraws.get(n.id) ?? "lambda _s, _r, _v, _st: None";
    lines.push(`_gui.widget(${pyStr(n.id)}, ${draw}, ${staleMs}${n.type === GUI_BUTTON || n.type === GUI_SUBMIT ? ", True" : ""})`);
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

/** The remote branch (displayKind "remote") of gui_screen's codegen. Emits the screens definition (compiled
 * by screens.ts's remote branch) and one setup: the shared ts_http_server on the web server config's port,
 * the ts_wifi bring-up, and ts_remote.Remote staged + started. The screen node's own event source waits on
 * the page-change stream, so a flow can react to board-owned navigation. Claimed invariants of Mike's
 * decision 8: the server is a general facility (`mount()` from any other code adds routes beside this);
 * remote display code owns only /ts/remote/ and one socket. */
function remoteScreenCodegen(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
  const screenName = typeof node.properties.name === "string" && node.properties.name ? node.properties.name : node.id;
  const base = ctx.uniqueName("remote_display");
  // One remote display per board today (decisions/remote-display.md position 1: one view at a time; ts_remote's
  // session state is per-Remote and its routes claim one prefix): a second remote screen in the same flow in
  // fact fails at runtime, so say it at compile instead.
  const others = (ctx.findNodesOfType?.(GUI_SCREEN) ?? []).filter(
    (n) => n.id !== node.id && String(n.properties.displayKind ?? "panel") === "remote",
  );
  if (others.length > 0) {
    throw new CompileError(
      `GUI screens ${nodeLabel(node)} and ${nodeLabel(others[0]!)} are both remote screens: a flow has one remote display for now (a second would fight over the web server's same route prefix)`,
    );
  }
  const configId = typeof node.properties.webServerConfigId === "string" ? node.properties.webServerConfigId : "";
  if (!configId) {
    throw new CompileError(`GUI screen ${nodeLabel(node)} is a remote screen: give it a web server config (a remote screen mounts the board's HTTP server)`);
  }
  const server = ctx.resolveConfig(configId);
  const port = Math.round(Number(server.port ?? 80));
  if (!(port >= 1 && port <= 65535)) {
    throw new CompileError(`web server config for GUI screen ${nodeLabel(node)}: port must be between 1 and 65535, got ${String(server.port)}`);
  }
  // A remote display needs the station up like any network node; an mqtt node in the flow owns the
  // connection (the same defer rule every network node follows).
  const mqttNodes = [...(ctx.findNodesOfType?.("thingstudio/mqtt_publish") ?? []), ...(ctx.findNodesOfType?.("thingstudio/mqtt_subscribe") ?? [])];
  const wifi = wifiSetupStatement(
    resolveFlowWifiCredentials(ctx, `GUI screen ${nodeLabel(node)}`).ssid,
    resolveFlowWifiCredentials(ctx, `GUI screen ${nodeLabel(node)}`).password,
    resolveFlowWifiCredentials(ctx, `GUI screen ${nodeLabel(node)}`).security,
    mqttNodes.length > 0,
  );

  const core = coreBlock(ctx);
  const surface = screensFor(ctx).surfaces.find((s) => s.screen === node.id);
  if (!surface) throw new CompileError(`GUI screen ${nodeLabel(node)} has no pages yet: lay it out in the GUI view`);
  const def = surface.remoteDef;
  if (def === undefined) throw new CompileError(`GUI screen ${nodeLabel(node)}: a remote screen's compiled definition is missing -- internal error, not a flow-authoring mistake`);

  // A remote display's memory floor is a measured fact (definitions/remote-display-measurements.ts), and
  // the compiler cannot see the board's image -- stock or custom is known only at deploy time, from the
  // frozen inventory -- so the warning names the image a measurement covers and fires for anything else.
  // A warning, never a block: unmeasured boards are caveat emptor by decision (decisions/remote-display.md
  // 2026-11-10).
  if (!ctx.target) {
    ctx.warn?.(`GUI screen ${nodeLabel(node)} is a remote display: no board or processor is selected, so its memory needs are not checked.`);
  } else {
    const measured = REMOTE_DISPLAY_MEASUREMENTS.get(ctx.target.processor.id);
    if (measured?.verdict === "comfortable") {
      ctx.warn?.(`GUI screen ${nodeLabel(node)} is a remote display on ${ctx.target.label}: measured comfortable on ${measured.note} -- a stock install is unmeasured and may not have the memory.`);
    } else if (measured?.verdict === "below-floor") {
      ctx.warn?.(`GUI screen ${nodeLabel(node)} is a remote display on ${ctx.target.label}: measured below the feature's floor on ${measured.note}.`);
    } else {
      ctx.warn?.(`GUI screen ${nodeLabel(node)} is a remote display on ${ctx.target.label}: not measured for remote displays -- it may not have the memory.`);
    }
  }

  const policy = String(node.properties.linkPolicy ?? "stale");
  if (policy !== "stale" && policy !== "safe") {
    throw new CompileError(`GUI screen ${nodeLabel(node)}: link policy must be stale or safe, got "${policy}"`);
  }
  const deadmanMs = Math.max(1, Math.round(Number(node.properties.deadmanMs ?? 400)));

  const code = [
    `${base}_srv = runtime.shared('http_server', ${port}, 'v1', lambda: ts_http_server.Server(${port}, [], {}))`,
    `${base}_def = ${def}`,
    `${base}_remote = ts_remote.Remote(_gui, ${base}_srv, ${base}_def, display=${pyStr(screenName)})`,
    `${base}_remote.stage()`,
    `${base}_remote.set_link_policy(${pyStr(policy)}${policy === "safe" ? `, ${deadmanMs}` : ""})`,
    `async def ${base}_start():`,
    `    await ${base}_remote.start()`,
    `runtime.spawn(${base}_start(), ${pyStr(node.id)})`,
  ].join("\n");
  return {
    imports: [...core.imports, "import ts_remote", "import ts_http_server"],
    statements: [wifi, ...core.statements, { key: `gui_screen_${node.id}`, code }],
    waitStatement: `_page = await _gui.page_changed(${pyStr(screenName)})`,
    buildMsg: `msg = {'payload': _page, 'topic': ${pyStr(screenName)}}`,
  };
}

export const guiScreenNode: NodeDefinition = {
  type: GUI_SCREEN,
  kind: "source",
  // Descriptor metadata (compiler/node-descriptor.ts) -- migrated onto the canonical descriptor.
  paletteId: "gui_screen",
  label: "screen",
  title: "screen",
  group: "GUI",
  priority: 10,
  color: "#3f6e5c",
  bgcolor: "#1f3a30",
  icon: "▣",
  width: 110,
  screenOutline: true,
  // Save/load a named theme under ~/.thingstudio/presets/gui_theme/ (shares the config's preset type).
  presetType: "gui_theme",
  description:
    "One per display. A panel screen: wire it to a display node; its size and frame format come from the display. " +
    "A remote screen: the board serves the phone the page (screen-size agnostic); needs a WiFi network and a web " +
    "server config in this flow.",
  ports: { outputs: [{ name: "frame", type: "bytes" }] },
  properties: [
    { name: "name", label: "name", kind: "text", default: "screen" },
    {
      name: "displayKind",
      label: "display kind",
      kind: "select",
      default: "panel",
      options: [
        { value: "panel", label: "a physical panel, wired to a display node" },
        { value: "remote", label: "a phone (the board's own web server)" },
      ],
      help:
        "A panel screen sends frames to the display it is wired to. A remote screen is screen-size agnostic: the phone " +
        "lays it out on its own viewport and the board serves it over its web server (a WiFi network and a web server " +
        "config must exist in this flow).",
    },
    {
      name: "webServerConfigId",
      label: "web server",
      kind: "configRef",
      configType: "thingstudio/config/web-server",
      default: "",
      visibleWhen: { field: "displayKind", equals: "remote" },
      help: "Which web server config this screen mounts on (the port).",
    },
    {
      name: "wifiConfigId",
      label: "WiFi",
      kind: "configRef",
      configType: "thingstudio/config/wifi",
      singleton: true,
      default: "",
      visibleWhen: { field: "displayKind", equals: "remote" },
    },
    // Fallback size/format for a screen not yet wired to a display; the wired display wins. Hidden: set once on
    // the display, not shown on the screen. A remote screen ignores sizes entirely.
    { name: "width", label: "width (px)", kind: "number", default: 320, min: 1, hidden: true },
    { name: "height", label: "height (px)", kind: "number", default: 240, min: 1, hidden: true },
    {
      name: "frameFormat",
      label: "frame format",
      kind: "select",
      default: "gs4",
      hidden: true,
      options: [
        { value: "gs4", label: "gs4 (16 greys)" },
        { value: "gs2", label: "gs2 (4 greys)" },
        { value: "mono", label: "mono" },
        { value: "rgb565", label: "rgb565 (colour)" },
      ],
    },
    { name: "minInterval", label: "fastest redraw (ms)", kind: "number", default: 200, min: 0, help: "A panel screen's redraw rate limit, or a remote screen's message rate (minIntervalMs in its definition)." },
    {
      name: "linkPolicy",
      label: "lost link means",
      kind: "select",
      default: "stale",
      options: [
        { value: "stale", label: "stale (the phone shows stale values)" },
        { value: "safe", label: "safe (the flow is told; for remote control)" },
      ],
      visibleWhen: { field: "displayKind", equals: "remote" },
      help:
        "What the board decides when the phone goes quiet. \"safe\" drives link_change() in the flow and arms a " +
        "deadman on slider input, so a drag that stopped turns the output safe -- wire the flow's outputs (motors, " +
        "heaters) through something that goes off on link down.",
    },
    { name: "deadmanMs", label: "deadman after (ms, no slider input)", kind: "number", default: 400, min: 1, visibleWhen: { field: "linkPolicy", equals: "safe" } },
    { name: "wrap", label: "next/prev wrap round", kind: "boolean", default: true, visibleWhen: { field: "displayKind", equals: "panel" } },
    // The layout grid (gui-grid-layout-scoping.md, 2026-10-24). Rows 0 = derived from the display's shape so a
    // cell stays roughly square: rows = round(columns * display height / display width).
    { name: "gridColumns", label: "grid columns", kind: "number", default: 12, min: 2, max: 48 },
    { name: "gridRows", label: "grid rows (0 = from the display's shape)", kind: "number", default: 0, min: 0, max: 64, visibleWhen: { field: "displayKind", equals: "panel" } },
    { name: "touchPanelConfigId", label: "touch panel (blank: no touch)", kind: "configRef", configType: "thingstudio/config/touch-panel", default: "", visibleWhen: { field: "displayKind", equals: "panel" } },
    {
      name: "themeConfigId",
      label: "shared theme config (older flows)",
      kind: "configRef",
      configType: GUI_THEME_CONFIG_TYPE,
      default: "",
      visibleWhen: { field: "displayKind", equals: "panel" },
      help:
        "Only used when the theme fields below are empty. Kept so a flow saved with a shared theme still renders; " +
        "the screen's own colours win.",
    },
    // The theme lives on the screen (Mike, 2026-10-24: "I think we want them on the screen"): a starting point
    // and ten role colours, the same fields the shared theme config has, so one screen is one complete look.
    {
      name: "themePreset",
      label: "theme",
      kind: "select",
      default: "",
      options: themePresetOptions(),
      visibleWhen: { field: "displayKind", equals: "panel" },
      help: "A starting point replaces the colours below; editing a colour makes the theme custom.",
    },
    ...THEME_ROLES.map((role) => ({ name: role, label: THEME_ROLE_LABELS[role], kind: "colour" as const, visibleWhen: { field: "displayKind", equals: "panel" } })),
  ],
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    if (String(node.properties.displayKind ?? "panel") === "remote") return remoteScreenCodegen(node, ctx);
    const { width, height, format } = screenSize(node, ctx);
    // A theme is optional; without one this resolves to the built-in colours, so existing flows are unchanged.
    const theme = resolveScreenTheme(ctx, node);
    const resolved = resolveThemeForFormat(theme, format);
    // A theme is sent for every format once one is chosen: on an indexed format its values are palette indexes,
    // and the display takes its palette from the same theme (display-spi.ts). Without a theme, the indexed formats
    // keep the device's own style untouched, which is why existing gs4/gs2/mono flows are unchanged. The screen's
    // own theme fields are the normal path (2026-10-24); a `themeConfigId` shared config is the older one.
    const shared = typeof node.properties.themeConfigId === "string" && node.properties.themeConfigId !== "";
    const emitTheme = format === "rgb565" || hasScreenTheme(node.properties) || shared;
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
        `${emitTheme ? `, theme=${themeLiteral(resolved.values, format === "rgb565")}` : ""}))`,
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

export const guiLabelNode: NodeDefinition = {
  ...widgetNode("thingstudio/gui_label"),
  paletteId: "gui_label",
  label: "label",
  title: "show text",
  group: "GUI",
  priority: 41,
  color: "#4a6e3f",
  bgcolor: "#2a3a1f",
  icon: "T",
  width: 100,
  properties: [
    { name: "name", label: "name", kind: "text", default: "" },
    { name: "font", label: "font (blank = fit the cells)", kind: "select", default: "", options: [
      { value: "", label: "auto (the largest that fits)" },
      ...fontIds().map((f) => ({ value: f, label: f.replace(/^font_/, "") })),
    ] },
    { name: "maxChars", label: "room for (characters)", kind: "number", default: 8, min: 1 },
    { name: "staleAfter", label: "stale after (s, 0 = never)", kind: "number", default: 0, min: 0 },
  ],
};
export const guiReadoutNode: NodeDefinition = {
  ...widgetNode("thingstudio/gui_readout"),
  paletteId: "gui_readout",
  label: "readout",
  title: "show number",
  group: "GUI",
  priority: 40,
  color: "#4a6e3f",
  bgcolor: "#2a3a1f",
  icon: "#",
  width: 110,
  description: "Shows msg.payload. Its space is sized for the lowest to highest value.",
  properties: [
    { name: "name", label: "name", kind: "text", default: "" },
    { name: "font", label: "font (blank = fit the cells)", kind: "select", default: "", options: [
      { value: "", label: "auto (the largest that fits)" },
      ...fontIds().map((f) => ({ value: f, label: f.replace(/^font_/, "") })),
    ] },
    { name: "caption", label: "caption (above the number)", kind: "text", default: "", help: "Static text above the value, in the theme's muted colour." },
    { name: "units", label: "units", kind: "text", default: "" },
    { name: "decimals", label: "decimals", kind: "number", default: 1, min: 0, max: 6 },
    { name: "lo", label: "lowest value", kind: "number", default: 0 },
    { name: "hi", label: "highest value", kind: "number", default: 100 },
    { name: "staleAfter", label: "stale after (s, 0 = never)", kind: "number", default: 0, min: 0 },
  ],
};
export const guiBarNode: NodeDefinition = {
  ...widgetNode("thingstudio/gui_bar"),
  paletteId: "gui_bar",
  label: "bar",
  title: "show level",
  group: "GUI",
  priority: 42,
  color: "#4a6e3f",
  bgcolor: "#2a3a1f",
  icon: "▬",
  width: 90,
  properties: [
    { name: "name", label: "name", kind: "text", default: "" },
    {
      name: "style",
      label: "style",
      kind: "select",
      default: "solid",
      options: [
        { value: "solid", label: "solid (outline and fill)" },
        { value: "segments", label: "segments (cells)" },
      ],
    },
    { name: "segments", label: "cells", kind: "number", default: 10, min: 1, max: 40, visibleWhen: { field: "style", equals: "segments" } },
    { name: "lo", label: "empty at", kind: "number", default: 0 },
    { name: "hi", label: "full at", kind: "number", default: 100 },
    { name: "staleAfter", label: "stale after (s, 0 = never)", kind: "number", default: 0, min: 0 },
  ],
};
export const guiTrendNode: NodeDefinition = {
  ...widgetNode("thingstudio/gui_trend"),
  paletteId: "gui_trend",
  label: "histogram",
  title: "show history",
  group: "GUI",
  priority: 45,
  color: "#4a6e3f",
  bgcolor: "#2a3a1f",
  icon: "▁▃▆",
  width: 100,
  description:
    "A histogram of the series a journal sends, newest on the right, or any list of numbers (None is a gap). A " +
    "wider space shows more history.",
  properties: [
    { name: "name", label: "name", kind: "text", default: "" },
    { name: "lo", label: "bottom at", kind: "number", default: 0, step: "any" },
    { name: "hi", label: "top at", kind: "number", default: 100, step: "any" },
    { name: "columns", label: "columns (natural width)", kind: "number", default: 60, min: 1 },
    { name: "colWidth", label: "column width (px)", kind: "number", default: 3, min: 1 },
    { name: "height", label: "height (px)", kind: "number", default: 48, min: 8 },
    { name: "staleAfter", label: "stale after (s, 0 = never)", kind: "number", default: 0, min: 0 },
  ],
};
export const guiLedNode: NodeDefinition = {
  ...widgetNode("thingstudio/gui_led"),
  paletteId: "gui_led",
  label: "light",
  title: "status light",
  group: "GUI",
  priority: 43,
  color: "#4a6e3f",
  bgcolor: "#2a3a1f",
  icon: "●",
  width: 90,
  description: "On when msg.payload is true, off when false.",
  properties: [
    { name: "name", label: "name", kind: "text", default: "" },
    {
      name: "style",
      label: "style",
      kind: "select",
      default: "light",
      options: [
        { value: "light", label: "light (circle)" },
        { value: "chip", label: "chip (text pill)" },
      ],
    },
    { name: "onText", label: "chip when on", kind: "text", default: "On", visibleWhen: { field: "style", equals: "chip" } },
    { name: "offText", label: "chip when off", kind: "text", default: "Off", visibleWhen: { field: "style", equals: "chip" } },
    { name: "staleAfter", label: "stale after (s, 0 = never)", kind: "number", default: 0, min: 0 },
  ],
};
/** Two-faced (compiler/node-definition.ts, codegenEventSource): the input sets what the button shows -- a toggle's
 * state, or a value replacing its text -- and the output sends when it is tapped: {topic: <name>, payload: ...}.
 * A navigate button has no output; it acts on its own screen. */
export const guiButtonNode: NodeDefinition = {
  ...widgetNode(GUI_BUTTON),
  // Descriptor metadata (compiler/node-descriptor.ts) -- migrated onto the canonical descriptor. Title
  // matches the old GUI_CANVAS_TITLES.gui_button ("touch button").
  paletteId: "gui_button",
  label: "button",
  title: "touch button",
  group: "GUI",
  priority: 44,
  color: "#4a6e3f",
  bgcolor: "#2a3a1f",
  icon: "▭",
  width: 100,
  ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
  properties: [
    { name: "name", label: "topic", kind: "text", default: "" },
    {
      name: "mode",
      label: "mode",
      kind: "select",
      default: "momentary",
      options: [
        { value: "momentary", label: "momentary: sends a value" },
        { value: "toggle", label: "toggle: sends the opposite of its state" },
        { value: "navigate", label: "navigate: changes page" },
      ],
    },
    {
      name: "style",
      label: "style",
      kind: "select",
      default: "box",
      options: [
        { value: "box", label: "box (outline and text)" },
        { value: "filled", label: "filled (solid)" },
        { value: "switch", label: "switch (a toggle)" },
      ],
      help: "A switch style needs a toggle button.",
    },
    {
      name: "valueType",
      label: "value type",
      kind: "select",
      default: "bool",
      visibleWhen: { field: "mode", notEquals: "navigate" },
      options: [
        { value: "bool", label: "true / false" },
        { value: "string", label: "text" },
        { value: "number", label: "number" },
      ],
    },
    {
      name: "fireOn",
      label: "send on",
      kind: "select",
      default: "release",
      visibleWhen: { field: "mode", notEquals: "navigate" },
      options: [
        { value: "release", label: "release (inside the button)" },
        { value: "press", label: "press" },
      ],
    },
    { name: "text", label: "board label (drawn on the button)", kind: "text", default: "", visibleWhen: { field: "mode", equals: "momentary" }, help: "What is drawn on the button; blank uses the flow label." },
    {
      name: "value",
      label: "sends (the payload)",
      kind: "text",
      default: "",
      visibleWhen: { field: "mode", equals: "momentary" },
      placeholderWhen: [
        { when: { field: "valueType", equals: "string" }, text: "ON" },
        { when: { field: "valueType", equals: "number" }, text: "1" },
        { text: "true" },
      ],
      help: "Sends this when tapped (the topic is above). The board label is what is drawn on the button (blank: the flow label); a msg.payload on its input replaces it.",
    },
    { name: "maxChars", label: "room for (characters, if no text)", kind: "number", default: 8, min: 1, visibleWhen: { field: "mode", equals: "momentary" } },
    {
      name: "onValue",
      label: "on sends",
      kind: "text",
      default: "",
      visibleWhen: { field: "mode", equals: "toggle" },
      placeholderWhen: [
        { when: { field: "valueType", equals: "string" }, text: "ON" },
        { when: { field: "valueType", equals: "number" }, text: "1" },
        { text: "true" },
      ],
      help: "Wire its input to the real state (a plug's MQTT status) and the flow owns it: it shows -- until the first report, a tap shows the requested state hollow until the input confirms it, and with no answer it goes back and flags the failure. Unwired, it keeps its own state. Its output sends the new state; wire it to whatever switches the device.",
    },
    {
      name: "offValue",
      label: "off sends",
      kind: "text",
      default: "",
      visibleWhen: { field: "mode", equals: "toggle" },
      placeholderWhen: [
        { when: { field: "valueType", equals: "string" }, text: "OFF" },
        { when: { field: "valueType", equals: "number" }, text: "0" },
        { text: "false" },
      ],
    },
    { name: "onText", label: "on shows", kind: "text", default: "ON", visibleWhen: { field: "mode", equals: "toggle" } },
    { name: "offText", label: "off shows", kind: "text", default: "OFF", visibleWhen: { field: "mode", equals: "toggle" } },
    { name: "initial", label: "starts on (when nothing is wired in)", kind: "boolean", default: false, visibleWhen: { field: "mode", equals: "toggle" } },
    { name: "pendingTimeout", label: "wait for confirmation (s, 5 or more)", kind: "number", default: 5, min: 5, visibleWhen: { field: "mode", equals: "toggle" } },
    {
      name: "target",
      label: "goes to",
      kind: "text",
      default: "",
      visibleWhen: { field: "mode", equals: "navigate" },
      placeholder: "next, prev, back, home or a page name",
      help: "Acts on its own screen; needs no wires.",
    },
  ],
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

// --- the phone-input widgets (2026-11-06, the editor authoring story for remote displays) -----------------
// All four live on a remote screen only (screens.ts refuses them on a panel table). On the board they are
// ts_remote's kinds, so no draw routine is registered in the flow's gui_core block: a widget on a remote
// screen is registered there with the same _noop stubs every remote widget gets.

export const guiNumberNode: NodeDefinition = {
  type: GUI_NUMBER,
  kind: "sink",
  // The board registers a remote-screen widget itself (ts_remote), so a field needs no message feed to
  // exist: it is placed, its key is read at boot, and its value reaches it through the page's own act.
  allowUnwired: true,
  paletteId: "gui_number",
  label: "number field",
  title: "number field",
  group: "GUI",
  priority: 46,
  color: "#4a6e3f",
  bgcolor: "#2a3a1f",
  icon: "⌨",
  width: 110,
  description:
    "An editable number on a remote display, read from and written to a settings key: the field shows the key's " +
    "value, a submit button writes it, and it survives a reboot. Its input turns the field into a display bound " +
    "to whatever feeds it.",
  ports: { inputs: [{ name: "msg", type: "any" }] },
  properties: [
    { name: "name", label: "label", kind: "text", default: "" },
    {
      name: "settingsKey",
      label: "settings key",
      kind: "text",
      default: "",
      help: "The runtime.settings key this field reads and writes. Empty means the field shows its input only and submits nothing.",
    },
    { name: "form", label: "form", kind: "text", default: "", help: "Which submit button this field belongs to. Fields with the same form name submit together." },
    { name: "defaultValue", label: "default value", kind: "number", default: 0 },
    { name: "staleAfter", label: "stale after (s, 0 = never)", kind: "number", default: 0, min: 0 },
  ],
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    if (!isFieldConfigured(node)) throw new CompileError(`${fieldLabel(node)}: give it a settings key (or wire its input)`);
    const core = coreBlock(ctx);
    return {
      imports: core.imports,
      statements: core.statements,
      functionName: ctx.uniqueName("gui_number"),
      functionBody: `_gui.set_value(${pyStr(node.id)}, msg.get('payload'))`,
    };
  },
};

export const guiTextNode: NodeDefinition = {
  type: GUI_TEXT,
  kind: "sink",
  // Same reasoning as the number field above (see gui.ts's phone-input widgets header).
  allowUnwired: true,
  paletteId: "gui_text",
  label: "text field",
  title: "text field",
  group: "GUI",
  priority: 47,
  color: "#4a6e3f",
  bgcolor: "#2a3a1f",
  icon: "¶",
  width: 110,
  description:
    "An editable text on a remote display, read from and written to a settings key: the field shows the key's " +
    "value, a submit button writes it, and it survives a reboot. Its input turns the field into a display bound " +
    "to whatever feeds it.",
  ports: { inputs: [{ name: "msg", type: "any" }] },
  properties: [
    { name: "name", label: "label", kind: "text", default: "" },
    {
      name: "settingsKey",
      label: "settings key",
      kind: "text",
      default: "",
      help: "The runtime.settings key this field reads and writes. Empty means the field shows its input only and submits nothing.",
    },
    { name: "form", label: "form", kind: "text", default: "", help: "Which submit button this field belongs to. Fields with the same form name submit together." },
    { name: "defaultValue", label: "default text", kind: "text", default: "" },
    { name: "staleAfter", label: "stale after (s, 0 = never)", kind: "number", default: 0, min: 0 },
  ],
  codegenSink(node: GraphNode, ctx: CodegenContext): SinkCodegenResult {
    if (!isFieldConfigured(node)) throw new CompileError(`${fieldLabel(node)}: give it a settings key (or wire its input)`);
    const core = coreBlock(ctx);
    return {
      imports: core.imports,
      statements: core.statements,
      functionName: ctx.uniqueName("gui_text"),
      functionBody: `_gui.set_value(${pyStr(node.id)}, msg.get('payload'))`,
    };
  },
};

export const guiSubmitNode: NodeDefinition = {
  type: GUI_SUBMIT,
  kind: "source",
  eventSource: true,
  paletteId: "gui_submit",
  label: "submit",
  title: "submit button",
  group: "GUI",
  priority: 48,
  color: "#3f5c8c",
  bgcolor: "#1f2a3a",
  icon: "⏎",
  width: 110,
  description:
    "Saves the fields of its form on the board: one submit writes every field with the same form name to " +
    "runtime.settings, and its output sends a message per save ({form, keys}).",
  ports: { outputs: [{ name: "msg", type: "any" }] },
  properties: [
    { name: "name", label: "label (what the button says)", kind: "text", default: "Save" },
    { name: "form", label: "form", kind: "text", default: "", help: "The fields with this form name write when this button submits." },
  ],
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    const form = typeof node.properties.form === "string" ? node.properties.form.trim() : "";
    if (!form) throw new CompileError(`${fieldLabel(node)}: give the form a name, and the same name on the fields it saves`);
    const core = coreBlock(ctx);
    if (screensFor(ctx).remoteWidgets.has(node.id) === false) {
      throw new CompileError(`${fieldLabel(node)}: place a submit button on a remote screen (it has nowhere to sit otherwise)`);
    }
    return {
      imports: core.imports,
      statements: core.statements,
      waitStatement: `_keys = await _gui.event(${pyStr(node.id)})`,
      buildMsg: `msg = {'payload': _keys, 'topic': ${pyStr(form)}}`,
    };
  },
};

export const guiSliderNode: NodeDefinition = {
  type: GUI_SLIDER,
  kind: "source",
  eventSource: true,
  paletteId: "gui_slider",
  label: "slider",
  title: "slider",
  group: "GUI",
  priority: 49,
  color: "#3f5c8c",
  bgcolor: "#1f2a3a",
  icon: "⬍",
  width: 110,
  description:
    "Continuous remote input: a drag on the phone sends its value at ~20 Hz, latest wins. Its output is the " +
    "usual msg, payload = the slider's value. For driving something with a failsafe, not for picking a setting.",
  ports: { outputs: [{ name: "msg", type: "any" }] },
  properties: [
    { name: "name", label: "name", kind: "text", default: "" },
    { name: "lo", label: "low value", kind: "number", default: 0 },
    { name: "hi", label: "high value", kind: "number", default: 100 },
    { name: "step", label: "step (0 = continuous)", kind: "number", default: 0, min: 0 },
  ],
  codegenEventSource(node: GraphNode, ctx: CodegenContext): EventSourceCodegenResult {
    if (!screensFor(ctx).remoteWidgets.has(node.id)) {
      throw new CompileError(`${fieldLabel(node)}: place a slider on a remote screen (a remote display is what it drives through)`);
    }
    const core = coreBlock(ctx);
    return {
      imports: core.imports,
      statements: core.statements,
      waitStatement: `_ctl = await _remote.control()`,
      buildMsg: `msg = {'payload': _ctl.get('payload'), 'topic': ${pyStr(node.id)}}`,
    };
  },
};

/** A field's settings key decides whether its form submit writes it; an unwired, keyless field is dead. */
function isFieldConfigured(node: GraphNode): boolean {
  return typeof node.properties.settingsKey === "string" && node.properties.settingsKey.trim() !== "";
}

function fieldLabel(node: GraphNode): string {
  const kindName = node.type.replace("thingstudio/", "");
  return `${kindName} ${nodeLabel(node)}`;
}

export const guiNavigatorNode: NodeDefinition = {
  type: "thingstudio/gui_navigator",
  kind: "transform",
  // Descriptor metadata (compiler/node-descriptor.ts) -- migrated onto the canonical descriptor.
  paletteId: "gui_navigator",
  label: "navigator",
  title: "change page",
  group: "GUI",
  priority: 20,
  color: "#3f5c6e",
  bgcolor: "#1f303a",
  icon: "⇆",
  width: 120,
  hidden: true,
  description: "msg.payload: next, prev, back, home or a page name. Sends the new page when it changes.",
  // `any` in, checked when it arrives: a function or timer upstream is untyped, and a non-string command
  // gets a NODE_ERROR naming what's accepted (the canvas refused any -> string wires, 2026-10-08).
  ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "page", type: "string" }] },
  properties: [
    { name: "name", label: "name", kind: "text", default: "navigator" },
    { name: "screen", label: "screen", kind: "text", default: "", placeholder: "only needed with two screens" },
  ],
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
  // Descriptor metadata (compiler/node-descriptor.ts) -- migrated onto the canonical descriptor.
  paletteId: "gui_modal",
  label: "modal",
  title: "pop-up alert",
  group: "GUI",
  priority: 30,
  color: "#6e3f3f",
  bgcolor: "#3a1f1f",
  icon: "!",
  width: 100,
  description:
    "Opens with msg.payload as its content; a payload of None closes it. The output sends how it closed: ack, " +
    "timeout or closed.",
  ports: { inputs: [{ name: "msg", type: "any" }], outputs: [{ name: "msg", type: "any" }] },
  properties: [
    { name: "name", label: "name", kind: "text", default: "" },
    { name: "screen", label: "screen", kind: "text", default: "", placeholder: "only needed with two screens" },
    { name: "priority", label: "priority", kind: "number", default: 0 },
    { name: "timeout", label: "close after (s, 0 = never)", kind: "number", default: 0, min: 0 },
  ],
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

export const GUI_NODES: NodeDefinition[] = [
  guiScreenNode, guiLabelNode, guiReadoutNode, guiBarNode, guiTrendNode, guiLedNode, guiButtonNode,
  // The phone-input widgets (2026-11-06), remote-display only.
  guiNumberNode, guiTextNode, guiSubmitNode, guiSliderNode,
  guiNavigatorNode, guiModalNode,
];
