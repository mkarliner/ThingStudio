// Thingstudio poc-rete — checkpoint 2 (rete-spike-briefing.md #2): drag a
// node onto an existing wire, confirm it splices in (the wire splits into
// two, rewired through the dropped node).
//
// IMPORTANT PROVENANCE NOTE, worth being honest about rather than glossing
// over: the briefing asks for this via "Rete's official 'Insert node'
// example (retejs.org/examples/insert-node, MIT, rete-kit-scaffolded
// insertableNodes source)". That source is generated on demand by
// `npx rete-kit app` picking the "insert-node" feature — it isn't published
// as a browsable file in the `retejs/rete` or `retejs/rete-kit` repos
// (confirmed: rete-kit's own repo tree has no insert-node-shaped file at the
// top level; GitHub code search for `insertableNodes` didn't resolve through
// the tools available in this environment, and running `npx rete-kit app`
// itself is exactly the un-pinned, non-lockfile-tracked `npx` invocation
// CLAUDE.md's npm rule says not to run). So this file is a same-behavior
// REIMPLEMENTATION written from the documented description ("the
// implementation replaces the connection with two new connections when the
// selected node is dropped onto the connection. After adding the connection,
// the graph is arranged with animation" — retejs.org/examples/insert-node),
// not a byte-for-byte copy of the official source. The underlying claim this
// spike is actually testing — is splice-onto-wire reachable in Rete without
// a large custom-canvas effort — holds either way: this file is ~80 lines
// built entirely from public `rete-area-plugin`/`rete` API (hit-testing a
// drag against nearby connections, splitting the link, rewiring two new
// ones), which is itself the evidence for or against "close to free."

import type { AreaPlugin } from "rete-area-plugin";
import type { AreaExtra, Editor, Schemes } from "./schemes";
import { canCreateConnection, getConnectionSockets } from "./validation";
import { ClassicPreset } from "rete";

type Point = { x: number; y: number };

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

// Node center in area-space, approximated from the node view's translated
// position plus the node's own declared width/height (same width/height
// contract the "Arrange nodes" guide's node base class uses).
function nodeCenter(area: AreaPlugin<Schemes, AreaExtra>, nodeId: string): Point | null {
  const view = area.nodeViews.get(nodeId);
  const node = area.editor.getNode(nodeId) as unknown as { width?: number; height?: number };
  if (!view) return null;
  return {
    x: view.position.x + (node?.width ?? 150) / 2,
    y: view.position.y + (node?.height ?? 60) / 2,
  };
}

const HIT_THRESHOLD_PX = 40;

export function installInsertableNodes(editor: Editor, area: AreaPlugin<Schemes, AreaExtra>): void {
  area.addPipe((context) => {
    if (context.type === "nodedragged") {
      const droppedId = context.data.id;
      const dropped = editor.getNode(droppedId);
      const center = nodeCenter(area, droppedId);
      if (!dropped || !center) return context;

      // A node with no free input+output pair of the right shape can't be
      // spliced through — skip (debug has no output, inject has no input).
      const droppedInputKey = Object.keys(dropped.inputs)[0];
      const droppedOutputKey = Object.keys(dropped.outputs)[0];
      if (!droppedInputKey || !droppedOutputKey) return context;

      for (const connection of editor.getConnections()) {
        // Don't try to splice into a wire already touching the dropped node.
        if (connection.source === droppedId || connection.target === droppedId) continue;

        const a = nodeCenter(area, connection.source);
        const b = nodeCenter(area, connection.target);
        if (!a || !b) continue;

        if (distanceToSegment(center, a, b) <= HIT_THRESHOLD_PX) {
          const sourceToDropped = new ClassicPreset.Connection(
            editor.getNode(connection.source)!,
            connection.sourceOutput,
            dropped,
            droppedInputKey,
          ) as Schemes["Connection"];
          const droppedToTarget = new ClassicPreset.Connection(
            dropped,
            droppedOutputKey,
            editor.getNode(connection.target)!,
            connection.targetInput,
          ) as Schemes["Connection"];

          if (!canCreateConnection(editor, sourceToDropped) || !canCreateConnection(editor, droppedToTarget)) {
            // Types don't line up (e.g. dropping `debug` mid-wire, or the
            // wire feeds gpio_out's bool-only input and the dropped node's
            // output isn't bool) — leave the original connection alone
            // rather than silently breaking the flow.
            continue;
          }

          void editor.removeConnection(connection.id).then(async () => {
            await editor.addConnection(sourceToDropped);
            await editor.addConnection(droppedToTarget);
          });
          break; // one splice per drop
        }
      }
    }
    return context;
  });
}

export { getConnectionSockets };
