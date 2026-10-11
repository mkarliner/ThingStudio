# Node conventions — built-in nodes

Status: reference for anyone adding a built-in node to Thingstudio, a person or an AI session. Written 2026-10-11.
Architecture and rationale live in `docs/thingstudio-design-doc.md` (§6/§7, §11); the history behind each
convention is in `docs/working-notes/decisions/`. This page is the checklist, not the design.

A custom node (the user-facing `.node.json`/`.node.py` format) follows the same message and port conventions through
a different mechanism — see `docs/user-guide/custom-nodes.md` and the published `docs/user-guide/node-conventions.md`.

## Where a built-in node lives

A node is a few pieces that have to agree:

- **Editor descriptor and codegen** — `editor/src/node-library/<name>.ts`, a `NodeDefinition`
  (`editor/src/compiler/node-definition.ts`). Register it in `editor/src/node-library/registry.ts`.
- **Editor node class and palette entry** — `editor/src/app/rete/nodes.ts` (`NODE_FACTORIES`, `addInput`/`addOutput`)
  and `editor/src/app/rete/palette.ts` (group, colour, order). Each port key here must exactly match the
  `NodeDefinition`'s `ports` name.
- **Property panel** — the descriptor's `properties` crossed with the class's fields and sockets.
- **Device-side behaviour** — generated Python, not a separate module. A node that needs a third-party driver
  vendors it (see Vendoring).
- **A user docs page** — `docs/user-guide/nodes/<name>.md`, in the fixed layout.
- **Tests** — a codegen test (`editor/test/node-<name>.test.ts`) and, where the generated code actually runs, a
  real MicroPython test.

## Kind and codegen pattern

`kind` is `source`, `transform` or `sink`, and it decides where the node can sit in a flow. Pick the codegen hook
that matches:

- `codegenSource` → `SourceCodegenResult`: a poll or schedule source. `buildMsg` builds one message; `repeatMs`
  sleeps between iterations (`0` runs once).
- `codegenEventSource` → `EventSourceCodegenResult`: a source that blocks on an external event (a hard IRQ, a driver
  event). `waitStatement` suspends until the event fires, then `buildMsg` runs. There is no sleep — the wait is the
  only suspension point.
- `codegenTransform` → `TransformCodegenResult`: a transform. Return the message, or `None` to stop it. With more
  than one output (`ports.outputs.length > 1`, or an `outputCount()` hook), return a Node-RED-style array.
- `codegenSink` → `SinkCodegenResult`: a sink.

A source with several distinct events (see `eswitch`/`ebutton`) is the one place a single output is still a
compromise: one output port per event would need `EventSourceCodegenResult` extended for multi-output sources.

## The message envelope

Every message is `msg = {'payload': ..., 'topic': ..., <extra named fields>}`:

- **`payload`** — the node's main value. It is what the output port's declared type checks against and the one key a
  generic downstream node reads. `debug` prints only `msg['payload']`.
- **`topic`** — a routing/identification string. Set it to the real protocol topic when the node has one
  (`mqtt subscribe` does); otherwise `''`. Never carry the node's own event or state here — putting the interesting
  value in `topic` hides it from `debug` and from every generic node.
- **extra fields** — anything else rides along under its own name, read only by a node written to look for it
  specifically (`wifi status`'s `ip`/`subnet`/…; `ebutton`/`eswitch`'s `event`). Prefer a named field over
  overloading `payload` or `topic`.

Full explanation: design doc §6 and `AGENTS.md`'s "Message shape".

## Ports and wire types

Port types are `int`, `number`, `bool`, `string`, `bytes`, `any`. The editor refuses a wire between types that don't
fit. A declared output type must match what the codegen actually puts in `payload`. `any` connects only to `any`,
`bool` and `bytes`. The full coercion matrix is in `docs/user-guide/working-in-the-editor.md` (Wiring).

## Naming

- **Type id** — `thingstudio/<name>`, lower case. The `thingstudio/` namespace is reserved; custom nodes may not
  use it.
- **Palette name** — what the user sees, exactly as the editor shows it (`i2c device`, `gui screen`, `gpio out`).
  The docs use this name everywhere.
- **Group and colour** — set in `palette.ts`, one colour per group.

## Fault handling

The measure of a node is how it fails.

- **A transform must never raise** — a raising transform ends its source's loop. Catch, report, and return `None`.
- **Report through the status dot / `NODE_ERROR`**, naming the operation and its `host:port`, not a bare exception.
- **Bound every network wait** with a timeout.
- **One console line** — what happened, then what to do (see `AGENTS.md`).

## Config nodes

A setting shared across nodes (a bus, a broker, a WiFi network, a touch panel) is a config node, not a property
repeated on every node. The node holds a `...ConfigId` property and resolves it with `ctx.resolveConfig(id)`.
Secrets stay outside the flow file. See `docs/user-guide/working-in-the-editor.md` (Config nodes).

## Docs, catalog, tests

Every node needs, in the same change:

- a **docs page** in the fixed layout (one-line purpose, Properties, Wiring, Behavior, Errors) —
  `docs/working-notes/docs-style-guide.md`;
- its rows in `docs/user-guide/nodes/index.md`;
- a **`PROPERTY_NOTES` entry** (`editor/src/cli/describe.ts`), then regenerate the catalog:
  `cd editor && npm run build:cli && node dist-cli/thingstudio-compile.mjs --describe-all --markdown > ../docs/user-guide/nodes-catalog.md`;
- a **test** — codegen assertions, and, for generated code that actually runs, a real MicroPython test
  (`device-runtime/test/`);
- a **hardware check** for anything that touches a board.

## Vendoring and version bumps

- Vendored third-party drivers go under `device-runtime/src/vendor/<name>/` with a README carrying the pinned
  per-file commit SHA, the before/after SHA-256s, and every local patch. Add a `docs/third-party-licenses.md` row
  in the same change. Follow `primitives_events/README.md`.
- Any change to a file `deploy_runtime.py` pushes onto hardware is a breaking-change call: bump both
  `_RUNTIME_VERSION` and `EDITOR_TARGET_VERSION`, `major`, in the same commit (`AGENTS.md`).
