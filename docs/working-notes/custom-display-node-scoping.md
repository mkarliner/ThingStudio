# Custom display nodes driving a gui screen

Status: proposal, 2026-10-17. Needs Mike's go-ahead: it adds a key to the node descriptor (`interfaces/node-descriptor/`).

## The problem

Since `c7cb886` (2026-10-17) a `gui_screen` takes its width, height and frame format from the `display_spi` it is
wired to. The display is found by type: `n.type === "thingstudio/display_spi"`, in three places:

| Where | What it takes from the display |
|---|---|
| `gui.ts` `screenSize()` | width, height, frame format |
| `orientation-shared.ts` `resolveOrientation()` | orientation (0/90/180/270, the picture turned) |
| `touch-panel-shared.ts` | the same orientation, to turn the touch axes |

Any other display gets none of this. Wired to the RM68090 custom node (`example_nodes/rm68090`, confirmed on a
D1 R32), a screen falls back to its hidden defaults, 320x240 gs4, which the panel no longer shows. With the node at
90 or 270 that matches by luck; at 0 or 180 (240x320) the flow fails at start with "a strip must be whole rows".
Orientation and touch never follow.

A second, smaller problem: the RM68090 node calls its setting `rotation`, meaning the picture turned. On
`display_spi`, `rotation` is how the panel is mounted (0-3) and `orientation` is the turn. Same word, different
meaning.

## Proposal: a node says it is a display

An optional descriptor key, `display`, on any sink that takes the display wire contract (a whole frame, or strips
with `msg['y']`, in the frame format it names):

```json
"display": { "width": 240, "height": 320, "frameFormat": "frameFormat", "orientation": "orientation" }
```

Each value is a number (a fixed size) or the name of one of the node's own properties:

| Key | Meaning |
|---|---|
| `width`, `height` | The panel's own size, unturned. Required. |
| `frameFormat` | The frame format: `rgb565`, `gs4`, `gs2`, `mono`. Required. |
| `orientation` | Optional. `""` off, or 0/90/180/270, the picture turned clockwise, as on `display_spi`. |

- `display_spi` declares `{ width: "width", height: "height", frameFormat: "frameFormat", orientation: "orientation" }`.
- The RM68090 package declares fixed 240x320 and renames its `rotation` property to `orientation`, same values.
- The three call sites above find the wired target whose descriptor has `display`, instead of matching the type.
  They need the descriptor of a `GraphNode`, so `CodegenContext` gains `descriptorOf(type)`, filled in by
  `compile.ts` from the registry it already has. (CodegenContext is editor-internal, not an interface spec.)
- A screen wired to a node *without* `display` keeps today's fallback. Wired to two displays: a compile error
  naming both (today it silently takes the first `display_spi`).

What doesn't change: the wire contract itself, flow files, the device runtime, any existing custom package (the key
is optional). The palette is still by convention: gui renders palette indices, and an indexed display expands them
with its own palette, so a custom display should start from `display_spi`'s default palette (the RM68090 node does).

## Blast radius

- **Node descriptor**: one optional key in `NodeDescriptor`, `custom-node.schema.json`, `validateCustomNodeDescriptor`,
  `SPEC.md` (§2/§3), and `node-descriptor-schema.test.ts`. Additive: no saved package or flow breaks.
- **Editor**: `gui.ts`, `orientation-shared.ts`, `touch-panel-shared.ts`, `compile.ts`, `display-spi.ts`
  (declare the key); tests for a custom display driving a screen's size, format, orientation and touch.
- **RM68090 package**: `rotation` -> `orientation`; `display` key; its test flow. Only that one flow uses it.
- **Docs**: `custom-nodes.md` (a display package), `nodes/gui.md` (any display, not only display spi).

About one session. The RM68090's 90 is MCUFRIEND's rotation 1: clockwise is believed but unverified on the glass,
so check it with the test flow when the rename lands.

## Not chosen

- **Match on property names** (any wired node with `width`/`height`/`frameFormat`): an unwritten contract a package
  can meet by accident; fails silently rather than legibly.
- **Show the screen's own size fields again when the display isn't `display_spi`**: brings back two places to keep
  equal by hand, which `c7cb886` removed on purpose, and orientation and touch still wouldn't follow.
