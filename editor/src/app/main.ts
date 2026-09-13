// SPDX-License-Identifier: Apache-2.0
// editor/src/app/main.ts
//
// Bare-minimum editor app shell: canvas (Rete, five real node types via
// rete/nodes.ts) -> real compiler (compiler/compile.ts, the same one the
// off-device tests exercise) -> real mpy-cross WASM cross-compile
// (vendored from mpy-cross-wasm/, see editor/public/vendor/mpy-cross) ->
// real §13 DEPLOY over WebSerial (protocol/transport.ts). Save/load
// (flow-file/), the HELLO/version gate (version.ts), and node highlighting
// are all wired in below.
//
// Canvas layer rewritten Rete migration Phase 3
// (docs/working-notes/rete-migration-decision.md's scoped task list, items
// 1 and 10-13). app/nodes.ts (Litegraph) is deliberately no longer
// imported from this file -- not deleted (Phase 4 step 17, after the
// hardware round-trip). Per the decision doc's own framing, "the existing
// Litegraph editor stays runnable" now means reversible via git, not
// simultaneously live in this browser tab alongside Rete -- Litegraph and
// Rete both want to own the same canvas element and pointer events, so
// there is no dual-canvas mode. Confirmed with Mike before this rewrite
// started, same as the decision doc asked.
//
// Vue-mounting judgment call (index.html's own open question, decision doc
// item 2): this migration mounts two small standalone Vue apps
// (PaletteSidebar.vue, PropertyPanel.vue) via createApp(...).mount(...)
// into two designated containers, rather than folding the whole app shell
// into one Vue tree. The canvas region's own rendering is already Vue
// internally (rete-vue-plugin, via createThingstudioEditor()) without this
// file mounting anything itself. Toolbar, source-preview, console, and the
// WebSerial connect/deploy flow all stay exactly the vanilla-DOM
// addEventListener style they always were. This is the smaller-blast-
// radius reading of the two options: the canvas-agnostic two-thirds of
// this file (mpy-cross loader, device console, HELLO/version gate,
// Deploy handler) must survive verbatim per the decision doc's stop
// conditions, and a single-Vue-tree rewrite would touch all of it for no
// benefit this migration is scoped to deliver.
//
// Config nodes (config-node-and-palette-implementation-briefing.md):
// rete/store.ts's `configs` map is the single source of truth for a
// flow's config nodes, same role it already plays for `selectedNode`/
// `propertyVersion`. This file folds that store into save (buildFlowFile),
// load (applyFlowFile -> replaceAllConfigs), compile (toGraphData), and
// canvas-clear (clearConfigs) -- the "genuinely new plumbing" the briefing
// calls out, not a couple of extra fields on something that already walks
// the canvas.
//
// Custom node authoring (docs/working-notes/custom-node-authoring-
// scoping.md, 2026-08-20): a loaded custom node type (rete/custom-nodes-
// store.ts) is session-scoped, not flow-scoped -- unlike configs, it is
// NOT cleared by "clear canvas" and is not part of applyFlowFile()'s
// clear-then-repopulate cycle. What IS new here: addCustomNodeOfType()
// (this file's equivalent of addNodeOfKind() for a loaded custom type),
// the drop handler's second MIME check, applyFlowFile()'s per-node branch
// (a saved node whose type matches a *currently loaded* custom package
// constructs via CustomNode instead of NODE_FACTORIES -- one not
// currently loaded already falls through to the pre-existing "unknown
// type, skip + log" path unchanged, no special-casing needed there), and
// currentSource()'s registry merge (custom-node.ts's
// mergeCustomNodeRegistry(), rebuilt fresh each compile since custom
// nodes can be loaded mid-session).

// Editor-backend-wiring, 2026-09-07 (docs/working-notes/outstanding-items/
// backend-persisted-data-protocol.md's own "suggested next-session
// candidates" #1): design doc §4 already requires the connection be an
// "explicit user choice between 'direct' (WebSerial, local-only) and 'via
// backend' connection modes -- not auto-detection." Before this session
// nothing in the browser could reach either backend surface at all
// (backend-auth-overview.md's own finding). This adds that choice
// (connModeSelect in index.html) and a second transport implementation,
// BackendTransport (protocol/backend-transport.ts), alongside the
// existing WebSerialTransport -- both now typed against the shared
// DeviceTransport contract (transport.ts) so the Connect/Deploy/Check
// status/Disconnect/inject-click-to-fire logic below is written once and
// used by either mode, branching only at the point a connection is
// actually opened. Default mode is "via backend" (Mike's own call,
// 2026-09-07); "direct" stays available deliberately, not just left in
// out of inertia -- it needs no backend process running at all (lowest
// friction for a quick one-off session) and remains a working fallback if
// the backend itself is what's broken, and keeping it costs nothing new
// here since WebSerialTransport already existed and already worked.
// Out of scope for this session, named explicitly: a fetch-based client
// for the new /api/flows and /api/custom-nodes admin API (backend-
// persisted-data-protocol.md) -- flow/custom-node save-load still goes
// through the File System Access picker (flow-file/file-io.ts) regardless
// of connection mode; that's its own follow-up, not assumed done here.
//
// Admin-API client wired in, 2026-09-08 (flow-file/admin-api-client.ts):
// custom node loading (PaletteSidebar.vue) goes through the backend's
// /api/custom-nodes routes; backendUrlInput is the single backend
// location for both the device transport and custom-node storage.
//
// Flow save/open briefly went backend-exclusive the same day (every
// save/load through /api/flows, no File System Access picker) before
// Mike's own explicit call, later the same day, reversed it: a flow is
// project material that belongs in whatever git repo it's part of,
// chosen per-save/per-open via the OS's own native file dialog like any
// other editing program -- not tied to a directory fixed at backend
// startup, and not backend-managed at all. flow-file/file-io.ts (File
// System Access API, with manual download/upload as the Safari/Firefox
// fallback) is what btnSaveFlow/btnOpenFlow use below, same as before
// this file ever went backend-exclusive. admin-api-client.ts's flow
// functions (listFlows/readFlow/writeFlow/deleteFlow) and the backend's
// own /api/flows routes stay in the tree, unused -- same "keep it,
// git-reversible" posture this file's header already takes with
// connModeSelect's hidden "direct" option -- custom nodes are the
// genuinely cross-flow case backend storage stays right for.
// "Direct" WebSerial mode's connModeSelect option stays hidden regardless
// -- that's about the device transport, unrelated to where a flow's own
// file lives.

import { createApp, nextTick, watch } from "vue";
import { compile } from "../compiler/compile.js";
import type { NodeLineRange } from "../compiler/compile.js";
import { buildRegistry } from "../node-library/registry.js";
import { mergeCustomNodeRegistry } from "../node-library/custom-node.js";
import { WebSerialTransport, type WebSerialPort, type DeviceTransport, type TransportEvents } from "../protocol/transport.js";
import { BackendTransport, type SerialPortInfo } from "../protocol/backend-transport.js";
import type { Message, NodeStatusMessage, ProtocolVersion } from "../protocol/messages.js";
import { checkRuntimeBuild, decideDeploy } from "../protocol/version.js";
import { ClassicPreset } from "rete";
import { createThingstudioEditor, type ThingstudioEditor } from "./rete/editor-setup.js";
import { NODE_FACTORIES, CustomNode, FunctionNode, portSocket, functionOutputKey, functionNodeHeight, type AnyThingstudioNode } from "./rete/nodes.js";
import { functionNode as functionNodeDefinition } from "../node-library/function-node.js";
import { DRAG_MIME, CUSTOM_DRAG_MIME, type NodeKind } from "./rete/palette.js";
import { toGraphData, socketIndex } from "./rete/graph-adapter.js";
import { propertyVersion, configs as configsStore, replaceAllConfigs, clearConfigs, backendWsUrl, fireInjectNode } from "./rete/store.js";
import { getCustomNodePackage, listCustomNodeDefinitions } from "./rete/custom-nodes-store.js";
import { assignNodeToActivePane, paneOfNode, replacePanesFromFlowFile, resetPanes, setActivePane, panes as panesStore } from "./rete/panes-store.js";
import PaletteSidebar from "./rete/PaletteSidebar.vue";
import PropertyPanel from "./rete/PropertyPanel.vue";
import PaneTabs from "./rete/PaneTabs.vue";
import {
  buildFlowFile,
  parseFlowFile,
  serializeFlowFileText,
  FlowFileError,
  DEFAULT_FLOW_NAME,
  type FlowFile,
  type FlowFileEdge,
  type FlowFileConfig,
  type CanvasNodeSnapshot,
} from "../flow-file/flow-file.js";
import { DEFAULT_BACKEND_WS_URL, slugifyFlowName } from "../flow-file/admin-api-client.js";
// slugifyFlowName is reused here purely for a nicer suggested filename in
// the save dialog below -- its own header's reasoning for why a display
// name isn't a valid storage key applies just as well to a suggested
// filename, even though nothing here treats it as an actual storage key
// anymore. AdminApiError and the flow CRUD functions aren't imported --
// nothing in this file calls them; see the header comment above.
import { saveFlowFileToDisk, openFlowFileFromDisk } from "../flow-file/file-io.js";

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// Flow identity (2026-09-05, "flow identity" -- decisions.md): the name
// input is the single source of truth for this flow's flowName, read at
// save/deploy time and written at load/clear time -- deliberately not
// mirrored into any other in-memory variable, so there's exactly one
// place this can drift from what's on screen.
function currentFlowNameInput(): string {
  const raw = el<HTMLInputElement>("flowNameInput").value.trim();
  return raw === "" ? DEFAULT_FLOW_NAME : raw;
}

// ---------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------
// Top-level await, not an async IIFE: createThingstudioEditor() does no
// network/disk I/O (just plugin/DOM setup), so everything below this
// block starts running a single microtask later in practice -- simpler
// than threading an "editor not ready yet" guard through every function
// below that touches reteEditor/reteArea.
const canvasContainer = el("rete-canvas");
const reteHandle: ThingstudioEditor = await createThingstudioEditor(canvasContainer);
const reteEditor = reteHandle.editor;
const reteArea = reteHandle.area;

let placeCount = 0;
function nextGridPosition(): { x: number; y: number } {
  const col = placeCount % 3;
  const row = Math.floor(placeCount / 3);
  placeCount++;
  return { x: 80 + col * 220, y: 80 + row * 160 };
}

async function addNodeOfKind(kind: NodeKind, position?: { x: number; y: number }): Promise<AnyThingstudioNode> {
  const node = NODE_FACTORIES[kind]();
  await reteHandle.addNode(node, position ?? nextGridPosition());
  // Multiple panes (2026-09-13): a new node defaults into whichever pane
  // is currently open -- multi-pane-canvas.md's own resolved design.
  assignNodeToActivePane(node.id);
  return node;
}

/** Custom-node counterpart to addNodeOfKind() above -- `type` must name a
 * package already loaded this session (rete/custom-nodes-store.ts); a
 * stale drag/click referencing a type that's since... never happens today
 * (nothing unloads a custom type once loaded), but a stale flow file
 * reference is real (applyFlowFile() below), so this stays a fallible
 * lookup rather than an assert. */
async function addCustomNodeOfType(type: string, position?: { x: number; y: number }): Promise<AnyThingstudioNode | null> {
  const pkg = getCustomNodePackage(type);
  if (!pkg) {
    logLine(`[custom node "${type}" is not loaded this session -- use "Load custom node..." first]`, "err");
    return null;
  }
  const node = new CustomNode(pkg.descriptor);
  await reteHandle.addNode(node, position ?? nextGridPosition());
  assignNodeToActivePane(node.id); // see addNodeOfKind()'s own comment just above
  return node;
}

el("clear-canvas").addEventListener("click", async () => {
  await reteHandle.clear();
  placeCount = 0;
  // Configs are flow-scoped, not canvas-node-scoped (they never appear as
  // boxes -- graph.ts's GraphConfigNode header), but "clear canvas" means
  // "start a new empty flow" from the user's point of view, so they reset
  // together rather than leaving orphaned configs no visible node
  // references anymore. Loaded custom node *types* are session-scoped, not
  // flow-scoped (this file's header comment) -- deliberately NOT reset
  // here. The flow name (2026-09-05) is flow-scoped the same way configs
  // are, so it resets to the same default a brand new flow file would get.
  clearConfigs();
  // Panes (2026-09-13) are flow-scoped the same way -- back to the single
  // starting pane, same as a brand new flow file.
  resetPanes();
  el<HTMLInputElement>("flowNameInput").value = "";
});

// Delete-node/delete-wire (2026-09-08, outstanding-items.md "UI / editor"
// section). Listens on `document`, not `canvasContainer` -- a click on a
// node/wire doesn't necessarily leave DOM focus anywhere in particular, so
// scoping this to the canvas element could miss the very keypress it's
// meant to catch. The real risk of a document-level listener is a
// Backspace/Delete meant for a text field (flowNameInput, a property
// panel field, ConfigRefField.vue's own inputs) instead deleting whatever
// happens to be selected on the canvas -- guarded by checking
// document.activeElement the same way any editor with both a canvas and
// text inputs has to. reteHandle.deleteSelected() itself is a no-op with
// nothing selected, so this doesn't need its own guard for that case.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Delete" && e.key !== "Backspace") return;
  const active = document.activeElement as HTMLElement | null;
  const tag = active?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active?.isContentEditable) return;
  e.preventDefault();
  void reteHandle.deleteSelected();
});

// Palette (left) -- click-to-add via the `add`/`addCustom` emits, plus the
// two custom-node-load outcome emits routed to the same device console
// every other status line already uses. Vue's programmatic mount treats
// an `onX` prop as a listener for an emitted `x` event, same as if this
// were a child component in a template (PaletteSidebar.vue's own
// `defineEmits<...>()`).
createApp(PaletteSidebar, {
  onAdd: (kind: NodeKind) => {
    void addNodeOfKind(kind);
  },
  onAddCustom: (type: string) => {
    void addCustomNodeOfType(type);
  },
  onCustomNodeLoaded: (type: string) => {
    logLine(`[custom node loaded: ${type}]`, "ok");
  },
  onCustomNodeLoadError: (message: string) => {
    logLine(`[custom node load failed] ${message}`, "err");
  },
}).mount(el("palette-mount"));

// Property panel (right) -- reads/writes the selected node via store.ts;
// editor-setup.ts's nodepicked pipe (Phase 3 item 13) keeps `selectedNode`
// in sync with canvas clicks.
createApp(PropertyPanel).mount(el("property-panel-mount"));

// Pane tabs (2026-09-13, multi-pane-canvas.md) -- overlaid on top of the
// canvas itself (index.html's #pane-tabs-mount sits inside #canvas-wrap,
// before #rete-canvas; PaneTabs.vue's own `#pane-tabs` rule does the
// actual `position:absolute` pinning, so #rete-canvas's existing
// absolute-fill sizing is untouched). Only pane *removal* needs
// reteHandle (it deletes the pane's live Rete nodes too, editor-setup.
// ts's deletePane()) -- add/rename are pure panes-store.ts mutations
// PaneTabs.vue makes directly (that component's own header explains the
// split).
createApp(PaneTabs, {
  onDeletePane: (id: string) => {
    void reteHandle.deletePane(id);
  }, // matches PaneTabs.vue's `defineEmits<{ deletePane: ... }>()`
}).mount(el("pane-tabs-mount"));

// Drag-and-drop from the palette onto the canvas -- ported from poc-rete's
// App.vue onDrop(), same graph-space coordinate math: a screen point maps
// back to graph space by subtracting the canvas's own on-screen offset and
// current pan, then dividing by zoom (the inverse of how the canvas
// positions/scales its content layer). PaletteSidebar.vue's own dragstart
// sets DRAG_MIME (built-in kinds) or CUSTOM_DRAG_MIME (loaded custom
// types, checked first below since a custom type is never also a NodeKind
// literal -- the two MIME types are mutually exclusive per drag, not a
// fallback chain); this is the drop-target half, a plain DOM listener
// rather than part of either mounted Vue app since the gesture crosses a
// real DOM boundary between them.
canvasContainer.addEventListener("dragover", (e) => e.preventDefault());
canvasContainer.addEventListener("drop", (e) => {
  e.preventDefault();
  const rect = canvasContainer.getBoundingClientRect();
  const { x: panX, y: panY, k: zoom } = reteArea.area.transform;
  const graphX = (e.clientX - rect.left - panX) / zoom;
  const graphY = (e.clientY - rect.top - panY) / zoom;

  const customType = e.dataTransfer?.getData(CUSTOM_DRAG_MIME);
  if (customType) {
    void addCustomNodeOfType(customType, { x: graphX, y: graphY });
    return;
  }
  const kind = e.dataTransfer?.getData(DRAG_MIME) as NodeKind | "";
  if (!kind) return;
  void addNodeOfKind(kind, { x: graphX, y: graphY });
});

// ---------------------------------------------------------------------
// Flow save/load (flow-file/) -- the canvas-coupled half. flow-file.ts
// owns the actual format (pure, off-device testable); this is just the
// glue reading/writing a live Rete graph, same split transport.ts
// (protocol machinery) vs. main.ts's Connect handler (the raw
// requestPort() call) already uses.
// ---------------------------------------------------------------------
function extractCanvasSnapshot(): { nodes: CanvasNodeSnapshot[]; edges: FlowFileEdge[] } {
  const nodes = reteEditor.getNodes() as AnyThingstudioNode[];
  // Rete node IDs are string UUIDs (ClassicPreset.Node's own constructor,
  // crypto.randomUUID()) -- flow-file.ts's node ids are the same string
  // now (decisions.md's "Stable node IDs" entry, 2026-09-04), so this is
  // a direct pass-through below, not a remap: a node is saved under the
  // exact id it already has on the canvas, stable across save/load and
  // redeploys rather than recomputed fresh on every save.

  const snapshot: CanvasNodeSnapshot[] = nodes.map((n) => {
    const view = reteArea.nodeViews.get(n.id);
    // A missing NodeView would mean the node exists in the editor's data
    // model but was never actually rendered -- shouldn't happen
    // (reteHandle.addNode() always area.translate()s a node right after
    // adding it), but falls back to (0, 0) rather than crashing the save,
    // same "a partially-bad state should still save what it can" reasoning
    // applyFlowFile's load side below uses.
    const pos: [number, number] = view ? [view.position.x, view.position.y] : [0, 0];
    return {
      id: n.id,
      // n.nodeType is each node's own real compiler type string (nodes.ts)
      // -- "thingstudio/xxx" for a first-party kind, or a custom type's own
      // namespaced id verbatim (e.g. "custom/dht22") -- read directly
      // instead of computing `` `thingstudio/${n.kind}` ``, which assumed
      // every node lives in the "thingstudio/" namespace (docs/working-
      // notes/custom-node-authoring-scoping.md, 2026-08-20).
      type: n.nodeType,
      properties: n.properties,
      pos,
      size: [n.width, n.height],
      // Multiple panes (2026-09-13) -- paneOfNode() falls back to the
      // first pane for a node panes-store.ts somehow never tracked
      // (shouldn't happen -- every node gets assigned at creation/load --
      // but a save should still succeed with a sensible default rather
      // than crash, same "a partially-bad state should still save what it
      // can" reasoning this function's own header already documents).
      paneId: paneOfNode(n.id),
    };
  });

  const edges: FlowFileEdge[] = reteEditor.getConnections().map((c) => {
    const sourceNode = reteEditor.getNode(c.source) as AnyThingstudioNode;
    const targetNode = reteEditor.getNode(c.target) as AnyThingstudioNode;
    const originSlot = socketIndex(Object.keys(sourceNode.outputs), c.sourceOutput);
    const targetSlot = socketIndex(Object.keys(targetNode.inputs), c.targetInput);
    return [c.source, originSlot, c.target, targetSlot];
  });

  return { nodes: snapshot, edges };
}

/** rete/store.ts's `configs` map, snapshotted into flow-file.ts's own
 * {id, type, properties} shape -- already agrees field-for-field
 * (store.ts's ConfigEntry header), so this is a plain copy, not a
 * translation. */
function extractConfigsSnapshot(): FlowFileConfig[] {
  return [...configsStore.value.values()].map((c) => ({ id: c.id, type: c.type, properties: c.properties }));
}

/**
 * Reconstructs the canvas from a parsed flow file. Rete rewrite of the
 * Litegraph version -- rete has no widget layer to sync (no
 * per-node `configure()` call doing double duty the way Litegraph's did),
 * which makes this simpler, not harder: construct each node via
 * NODE_FACTORIES (or, for a custom type, `new CustomNode(descriptor)` --
 * see below), assign its saved properties directly, and place it via
 * reteHandle.addNode(). The fault-handling contract this replaces is not
 * negotiable and is unchanged: a referenced node type that isn't
 * registered (a newer/unknown type, a typo from hand-editing the file, or
 * -- new with custom nodes -- a custom type this session hasn't loaded
 * yet) is reported and skipped, along with any edge touching it, rather
 * than aborting the whole load -- CLAUDE.md's fault-handling priority
 * applied to file I/O: a partially-bad file should still load what it
 * can. An edge naming a valid slot index that doesn't resolve to a real
 * socket key, or a connection Rete's own validation pipe rejects, is
 * reported and skipped the same way rather than treated as fatal.
 */
async function applyFlowFile(file: FlowFile): Promise<void> {
  await reteHandle.clear();
  placeCount = 0;
  // Configs load before nodes: a node's own ConfigRefField (PropertyPanel.vue)
  // looks its bound wifiConfigId up in this store to render the dropdown's
  // current selection, so the store needs to already hold the file's
  // configs by the time any node using one gets constructed/selected below.
  replaceAllConfigs(file.configs.map((c) => ({ id: c.id, type: c.type, properties: c.properties })));
  const skippedFileIds = new Set<string>();
  const nodeByFileId = new Map<string, AnyThingstudioNode>();

  for (const n of file.nodes) {
    // Custom node types are checked first -- a loaded custom package's
    // `type` never starts with "thingstudio/" (validateCustomNodeDescriptor
    // enforces the reserved namespace), so there's no ambiguity between
    // the two lookups. A custom type this session simply hasn't loaded
    // yet falls straight through to the existing built-in lookup below,
    // which correctly reports it as unknown (custom-node-authoring-
    // scoping.md's Decision 4: session-scoped loading, no auto-restore).
    const customPkg = getCustomNodePackage(n.type);
    let node: AnyThingstudioNode;
    if (customPkg) {
      node = new CustomNode(customPkg.descriptor);
    } else {
      const kind = n.type.replace(/^thingstudio\//, "") as NodeKind;
      const factory = NODE_FACTORIES[kind];
      if (!factory) {
        skippedFileIds.add(n.id);
        logLine(`[load: skipped node ${n.id}, unknown type "${n.type}"]`, "err");
        continue;
      }
      node = factory();
    }
    // Adopt the saved id instead of the fresh crypto.randomUUID() the
    // constructor just assigned -- stable node IDs (decisions.md's
    // "Stable node IDs" entry, 2026-09-04) means a loaded node keeps the
    // exact identity it was saved under, not a new one every time the
    // flow file is opened. Must happen before reteHandle.addNode() below,
    // which registers the node into the editor (and calls area.translate())
    // keyed by whatever node.id already holds at that point.
    node.id = n.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(node.properties as any, n.properties);
    // Rebuild a loaded function node's real output ports to match its
    // saved `outputCount` (multi-output-port support, outstanding-items/
    // connection-state-gate-router-nodes.md, 2026-09-12) -- the factory()
    // call above just built a fresh FunctionNode with the DEFAULT
    // outputCount (1), before the Object.assign above overwrote
    // `properties.outputCount` with whatever the file actually says;
    // `node.outputs` itself (the real Rete port record) isn't touched by
    // that assignment at all, so without this a flow saved with 3 outputs
    // would load back with `properties.outputCount === 3` but only ONE
    // real output port -- any edge targeting slot 1 or 2 would then
    // silently fail to resolve in the edge-restoring loop below
    // (`Object.keys(originNode.outputs)[originSlot]` undefined). Runs
    // before reteHandle.addNode() so there's no already-rendered canvas
    // state to force a re-render of -- the node is constructed correctly
    // from the start instead. Reuses functionNodeDefinition's own
    // outputCount() hook (function-node.ts) for the same clamping a
    // garbage/out-of-range saved value gets anywhere else, rather than a
    // second copy of that clamp logic here.
    if (node instanceof FunctionNode) {
      const wanted = functionNodeDefinition.outputCount!(node.properties);
      const current = Object.keys(node.outputs).length;
      for (let i = current; i < wanted; i++) {
        node.addOutput(functionOutputKey(i), new ClassicPreset.Output(portSocket(functionNodeDefinition.ports?.outputs, "msg", node.properties), String(i + 1)));
      }
      for (let i = wanted; i < current; i++) {
        node.removeOutput(functionOutputKey(i));
      }
      node.properties.outputCount = wanted;
      node.height = functionNodeHeight(wanted);
    }
    const layoutEntry = file.layout[n.id];
    const position = layoutEntry ? { x: layoutEntry.pos[0], y: layoutEntry.pos[1] } : { x: 0, y: 0 };
    await reteHandle.addNode(node, position);
    nodeByFileId.set(n.id, node);
  }

  for (const [originId, originSlot, targetId, targetSlot] of file.edges) {
    if (skippedFileIds.has(originId) || skippedFileIds.has(targetId)) continue; // already reported above
    const originNode = nodeByFileId.get(originId);
    const targetNode = nodeByFileId.get(targetId);
    if (!originNode || !targetNode) {
      logLine(`[load: skipped edge from missing node ${!originNode ? originId : targetId}]`, "err");
      continue;
    }
    const sourceKey = Object.keys(originNode.outputs)[originSlot];
    const targetKey = Object.keys(targetNode.inputs)[targetSlot];
    if (sourceKey === undefined || targetKey === undefined || !(await reteHandle.connectNodes(originNode, sourceKey, targetNode, targetKey))) {
      logLine(`[load: failed to connect node ${originId} slot ${originSlot} -> node ${targetId} slot ${targetSlot}]`, "err");
    }
  }

  // Multiple panes (2026-09-13) -- after nodes exist (a node's saved pane
  // assignment doesn't affect construction/placement above, so ordering
  // relative to that loop doesn't matter, but this reads nodeByFileId's
  // final key set, so it has to come after that loop finishes). Only real
  // constructed nodes get a pane entry -- a skipped (unknown-type) node
  // was never added to the canvas at all, so it has nothing to track.
  replacePanesFromFlowFile(file.panes, file.paneOf, [...nodeByFileId.keys()]);

  placeCount = file.nodes.length;
}

// Save/open use the OS's own native file dialog (flow-file/file-io.ts),
// same as any other desktop editing program -- see this file's header for
// the 2026-09-08 back-and-forth on why. No refresh/list/delete concept
// here at all: the OS's own Open dialog IS the browsing UI, and deleting a
// file you picked yourself is Finder's/git's job, not this editor's.

el("btnSaveFlow").addEventListener("click", async () => {
  try {
    const { nodes, edges } = extractCanvasSnapshot();
    const flowDisplayName = currentFlowNameInput();
    const text = serializeFlowFileText(buildFlowFile(nodes, edges, extractConfigsSnapshot(), flowDisplayName, panesStore.value));
    // Suggested filename only -- the picker lets the user type over it
    // freely, same as any "Save As" dialog; nothing here treats this as a
    // storage key the way the brief backend-exclusive period did.
    const suggestedName = `${slugifyFlowName(flowDisplayName)}.flow.json`;
    const saved = await saveFlowFileToDisk(text, suggestedName);
    if (saved) logLine("[flow saved]", "ok");
  } catch (err) {
    logLine(`[save failed] ${err instanceof Error ? err.message : String(err)}`, "err");
  }
});

el("btnOpenFlow").addEventListener("click", async () => {
  try {
    const text = await openFlowFileFromDisk();
    if (text === null) return; // user cancelled the picker
    const file = parseFlowFile(text);
    await applyFlowFile(file);
    // Mirrors the file's own saved name into the input -- shows "" (the
    // placeholder) rather than literally re-typing DEFAULT_FLOW_NAME for
    // an older file that never had one, same reasoning clear-canvas's own
    // reset uses.
    el<HTMLInputElement>("flowNameInput").value = file.flowName === DEFAULT_FLOW_NAME ? "" : file.flowName;
    logLine(`[flow loaded -- ${file.nodes.length} node(s)]`, "ok");
    refreshPreview();
  } catch (err) {
    const message = err instanceof FlowFileError ? `invalid flow file: ${err.message}` : err instanceof Error ? err.message : String(err);
    logLine(`[load failed] ${message}`, "err");
  }
});

// ---------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------
const consoleEl = el("console");
// `nodeId` (added 2026-09-04, phase 2 of decisions.md's "Stable node IDs"
// entry -- the actual console click-to-navigate ask this whole change
// started from): when a log line names a real node, the message span
// becomes clickable, wired to locateNode() below. Every call site below
// that knows a node id passes it through; every other call (most of
// them) simply omits it and gets the old plain, unclickable line.
function logLine(text: string, cls?: "ok" | "err" | "", nodeId?: string): void {
  const row = document.createElement("div");
  const now = new Date();
  const ts = now.toLocaleTimeString(undefined, { hour12: false }) + "." + String(now.getMilliseconds()).padStart(3, "0");
  row.innerHTML = `<span class="t">[${ts}] </span><span class="${cls ?? ""}"></span>`;
  const msgSpan = row.querySelector("span:last-child")!;
  msgSpan.textContent = text;
  if (nodeId !== undefined) {
    msgSpan.classList.add("node-link");
    msgSpan.setAttribute("title", "click to locate this node on the canvas");
    msgSpan.addEventListener("click", () => locateNode(nodeId));
  }
  consoleEl.appendChild(row);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/**
 * Console click-to-navigate (phase 2, 2026-09-04 -- Mike's original ask:
 * "make messages clickable and highlight/focus on the transmitting
 * node"). Selects the node (drives PropertyPanel.vue the same way
 * clicking it directly on the canvas does, editor-setup.ts's own
 * `nodepicked` pipe) and pans/zooms it into view (editor-setup.ts's new
 * `focusNode()`, scoped AreaExtensions.zoomAt()) -- deliberately does NOT
 * also force the red `highlighted` flag on: that's reserved for a real
 * NODE_ERROR/compile error (highlightNode() above), and reusing it here
 * would make an ordinary DEBUG-line click look like an error report.
 * Same untrusted-input handling as highlightNode(): an id that doesn't
 * resolve to a live node (removed since, or from a different flow) is
 * reported, not thrown.
 */
function locateNode(nodeId: string): void {
  const node = reteEditor.getNode(nodeId) as AnyThingstudioNode | undefined;
  if (!node) {
    logLine(`[locate: node ${nodeId} not found on the canvas -- removed since, or from a different flow]`, "err");
    return;
  }
  // Multiple panes (2026-09-13): the console can report a node from ANY
  // pane -- the device runs the whole compiled flow, not just whichever
  // pane happens to be open (panes-store.ts's own header) -- so a click
  // has to switch panes first when the node isn't in the one currently
  // showing, or it'd try to focus a node the user can't see yet
  // (ThingstudioNode.vue's `visibility:hidden`) without ever revealing it.
  // setActivePane() itself no-ops if this is already the active pane, so
  // no separate "did it change" check is needed here.
  setActivePane(paneOfNode(nodeId));
  // nextTick before select/focus, not strictly required by the geometry
  // itself -- ThingstudioNode.vue hides a node with `visibility:hidden`,
  // which (unlike `display:none`) keeps normal, correct measurements at
  // all times regardless of paint state, so focusNode()'s
  // AreaExtensions.zoomAt() would read valid numbers either way. Kept
  // anyway as a small safety margin between the pane-switch's reactive
  // update and reading anything DOM-derived, at effectively zero cost
  // (one microtask; a no-op setActivePane() call still resolves on the
  // very next microtask same as a real one).
  void nextTick().then(() => {
    // selectNode() drives both the property panel (selectedNode) and
    // Rete's own visual "selected" highlight (editor-setup.ts's new
    // selectNode(), 2026-09-04 fix -- a plain `selectedNode.value = node`
    // here opened the property panel but never touched the canvas's own
    // node.selected flag, so the node itself never visually highlighted;
    // Mike caught this on the first real click-through).
    void reteHandle.selectNode(node);
    void reteHandle.focusNode(node);
  });
}
el("btnClear").addEventListener("click", () => (consoleEl.innerHTML = ""));

// ---------------------------------------------------------------------
// mpy-cross WASM (vendored -- see editor/public/vendor/mpy-cross, copied
// byte-for-byte from mpy-cross-wasm/, hashes verified at copy time).
//
// NOT imported from this source file -- a first attempt at a dynamic
// `import()` of the public-dir URL hit Vite's own guard against exactly
// that ("This file is in /public ... should not be imported from source
// code. It can only be referenced via HTML tags."). So instead,
// index.html loads a tiny bridge script
// (public/vendor/mpy-cross/load.mjs) via a real HTML `<script
// type="module">` tag -- outside Vite's module graph entirely, the same
// unbundled way pocs/poc-d/app.js loaded this exact file -- which
// imports the real mpy-cross.mjs and publishes its factory on
// `window.__thingstudioCreateMpyCross`. This file just waits for that
// global to show up.
// ---------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let MpyModule: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateMpyCross = (opts: { print: (t: string) => void; printErr: (t: string) => void }) => Promise<any>;

async function waitForMpyCrossFactory(timeoutMs: number): Promise<CreateMpyCross> {
  const w = window as unknown as { __thingstudioCreateMpyCross?: CreateMpyCross };
  const deadline = Date.now() + timeoutMs;
  while (!w.__thingstudioCreateMpyCross) {
    if (Date.now() > deadline) {
      throw new Error("mpy-cross loader (public/vendor/mpy-cross/load.mjs) never populated window.__thingstudioCreateMpyCross -- check the browser console for a script-load error");
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return w.__thingstudioCreateMpyCross;
}

// Captured alongside the printErr logging below so a failed compile can be
// parsed for a "line N" attribution (see highlightNodeFromMpyError) without
// re-running mpy-cross or scraping the console DOM -- reset per compile
// attempt in compileToMpy, read back in the Deploy handler's catch block.
let mpyStderrLines: string[] = [];

const mpyReadyPromise: Promise<void> = (async () => {
  const createMpyCross = await waitForMpyCrossFactory(10000);
  MpyModule = await createMpyCross({
    print: (t: string) => logLine("[mpy-cross] " + t, ""),
    printErr: (t: string) => {
      mpyStderrLines.push(t);
      logLine("[mpy-cross] " + t, "err");
    },
  });
  logLine("[mpy-cross WASM ready]", "ok");
})().catch((err) => {
  logLine(`[mpy-cross load error] ${err instanceof Error ? err.message : String(err)}`, "err");
});

function compileToMpy(source: string): Uint8Array {
  if (!MpyModule) throw new Error("mpy-cross not ready yet");
  mpyStderrLines = [];
  MpyModule.FS.writeFile("/in.py", source);
  try {
    MpyModule.FS.unlink("/out.mpy");
  } catch {
    // no previous output to remove -- fine
  }
  const exitCode = MpyModule.callMain(["-o", "/out.mpy", "/in.py"]);
  if (exitCode !== 0) {
    throw new Error(`mpy-cross exited ${exitCode} (see console log above for stderr)`);
  }
  return MpyModule.FS.readFile("/out.mpy") as Uint8Array;
}

// ---------------------------------------------------------------------
// Compile (source preview -- runs the real compiler, no device needed)
// ---------------------------------------------------------------------
// Base registry, built once -- every compile merges the loaded custom
// node definitions (rete/custom-nodes-store.ts) on top of this fresh
// (custom-node.ts's mergeCustomNodeRegistry(), see currentSource() below),
// since which custom types are loaded can change mid-session. Renamed
// from the old bare `registry` (docs/working-notes/custom-node-
// authoring-scoping.md, 2026-08-20) so it's unambiguous this is the
// built-in-only base, not the registry actually passed to compile().
const builtInRegistry = buildRegistry();

// Node-ID line ranges from the most recent successful compile -- stashed
// here rather than threaded through refreshPreview()'s return value so the
// Deploy handler's mpy-cross error path (which runs after Deploy's own
// re-compile, see currentSource()'s call sites) can look a line number up
// without re-plumbing it through another layer.
let lastNodeLineRanges: NodeLineRange[] = [];

function currentSource(): string {
  const graphData = toGraphData(reteEditor, [...configsStore.value.values()]);
  // mergeCustomNodeRegistry throws (CustomNodeDescriptorError) if two
  // loaded custom packages collide on the same type id -- allowed to
  // propagate out to refreshPreview()'s existing catch below, which
  // already turns any thrown Error from this function into a visible
  // "COMPILE ERROR: ..." in the source preview panel; no special-casing
  // needed here for that to be comprehensible.
  const registry = mergeCustomNodeRegistry(builtInRegistry, listCustomNodeDefinitions());
  const { source, nodeLineRanges } = compile(graphData, registry);
  lastNodeLineRanges = nodeLineRanges;
  return source;
}

function refreshPreview(): { source: string } | { error: string } {
  try {
    const source = currentSource();
    el("source-preview").textContent = source;
    return { source };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    el("source-preview").textContent = "COMPILE ERROR: " + message;
    return { error: message };
  }
}

// ---------------------------------------------------------------------
// Error node attribution -- two distinct error sources, both flagging the
// same way (the node goes red on the canvas):
//
//  1. Compile-time: mpy-cross's SyntaxError only carries a raw line number
//     in the generated source; map it back to whichever node's generated
//     function that line falls inside via lastNodeLineRanges (computed by
//     compile.ts from the exact same text it emits, not re-derived here).
//     Only meaningful for function-node syntax errors in practice -- every
//     other node type's generated body is fixed, known-good text.
//  2. Runtime: a real §13 NODE_ERROR from the device (design doc §5's
//     fault isolation) -- this one's easier, the device already tells us
//     the exact node ID directly, no line-number math needed at all. The
//     msg22/NameError case that motivated adding this: syntactically
//     valid Python, so mpy-cross never rejects it -- it only fails once
//     actually executed on-device, which is exactly case 2, not case 1.
//     A custom node's own NameError (e.g. its `.node.py` doesn't actually
//     define `run`/`emit`, custom-node.ts's own header) is exactly this
//     case too -- syntactically valid Python, fails only once imported.
//
// Both cases' own logic is unchanged from the Litegraph version (Phase 3
// item 12) -- only the mechanism that turns a node red changed, from
// node.color/node.bgcolor mutation + canvas.setDirty(true, true) to
// reactive component state (nodes.ts's `highlighted` field, mutated here
// and pushed to the DOM via area.update("node", id) since Rete nodes
// aren't Vue-reactive on their own).
// ---------------------------------------------------------------------
function clearNodeHighlights(): void {
  for (const node of reteEditor.getNodes() as AnyThingstudioNode[]) {
    if (node.highlighted) {
      node.highlighted = false;
      void reteArea.update("node", node.id);
    }
  }
}

// Clears every node's status back to "never heard from" (nodes.ts's own
// comment on `status`'s null default) -- Mike's "clear all statuses on
// every redeploy" design call. A stale "connected" left over from the
// previous flow would otherwise keep showing on a node that the new flow
// doesn't even wire up to WiFi/MQTT the same way, or that isn't even the
// same node any more (edited between deploys but reusing an id) -- same
// staleness risk clearNodeHighlights() above already exists to avoid, one
// state field over.
function clearNodeStatuses(): void {
  for (const node of reteEditor.getNodes() as AnyThingstudioNode[]) {
    if (node.status !== null || node.statusText !== null) {
      node.status = null;
      node.statusText = null;
      void reteArea.update("node", node.id);
    }
  }
}

function highlightNode(nodeId: string): AnyThingstudioNode | null {
  // nodeId IS the Rete node's own id now (decisions.md's "Stable node
  // IDs" entry, 2026-09-04) -- no lookup table needed, and no more "which
  // compile's mapping is this from" staleness risk the old per-compile
  // remap carried (an edit made after a deploy but before a device
  // response arrived could previously point this at the wrong live
  // node). Still returns null rather than throwing for an unknown id (a
  // since-removed node, or the device reporting an id from a flow that's
  // since been edited) -- untrusted input either way, not a reason to
  // crash the console (CLAUDE.md's fault-handling priority).
  const node = reteEditor.getNode(nodeId) as AnyThingstudioNode | undefined;
  if (!node) return null;
  node.highlighted = true;
  void reteArea.update("node", node.id);
  return node;
}

function highlightNodeFromMpyError(stderrText: string): void {
  const match = stderrText.match(/line (\d+)/);
  if (!match) return; // not every mpy-cross failure names a line (e.g. a generic exit code) -- nothing to attribute
  const lineNo = Number(match[1]);
  const range = lastNodeLineRanges.find((r) => lineNo >= r.startLine && lineNo <= r.endLine);
  if (!range) return; // line falls outside any single node's function (compiler scaffolding) -- can't attribute more precisely than "somewhere in the flow"
  const node = highlightNode(range.nodeId);
  if (!node) return;
  // node.nodeType (nodes.ts) rather than node.kind here -- kind is just
  // "custom" for every loaded custom node type, nodeType is the real,
  // specific type id regardless of first-party or custom (docs/working-
  // notes/custom-node-authoring-scoping.md, 2026-08-20).
  logLine(`[compile error attributed to node ${range.nodeId} (${node.nodeType}), source line ${lineNo}]`, "err", range.nodeId);
}

function highlightNodeFromNodeError(nodeId: string): void {
  // §13's NODE_ERROR.nodeId is a string on the wire (messages.ts's own
  // "verbose over terse" convention) and now IS the compiler-facing node
  // id directly (decisions.md's "Stable node IDs" entry, 2026-09-04) --
  // no numeric coercion needed any more. Still untrusted input either way
  // (CLAUDE.md's fault-handling priority): highlightNode() itself returns
  // null rather than throwing for an id that doesn't resolve to a real
  // node, so a garbled/unknown id from the device is silently dropped
  // here, not trusted blindly.
  const node = highlightNode(nodeId);
  if (!node) return;
  logLine(`[runtime error attributed to node ${nodeId} (${node.nodeType})]`, "err", nodeId);
}

// NODE_STATUS handler (connection-status-indicator feature,
// outstanding-items/node-status-indicators.md) -- deliberately NOT
// built on highlightNode(): that function's whole contract is "flag this
// node red," which a routine status push (most commonly "still
// connected," wifi_status's own emit-on-change design already limits
// these to real state transitions, not a poll-rate flood) has no
// business doing. Same untrusted-input handling as every other §13
// nodeId-bearing message, though: reteEditor.getNode() returns undefined
// for an id that doesn't resolve (a since-removed node, or a stale id
// from a flow the editor has since redeployed over), silently dropped
// here rather than crashing the console.
function handleNodeStatus(nodeId: string, state: NodeStatusMessage["state"], text: string | undefined): void {
  const node = reteEditor.getNode(nodeId) as AnyThingstudioNode | undefined;
  if (!node) return;
  node.status = state;
  node.statusText = text ?? null;
  void reteArea.update("node", node.id);
}

// Rete's editor.addPipe sees every graph mutation (nodes/connections
// added, removed, or cleared) -- replaces the 1s poll this section used to
// need for Litegraph, whose own "no reliable 'graph changed' callback"
// gap (this file's previous header comment) doesn't exist here. Property-
// only edits (PropertyPanel.vue's v-model bindings) don't go through an
// editor pipe at all -- they mutate `node.properties` directly, the same
// off-Vue-reactivity mutation store.ts's `propertyVersion` bump exists to
// signal -- so this also re-runs on every propertyVersion bump, which
// PropertyPanel.vue's `touch()` already fires on every field edit. Between
// the two, every user action that could change the compiled source
// triggers a refresh; as before, Deploy always re-compiles from the live
// graph right before sending regardless of when this last ran, so nothing
// here is ever the source of truth for what gets deployed.
// Deploy-button "clean" state (Mike's ask, 2026-09-09): the Compile ->
// Deploy button should stay disabled right after a successful deploy --
// signals "what's running on the device already matches what's open" --
// and re-enable the moment the flow actually changes again, rather than
// (the old behavior) re-enabling unconditionally the instant the deploy
// attempt finishes, success or not. Piggybacks on the exact same two
// change-signals refreshPreview() already listens to below (this file's
// own comment there: "every user action that could change the compiled
// source" triggers one of these) -- anything that marks the preview
// stale marks the deploy button re-deployable too, so there's no second,
// independently-maintained notion of "did the flow change" to drift out
// of sync with the first. Starts false (nothing deployed yet this
// session, and setConnectedUi resets it on every fresh connect too --
// see that function) so Deploy is always available the moment you can
// reach a device.
let deployedClean = false;

function updateDeployButtonEnabled(): void {
  el<HTMLButtonElement>("btnDeploy").disabled = !transport.isConnected || deployedClean;
}

reteEditor.addPipe((context) => {
  if (context.type === "nodecreated" || context.type === "noderemoved" || context.type === "connectioncreated" || context.type === "connectionremoved" || context.type === "cleared") {
    deployedClean = false;
    updateDeployButtonEnabled();
    refreshPreview();
  }
  return context;
});
watch(propertyVersion, () => {
  deployedClean = false;
  updateDeployButtonEnabled();
  refreshPreview();
});
refreshPreview();

// ---------------------------------------------------------------------
// WebSerial connect / deploy -- real §13 protocol via transport.ts, no
// hand-rolled framing here (that's exactly what transport.ts exists to
// own). HELLO/version-gate check (version.ts) wired in below.
//
// Real constraint this wiring has to live with, not a hypothetical:
// device-runtime/src/listener.py sends HELLO exactly once, from a task
// spawned in main() at listener *boot* -- there's no periodic resend and
// nothing re-triggers it on a new client connection, because opening a
// WebSerial port is silent to the device (no DTR-style reset the way
// esptool's own best-effort reset trick, already used elsewhere in this
// app, exploits when it works at all). So a device that was already
// running before Connect was clicked -- the normal case, since a
// deployed flow persists across power cycles per §5 -- has no fresh
// HELLO for this connection to see; only a physical reset (the console
// already hints at this today) produces one. Blocking Deploy outright
// whenever no HELLO has arrived would make Deploy unusable in that
// ordinary case, so the gate is soft on absence and hard on mismatch:
// no HELLO yet -> allow Deploy with a visible "unverified" warning, a
// real HELLO reporting an incompatible major version -> block, per §5's
// "a version-checked editor refusing to send a DEPLOY the device can't
// parse prevents this specific trigger before it starts." Fixing the
// underlying gap for real (an explicit HELLO_REQUEST the editor can send
// on connect instead of waiting on a maybe-reset) is a device-runtime
// protocol change, out of scope here -- flagged, not silently worked
// around forever.
// ---------------------------------------------------------------------
let waiters: { match: (m: Message) => boolean; resolve: (m: Message) => void; timer: ReturnType<typeof setTimeout> }[] = [];

function waitForMessage(match: (m: Message) => boolean, timeoutMs: number): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((w) => w.timer !== timer);
      reject(new Error("timeout waiting for device response"));
    }, timeoutMs);
    waiters.push({ match, resolve, timer });
  });
}

// The runtime version this editor's compiler/codegen currently targets
// (version.ts's `editorTarget`). Has to be mirrored by hand against
// device-runtime/src/listener.py's `_RUNTIME_VERSION` -- no shared
// config file between the two projects/languages, same "has to be
// mirrored, flagged rather than silently duplicated" reasoning
// messages.ts's own header already applies to the MessageType table.
// Bumped 2026-09-10 (major: 0 -> 1): wifi-status.ts's/mqtt-shared.ts's
// codegen now calls runtime.report_status (NODE_STATUS,
// outstanding-items/node-status-indicators.md) -- a function that
// doesn't exist on any pre-2026-09-10 device-runtime/src/listener.py.
// decideDeploy() only blocks on a major mismatch (CLAUDE.md's version-
// bump-discipline rule), so this is the level that actually stops an
// unsafe DEPLOY rather than letting it crash on the device.
const EDITOR_TARGET_VERSION: ProtocolVersion = { major: 1, minor: 0, patch: 0 };

// This editor's own device-runtime/src git SHA, injected at build/dev-
// server-start time by vite.config.ts's `define` (see that file,
// vite-env.d.ts's ambient declaration, and version.ts's
// checkRuntimeBuild). null if git wasn't available when this editor was
// built/started -- checkRuntimeBuild treats that as "can't compare",
// not as a mismatch.
const EDITOR_RUNTIME_BUILD: string | null = __RUNTIME_BUILD_SHA__;

const HELLO_WAIT_MS = 3000; // generous over a real boot's timing; only gates the "unverified" warning below, never blocks Connect itself

// Set from the most recent HELLO this connection has seen; null means
// "no HELLO yet this connection" (either still waiting, or the device
// was already running and none is coming -- see the constraint above).
// Reset on every fresh Connect and on disconnect so a stale version from
// a previous device never silently carries over to a new one.
let lastHelloVersion: ProtocolVersion | null = null;

// Transport-agnostic event handling (design doc §4, editor-backend-wiring
// 2026-09-07: "explicit user choice between 'direct' (WebSerial,
// local-only) and 'via backend' connection modes"). Everything below
// reacts to §13 Message events the same way regardless of whether they
// arrived over a real WebSerial port or relayed through the backend's
// WebSocket -- only *how a connection is opened* differs (see the Connect
// handler further down), which is why this object is shared between both
// WebSerialTransport and BackendTransport rather than duplicated per mode.
const transportEvents: TransportEvents = {
  onMessage(message) {
    // Not every message type carries a nodeId (HELLO doesn't) -- `in`
    // narrows this safely per the real discriminated union either way.
    const nodeId = "nodeId" in message ? message.nodeId : undefined;
    logLine(`[${message.type}] ${JSON.stringify(message, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v))}`, "ok", nodeId);
    if (message.type === "NODE_ERROR") highlightNodeFromNodeError(message.nodeId);
    if (message.type === "NODE_STATUS") handleNodeStatus(message.nodeId, message.state, message.text);
    if (message.type === "HELLO") {
      lastHelloVersion = message.runtimeVersion;
      const decision = decideDeploy(message.runtimeVersion, EDITOR_TARGET_VERSION);
      logLine(`[version check] ${decision.reason}`, decision.allowed ? "ok" : "err");
      // Belt-and-braces companion check, non-blocking -- see
      // checkRuntimeBuild's own header for why this exists alongside
      // decideDeploy rather than replacing it.
      const buildCheck = checkRuntimeBuild(message.runtimeBuild, EDITOR_RUNTIME_BUILD);
      logLine(`[runtime build check] ${buildCheck.reason}`, buildCheck.status === "mismatch" ? "err" : "ok");
      // Flow identity (2026-09-05, "flow identity" -- decisions.md):
      // purely informational, same non-blocking spirit as the build
      // check just above -- lets a human confirm "is the flow on this
      // board the one I have open" without matching a deployId against
      // flow files on disk (Mike's own reasoning for why flowName, not
      // deployId, is the field meant to be eyeballed here).
      if (message.currentFlowName !== null) {
        logLine(`[flow status] running: "${message.currentFlowName}" (deploy ${message.currentFlowDeployId ?? "unknown"})`, "");
      } else {
        logLine("[flow status] no flow currently running on this board", "");
      }
    }
    waiters = waiters.filter((w) => {
      if (w.match(message)) {
        clearTimeout(w.timer);
        w.resolve(message);
        return false;
      }
      return true;
    });
  },
  onProtocolError(error) {
    logLine(`[protocol error] ${String(error)}`, "err");
  },
  onDebugLine(line) {
    // debug.ts's codegen emits `DEBUG node=<id> payload=...` -- DEBUG
    // output is raw print() text over the wire, not its own structured
    // §13 message type (Tier 2's still-unbuilt VALUE_STREAM is the
    // eventual structured replacement, debug.ts's own header), so this is
    // a text parse, same pattern highlightNodeFromMpyError() already uses
    // for a raw mpy-cross line number. Backend-relayed debug lines
    // (BackendTransport's onDebugLine -- the device's own print() output
    // forwarded via the backend's "debug" control message, or a
    // "[backend] ..."-prefixed line reporting a relay-side problem) land
    // here too, same handling either way.
    const match = line.match(/^DEBUG node=(\S+) /);
    logLine(line, "", match ? match[1] : undefined);
  },
  onDisconnect(reason) {
    logLine(`[disconnected] ${reason ? String(reason) : "(clean)"}`, "");
    lastHelloVersion = null;
    setConnectedUi(false);
  },
};

// The live connection, if any -- a WebSerialTransport (direct) or a
// BackendTransport (relayed through the backend's WebSocket), chosen by
// connModeSelect at Connect time (see below). Typed against the minimal
// DeviceTransport contract both implement (transport.ts), so everything
// past this point -- Deploy, Check status, Disconnect, inject
// click-to-fire -- is written once against that contract rather than
// duplicated per mode. Reassigned to a freshly-constructed instance of the
// right kind each time Connect succeeds; never mutated in place.
let transport: DeviceTransport = new WebSerialTransport(transportEvents);


// --- Inject click-only live-fire (2026-09-02) ---------------------------
// A click sends a real §13 TRIGGER naming the clicked node's own id
// directly (decisions.md's "Stable node IDs" entry, 2026-09-04) -- no
// reverse lookup needed any more (there used to be a
// findNodeIdForReteId()/lastReteIdByNodeId indirection here, the same
// per-compile remap highlightNodeFromNodeError() used to need in the
// opposite direction; both went away together in the same change). A
// click naming an id the device never actually deployed (the flow was
// edited after the last Deploy, or the device was reset/power-cycled and
// has no flow running at all -- see outstanding-items/inject-click-fire-
// missing.md's hardware notes) just gets silently ignored on the device
// side (runtime.py's fire_trigger) -- the same "untrusted/possibly-stale
// wire input degrades gracefully" contract every other §13 message
// already follows, not a new failure mode this feature introduces.
// 2026-09-13: reworked from an onNodeClicked veto (which made the whole
// inject node body either fire or select, with no way to open a live
// inject node's property panel) to a dedicated fire action wired through
// store.ts's fireInjectNode -- ThingstudioNode.vue calls this only from
// the node's own "▶" icon, stopping that click from ever reaching the
// canvas's normal node-select handling. No return value needed any more:
// firing and selecting are now two entirely separate click targets, not
// one click racing to decide which it was.
fireInjectNode.value = (node) => {
  if (!transport.isConnected) {
    logLine("[inject: connect to a device first -- clicking only fires while live]", "");
    return;
  }
  logLine(`[inject: firing node ${node.id}]`, "");
  transport.send({ type: "TRIGGER", nodeId: node.id }).catch((err) => {
    logLine(`[inject: trigger send failed] ${err instanceof Error ? err.message : String(err)}`, "err");
  });
};

function setConnectedUi(connected: boolean): void {
  el("pill").textContent = connected ? "connected" : "disconnected";
  el("pill").className = connected ? "pill connected" : "pill disconnected";
  el<HTMLButtonElement>("btnConnect").disabled = connected;
  el<HTMLButtonElement>("btnDisconnect").disabled = !connected;
  el<HTMLButtonElement>("btnCheckStatus").disabled = !connected;
  // A fresh connection always starts deployable, regardless of whatever
  // deployedClean was left at from a previous connection (a different
  // board very likely doesn't already have this exact flow running, and
  // even the same board could have been redeployed to, reset, or power-
  // cycled since -- HELLO's own currentFlowName/currentFlowDeployId is
  // the real source of truth for that, not this button's own state).
  if (connected) deployedClean = false;
  updateDeployButtonEnabled();
}

// DEFAULT_BACKEND_WS_URL now lives in admin-api-client.ts (imported above)
// -- the WS transport and the admin-API client share one backend location,
// so the fallback default only needs to exist in one place.

function currentConnMode(): "direct" | "backend" {
  return el<HTMLSelectElement>("connModeSelect").value === "direct" ? "direct" : "backend";
}

/** The one backend URL this editor talks to, for both the device
 * transport (when connModeSelect is "backend") and all storage (always,
 * per this file's 2026-09-08 header addendum) -- a small helper so every
 * call site (Connect, refreshBackendPorts, Save/Open/Delete flow, and the
 * store.ts mirror PaletteSidebar.vue reads) reads backendUrlInput the same
 * way rather than repeating the trim-or-default inline. */
function currentBackendWsUrl(): string {
  return el<HTMLInputElement>("backendUrlInput").value.trim() || DEFAULT_BACKEND_WS_URL;
}

/** Shows/hides the "via backend" controls (URL, port picker, refresh) --
 * a UI convenience only. The actual explicit choice design doc §4 asks for
 * is connModeSelect's own value; nothing here infers or defaults the mode
 * from the environment (e.g. whether a backend happens to be reachable). */
function updateConnModeUi(): void {
  const backend = currentConnMode() === "backend";
  el("backendUrlInput").hidden = !backend;
  el("backendPortSelect").hidden = !backend;
  el("btnRefreshPorts").hidden = !backend;
}
el("connModeSelect").addEventListener("change", updateConnModeUi);
updateConnModeUi();

// Mirrors backendUrlInput into store.ts's backendWsUrl (2026-09-08) --
// PaletteSidebar.vue's "Load custom node..." picker talks to the admin
// API directly and has no DOM reference to this input (main.ts owns all
// direct element access, per this file's own established convention), so
// it reads this reactive ref instead. Initialized once here, then kept in
// sync on every edit; not read reactively anywhere else in this file
// (every other call site here already calls currentBackendWsUrl() fresh).
backendWsUrl.value = currentBackendWsUrl();
el("backendUrlInput").addEventListener("input", () => {
  backendWsUrl.value = currentBackendWsUrl();
});

/** Populates backendPortSelect from the backend's own list_ports control
 * message. Uses a short-lived BackendTransport just for this one
 * request/response, torn down immediately after -- deliberately not the
 * same instance the Connect handler below opens for the real session, so
 * listing ports never requires already being (or staying) connected to a
 * device. Not called automatically on load or on switching to "via
 * backend": design doc §4's "explicit choice, not auto-detection"
 * reasoning applies here too -- probing a URL nobody asked to probe yet
 * would silently fail on every page load before a backend is even
 * started, which is exactly the ambiguous-failure shape that reasoning
 * warns against. */
async function refreshBackendPorts(): Promise<void> {
  const select = el<HTMLSelectElement>("backendPortSelect");
  const wsUrl = currentBackendWsUrl();
  select.innerHTML = '<option value="">(loading…)</option>';
  const probe = new BackendTransport({ onDebugLine: (line) => logLine(`[backend] ${line}`, "") });
  try {
    await probe.open(wsUrl);
    const ports: SerialPortInfo[] = await probe.listPorts();
    select.innerHTML = "";
    if (ports.length === 0) {
      select.innerHTML = '<option value="">(no ports found)</option>';
    } else {
      for (const p of ports) {
        const opt = document.createElement("option");
        opt.value = p.device;
        opt.textContent = p.description ? `${p.device} -- ${p.description}` : p.device;
        select.appendChild(opt);
      }
    }
  } catch (err) {
    select.innerHTML = '<option value="">(backend unreachable)</option>';
    logLine(`[list ports failed] ${err instanceof Error ? err.message : String(err)}`, "err");
  } finally {
    await probe.disconnect();
  }
}
el("btnRefreshPorts").addEventListener("click", () => void refreshBackendPorts());

el("btnConnect").addEventListener("click", async () => {
  lastHelloVersion = null;
  const mode = currentConnMode();

  if (mode === "direct") {
    // Frozen fallback per design doc §4's 2026-08-16 addendum: local-only,
    // no remote access, no auth story -- kept alongside the backend path
    // rather than retired. Genuinely still useful, not just legacy: it
    // needs no backend process installed or running at all (lowest-
    // friction path for a quick one-off session), and it stays usable as
    // an independent fallback if the backend itself is ever the thing
    // that's broken. All new investment still goes into the backend path
    // per that same addendum -- this mode is deliberately not being
    // extended further here.
    const nav = navigator as unknown as { serial?: { requestPort(): Promise<WebSerialPort> } };
    if (!nav.serial) {
      logLine('[Web Serial API not available -- use Chrome or Edge, served over http(s)://, or switch to "Via backend"]', "err");
      return;
    }
    const t = new WebSerialTransport(transportEvents);
    try {
      const port = await nav.serial.requestPort();
      await t.connect(port);
    } catch (err) {
      logLine(`[connect failed] ${err instanceof Error ? err.message : String(err)}`, "err");
      return;
    }
    transport = t;
    setConnectedUi(true);
    logLine("[connected @ 115200 baud, direct WebSerial -- opening the port does not reset the board]", "");
  } else {
    const wsUrl = currentBackendWsUrl();
    const portName = el<HTMLSelectElement>("backendPortSelect").value;
    if (!portName) {
      logLine('[connect failed] choose a serial port from the list first ("⟳ ports")', "err");
      return;
    }
    const t = new BackendTransport(transportEvents);
    try {
      await t.open(wsUrl);
      await t.connectPort(portName);
    } catch (err) {
      logLine(`[connect failed] ${err instanceof Error ? err.message : String(err)}`, "err");
      try {
        await t.disconnect();
      } catch {
        // best-effort cleanup of a half-open socket -- not worth its own error path
      }
      return;
    }
    transport = t;
    setConnectedUi(true);
    logLine(`[connected @ 115200 baud via backend -- ${wsUrl}, port ${portName}]`, "");
  }

  // Actively ask for a fresh HELLO rather than passively hoping one
  // arrives (2026-09-05, real RP2040 hardware -- no reset button on the
  // Pico W): listener.py's _send_hello() only ever runs once, at boot,
  // so a board that's been running a while already sent its one HELLO
  // long before this connection existed -- a purely passive wait here
  // would only ever catch one from a board that happens to be mid-boot
  // at the exact moment Connect was clicked. HELLO_REQUEST
  // (messages.ts) gets to a known state without a reset -- explicitly no
  // side effects beyond that (no redeploy, no runtime reload). Start
  // waiting before sending, not after, so a fast reply can't race past
  // this listener being registered. Identical for both connection modes
  // -- transport.send() doesn't care which one is live.
  const helloP = waitForMessage((m) => m.type === "HELLO", HELLO_WAIT_MS);
  try {
    await transport.send({ type: "HELLO_REQUEST" });
  } catch {
    // send() failing here just means the wait below times out the normal
    // way below -- not worth a separate error path for this.
  }
  try {
    await helloP;
  } catch {
    logLine(
      '[no HELLO received yet -- version compatibility is unverified; Deploy will proceed without the check. Try "Check status", or the board\'s listener may not be running at all (reset it if this persists)]',
      "",
    );
  }
});


el("btnCheckStatus").addEventListener("click", async () => {
  // Same HELLO_REQUEST as the Connect handler above, available any time
  // while connected -- no reset, no redeploy, just "tell me what you are
  // right now." transport.onMessage already logs the resulting HELLO (and
  // re-runs both version checks) the same way any other HELLO does.
  try {
    await transport.send({ type: "HELLO_REQUEST" });
  } catch (err) {
    logLine(`[check status failed] ${err instanceof Error ? err.message : String(err)}`, "err");
  }
});

el("btnDisconnect").addEventListener("click", async () => {
  await transport.disconnect();
  setConnectedUi(false);
});

const DEPLOY_TIMEOUT_MS = 30000; // comfortably exceeds listener.py's own READ_TIMEOUT_S=8 across a few internal phases

el("btnDeploy").addEventListener("click", async () => {
  const btn = el<HTMLButtonElement>("btnDeploy");
  btn.disabled = true;
  clearNodeHighlights(); // stale red from a previous failed attempt shouldn't linger past a new one
  clearNodeStatuses(); // Mike's "clear all statuses on every redeploy" call -- same staleness reasoning, one state field over
  try {
    // Gate the attempt itself, before any compile work -- §5's own
    // framing for why this check exists. Soft on absence (no HELLO seen
    // this connection -- proceed, warned), hard on a real mismatch (a
    // HELLO reporting an incompatible major version -- refuse outright).
    // See the "WebSerial connect / deploy" section header for why
    // absence is common and not itself a red flag.
    if (lastHelloVersion) {
      const decision = decideDeploy(lastHelloVersion, EDITOR_TARGET_VERSION);
      if (!decision.allowed) {
        logLine(`[deploy blocked -- version mismatch] ${decision.reason}`, "err");
        return;
      }
    } else {
      logLine("[deploying without a version check -- no HELLO received this connection]", "");
    }

    const preview = refreshPreview();
    if ("error" in preview) {
      logLine(`[compile error] ${preview.error}`, "err");
      return;
    }

    await mpyReadyPromise;

    let mpyBytes: Uint8Array;
    try {
      mpyBytes = compileToMpy(preview.source);
    } catch (err) {
      logLine(`[mpy-cross error] ${err instanceof Error ? err.message : String(err)}`, "err");
      highlightNodeFromMpyError(mpyStderrLines.join("\n"));
      return;
    }
    logLine(`[compiled -- ${mpyBytes.length} bytes of bytecode]`, "");

    // Flow identity (2026-09-05, "flow identity" -- decisions.md): a
    // fresh id every single Deploy click, deliberately not reused even
    // for a redeploy of the identical unchanged flow -- this identifies
    // *this deploy action*, not the flow itself (flowName, read from the
    // input, is the stable half). See messages.ts's DeployMessage doc
    // comment for the full reasoning.
    const deployId = crypto.randomUUID();
    const flowName = currentFlowNameInput();
    logLine(`[deploying "${flowName}" as ${deployId}]`, "");
    const ackP = waitForMessage((m) => m.type === "DEPLOY_ACK" || m.type === "DEPLOY_ERROR", DEPLOY_TIMEOUT_MS);
    await transport.send({ type: "DEPLOY", bytecode: mpyBytes, staticData: new Uint8Array(0), flowName, deployId });
    try {
      const result = await ackP;
      if (result.type === "DEPLOY_ERROR") {
        logLine(`[deploy failed] ${result.code}: ${result.message}`, "err");
      } else {
        logLine("[deploy OK -- flow is running on the device]", "ok");
        // Only the real success path marks the button clean (Mike's ask,
        // 2026-09-09) -- a DEPLOY_ERROR or a timeout below both mean the
        // device does NOT have this flow running, so the button must stay
        // available to retry, not go stale-disabled on a failed attempt.
        deployedClean = true;
      }
    } catch {
      logLine(`[deploy timeout] no DEPLOY_ACK/DEPLOY_ERROR within ${DEPLOY_TIMEOUT_MS}ms`, "err");
    }
  } finally {
    updateDeployButtonEnabled();
  }
});

if (!("serial" in navigator)) {
  // Only "Direct" mode needs navigator.serial -- "Via backend" (the
  // default per Mike's 2026-09-07 call) works in any browser that can
  // open a WebSocket, so Connect itself stays enabled; only the Direct
  // option is disabled, and the mode select is forced off it if it
  // somehow started there (e.g. a saved/bookmarked page state).
  const directOption = el<HTMLOptionElement>("connModeOptionDirect");
  directOption.disabled = true;
  directOption.textContent += " (unavailable in this browser)";
  if (currentConnMode() === "direct") {
    el<HTMLSelectElement>("connModeSelect").value = "backend";
    updateConnModeUi();
  }
  logLine('[Web Serial API not available in this browser -- "Direct" mode is disabled; use "Via backend" instead]', "");
}
