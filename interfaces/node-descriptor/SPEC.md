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
| `paletteId` | string | built-in, yes | The short canvas/palette key (e.g. `debug`), distinct from `kind`. `"custom"` for a custom node. |
| `label` | string | yes | Name on the canvas and in the palette. |
| `group` | string | no | Palette section. Default `"general"`. |
| `priority` | number | no | Order within `group`, lower first. |
| `color` / `bgcolor` | string | no | Node outline / fill. Default grey. |
| `icon` | string | no | One or two characters. |
| `width` | number | no | Canvas pill width in px. |
| `description` | string | no | Short self-documenting blurb, shown in the editor. |
| `requires` | `{capabilities: string[]}` | no | Hardware the node needs (e.g. `["pio"]`, `["espnow"]`), checked centrally at compile time (§4). |
| `allowUnwired` | boolean | no | The node is valid with nothing wired to it. |
| `ports` | `{inputs, outputs}` | no | Arrays of `{name, type}`. |
| `properties` | array | no | Property-panel fields (below). |

A property field is `{name, label, kind, default, options?}`. `kind` is shared with config fields
(`config-types.ts`): `text`, `password`, `number`, `select`, `boolean`, `credential`, `configRef`,
`pin`. `default` seeds a freshly-dropped node. A custom `.node.json` may only use `text`, `number`,
`boolean` and `select`; the rest are built-in editor widgets. Built-in fields may also carry
`optional`, `min`/`max`/`step`, `help`, and a `showIf(properties)` visibility predicate (a function,
so built-in only).

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

A custom package serializes the same shape. Its keys today are a strict subset — `type`, `kind`,
`label`, `color`, `bgcolor`, `icon`, `group`, `priority`, `ports`, `properties`, `requires` — defined
by `custom-node.schema.json` and validated by `validateCustomNodeDescriptor`. The remaining
cross-field rules the schema can't express:

- Port counts by kind: `source` = 0 in / 1 out; `transform` = 1 in / 1 out; `sink` = 1 in / 0 out.
- At most one output port (a codegen ceiling, relaxed in a later change — §4).
- A `source` must declare a numeric property named `intervalMs` (its poll interval).

**Behaviour (`.node.py`).** Ordinary MicroPython defining exactly one top-level function named for the
kind: `async def run(msg, properties)` (transform/sink) or `async def emit(properties)` (source). It
is spliced into the generated flow inside a per-instance function, so mutable state uses `nonlocal`,
not `global`. Pins and buses go through `runtime.shared(...)` — see `../runtime-api/SPEC.md`.

## 4. Convergence: what is built, and what is still coming

v1's divergence — a built-in described in up to seven hand-maintained places, a custom node in two
files with no bridge — is being closed deliberately, family by family, with no behavior change:

- **Built (this change).** `NodeDescriptor` is the single shape; `NodeDefinition` composes it. The
  canvas class factory, property panel, palette and catalog read a migrated node's descriptor instead
  of their own copies. `debug` is the first family migrated. A descriptor missing the palette
  metadata is "not yet migrated" and still falls back to `palette.ts`.
- **Still coming.** Relax the custom format so more built-ins can be cloned: multi-output (the
  compiler already supports it), `configRef` properties, and event sources. Dynamic ports (`function`'s
  `outputCount`) and arbitrary codegen stay built-in-only. Compile-time hardware resource claims stay
  a documented limit (a custom node uses `runtime.shared` only). Once every family is migrated, the
  descriptor's palette metadata becomes required and `palette.ts`'s per-kind rows are removed.

The one-way door stays closed: a built-in's codegen is not loaded code, and a browser-loaded editor
never executes arbitrary codegen.

## 5. Conformance

`editor/test/node-descriptor-schema.test.ts` asserts the enums and type-id pattern in
`custom-node.schema.json` equal the validator's (`PAYLOAD_TYPES`, `NODE_KINDS`, `PROPERTY_KINDS`,
`TYPE_ID_RE` in `custom-node.ts`), so the published schema can't drift from the code. The validator's
cross-field rules are covered by `editor/test/custom-node.test.ts`.

Change this descriptor format only with Mike's explicit permission — users have written `.node.json`
packages against it.
