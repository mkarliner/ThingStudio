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
// `string` depending on its own `payloadType` property. The data form below covers that case: it is
// serializable, so a custom `.node.json` and a built-in descriptor express it the same way (the
// project's data-equivalent rule). The old JS-function form was removed 2026-10-20 when the last
// three users (inject, startup, variable_get) moved to this form.
export interface PortTypeFromProperty {
  /** The node property whose value selects the type. */
  readonly property: string;
  /** Property value -> payload type. */
  readonly map: Readonly<Record<string, PayloadType>>;
  /** Used when the property is missing or has no mapping. */
  readonly default: PayloadType;
}

export type PortType = PayloadType | PortTypeFromProperty;

export interface PortDefinition {
  /** Must match the port's key in the node's own descriptor/class exactly. */
  name: string;
  type: PortType;
}

/** Resolves a possibly-dynamic PortDefinition against one node instance's current properties. The one
 * place the data form gets interpreted -- callers never branch on that themselves. */
export function resolvePortType(port: PortDefinition, properties: Record<string, unknown>): PayloadType {
  const type = port.type;
  if (typeof type === "string") return type;
  const mapped = type.map[String(properties[type.property])];
  return mapped ?? type.default;
}

// The property-panel field vocabulary. The first four (text/number/boolean/select) are the
// serializable subset a custom `.node.json` may use (node-library/custom-node.ts's PROPERTY_KINDS,
// mirrored in interfaces/node-descriptor/custom-node.schema.json); the rest are built-in-only editor
// widgets (a credential picker, a config reference, a pin selector). config-types.ts's own
// ConfigFieldDescriptor reuses this union so a config's fields and a node's fields share one
// vocabulary.
export type PropertyFieldKind =
  | "text"
  | "textarea"
  | "password"
  | "number"
  | "select"
  | "boolean"
  | "credential"
  | "configRef"
  | "pin"
  | "target"
  | "nodeId"
  | "palette";

export interface PropertyFieldOption {
  /** A string for most fields; a number for a `select` over numeric values (e.g. bme280's I2C address).
   * A custom `.node.json` may only use string options (custom-node.schema.json). */
  value: string | number;
  label: string;
}

/** A serializable field-visibility predicate: show the field only when `properties[field]` satisfies
 * the one condition given. The data form of a conditional -- a custom `.node.json` can carry it (the
 * earlier function-valued `showIf` could not, a built-in-only corner). */
export interface FieldPredicate {
  /** The property whose value decides visibility (a missing property compares as `undefined`). */
  field: string;
  equals?: string | number | boolean;
  notEquals?: string | number | boolean;
  /** True when the value is one of these. */
  in?: (string | number | boolean)[];
  /** Number comparisons; a non-numeric value is NaN and so fails all of them. */
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

/** A piece of text chosen by a condition -- the data form of a placeholder that changes with another
 * property's value (the gui_button's value field: "ON"/"OFF"/"true"/"false" by `valueType`). The first
 * variant whose `when` holds wins; a variant with no `when` is the fallback. */
export interface ConditionalText {
  when?: FieldPredicate;
  text: string;
}

/** Picks a conditional text (a `placeholderWhen` entry): first matching variant, else `fallback`. */
export function resolveConditionalText(
  variants: readonly ConditionalText[] | undefined,
  fallback: string | undefined,
  properties: Record<string, unknown>,
): string | undefined {
  for (const v of variants ?? []) {
    if (!v.when || evaluatePredicate(v.when, properties)) return v.text;
  }
  return fallback;
}

/** True when the predicate holds for these properties. An empty predicate (no operator) is always true. */
export function evaluatePredicate(predicate: FieldPredicate, properties: Record<string, unknown>): boolean {
  const value = properties[predicate.field];
  if (predicate.equals !== undefined) return value === predicate.equals;
  if (predicate.notEquals !== undefined) return value !== predicate.notEquals;
  if (predicate.in !== undefined) return predicate.in.includes(value as string | number | boolean);
  const n = Number(value);
  if (predicate.gt !== undefined) return n > predicate.gt;
  if (predicate.gte !== undefined) return n >= predicate.gte;
  if (predicate.lt !== undefined) return n < predicate.lt;
  if (predicate.lte !== undefined) return n <= predicate.lte;
  return true;
}

/** One field in a node's property panel -- a generic renderer (PropertyPanel.vue) dispatches on
 * `kind`. Mirrors config-types.ts's ConfigFieldDescriptor plus the two things a node field needs that
 * a config field doesn't: a `default` (seeds a freshly-dropped node's `properties`) and optional
 * number bounds / a `visibleWhen` visibility predicate. */
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
  /** A placeholder that changes with another property's value; the first matching variant wins, falling
   * back to `placeholder`. Serializable data, so a custom `.node.json` could carry it (not exposed there
   * yet). */
  placeholderWhen?: ConditionalText[];
  /** Rows for a `textarea` field (the function node's code editor uses 10). */
  rows?: number;
  /** A pin field where -1/blank means "not wired"; a configRef that may be left unset. */
  optional?: boolean;
  /** Number-field bounds/step, forwarded to the <input type="number">. `step` may be the literal
   * "any" (HTML's arbitrary-precision step) as well as a number. */
  min?: number;
  max?: number;
  step?: number | "any";
  /** On a `text` field: the value is a whole number (decimal or 0x hex), parsed and range-checked against
   * `min`/`max` at compile time and inlined as a number, not a string (e.g. an I2C address/register). An
   * empty value is a compile error unless `optional`, in which case it becomes `None`. */
  integer?: boolean;
  /** Show this field only when this predicate holds (e.g. a "deadband" threshold only in deadband mode).
   * Serializable data, so a custom `.node.json` can carry it too. */
  visibleWhen?: FieldPredicate;
  /** Changing this field re-resolves the node's port sockets -- for a port whose `type` is a function of
   * properties (e.g. inject/startup's output tracks `payloadType`). Built-in only. */
  retype?: boolean;
  /** On a `configRef` field: resolve the flow's single config of `configType` at compile time
   * (`findConfigsOfType`) rather than the config the node's stored id names -- how a built-in treats the
   * singleton WiFi config. Zero or many is a compile error; the field's stored value is ignored. */
  singleton?: boolean;
  /** On a numeric field: the field's value must be less than the named property's value, checked at compile
   * time (e.g. ebutton's double-click must be shorter than its long-press). Added 2026-10-16, core-only. */
  lessThan?: string;
  /** A field the package's Python reads but the property panel (and catalog) does not show -- for a legacy
   * property kept only for compile compatibility (display_i2c's node-level bus pins). Added 2026-10-16. */
  hidden?: boolean;
  /** On a `pin` field: whether the pin is driven or read, so the compiler can check it against the board
   * (`checkPin`) and claim it as a resource. Defaults to "input". */
  pinUse?: "input" | "output";
  /** On an input `pin` field: the internal pull the node configures, used for the resource claim's text
   * (so it shares with a built-in using the same mode) and the no-pull warning. Defaults to "none". */
  pinPull?: "none" | "up" | "down";
}

/** Outputs that vary per instance with a numeric property -- the data form of the old function-valued
 * `outputCount` hook (today: only the function node). The canvas class builds one output per unit from
 * the single `ports.outputs` template, named `<namePrefix><index>` (e.g. "out0") and labelled "1", "2",
 * ...; the pill grows by `rowHeightPx` per output past the first. The compiler reads the same count to
 * decide whether a transform's return routes across several outputs. */
export interface DynamicOutputs {
  /** The numeric property on the node instance holding the count. */
  property: string;
  /** Count bounds; a missing/non-numeric property resolves to `min`. */
  min: number;
  max: number;
  /** Output key prefix: the output at position `i` is `<namePrefix><i>`. */
  namePrefix: string;
  /** Extra pill height per output past the first, in px. */
  rowHeightPx: number;
}

/** The output count this instance has under a `dynamicOutputs` spec: `round(properties[property])`,
 * clamped to `min`..`max`, with `min` for a missing/non-numeric value. */
export function resolveOutputCount(spec: DynamicOutputs, properties: Record<string, unknown>): number {
  const n = Math.round(Number(properties[spec.property]));
  if (!Number.isFinite(n) || n < spec.min) return spec.min;
  return Math.min(n, spec.max);
}

/** A shared hardware resource a node declares, so the generic package codegen can validate it and claim it the
 * way a built-in's own codegen did through `hardware-shared.ts` / `i2c-shared.ts` (node-library/
 * resource-check.ts). Core-only for now: not part of the custom `.node.json` schema. A package's `.node.py`
 * still builds and fetches the resource object itself through `runtime.shared(...)` -- this restores the
 * compile-time checks, not the object plumbing (the on-device singleton already shares it). */
export type ResourceSpec = I2cResourceSpec | SpiResourceSpec | PinResourceSpec;

/** An I2C bus resolved from a flow config, validated (`checkI2c`, SCL/SDA) and claimed; two in-use configs on
 * one bus number are a `CompileError`, as `i2c-shared.ts`'s `resolveI2cBus` already refuses. */
export interface I2cResourceSpec {
  kind: "i2c";
  /** The `configRef` property naming the flow's I2C bus config. */
  config: string;
  /** Legacy fallback: when the config id is empty but these node properties are set, the bus is built from
   * them instead (display_i2c's pre-config flows). Property names, not values. Added 2026-10-16. */
  fallback?: { bus: string; scl: string; sda: string; freq: string };
  /** When set, the bus config id comes from this property of the config named by `config` (a nested configRef,
   * e.g. a touch panel's `i2cConfigId`). Core-only, added 2026-10-21 for touch_i2c. */
  nestedField?: string;
}

/** An SPI bus resolved from node properties: `checkPin` on SCK/MOSI, `checkSpi` against the board, and the
 * bus/pin claims (`hardware-shared.ts`'s `sharedSpi`). */
export interface SpiResourceSpec {
  kind: "spi";
  /** Property names holding the bus number, the SCK and MOSI pins, and the baudrate. */
  bus: string;
  sck: string;
  mosi: string;
  baudrate: string;
}

/** One pin (or pin pair's first pin) claimed with a role/use text and an optional derived device claim, for the
 * conflict checks a built-in got from `claimResource`. */
export interface PinResourceSpec {
  kind: "pin";
  /** Property holding the pin's value. */
  property: string;
  /** Direction checked against the board. */
  direction: "input" | "output" | "bidirectional";
  /** Input pull, for the check and the default claim text. Default `"none"`. */
  pull?: "none" | "up" | "down";
  /** A property holding the pull (`"none"`/`"up"`/`"down"`), when the pull is configurable rather than fixed.
   * Takes precedence over `pull`. Added 2026-10-16 for eswitch/ebutton, whose `pull` is a select property. */
  pullProperty?: string;
  /** The claim's use text; `{pin}` and any `{property}` are interpolated. Defaults to the direction/pull text. */
  use?: string;
  /** A second, derived claim for a device on the pin (its own settings), so two devices with different settings
   * on one pin conflict. `{pin}`/`{property}` interpolated. */
  claim?: { resource: string; use: string };
  /** Refuse this pin when it is a processor ADC2 pin and the flow uses WiFi (classic ESP32: ADC2 is unusable
   * while the radio is up). Core-only, added 2026-10-21 for the adc package. */
  noAdc2WithWifi?: boolean;
}

/** The canonical node descriptor: plain data only, plus (on a built-in's NodeDefinition) the codegen
 * hooks that a custom `.node.json` deliberately cannot carry. */
export interface NodeDescriptor {
  /** e.g. "thingstudio/gpio_out" (built-in) or "custom/dht22". */
  type: string;
  /** Where the node sits in a flow: source (no input), transform (one in, one out), sink (one in, none out). */
  kind: NodeKind;
  /** A `source` that waits on an external event rather than polling: its codegen (or `.node.py`, for a package)
   * provides a wait + build step instead of a poll interval. Core packages need this on the canonical descriptor
   * to be event sources (the custom `.node.json` already carries it). Added 2026-10-16. */
  eventSource?: boolean;
  /** A polled `source` that runs its emit once at flow start instead of on an interval (startup). Data, so a
   * custom package can use it too. Mutually exclusive with eventSource. Added 2026-10-21. */
  runOnce?: boolean;
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
  /** Shared hardware resources (a bus, a claimed pin) the generic package codegen validates and claims
   * (`node-library/resource-check.ts`). Core-only for now (not in the custom `.node.json` schema). */
  resources?: readonly ResourceSpec[];
  /** The node is valid with nothing wired to it, so "disconnected from any source" doesn't apply (a gui_button:
   * it is useful as a pure input, with nothing to display). */
  allowUnwired?: boolean;
  /** Inputs/outputs with a payload type each. Editor-side only: read by the class factory to build real
   * sockets, and by the catalog. compile.ts's own graph walk does not read this. */
  ports?: {
    inputs?: PortDefinition[];
    outputs?: PortDefinition[];
  };
  /** Outputs that vary per instance with a numeric property (the function node's `outputCount`). When
   * set, `ports.outputs` declares one template that types every dynamic output. Built-in only for now. */
  dynamicOutputs?: DynamicOutputs;
  /** The property panel's field schema. */
  properties?: PropertyFieldDescriptor[];
  /** Preset type (admin API `/api/presets/{type}`): when set, the panel shows a save/load-preset
   * control at the top (`PresetRefField`). The preset snapshots the node's whole `properties` object. */
  presetType?: string;
}
