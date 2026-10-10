// SPDX-License-Identifier: Apache-2.0
// editor/src/cli/describe.ts
//
// What an author (a person or an AI agent) needs to know to write a node into a flow file: its type id, its ports and
// their payload types, and every property it takes with the default the editor gives it. Generated from the editor's
// own node classes and node definitions, the same code that opens a flow, so it can't drift from them. Used by
// `thingstudio-compile --describe` and to generate docs/user-guide/nodes-catalog.md (a test fails when that file is
// out of date; regenerate it with the command in the test's message).
//
// Not here: allowed values and ranges. They live in each node's own validation, and the compile check reports them in
// words on the first try (for example `journal node's rows "0" must be a whole number from 1 to 256`).

import type { PortDefinition } from "../compiler/node-definition.js";
import { resolvePortType } from "../compiler/node-definition.js";
import { CONFIG_TYPES } from "../app/rete/config-types.js";
import { NODE_FACTORIES } from "../app/rete/nodes.js";
import { NODE_PALETTE } from "../app/rete/palette.js";
import { buildRegistry } from "../node-library/registry.js";

export interface PortInfo { name: string; type: string }
export interface PropertyInfo {
  /** What the property means, when the name and default don't say. */
  note?: string;
  name: string;
  /** string, number, boolean, or object for anything else. */
  type: string;
  default: unknown;
  /** A property that holds the id of a config node: "thingstudio/config/i2c-bus" etc. when known. */
  configType?: string;
}
export interface NodeInfo {
  type: string;
  kind: string;
  label: string;
  group: string;
  inputs: PortInfo[];
  outputs: PortInfo[];
  /** The number of outputs depends on a property (the function node's outputCount). */
  variableOutputs: boolean;
  properties: PropertyInfo[];
}
export interface ConfigFieldInfo { name: string; kind: string; options?: string[]; configType?: string; help?: string }
export interface ConfigInfo { type: string; label: string; singleton: boolean; fields: ConfigFieldInfo[]; defaults: Record<string, unknown> }
export interface Catalog {
  nodes: NodeInfo[];
  /** Node types the compiler knows that the canvas has no node for (a flow file can still use them). */
  compileOnly: string[];
  configs: ConfigInfo[];
}

// Which config type a `...ConfigId` property points at. The property name says which kind of config it takes.
const CONFIG_BY_PROPERTY: Record<string, string> = {
  i2cConfigId: "thingstudio/config/i2c-bus",
  wifiConfigId: "thingstudio/config/wifi",
  brokerConfigId: "thingstudio/config/mqtt-broker",
  touchPanelConfigId: "thingstudio/config/touch-panel",
};

function ports(list: PortDefinition[] | undefined, props: Record<string, unknown>): PortInfo[] {
  return (list ?? []).map((p) => ({ name: p.name, type: String(resolvePortType(p, props)) }));
}

// One line for the properties whose name and default don't say enough (units, which of several values, what a number
// counts). Hand-written, keyed "<kind>.<property>"; a test fails if a key names a property that no longer exists.
export const PROPERTY_NOTES: Record<string, string> = {
  "timer.intervalMs": "milliseconds between messages; the payload is a count that rises 1, 2, 3...",
  "function.code": "the body of a MicroPython function; `msg` in, return the message, None, or a list with one entry per output",
  "function.outputCount": "how many outputs, 1 to 10",
  "display_i2c.addr": "the I2C address as a plain number: 60 is 0x3C, the usual SSD1306 address",
  "gui_modal.screen": "the id of the gui_screen node this modal belongs to",
  "gui_modal.timeout": "seconds before the modal closes itself; 0 never",
  "gui_modal.priority": "a higher priority takes the screen from a lower one; the other waits",
  "bme280.address": "the I2C address as a plain number: 118 is 0x76, 119 is 0x77",
  "bme280.intervalMs": "milliseconds between readings, at least 100",
  "journal.rows": "how many rows are kept, 1 to 256",
  "journal.stepSeconds": "seconds per row; 0 makes every message its own row",
  "journal.steps": "rows per roll-up to the second output; 0 sends none",
  "journal.xff": "0 to 1: a roll-up becomes a gap if more than this fraction of its rows are gaps",
  "gui_screen.width": "the panel's own width in pixels, whatever the orientation; must match the display it is wired to",
  "gui_screen.height": "the panel's own height in pixels, whatever the orientation; must match the display it is wired to",
  "gui_screen.frameFormat": "rgb565, gs4, gs2 or mono; must match the display",
  "gui_screen.minInterval": "least milliseconds between screen updates",
  "gui_screen.wrap": "whether next/prev wrap around at the ends of the pages",
  "gui_screen.touchPanelConfigId": "the touch-panel config to read touches from; empty for none",
  "display_spi.orientation": "empty = off (the raw `rotation`), or 0, 90, 180, 270 as a string: the picture turned clockwise. Portrait 320x480 needs none",
  "display_spi.rotation": "how the panel is mounted, 0 to 7 (MADCTL); with an orientation, 0 to 3 only",
  "display_spi.width": "the panel's own width in pixels",
  "display_spi.height": "the panel's own height in pixels",
  "display_spi.frameFormat": "rgb565, gs4, gs2 or mono; must match the gui screen",
  "display_spi.xstart": "-1 lets the driver choose; set both only for an unusual panel offset",
  "display_spi.reset": "GPIO, or -1 for none",
  "display_spi.cs": "GPIO, or -1 for none",
  "display_spi.backlight": "GPIO, or -1 for none",
  "gui_readout.units": "text shown after the number",
  "gui_readout.lo": "lowest value it will show; with hi, sizes the space the number gets",
  "gui_readout.hi": "highest value it will show; with lo, sizes the space the number gets",
  "gui_readout.staleAfter": "seconds without a new value before it dims; 0 = never",
  "gui_label.maxChars": "room for this many characters",
  "gui_label.staleAfter": "seconds without a new value before it dims; 0 = never",
  "gui_bar.lo": "the value at which the bar is empty",
  "gui_bar.hi": "the value at which the bar is full",
  "gui_bar.staleAfter": "seconds without a new value before it dims; 0 = never",
  "gui_trend.lo": "value at the bottom of the bars; the range is fixed",
  "gui_trend.hi": "value at the top of the bars; the range is fixed",
  "gui_trend.columns": "natural width in bars; in a layout it can stretch to show more",
  "gui_trend.colWidth": "pixels per bar",
  "gui_trend.height": "natural height in pixels",
  "gui_trend.staleAfter": "seconds without a new row before it dims; 0 = never",
  "gui_led.staleAfter": "seconds without a new value before it goes grey; 0 = never",
  "gui_button.mode": "momentary, toggle or navigate",
  "gui_button.text": "what is drawn on the button; empty uses `name`",
  "gui_button.maxChars": "room for this many characters (a value replaces the text)",
  "gui_button.valueType": "bool, string or number: the type of what it sends",
  "gui_button.value": "momentary: what it sends; empty sends true, 'ON' or 1 by valueType",
  "gui_button.onValue": "toggle: what it sends to turn on",
  "gui_button.offValue": "toggle: what it sends to turn off",
  "gui_button.fireOn": "release (default: the finger lifts inside the button) or press",
  "gui_button.target": "navigate: next, prev, back, home or a page name from `screens`",
  "gui_button.pendingTimeout": "toggle with a wired input: seconds to wait for the input to confirm before going back",
  "clock.utcOffset": "hours from UTC for standard time, -12 to 14; the daylight-saving hour is added by `dst`",
  "clock.dst": "eu adds the UK/EU summer hour automatically; none adds nothing",
  "mqtt_publish.qos": "0 or 1",
};

const typeOf = (v: unknown): string => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? typeof v : "object");

export function buildCatalog(): Catalog {
  const registry = buildRegistry();
  const nodes: NodeInfo[] = [];
  const seen = new Set<string>();
  for (const [kind, factory] of Object.entries(NODE_FACTORIES)) {
    const node = factory() as unknown as { nodeType: string; properties: Record<string, unknown> };
    const def = registry.get(node.nodeType);
    const style = (NODE_PALETTE as Record<string, { label: string; group: string }>)[kind];
    seen.add(node.nodeType);
    const properties = Object.entries(node.properties).map(([name, value]): PropertyInfo => {
      const p: PropertyInfo = { name, type: typeOf(value), default: value };
      if (CONFIG_BY_PROPERTY[name]) p.configType = CONFIG_BY_PROPERTY[name];
      const note = PROPERTY_NOTES[`${kind}.${name}`];
      if (note) p.note = note;
      return p;
    });
    nodes.push({
      type: node.nodeType,
      kind: def?.kind ?? "?",
      label: style?.label ?? kind,
      group: style?.group ?? "",
      inputs: ports(def?.ports?.inputs, node.properties),
      outputs: ports(def?.ports?.outputs, node.properties),
      variableOutputs: def?.outputCount !== undefined,
      properties,
    });
  }
  nodes.sort((a, b) => a.group.localeCompare(b.group) || a.type.localeCompare(b.type));
  const compileOnly = [...registry.keys()].filter((t) => !seen.has(t)).sort();
  const configs = Object.values(CONFIG_TYPES)
    .map((c): ConfigInfo => ({
      type: c.type,
      label: c.label,
      singleton: c.singleton === true,
      defaults: c.defaults,
      fields: c.fields.map((f) => ({
        name: f.name,
        kind: f.kind,
        ...(f.options ? { options: f.options.map((o) => o.value) } : {}),
        ...(f.configType ? { configType: f.configType } : {}),
        ...(f.help ? { help: f.help } : {}),
      })),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
  return { nodes, compileOnly, configs };
}

/** Finds a node by full type ("thingstudio/timer") or short name ("timer"). */
export function findNode(catalog: Catalog, name: string): NodeInfo | undefined {
  return catalog.nodes.find((n) => n.type === name || n.type === `thingstudio/${name}`);
}

const lit = (v: unknown): string => (v === "" ? '`""`' : `\`${JSON.stringify(v)}\``);
const portList = (p: PortInfo[]): string => (p.length ? p.map((x) => `${x.name} (${x.type})`).join(", ") : "none");

export function renderNode(n: NodeInfo, heading = "###"): string {
  const lines = [`${heading} ${n.label}`, "", `Type \`${n.type}\`, kind ${n.kind}${n.group ? `, palette group ${n.group}` : ""}.`, ""];
  lines.push(`- Inputs: ${portList(n.inputs)}`);
  lines.push(`- Outputs: ${portList(n.outputs)}${n.variableOutputs ? " (the number of outputs is the node's `outputCount` property)" : ""}`);
  if (n.properties.length === 0) {
    lines.push("- Properties: none");
  } else {
    lines.push("- Properties (name, type, default):");
    for (const p of n.properties) {
      const cfg = p.configType ? `, the id of a \`${p.configType}\` config` : "";
      const note = p.note ? ` — ${p.note}` : "";
      lines.push(`    - \`${p.name}\`, ${p.type}, default ${lit(p.default)}${cfg}${note}`);
    }
  }
  return lines.join("\n");
}

export function renderMarkdown(c: Catalog): string {
  const out: string[] = [
    "# Node catalog",
    "",
    "<!-- Generated by `node dist-cli/thingstudio-compile.mjs --describe-all --markdown`. Do not edit by hand: a test fails when it is out of date. -->",
    "",
    "Every node a flow file can use: its type id, its ports with their payload types, and its properties with the default",
    "the editor gives a new node. A property a flow file leaves out gets this default. Allowed values and ranges are",
    "checked when the flow is compiled, and the error says what is allowed. See [Check a flow without the editor](check-a-flow.md).",
    "",
    "Ports are numbered from 0 in a flow file's `edges`: `[fromNodeId, outputNumber, toNodeId, inputNumber]`, in the order listed here.",
    "",
  ];
  let group: string | null = null;
  for (const n of c.nodes) {
    if (n.group !== group) {
      group = n.group;
      out.push(`## ${group || "Other"}`, "");
    }
    out.push(renderNode(n), "");
  }
  if (c.compileOnly.length) {
    out.push("## Compile-only types", "", "The compiler accepts these but the canvas has no node for them: " + c.compileOnly.map((t) => `\`${t}\``).join(", ") + ".", "");
  }
  out.push("## Config nodes", "", "A config node is listed under `configs` in a flow file as `{id, type, properties}`. A node names it by id in a property such as `i2cConfigId`. Credentials are saved by name (`credentialName`), never as secrets in the file.", "");
  for (const cfg of c.configs) {
    out.push(`### ${cfg.label}`, "", `Type \`${cfg.type}\`${cfg.singleton ? ", one per flow" : ""}.`, "");
    for (const f of cfg.fields) {
      const extra = [f.options ? `one of ${f.options.map((o) => `\`${o}\``).join(", ")}` : "", f.configType ? `the id of a \`${f.configType}\` config` : "", f.help ?? ""].filter(Boolean).join("; ");
      out.push(`- \`${f.name}\`, ${f.kind}${extra ? `: ${extra}` : ""}`);
    }
    out.push("", `Defaults: \`${JSON.stringify(cfg.defaults)}\``, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
