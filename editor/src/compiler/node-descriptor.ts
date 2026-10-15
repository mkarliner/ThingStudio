// SPDX-License-Identifier: Apache-2.0
// editor/src/compiler/node-descriptor.ts
//
// The canonical NodeDescriptor (docs/working-notes/node-descriptor-unification-briefing.md,
// decisions/node-board-mapping.md's 2026-10-14 "metadata-first" call): the plain, serializable data
// half of a node type -- id, kind, ports, palette styling, property schema, hardware requirements.
// A built-in's NodeDefinition (./node-definition.ts) is a NodeDescriptor plus its TypeScript codegen
// hooks; a custom `.node.json` is a serialization of this same shape minus those hooks (node-library/
// custom-node.ts). One shape, two producers -- the point of the unification.
//
// This lives in compiler/ rather than app/ so both the engine (which reads type/kind/ports/requires
// and the codegen hooks) and the canvas (which reads label/color/group/properties) may see it:
// app/ is the top layer and may import compiler/, but not the reverse. The primitive port types
// below (NodeKind/PayloadType/PortType/PortDefinition) used to live in ./node-definition.ts; they
// moved here so NodeDefinition can extend this type without a circular import, and
// ./node-definition.ts re-exports them so existing `from "./node-definition.js"` imports keep working.

export type NodeKind = "source" | "transform" | "sink";

// §6's fixed payload type set (design doc §6, "payload itself is typed from a small fixed set").
// Single source of truth for both sides that need it: rete/sockets.ts maps each of these to a real
// socket class for the editor's wire-connect-time check, and a node descriptor's `ports` field
// declares its ports' types against it.
export type PayloadType = "int" | "number" | "bool" | "string" | "bytes" | "any";

// A port's type is usually fixed, but not always -- inject's single output is `bool`/`number`/
// `string` depending on its own `payloadType` property, the one node whose port type isn't static.
// A function taking the node's resolved `properties` covers that case without a second, parallel
// mechanism for "ports that can retype" -- see resolvePortType below.
export type PortType = PayloadType | ((properties: Record<string, unknown>) => PayloadType);

export interface PortDefinition {
  /** Must match the port's key in the node's own descriptor/class exactly. */
  name: string;
  type: PortType;
}

/** Resolves a possibly-dynamic PortDefinition against one node instance's current properties. The one
 * place `typeof type === "function"` gets checked -- callers never branch on that themselves. */
export function resolvePortType(port: PortDefinition, properties: Record<string, unknown>): PayloadType {
  return typeof port.type === "function" ? port.type(properties) : port.type;
}

// The property-panel field vocabulary. The first four (text/number/boolean/select) are the
// serializable subset a custom `.node.json` may use (node-library/custom-node.ts's PROPERTY_KINDS,
// mirrored in interfaces/node-descriptor/custom-node.schema.json); the rest are built-in-only editor
// widgets (a credential picker, a config reference, a pin selector). config-types.ts's own
// ConfigFieldDescriptor reuses this union so a config's fields and a node's fields share one
// vocabulary.
export type PropertyFieldKind =
  | "text"
  | "password"
  | "number"
  | "select"
  | "boolean"
  | "credential"
  | "configRef"
  | "pin"
  | "palette";

export interface PropertyFieldOption {
  /** A string for most fields; a number for a `select` over numeric values (e.g. bme280's I2C address).
   * A custom `.node.json` may only use string options (custom-node.schema.json). */
  value: string | number;
  label: string;
}

/** One field in a node's property panel -- a generic renderer (PropertyPanel.vue) dispatches on
 * `kind`. Mirrors config-types.ts's ConfigFieldDescriptor plus the two things a node field needs that
 * a config field doesn't: a `default` (seeds a freshly-dropped node's `properties`) and optional
 * number bounds / a `showIf` visibility predicate. */
export interface PropertyFieldDescriptor {
  /** Dict key in the node's `properties` and in the generated Python `properties` argument. Absent for
   * an **info-only** field: the panel renders the widget but it binds to no property (the display-only
   * WiFi `configRef` on a network node, where the config is a flow singleton). */
  name?: string;
  label: string;
  kind: PropertyFieldKind;
  /** Seed value for a freshly-dropped node; also the fallback for a flow file that omits the field.
   * Absent for an info-only field (one with no `name`). */
  default?: unknown;
  /** Required, non-empty, when kind is "select"; `default` must be one of the values. */
  options?: PropertyFieldOption[];
  /** Only meaningful when `kind` is "configRef" -- the config type this field points at. */
  configType?: string;
  /** Only meaningful when `kind` is "credential" -- which credential-store namespace this resolves against. */
  credentialType?: "wifi" | "mqtt-broker";
  /** Short plain-text note rendered under the field, any kind. */
  help?: string;
  /** Hint text shown in an empty text/number input (e.g. "e.g. 0x29"), any kind. */
  placeholder?: string;
  /** A pin field where -1/blank means "not wired"; a configRef that may be left unset. */
  optional?: boolean;
  /** Number-field bounds/step, forwarded to the <input type="number">. `step` may be the literal
   * "any" (HTML's arbitrary-precision step) as well as a number. */
  min?: number;
  max?: number;
  step?: number | "any";
  /** Show this field only when the predicate holds (e.g. a "deadband" threshold only in deadband mode). Built-in
   * only -- a function, so it can't serialize to a custom `.node.json` (custom nodes get no conditionals). */
  showIf?: (properties: Record<string, unknown>) => boolean;
  /** Changing this field re-resolves the node's port sockets -- for a port whose `type` is a function of
   * properties (e.g. inject/startup's output tracks `payloadType`). Built-in only. */
  retype?: boolean;
}

/** The canonical node descriptor: plain data only, plus (on a built-in's NodeDefinition) the codegen
 * hooks that a custom `.node.json` deliberately cannot carry. */
export interface NodeDescriptor {
  /** e.g. "thingstudio/gpio_out" (built-in) or "custom/dht22". */
  type: string;
  /** Where the node sits in a flow: source (no input), transform (one in, one out), sink (one in, none out). */
  kind: NodeKind;
  /** The short canvas/palette key (e.g. "gpio_out"), distinct from `kind` above and from the full `type`.
   * "custom" for every loaded custom type, whose real id is `type`. Keys palette styling and NODE_FACTORIES.
   *
   * The five metadata fields below (paletteId/label/group/priority/color...) are optional while the
   * built-in library migrates family by family: a migrated node fills them in and the canvas/palette/
   * panel/catalog read them instead of their own hardcoded copy; an unmigrated node leaves them off
   * and palette.ts still supplies its row. Once every family is migrated these become required and
   * palette.ts's per-kind rows go away (node-descriptor-unification-briefing.md). A descriptor with a
   * paletteId is "migrated". */
  paletteId?: string;
  /** Name shown on the canvas and in the palette. */
  label?: string;
  /** Canvas title, when it differs from the palette `label` (e.g. gui_label shows "show text" on the canvas
   * but is "label" in the palette). Defaults to `label`. */
  title?: string;
  /** Hide from the palette (still usable in a flow file). */
  hidden?: boolean;
  /** Show the `ScreenOutline` widget in the property panel (a gui_screen's widget layout). */
  screenOutline?: boolean;
  /** Palette section (PaletteSidebar.vue); one of palette.ts's DEFAULT_NODE_GROUPS for most built-ins. */
  group?: string;
  /** Order within `group`, lower first. */
  priority?: number;
  /** Node outline color. Defaults to the palette's grey. */
  color?: string;
  /** Node fill color. Defaults to the palette's grey. */
  bgcolor?: string;
  /** One or two glyphs shown in the icon chip. */
  icon?: string;
  /** Canvas pill width in px; defaults to the class's own default when absent. */
  width?: number;
  /** Short self-documenting blurb (shown in the editor / catalog). */
  description?: string;
  /** Hardware capabilities this node needs (e.g. `["espnow"]`), checked centrally against the compile's
   * Target by definitions/capability-check.ts. Absent = needs nothing in particular. */
  requires?: { readonly capabilities?: readonly string[] };
  /** The node is valid with nothing wired to it, so "disconnected from any source" doesn't apply (a gui_button:
   * it is useful as a pure input, with nothing to display). */
  allowUnwired?: boolean;
  /** Inputs/outputs with a payload type each. Editor-side only: read by the class factory to build real
   * sockets, and by the catalog. compile.ts's own graph walk does not read this. */
  ports?: {
    inputs?: PortDefinition[];
    outputs?: PortDefinition[];
  };
  /** The property panel's field schema. */
  properties?: PropertyFieldDescriptor[];
  /** Preset type (admin API `/api/presets/{type}`): when set, the panel shows a save/load-preset
   * control at the top (`PresetRefField`). The preset snapshots the node's whole `properties` object. */
  presetType?: string;
}
