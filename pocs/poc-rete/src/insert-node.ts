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
import { logDebug } from "./store";

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
// contract the "Arrange nodes" guide's node base class uses, and the same
// field `rete-vue-plugin`'s own Node.vue reads to size the real DOM box —
// see nodes.ts's FunctionNode header for why that matters beyond this file).
function nodeCenter(editor: Editor, area: AreaPlugin<Schemes, AreaExtra>, nodeId: string): Point | null {
  const view = area.nodeViews.get(nodeId);
  const node = editor.getNode(nodeId) as unknown as { width?: number; height?: number } | undefined;
  if (!view) return null;
  return {
    x: view.position.x + (node?.width ?? 150) / 2,
    y: view.position.y + (node?.height ?? 60) / 2,
  };
}

const HIT_THRESHOLD_PX = 40;

// 2026-08-15: Mike reported splice still not firing after the
// `nodedragged` → `nodetranslated` fix (verified correct at the
// AreaPlugin.translate → NodeView.translate → emits "nodetranslated"
// level, by reading the installed bundle, not re-guessed). Since there's
// no browser available in this environment to watch it happen, this pass
// adds two things instead of a third guess: (1) a debug-sidebar log line
// on every attempt — nearest wire found and its distance, or the
// type-check verdict — so a real failure is diagnosable instead of just
// "nothing happened"; (2) a guard against re-entrant splices on the same
// connection, since `nodetranslated` can fire many times per drag and the
// splice itself is async (`removeConnection` then two `addConnection`s) —
// without this, two overlapping in-flight splices on the same wire could
// race and silently no-op or throw.
const splicingConnections = new Set<string>();

export function installInsertableNodes(editor: Editor, area: AreaPlugin<Schemes, AreaExtra>): void {
  area.addPipe((context) => {
    if (context.type !== "nodetranslated") return context;

    // `NodeTranslateEventParams` (rete-area-plugin's own declared type)
    // only lists `position`/`previous` — but the plugin's actual emit call
    // does `_objectSpread({ id }, data)` (checked in the installed bundle,
    // not assumed), so `id` really is there at runtime. The cast documents
    // that gap between the shipped .d.ts and the shipped JS rather than
    // reaching for `any`.
    const droppedId = (context.data as { id: string }).id;
    const dropped = editor.getNode(droppedId);
    const center = nodeCenter(editor, area, droppedId);
    if (!dropped || !center) return context;

    // A node with no free input+output pair of the right shape can't be
    // spliced through — skip silently (debug has no output, inject has no
    // input) rather than logging noise on every one of their moves too.
    const droppedInputKey = Object.keys(dropped.inputs)[0];
    const droppedOutputKey = Object.keys(dropped.outputs)[0];
    if (!droppedInputKey || !droppedOutputKey) return context;

    let nearest: { connection: Schemes["Connection"]; distance: number } | null = null;

    for (const connection of editor.getConnections()) {
      if (connection.source === droppedId || connection.target === droppedId) continue;
      if (splicingConnections.has(connection.id)) continue;

      const a = nodeCenter(editor, area, connection.source);
      const b = nodeCenter(editor, area, connection.target);
      if (!a || !b) continue;

      const distance = distanceToSegment(center, a, b);
      if (!nearest || distance < nearest.distance) nearest = { connection, distance };
    }

    if (!nearest || nearest.distance > HIT_THRESHOLD_PX) {
      if (nearest) {
        logDebug(
          "[splice]",
          `nearest wire ${Math.round(nearest.distance)}px away (need <=${HIT_THRESHOLD_PX}px) — move closer to the line between the two node centers`,
        );
      }
      return context;
    }

    const { connection } = nearest;
    const source = editor.getNode(connection.source)!;
    const target = editor.getNode(connection.target)!;
    const sourceToDropped = new ClassicPreset.Connection(source, connection.sourceOutput, dropped, droppedInputKey) as Schemes["Connection"];
    const droppedToTarget = new ClassicPreset.Connection(dropped, droppedOutputKey, target, connection.targetInput) as Schemes["Connection"];

    if (!canCreateConnection(editor, sourceToDropped) || !canCreateConnection(editor, droppedToTarget)) {
      logDebug(
        "[splice]",
        `in range (${Math.round(nearest.distance)}px) but type-rejected: ${source.label}→${dropped.label} or ${dropped.label}→${target.label} isn't a valid socket pair`,
      );
      return context;
    }

    splicingConnections.add(connection.id);
    logDebug("[splice]", `splicing ${dropped.label} into ${source.label}→${target.label}`);
    void editor
      .removeConnection(connection.id)
      .then(async () => {
        await editor.addConnection(sourceToDropped);
        await editor.addConnection(droppedToTarget);
        logDebug("[splice]", "done");
      })
      .catch((err) => {
        logDebug("[splice] ERROR", String(err));
      })
      .finally(() => {
        splicingConnections.delete(connection.id);
      });

    return context;
  });
}

export { getConnectionSockets };
