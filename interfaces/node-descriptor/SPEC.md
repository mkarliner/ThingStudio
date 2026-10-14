# Node descriptor — v1 specification

Status: v1, shipped. This is what a *node type* declares: its id, kind, ports, properties and palette styling.
There are two implementations today, and an important divergence between them (below).

- **Built-in nodes** are TypeScript: a `NodeDefinition` (`editor/src/compiler/node-definition.ts`) with Python
  codegen, plus a palette row (`editor/src/app/rete/palette.ts`) and a property-panel block
  (`editor/src/app/rete/PropertyPanel.vue`). The practical checklist for adding one is
  `../../docs/node-conventions.md`; the design intent is design doc §6/§7.
- **Custom nodes** are data: a package of `<name>.node.json` (this descriptor) + `<name>.node.py` (opaque
  MicroPython). The machine-readable contract is `custom-node.schema.json`. The user walkthrough is
  `../../docs/user-guide/custom-nodes.md`; the validator is `editor/src/node-library/custom-node.ts`.

## 1. The common contract

Both implementations agree on:

- **Type id** — the built-in namespace is `thingstudio/<name>`; a custom node picks its own `namespace/name`
  (lowercase letters, digits, underscores) and may not use `thingstudio/`. A wire type id is what a flow file
  stores.
- **Kind** — `source` (generates messages, no input), `transform` (one in, one out), or `sink` (one in, none out).
- **Ports** — inputs/outputs with a name and a payload `type` (`int`, `number`, `bool`, `string`, `bytes`, `any`).
  A declared output type must match what the codegen puts in `payload`.
- **The message envelope** — every message is `{payload, topic, ...}`, per `../../AGENTS.md` and design doc §6.
- **Palette styling** — `label`, `group`, `color`/`bgcolor`, `icon`, and a `priority` for order within a group.
- **Hardware requirements** — optional `requires.capabilities` (see §2). A node that needs a radio or a
  peripheral feature the board lacks is refused at compile time; the palette greys it out when a target is known.

Board/processor capability data itself lives in `../board-descriptor/` (its `capabilities` key).

## 2. Custom node descriptor (`.node.json`)

| Key | Type | Required | Meaning |
|---|---|---|---|
| `type` | string | yes | `namespace/name`, e.g. `custom/dht22`. Not in `thingstudio/`. |
| `kind` | `"source"` \| `"transform"` \| `"sink"` | yes | Decides port counts and the `.node.py` entry function. |
| `label` | string | yes | Name on the canvas and in the palette. |
| `color` / `bgcolor` | string | no | Node outline / fill. Default grey. |
| `icon` | string | no | One or two characters. |
| `group` | string | no | Palette section. Default `"general"`. |
| `priority` | number | no | Order within `group`, lower first. Omit to sort after built-ins. |
| `ports` | `{inputs, outputs}` | no | Arrays of `{name, type}`. |
| `properties` | array | no | Fields shown in the property panel (below). |
| `requires` | `{capabilities: string[]}` | no | Hardware the node needs (e.g. `["pio"]`, `["espnow"]`). Checked centrally against the board at compile time (see §4). |

A property field is `{name, label, kind, default, options?}`. `kind` is `text`, `number`, `boolean` or `select`;
`default` must match `kind`; `options` (`[{value, label}]`) is required for `select` and `default` must be one of
them.

**Cross-field rules the schema can't express** (enforced by `validateCustomNodeDescriptor`):

- Port counts by kind: `source` = 0 in / 1 out; `transform` = 1 in / 1 out; `sink` = 1 in / 0 out.
- At most one output port.
- A `source` must declare a numeric property named `intervalMs` (its poll interval).

**Behaviour (`.node.py`).** Ordinary MicroPython defining exactly one top-level function named for the kind:
`async def run(msg, properties)` (transform/sink) or `async def emit(properties)` (source). It is spliced into
the generated flow inside a per-instance function, so mutable state uses `nonlocal`, not `global`. Pins and buses
go through `runtime.shared(...)` — see `../runtime-api/SPEC.md`.

## 3. Built-in node descriptor

A built-in declares the same fields in code: `type`/`kind`/`ports` on its `NodeDefinition`, palette styling in
`palette.ts`, property UI in `PropertyPanel.vue`, and its device-side behaviour as a **codegen hook**
(`codegenSource`/`codegenEventSource`/`codegenTransform`/`codegenSink`). Built-ins can do things the custom format
cannot: config references, dynamic and multi output ports, event sources, hardware resource claims, and arbitrary
generated Python. See `../../docs/node-conventions.md` for the full checklist (catalog, docs page, tests,
vendoring).

## 4. Known divergence (architecture-review concern)

The two implementations are **not** the same mechanism, and the review flagged it as a problem to resolve
deliberately rather than accrete:

- A built-in keeps its descriptor, property UI and codegen in TypeScript; a custom node keeps its descriptor in
  JSON and its behaviour in Python. There is no bridge — a built-in cannot be forked into a custom node, because
  its descriptor isn't exposed and the custom format can't express its codegen (nor can a browser-loaded editor
  safely execute arbitrary codegen).
- ~~A node descriptor says nothing about which boards or processor families it is valid on.~~ Addressed: a
  node can declare `requires.capabilities` (an ESP-NOW node needs `espnow`, an RP2040 PIO node needs `pio`), the
  compile checks it centrally against the target, and the palette greys out a node the current board can't run.

Tracked as open work: `../../docs/working-notes/outstanding-items/node-descriptor-unification.md` (the built-in /
custom split). The node→board applicability above is now built (`decisions/node-board-mapping.md`).

## 5. Conformance

`editor/test/node-descriptor-schema.test.ts` asserts the enums and type-id pattern in `custom-node.schema.json`
equal the validator's (`PAYLOAD_TYPES`, `NODE_KINDS`, `PROPERTY_KINDS`, `TYPE_ID_RE` in `custom-node.ts`), so the
published schema can't drift from the code. The validator's cross-field rules are covered by
`editor/test/custom-node.test.ts`.

Change this descriptor format only with Mike's explicit permission — users have written `.node.json` packages
against it.
