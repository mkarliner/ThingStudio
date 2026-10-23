# Node descriptor — v2 specification

Status: v2, in progress (2026-10-14). This is what a *node type* declares: its id, kind, ports,
palette styling, property schema and hardware requirements. v1 described two separate mechanisms
(built-in TypeScript vs custom JSON); v2 converges them on one **`NodeDescriptor`** data shape. The
direction and scope are fixed by `../../docs/working-notes/node-descriptor-unification-briefing.md`
and `../../docs/working-notes/decisions/node-board-mapping.md`; the built-in library migrates onto it
family by family.

- **The canonical shape** is `NodeDescriptor` in `editor/src/compiler/node-descriptor.ts`.
- **Built-in nodes** are a `NodeDefinition` (`editor/src/compiler/node-definition.ts`): this same
  descriptor, plus the TypeScript codegen hooks (`codegenSource`/`codegenEventSource`/
  `codegenTransform`/`codegenSink`) and an optional dynamic `outputCount`. Those hooks are the one
  thing a browser-loaded `.node.json` deliberately cannot carry (§4).
- **Custom nodes** are a package of `<name>.node.json` (a serialization of this descriptor, minus the
  hooks) + `<name>.node.py` (opaque MicroPython). The machine-readable contract is
  `custom-node.schema.json`; the validator is `editor/src/node-library/custom-node.ts`. The custom
  format's own surface is unchanged in v2 so far — the relaxations in §4 are planned.

## 1. The common contract

Both producers agree on:

- **Type id** — the built-in namespace is `thingstudio/<name>`; a custom node picks its own
  `namespace/name` (lowercase letters, digits, underscores) and may not use `thingstudio/`. A wire
  type id is what a flow file stores.
- **Kind** — `source` (generates messages, no input), `transform` (one in, one out), or `sink` (one
  in, none out).
- **Ports** — inputs/outputs with a name and a payload `type` (`int`, `number`, `bool`, `string`,
  `bytes`, `any`). A declared output type must match what the codegen puts in `payload`.
- **The message envelope** — every message is `{payload, topic, ...}`, per `../../AGENTS.md` and
  design doc §6.
- **Palette styling** — `label`, `group`, `color`/`bgcolor`, `icon`, and a `priority` for order
  within a group.
- **Hardware requirements** — optional `requires.capabilities` (see §2). A node that needs a radio
  or a peripheral feature the board lacks is refused at compile time; the palette greys it out when a
  target is known.

Board/processor capability data itself lives in `../board-descriptor/` (its `capabilities` key).

## 2. The canonical `NodeDescriptor`

`editor/src/compiler/node-descriptor.ts`. Both a built-in `NodeDefinition` and a custom `.node.json`
carry these keys.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `type` | string | yes | `namespace/name`, e.g. `thingstudio/debug` or `custom/dht22`. |
| `kind` | `"source"` \| `"transform"` \| `"sink"` | yes | Where the node sits in a flow. |
| `eventSource` | boolean | no | A source that waits on an external event rather than polling (`wait`/`emit`, no poll interval), **or a `sink` that is two-faced**: its input face is `run`, its output face is `wait`/`emit`, from one per-instance closure (2026-10-19). Not valid on a `transform`. See §3. |
| `runOnce` | boolean | no | A polled `source` that runs its emit once at flow start, with no `intervalMs` (startup). Sources only, and mutually exclusive with `eventSource`. Added 2026-10-21. |
| `paletteId` | string | built-in, yes | The short canvas/palette key (e.g. `debug`), distinct from `kind`. `"custom"` for a custom node. |
| `label` | string | yes | Name on the canvas and in the palette. |
| `group` | string | no | Palette section. Default `"general"`. |
| `priority` | number | no | Order within `group`, lower first. |
| `color` / `bgcolor` | string | no | Node outline / fill. Default grey. |
| `icon` | string | no | One or two characters. |
| `width` | number | no | Canvas pill width in px. |
| `description` | string | no | Short self-documenting blurb, shown in the editor. |
| `title` | string | no | Canvas title when it differs from `label` (e.g. `gui_label` shows "show text" on the canvas). Defaults to `label`. |
| `hidden` | boolean | no | Hide from the palette (still usable in a flow file). |
| `screenOutline` | boolean | no | Show the `ScreenOutline` widget in the panel (a `gui_screen`'s widget layout). |
| `requires` | `{capabilities: string[]}` | no | Hardware the node needs (e.g. `["pio"]`, `["espnow"]`), checked centrally at compile time (§4). |
| `resources` | `ResourceSpec[]` | no | Shared hardware a **core package** declares so the generic codegen validates and claims it (an I2C bus, an SPI bus, a claimed pin). Core-only: not part of the custom `.node.json` schema (§4). |
| `allowUnwired` | boolean | no | The node is valid with nothing wired to it. |
| `ports` | `{inputs, outputs}` | no | Arrays of `{name, type}`. |
| `properties` | array | no | Property-panel fields (below). |
| `presetType` | string | no | Preset type (admin API `/api/presets/{type}`) for a save/load-preset control at the top of the panel. |

A property field is `{name, label, kind, default, options?}`. `kind` is shared with config fields
(`config-types.ts`): `text`, `textarea`, `password`, `number`, `select`, `boolean`, `credential`,
`configRef`, `pin`, `palette` (the indexed-colour palette editor), `colour` (one RGB565 colour picker,
added 2026-10-23 for the GUI theme's roles). `default` seeds a freshly-dropped node. A `select`'s option `value` is a string, or a number for a
select over numeric values (e.g. bme280's I2C address). A custom `.node.json` may use the `text`,
`textarea`, `number`, `boolean`, `select`, `configRef`, `pin`, `target` and `nodeId` kinds, with the same `help`/`placeholder`/
`min`/`max`/`step`/`optional` field attributes (`textarea` also takes `rows`) and a data-driven
`visibleWhen` predicate (a `configRef` field also carries `configType`); the remaining kinds
(`credential`, `palette`, `colour`) and attributes (`retype`, `placeholderWhen`) are built-in
editor widgets today.

A `configRef` field may carry **`singleton: true`**: at compile time the flow's *one* config of
`configType` is resolved (`findConfigsOfType`) rather than the node's stored id — the way a built-in treats
the singleton WiFi config; zero or many is a compile error and the stored value is ignored. A `pin` field
may carry **`pinUse`** (`"input"` default, or `"output"`) and **`pinPull`** (`"none"`/`"up"`/`"down"`):
the compiler checks the pin against the board and claims it as a hardware resource (a custom and a built-in
node on the same pin, same mode, share it; a different mode is a compile error). A `pin` field with **no
`pinUse`** is a plain pin value — checked to exist on the board, never claimed (a bus line, say). Added 2026-10-15
(node context parity, phase 2a).

A **`target`** field inlines the board/processor this flow is compiled for, as a dict (`boardId`,
`boardName`, `processorId`, `processorName`, `label`, `capabilities`), or `None` when no board is known — so a
board-specific package can identify its exact board and guard for "unknown" (2026-10-15, workstream e).

A **`nodeId`** field inlines the instance's own node id (a string) under its Python key, so a package can call
`runtime.report_status(properties["id"], ...)` (and speak about itself otherwise) — closing the NODE_STATUS gap
for custom nodes (2026-10-15).

A **`resources`** array declares shared hardware a core package touches, so the generic package codegen runs the
same compile-time checks a built-in's own codegen did (`editor/src/node-library/resource-check.ts`): an `i2c` bus
(from a `configRef` field) is validated against the board, its SCL/SDA pins claimed, and two in-use configs on one
bus number refused — with an optional `fallback` naming node properties to build the bus from when the config is
empty (display_i2c's pre-config flows); an `spi` bus (from `bus`/`sck`/`mosi`/`baudrate` properties) is `checkSpi`'d and its bus/pins
claimed; a `pin` is direction/pull-checked and claimed with a role/use text, plus an optional derived device claim
for two devices on one pin. A pin resource's pull is either a fixed `pull` (`"none"`/`"up"`/`"down"`) or a
`pullProperty` naming a property that holds it (eswitch/ebutton's configurable pull). The package's own `.node.py`
still builds and fetches the object through `runtime.shared(...)` — `resources` restores the checks, not the object
plumbing. **Core-only:** it is a `NodeDescriptor` field but is deliberately **not** in `custom-node.schema.json`
yet (2026-10-16). Full reasoning: `../../docs/working-notes/shared-resource-facility-scoping.md`.

A field with **no `name`** (and no `default`) is **info-only**: the panel renders its widget but it binds to
no property. Used for a `configRef` to a flow-singleton config (e.g. the WiFi picker shown on a network
node). Fields may also carry `optional`, `min`/`max`/`step` (`step` may be the literal `"any"` for
arbitrary fractional values), `help`, `placeholder`, `visibleWhen` (a serializable conditional: show the
field only when `properties[field]` equals/notEquals/is in/compares against a value), and `retype` (changing
the field re-resolves the node's port sockets — for a data-form port type, e.g. inject/startup's output tracking
`payloadType`). A numeric field may also
carry **`lessThan`** (the name of another property it must be below, checked at compile time — e.g. ebutton's
`doubleClickMs` less than `longPressMs`); core-only, added 2026-10-16. A field may also be **`hidden`** (a core
package reads it, but the property panel and catalog omit it — used for a legacy property kept only for compile
compatibility, e.g. display_i2c's node-level bus pins); core-only, added 2026-10-16.

A port's `type` is either a payload type (`"any"`, `"string"`, ...) or a **data form** that follows a select
property:

```json
{"property": "payloadType", "map": {"bool": "bool", "number": "number", "string": "string"}, "default": "bool"}
```

The value of `property` picks the wire type; an unset or unmapped value uses `default`. The form is serializable,
so a built-in descriptor and a custom `.node.json` express it the same way — the project's data-equivalent rule.
The JS-function form was removed 2026-10-20 with the last three users (inject, startup, variable_get). A custom
descriptor's data form must name a declared `select` property, and every map key must be one of its options.

**Worked example** — the built-in `debug` node's descriptor (its codegen hook omitted):

```jsonc
{
  "type": "thingstudio/debug",
  "kind": "sink",
  "paletteId": "debug",
  "label": "debug",
  "group": "general",
  "priority": 50,
  "icon": "≡",
  "ports": { "inputs": [{ "name": "msg", "type": "any" }] },
  "properties": [
    { "name": "fullMessage", "label": "full message", "kind": "boolean", "default": false }
  ]
}
```

## 3. Custom node descriptor (`.node.json`)

A custom package serializes the same shape. Its keys today are a subset — `type`, `kind`, `label`,
`title`, `hidden`, `presetType`, `screenOutline`, `description`, `color`, `bgcolor`, `icon`, `group`,
`priority`, `ports`, `properties`, `requires`, `eventSource` — defined by `custom-node.schema.json` and
validated by `validateCustomNodeDescriptor`.
The remaining cross-field rules the schema can't express:

- Port counts by kind: `source` = 0 in / 1 out; `transform` = 1 in / ≥1 out; `sink` = 1 in / 0 out.
  A `transform` may declare several outputs and return a list to route across them (compile.ts's
  multi-output contract; there is no multi-output-source contract).
- A polled `source` must declare a numeric property named `intervalMs` (its poll interval). An
  `eventSource: true` source instead defines `wait` (below) and needs no `intervalMs`; `eventSource`
  is only valid on a `source`.

**Behaviour (`.node.py`).** Ordinary MicroPython defining exactly one top-level function named for the
kind: `async def run(msg, properties)` (transform/sink) or `async def emit(properties)` (source). An
`eventSource` source also defines `async def wait(properties)` — awaited each loop iteration, then
`emit(properties)` builds the message. It is spliced into the generated flow inside a per-instance
function, so mutable state uses `nonlocal`, not `global`. Pins and buses go through `runtime.shared(...)`
— see `../runtime-api/SPEC.md`.

## 4. Convergence: what is built, and what is still coming

v1's divergence — a built-in described in up to seven hand-maintained places, a custom node in two
files with no bridge — is being closed deliberately, family by family, with no behavior change:

- **Built so far.** `NodeDescriptor` is the single shape; `NodeDefinition` composes it. The
  canvas class factory, property panel, palette and catalog read a migrated node's descriptor instead
  of their own copies. Migrated families: `debug`, `timer`, `delay`, `gpio_out`, `pwm_out`, the I2C
  family (`touch_i2c`, `i2c`, `bme280`), the network family (`udp_send`, `udp_receive`, `http_*`,
  `mqtt_*`, `ntp`), the GPIO cluster (`interrupt`, `eswitch`, `ebutton`, `adc`, `encoder`,
  `neopixel`), `filter`/`journal`/`wifi_status`/`wifi_gate`, `display_spi`/`display_i2c`,
  `inject`/`startup`, all nine GUI nodes, and `function` (whose output count is now the data descriptor
  field `dynamicOutputs` rather than a codegen hook). Every built-in family is migrated; `palette.ts`'s
  per-kind rows are gone.
- **Still coming.** Relax the custom format so more built-ins can be cloned. Landed 2026-10-15:
  multi-output `transform`s, a package `description`, `configRef` properties (the picked config's
  properties are inlined into the node's Python `properties`; an empty id is `None`),   and event-driven
  `source`s (`eventSource: true` + `wait`/`emit`; `eventSource` is now a canonical `NodeDescriptor` field too,
  2026-10-16, so a core package can be one). Dynamic output ports are a data descriptor field
  (`dynamicOutputs`: the function node's `outputCount`) but stay built-in-only (not in the custom
  schema) until the canvas can build them for a custom node too, as does arbitrary codegen. **Landed 2026-10-16:**
  a **core-only** `resources` field (a core package declares an I2C/SPI bus or a claimed pin the generic codegen
  validates and claims — §2); it is deliberately not in the custom schema. Compile-time hardware resource claims
  therefore stay a documented limit **for a custom node** (it uses `runtime.shared` only). Once every family is
  migrated, the descriptor's palette metadata becomes required and `palette.ts`'s per-kind rows are removed.

The one-way door stays closed: a built-in's codegen is not loaded code, and a browser-loaded editor
never executes arbitrary codegen.

## 5. Conformance

`editor/test/node-descriptor-schema.test.ts` asserts the enums and type-id pattern in
`custom-node.schema.json` equal the validator's (`PAYLOAD_TYPES`, `NODE_KINDS`, `PROPERTY_KINDS`,
`TYPE_ID_RE` in `custom-node.ts`), so the published schema can't drift from the code. The validator's
cross-field rules are covered by `editor/test/custom-node.test.ts`.

Change this descriptor format only with Mike's explicit permission — users have written `.node.json`
packages against it.
