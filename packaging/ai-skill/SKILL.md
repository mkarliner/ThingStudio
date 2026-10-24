---
name: thingstudio-flow-author
description: Write, edit or lay out a Thingstudio flow (.flow.json) for a microcontroller board, and check it with the bundled thingstudio-compile command before handing it back.
---

# Writing Thingstudio flows

Thingstudio flows are JSON files of nodes and wires that the Thingstudio editor opens, compiles to MicroPython and
deploys to a board. This skill carries everything needed to write one without the editor: the authoring guide, the
node catalog, example flows, and the same compile check the editor runs.

Built for Thingstudio {{VERSION}}. If the user's editor is newer, a node or property may be missing here; the online
guide is at {{DOCS_URL}}ai-authoring/.

`SKILL_DIR` below means the folder this file is in. The check needs Node 22 or newer (`node -v`).

## Before writing anything

1. Read `SKILL_DIR/reference/ai-authoring.md` in full. It is the guide: the file format, messages, pins, config nodes
   and credentials, GUI screens, and the traps earlier authors fell into.
2. Find the nodes you need in `SKILL_DIR/reference/nodes-catalog.md`, which gives exact property names, defaults and
   port order (each node is a `### <kind>` heading). `node SKILL_DIR/scripts/thingstudio-compile.mjs --describe <kind>`
   prints one node.
3. Ask which board, if the user hasn't said. Get its pins with `--board-info board:<id>` (`--list-boards` lists
   the boards, and the bare chips as `processor:<id>` for a board that isn't listed). Never guess a pin.
4. Copy the nearest example in `SKILL_DIR/examples/` rather than starting blank.

For a custom node (a `.node.json` and `.node.py` pair, for hardware no built-in node covers), read
`SKILL_DIR/reference/custom-nodes.md` instead. The check can't check custom nodes.

## Write, then check

Write the flow as a `.flow.json` file in the user's folder, then run:

```
node SKILL_DIR/scripts/thingstudio-compile.mjs --board board:<id> --layout my.flow.json
```

The guide in `reference/` calls this command `dist-cli/thingstudio-compile.mjs`; here it is `SKILL_DIR/scripts/`.
Its links to docs.thingstudio.net and `device_cli.py` are for the user. Everything you need is in this folder.

Fix every error and every `layout:` warning, and rerun until it prints `OK` with no layout warnings. Read the other
warnings too: fix them, or tell the user why they stand.

## Layout

People read a flow on the editor's canvas, and the editor shows it exactly where the file puts it. It does not
rearrange it or zoom to fit. So lay it out the way a careful person would:

- **Left to right.** Sources (timers, inputs, subscriptions) on the left, outputs on the right. Every wire runs to a
  node further right. Never wrap a long chain back to the left edge on a second row.
- **Columns about 220 px apart** (left edge to left edge). Nodes are 84-132 px wide, so that leaves about 90 px for
  the wire. Use one set of column positions for the whole flow, so columns line up.
- **Tight rows.** Nodes are 34 px tall (a function node with several outputs is taller). Stack branches in the same
  column with about 36 px between them (y about 70 apart), and put about 66 px between separate chains (y about 100
  apart).
- **One chain per job**, stacked top to bottom in reading order. Inputs and their processing go first, display or
  output last. Unwired nodes (GUI buttons laid out only on a screen, for example) go together at the bottom left.
- **Straight wires.** A node fed by one node sits at the same y as that node. When one node feeds several, the first
  sits level with it and the rest stack below. A node fed by several sits level with the first of them, or between
  them.
- **Start near (80, 80)** so the flow is on screen when it opens.

`--relayout` rewrites a file's positions to follow these rules. It is a good first pass for a new flow. Check the
result, then adjust by hand if a different order reads better. Re-run with `--layout` afterwards.

**Editing a user's flow:** keep their layout. Never run `--relayout` on it unless they ask. Place only the nodes you
add, in the gaps, following the same rules. Warnings about parts you didn't touch are theirs, so leave them and don't
list them.

## Hand it back

Tell the user briefly:

- that it passes the check, and with which `--board`
- which credential names they must create in the editor (WiFi, MQTT), since the check can't see secrets
- which board to choose in the editor, and what you assumed about the wiring
- what you couldn't check

Say "passes the check", never "works": nothing here has run on their hardware. They open it in the editor with
**File → Open**, choose the board, and deploy.
