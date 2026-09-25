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
import { WIFI_CONFIG_TYPE, computeWifiProvisionMarker, normalizeWifiConfigs } from "../node-library/wifi-status.js";
import { buildRegistry } from "../node-library/registry.js";
import { mergeCustomNodeRegistry } from "../node-library/custom-node.js";
import { WebSerialTransport, type WebSerialPort, type DeviceTransport, type TransportEvents } from "../protocol/transport.js";
import { BackendTransport, InstallRuntimeError, NetworkConnectError, type NetworkBoardInfo, type SerialPortInfo } from "../protocol/backend-transport.js";
import {
  MANUAL_NETWORK_VALUE,
  hostnameProblem,
  networkOptionLabel,
  networkOptionValue,
  parseNetworkAddress,
  parsePortSelection,
  passwordProblem,
  wifiReadiness,
} from "./network-choice.js";
import { choosePort, isUsbPort } from "./port-choice.js";
import {
  DOC_BOARD_STUCK,
  DOC_COMMANDS,
  classifyDebugLines,
  explainInstallFailure,
  explainNoHello,
  localDocUrl,
  type Advice,
  type DocLink,
} from "./board-diagnosis.js";
import { explainBackendConnectError } from "./connect-error-help.js";
import { NATIVE_ARCH_OPTIONS, inferNativeArch } from "./native-arch.js";
import { BUILTIN_DEFINITION_FILES } from "../definitions/builtin.js";
import { buildDefinitionSet, userDefinitionFiles, type DefinitionSet } from "../definitions/definitions.js";
import { choiceForConnectedBoard, resolveTarget, type TargetResolution } from "../definitions/target.js";
import type { BoardSettingsResultMessage, HelloMessage, Message, NodeStatusMessage, ProtocolVersion } from "../protocol/messages.js";
import { checkRuntimeBuild, decideDeploy } from "../protocol/version.js";
import { ClassicPreset } from "rete";
import { createThingstudioEditor, type ThingstudioEditor } from "./rete/editor-setup.js";
import { NODE_FACTORIES, CustomNode, FunctionNode, portSocket, functionOutputKey, functionNodeHeight, type AnyThingstudioNode } from "./rete/nodes.js";
import { functionNode as functionNodeDefinition } from "../node-library/function-node.js";
import { DRAG_MIME, CUSTOM_DRAG_MIME, type NodeKind } from "./rete/palette.js";
import { toGraphData, socketIndex } from "./rete/graph-adapter.js";
import { CONFIG_TYPES } from "./rete/config-types.js";
import { propertyVersion, configsVersion, configs as configsStore, replaceAllConfigs, clearConfigs, backendWsUrl, fireInjectNode, updateConfig, activeTarget } from "./rete/store.js";
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
import { DEFAULT_BACKEND_WS_URL, backendHttpBaseUrl, initialBackendWsUrl, slugifyFlowName, getCredential, putCredential, listDefinitions, type CredentialType } from "../flow-file/admin-api-client.js";
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
 * (store.ts's ConfigEntry header), so this is mostly a plain copy, not a
 * translation.
 *
 * Credential storage (2026-09-13, credential-storage-design.md): a WiFi/
 * MQTT-broker config's real secret values (ssid/password, or broker/
 * port/username/password) get resolved INTO this same in-memory config
 * entry at load time (resolveConfigCredentials() below), so that
 * resolveConfig() (compile.ts) keeps working unchanged -- but that means
 * `c.properties` in memory holds MORE than what's allowed to reach disk.
 * This function is the one save-time choke point that filters back down
 * to exactly config-types.ts's own declared field names for the config's
 * type (`credentialName`/`security`, never the resolved secrets) before
 * anything gets handed to buildFlowFile() -- the actual mechanism behind
 * this design's whole point: a saved flow file never has a real ssid or
 * password in it, only a name. A config type CONFIG_TYPES doesn't
 * recognize (shouldn't happen -- every config on this canvas is one of
 * the two known types) falls back to saving properties unfiltered rather
 * than silently dropping data for a type this function doesn't
 * understand -- CLAUDE.md's fault-handling priority: fail open into "saved
 * something reasonable," not into "silently lost a field." */
function extractConfigsSnapshot(): FlowFileConfig[] {
  return [...configsStore.value.values()].map((c) => {
    const descriptor = CONFIG_TYPES[c.type];
    if (!descriptor) return { id: c.id, type: c.type, properties: c.properties };
    const allowedNames = new Set(descriptor.fields.map((f) => f.name));
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(c.properties)) {
      if (allowedNames.has(key)) filtered[key] = value;
    }
    return { id: c.id, type: c.type, properties: filtered };
  });
}

/** The reverse direction: after a flow loads, every WiFi/MQTT-broker
 * config on the canvas holds only `{credentialName, ...}` (whatever
 * survived extractConfigsSnapshot()'s filter above) -- no real ssid/
 * password. This walks them and resolves each named credential from the
 * backend (admin-api-client.ts's getCredential()), merging the real
 * values into that config's own in-memory properties via updateConfig()
 * -- the same store mutation ConfigRefField.vue's own saveEdit() uses, so
 * resolveConfig() (compile.ts) sees a fully-populated config exactly as
 * if the values had been typed in directly, with zero changes to that
 * function's own contract.
 *
 * Fetches once, right after load, not per-compile (credential-storage-
 * design.md's "decided" #4) -- keeps compile.ts's resolveConfig() fully
 * synchronous. An empty `credentialName` (a freshly-created, not-yet-
 * filled-in config, or -- for WiFi specifically -- an intentionally blank
 * "unmanaged" config, wifi-status.ts's own header) is skipped, not an
 * error: resolveWifiCredentials()/resolveMqttBrokerConfig() already
 * handle an unresolved config with their own attributed CompileErrors at
 * compile time, so there's nothing this function needs to guess at ahead
 * of time. A resolution failure (backend unreachable, or the named
 * credential no longer exists) is a clear, attributed console line naming
 * the config id and credential name that failed -- not a silent empty
 * value reaching the compiler (this project's standing fault-handling
 * priority; matches wifi-status.ts's/mqtt-shared.ts's own loud-CompileError
 * posture for a missing config reference, one level up). */
// Which credential name each config's values were last fetched for. 2026-09-24, real ESP32-C3: picking
// a saved credential from a WiFi dropdown only set `credentialName` -- values were fetched on flow
// load only -- so the compiler saw a config with no SSID and silently emitted no connect() call.
// Now a changed name is fetched as soon as it's picked (the configsVersion watch below), and every
// Deploy re-fetches all of them (a credential's values may have been edited since).
const resolvedCredentialNames = new Map<string, string>();

async function resolveConfigCredentials(onlyChanged = false): Promise<void> {
  const credentialTypeByConfigType: Record<string, CredentialType> = {
    "thingstudio/config/wifi": "wifi",
    "thingstudio/config/mqtt-broker": "mqtt-broker",
  };
  for (const cfg of [...configsStore.value.values()]) {
    const credentialType = credentialTypeByConfigType[cfg.type];
    if (!credentialType) continue;
    const name = typeof cfg.properties.credentialName === "string" ? cfg.properties.credentialName : "";
    if (!name) continue;
    if (onlyChanged && resolvedCredentialNames.get(cfg.id) === name) continue;
    try {
      const data = await getCredential(backendWsUrl.value, credentialType, name);
      updateConfig(cfg.id, data);
      resolvedCredentialNames.set(cfg.id, name);
    } catch (err) {
      logLine(
        `[load: could not resolve ${credentialType} credential "${name}" for config ${cfg.id}] ${err instanceof Error ? err.message : String(err)}`,
        "err",
      );
    }
  }
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
  // One WiFi config per flow (2026-09-25, wifi-status.ts's normalizeWifiConfigs()): a flow saved before
  // that may have several -- keep the one in use, drop the rest, and say which.
  const wifi = normalizeWifiConfigs(file.nodes, file.configs);
  if (wifi.dropped.length > 0) {
    file = { ...file, nodes: wifi.nodes, configs: wifi.configs };
    const name = (c: { id: string; properties: Record<string, unknown> }) =>
      typeof c.properties.credentialName === "string" && c.properties.credentialName ? `"${c.properties.credentialName}"` : `#${c.id.slice(0, 6)}`;
    const kept = wifi.configs.find((c) => c.type === WIFI_CONFIG_TYPE);
    logLine(
      `[load] a flow now has one WiFi network, shared by every WiFi node: kept ${kept ? name(kept) : "?"}, ` +
        `removed ${wifi.dropped.map(name).join(", ")}. Save the flow to keep this.`,
      "",
    );
  }
  replaceAllConfigs(file.configs.map((c) => ({ id: c.id, type: c.type, properties: c.properties })));
  // Credential storage (2026-09-13): resolve every WiFi/MQTT-broker
  // config's credentialName into real values before any node gets
  // constructed below -- a node's own PropertyPanel.vue block may read a
  // referenced config's properties as soon as it's selected, so the
  // resolved values need to already be in the store by then, same
  // ordering reason the configs-before-nodes comment above already gives.
  await resolveConfigCredentials();
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

/** URL of a docs page on the backend's locally served copy (docs_site.py) -- works offline. Falls
 * back to the site root on a malformed backend URL rather than throwing out of an error path. */
function docUrl(doc: DocLink): string {
  let base: string;
  try {
    base = backendHttpBaseUrl(currentBackendWsUrl());
  } catch {
    base = backendHttpBaseUrl(DEFAULT_BACKEND_WS_URL);
  }
  return localDocUrl(base, doc);
}

/** logLine() for board-diagnosis.ts advice: the text, then a clickable link to the docs page it
 * refers to, opened in a new tab. */
function logAdvice(prefix: string, advice: Advice, cls: "ok" | "err" | ""): void {
  logLine(`${prefix} ${advice.text}`, cls);
  if (!advice.doc) return;
  const msgSpan = consoleEl.lastElementChild?.querySelector("span:last-child");
  if (!msgSpan) return;
  const a = document.createElement("a");
  a.href = docUrl(advice.doc);
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = advice.doc.label;
  msgSpan.append(" Help: ", a);
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

// mpy-cross's native-code emitter (what actually compiles a
// `@micropython.viper`/`@micropython.native`-decorated function to real
// machine code, as opposed to portable bytecode) needs an explicit
// `-march=<arch>` target -- omitted entirely until 2026-09-18, then
// hardcoded to one global "xtensawin" constant, then made board-aware
// 2026-09-22 (MVP item 3, mvp-kickoff-brief.md): the single-constant
// version was itself wrong for ESP32-C3 (a RISC-V core, not Xtensa,
// despite the family name) and had no way to target RP2040/RP2350 at
// all. See native-arch.ts's own header for the full reasoning, the real
// arch list read out of the vendored mpy-cross.wasm, and which mappings
// are confirmed vs. a best-effort guess pending real-hardware
// verification. inferNativeArch() there is this function's replacement;
// currentNativeArch() below adds the manual-override layer on top of it.

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

function compileToMpy(source: string, march: string): Uint8Array {
  if (!MpyModule) throw new Error("mpy-cross not ready yet");
  mpyStderrLines = [];
  MpyModule.FS.writeFile("/in.py", source);
  try {
    MpyModule.FS.unlink("/out.mpy");
  } catch {
    // no previous output to remove -- fine
  }
  const exitCode = MpyModule.callMain(["-march=" + march, "-o", "/out.mpy", "/in.py"]);
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

// wifi_provision.py's own boot-time marker (wifi-provisioning-captive-portal.md, 2026-09-14) --
// stashed here the same way lastNodeLineRanges is just above (not threaded through
// refreshPreview()'s own return value), computed once per compile and read back by the Deploy
// handler's transport.send({type: "DEPLOY", ...}) call further down this file. null for every flow
// that doesn't reference an "unmanaged" WiFi config -- see computeWifiProvisionMarker's own doc
// comment (wifi-status.ts) for why this is computed here, alongside compile(), rather than inside
// compile.ts itself.
let lastWifiProvision: { selfProvision: boolean; allowReprovision: boolean } | null = null;

// Non-fatal pin warnings from the most recent successful compile (definitions/pin-check.ts) --
// stashed the same way as lastNodeLineRanges, shown in the preview and logged on Deploy.
let lastCompileWarnings: string[] = [];

function currentSource(): string {
  const graphData = toGraphData(reteEditor, [...configsStore.value.values()]);
  // mergeCustomNodeRegistry throws (CustomNodeDescriptorError) if two
  // loaded custom packages collide on the same type id -- allowed to
  // propagate out to refreshPreview()'s existing catch below, which
  // already turns any thrown Error from this function into a visible
  // "COMPILE ERROR: ..." in the source preview panel; no special-casing
  // needed here for that to be comprehensible.
  const registry = mergeCustomNodeRegistry(builtInRegistry, listCustomNodeDefinitions());
  const { source, nodeLineRanges, warnings } = compile(graphData, registry, { target: activeTarget.value });
  lastNodeLineRanges = nodeLineRanges;
  lastCompileWarnings = warnings;
  lastWifiProvision = computeWifiProvisionMarker(graphData);
  return source;
}

function refreshPreview(): { source: string } | { error: string } {
  try {
    const source = currentSource();
    // Warnings go after the source, as comments, so line numbers in the preview still match
    // the compiled source's own.
    el("source-preview").textContent =
      lastCompileWarnings.length === 0 ? source : `${source}\n\n${lastCompileWarnings.map((w) => `# WARNING: ${w}`).join("\n")}\n`;
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
/** True between "Stop flow & open prompt" and "Restart Thingstudio" (or a disconnect) -- see the
 * command-box section at the end of this file. Declared up here because updateDeployButtonEnabled()
 * reads it and can run during startup. */
let boardAtPrompt = false;

function updateDeployButtonEnabled(): void {
  el<HTMLButtonElement>("btnDeploy").disabled = !transport.isConnected || deployedClean || boardAtPrompt;
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
// A config changed (picked, created, or its credential swapped): fetch any newly chosen credential's
// values, then recompile the preview. updateConfig() bumps configsVersion again, but the second pass
// finds nothing changed, so this settles.
watch(configsVersion, async () => {
  await resolveConfigCredentials(true);
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
// 2.0.0 (2026-09-23): EXEC, STOP_TO_PROMPT, safe mode. Must match listener.py's _RUNTIME_VERSION.
const EDITOR_TARGET_VERSION: ProtocolVersion = { major: 4, minor: 0, patch: 0 }; // 4.0.0 2026-09-25: mqtt_as guard, ESP32 MQTT joins WiFi first; 3.0.0 2026-09-24: WiFi transport, SET_BOARD_SETTINGS

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

// Same lifecycle as lastHelloVersion (set/reset at the same three call
// sites, deliberately not merged into one object -- they're read by
// unrelated code paths and this keeps each independently greppable).
// Feeds native-arch.ts's inferNativeArch() for the Deploy handler's
// board-aware mpy-cross -march choice (currentNativeArch(), below).
let lastHelloChipType: string | null = null;
// The whole last HELLO (WiFi transport, 2026-09-24): Board settings… reads the hostname and whether a
// password is set from it. Cleared on disconnect.
let lastHello: HelloMessage | null = null;
// Addresses typed into "WiFi address…", kept in the port menu across "⟳ ports" refreshes.
const manualNetworkTargets = new Map<string, string>(); // option value -> label
// What the last "⟳ ports" probe said about each WiFi board, by option value. Used to explain a failed
// connect ("no password set") -- never to block one, since it may be stale by the time Connect is clicked.
const discoveredBoards = new Map<string, NetworkBoardInfo>();
// Plain text lines the board has printed since the last HELLO_REQUEST (Connect or Check status) --
// board-diagnosis.ts's classifyDebugLines() input when no HELLO comes back. Capped: only the first
// few lines after a request say anything about what's on the board.
let debugLinesSinceRequest: string[] = [];
const DEBUG_LINES_KEPT = 50;

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
      if (message.safeMode) {
        logAdvice(
          "[safe mode]",
          {
            text:
              "The board's saved flow kept crashing it on start, so it hasn't been run this time. Fix the flow " +
              "and deploy again, or click \"Remove flow…\".",
            doc: DOC_BOARD_STUCK,
          },
          "err",
        );
      }
      lastHelloVersion = message.runtimeVersion;
      lastHelloChipType = message.chipType;
      const boardSelect = el<HTMLSelectElement>("boardSelect");
      const after = choiceForConnectedBoard(definitions, boardSelect.value || "auto", message.chipType);
      if (after.note) {
        boardSelect.value = after.choice;
        logLine(`[board] ${after.note}`, "");
      }
      logTargetResolution(updateActiveTarget());
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
      lastHello = message;
      logWifiStatus(message);
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
    if (!line.startsWith("[backend]") && debugLinesSinceRequest.length < DEBUG_LINES_KEPT) {
      debugLinesSinceRequest.push(line);
    }
  },
  onDisconnect(reason) {
    logLine(`[disconnected] ${reason ? String(reason) : "(clean)"}`, "");
    lastHello = null;
    lastHelloVersion = null;
    lastHelloChipType = null;
    updateActiveTarget();
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
  // Only the applicable one is shown (2026-09-23 top-bar tidy-up) -- two buttons with one always
  // greyed out was just clutter. `disabled` kept in step too, belt and braces.
  el<HTMLButtonElement>("btnConnect").disabled = connected;
  el<HTMLButtonElement>("btnConnect").hidden = connected;
  el<HTMLButtonElement>("btnDisconnect").disabled = !connected;
  el<HTMLButtonElement>("btnDisconnect").hidden = !connected;
  el<HTMLButtonElement>("btnCheckStatus").disabled = !connected;
  el<HTMLButtonElement>("btnCheckStatus").hidden = !connected;
  if (!connected) {
    boardAtPrompt = false;
    lastHello = null;
  }
  updateBoardSettingsButton();
  updateBoardToolsUi();
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

/** Resolves the mpy-cross `-march` to compile with -- MVP item 3
 * (mvp-kickoff-brief.md), reads nativeArchSelect (index.html): "auto"
 * (the default) infers from the connected board's HELLO via
 * native-arch.ts's inferNativeArch(), any other value is the user's own
 * explicit override and always reported `confirmed: true` -- a person who
 * picked a specific arch by hand isn't being "guessed at" the way Auto's
 * fallback is. Auto with no HELLO seen yet this connection (lastHelloChipType
 * still null -- Deploy is allowed to proceed without one, see the version-
 * check comment above) infers from "", which native-arch.ts's fallback
 * resolves the same unconfirmed way as any other unrecognized board. */
function currentNativeArch(): { arch: string; confirmed: boolean; manual: boolean } {
  const selected = el<HTMLSelectElement>("nativeArchSelect").value;
  if (selected === "auto") {
    // The target's processor definition (MVP item 4) when there is one; otherwise native-arch.ts's
    // own chipType heuristic, which also knows chips no definition covers yet (ESP32-C6).
    const processor = activeTarget.value?.processor;
    if (processor) return { arch: processor.nativeArch, confirmed: processor.nativeArchConfirmed, manual: false };
    const guess = inferNativeArch(lastHelloChipType ?? "");
    return { ...guess, manual: false };
  }
  return { arch: selected, confirmed: true, manual: true };
}

// Populates nativeArchSelect's real options from NATIVE_ARCH_OPTIONS
// (native-arch.ts) once, at startup -- index.html only hardcodes the
// static "Auto" option itself, so this list has exactly one source of
// truth rather than drifting between the .ts file and the markup the way
// CORE_FILES/VENDOR_FILES used to (runtime_manifest.py's own header).
for (const opt of NATIVE_ARCH_OPTIONS) {
  const optionEl = document.createElement("option");
  optionEl.value = opt.value;
  optionEl.textContent = opt.label;
  el("nativeArchSelect").appendChild(optionEl);
}

// ---------------------------------------------------------------------
// Processor and board definitions (MVP item 4, docs/working-notes/decisions/chip-board-definitions.md)
// ---------------------------------------------------------------------
// Built-ins ship with the editor; the user's own ~/.thingstudio/processors/ and boards/ files come
// from the backend and are merged on top by id. Every invalid file is logged, never skipped quietly.
// The Board menu picks the target by hand; "Auto" follows the connected board's HELLO.

let definitions: DefinitionSet = buildDefinitionSet(BUILTIN_DEFINITION_FILES, []);

function populateBoardSelect(): void {
  const select = el<HTMLSelectElement>("boardSelect");
  const previous = select.value || "auto";
  select.replaceChildren();
  const add = (parent: HTMLElement, value: string, text: string, disabled = false): void => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    o.disabled = disabled;
    parent.appendChild(o);
  };
  add(select, "auto", "Board: Auto");
  const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name);
  const boards = document.createElement("optgroup");
  boards.label = "Boards";
  for (const b of [...definitions.boards.values()].sort(byName)) add(boards, `board:${b.id}`, b.name);
  const processors = document.createElement("optgroup");
  processors.label = "Processor only";
  for (const p of [...definitions.processors.values()].sort(byName)) add(processors, `processor:${p.id}`, `${p.name} (any board)`);
  select.append(boards, processors);
  if (definitions.problems.length > 0) {
    const bad = document.createElement("optgroup");
    bad.label = "Invalid files (see console)";
    for (const p of definitions.problems) add(bad, "", `${p.source}`, true);
    select.appendChild(bad);
  }
  // Keep the user's pick across a reload; a pick that vanished is kept as a value resolveTarget()
  // reports on, rather than silently snapping back to Auto.
  select.value = previous;
  if (select.value !== previous) add(select, previous, `${previous} (no longer defined)`);
  select.value = previous;
}

/** Recomputes the target from the Board menu and the last HELLO, publishes it for PropertyPanel,
 * and recompiles the preview against it. */
function updateActiveTarget(): TargetResolution {
  const select = el<HTMLSelectElement>("boardSelect");
  const choice = select.value || "auto";
  const resolution = resolveTarget(definitions, choice, lastHelloChipType);
  activeTarget.value = resolution.target;
  // Show what Auto found in the menu itself (Mike, 2026-09-24) by relabelling the Auto option, not by
  // selecting the board: a real selection would become a manual pick and stop following the next board.
  const autoOption = select.querySelector<HTMLOptionElement>('option[value="auto"]');
  if (autoOption) {
    autoOption.textContent =
      choice !== "auto"
        ? "Board: Auto"
        : resolution.target
          ? `Auto: ${resolution.target.board?.name ?? `${resolution.target.processor.name} (any board)`}`
          : lastHelloChipType
            ? "Auto: unknown board"
            : "Board: Auto";
  }
  select.title = resolution.note;
  updateNativeArchLabel();
  refreshPreview();
  return resolution;
}

/** Same idea for the Native arch menu: its Auto option shows the arch Auto would use ("Arch: xtensawin"). */
function updateNativeArchLabel(): void {
  const select = el<HTMLSelectElement>("nativeArchSelect");
  const autoOption = select.querySelector<HTMLOptionElement>('option[value="auto"]');
  if (!autoOption) return;
  if (select.value !== "auto") {
    autoOption.textContent = "Arch: Auto";
    return;
  }
  const arch = currentNativeArch();
  const known = activeTarget.value !== null || lastHelloChipType !== null;
  autoOption.textContent = known ? `Arch: ${arch.arch}${arch.confirmed ? "" : " (unverified)"}` : "Arch: Auto";
}
el("nativeArchSelect").addEventListener("change", updateNativeArchLabel);

function logTargetResolution(resolution: TargetResolution): void {
  logLine(`[board] ${resolution.note}`, resolution.target ? "ok" : "");
  if (resolution.mismatch) logLine(`[board] ${resolution.mismatch}`, "err");
}

// What the last load reported, so reloading on every Connect/Deploy only logs what changed.
let lastDefinitionsReport = "";

async function loadUserDefinitions(): Promise<void> {
  let listing;
  try {
    listing = await listDefinitions(currentBackendWsUrl());
  } catch (err) {
    const line = `[definitions] using built-in boards only -- ${err instanceof Error ? err.message : String(err)}`;
    if (line !== lastDefinitionsReport) logLine(line, "");
    lastDefinitionsReport = line;
    return;
  }
  definitions = buildDefinitionSet(BUILTIN_DEFINITION_FILES, userDefinitionFiles(listing));
  const lines = [
    ...definitions.overrides.map((o) => ({ text: `[definitions] ${o.source} replaces the built-in ${o.kind} "${o.id}"`, cls: "" as const })),
    ...definitions.problems.map((p) => ({ text: `[definitions] ${p.source} is not loaded: ${p.message}`, cls: "err" as const })),
  ];
  const report = JSON.stringify(lines);
  if (report !== lastDefinitionsReport) for (const l of lines) logLine(l.text, l.cls);
  lastDefinitionsReport = report;
  populateBoardSelect();
  updateActiveTarget();
}

populateBoardSelect();
el("boardSelect").addEventListener("change", () => {
  logTargetResolution(updateActiveTarget());
  deployedClean = false;
  updateDeployButtonEnabled();
});

/** Shows/hides the "via backend" controls (URL, port picker, refresh) --
 * a UI convenience only. The actual explicit choice design doc §4 asks for
 * is connModeSelect's own value; nothing here infers or defaults the mode
 * from the environment (e.g. whether a backend happens to be reachable). */
function updateConnModeUi(): void {
  const backend = currentConnMode() === "backend";
  // Only the Vite dev server needs a settable backend URL; when the backend serves the page, the
  // URL is the page's own origin (initialBackendWsUrl, below). 2026-09-23 top-bar tidy-up.
  el("backendUrlInput").hidden = !backend || !import.meta.env.DEV;
  el("backendPortSelect").hidden = !backend;
  el("btnRefreshPorts").hidden = !backend;
  el("btnInstallRuntime").hidden = !backend;
}
el("connModeSelect").addEventListener("change", updateConnModeUi);
updateConnModeUi();

// Start from wherever this page was served (the backend, normally) -- see initialBackendWsUrl().
el<HTMLInputElement>("backendUrlInput").value = initialBackendWsUrl(import.meta.env.DEV, window.location);

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

// The user's own board/processor files. Read again on Connect and on Deploy, so an edit made in a
// text editor takes effect without reloading the page.
void loadUserDefinitions();

/** Populates backendPortSelect from the backend's own list_ports control
 * message. Uses a short-lived BackendTransport just for this one
 * request/response, torn down immediately after -- deliberately not the
 * same instance the Connect handler below opens for the real session, so
 * listing ports never requires already being (or staying) connected to a
 * device.
 *
 * Also runs once on page load (2026-09-23, Mike's call). It used to be
 * click-only because the page could load before any backend was running;
 * now the backend serves the page, so it's there. Under the Vite dev server
 * it may not be -- then the list says so and one console line says what to
 * do, rather than an error. USB devices are listed first, and a lone USB
 * device is pre-selected (port-choice.ts). */
async function refreshBackendPorts(onLoad = false): Promise<void> {
  const select = el<HTMLSelectElement>("backendPortSelect");
  const previous = select.value;
  const wsUrl = currentBackendWsUrl();
  select.innerHTML = '<option value="">(loading…)</option>';
  const probe = new BackendTransport({ onDebugLine: (line) => logLine(`[backend] ${line}`, "") });
  try {
    await probe.open(wsUrl);
    const ports: SerialPortInfo[] = await probe.listPorts();
    const choice = choosePort(ports, previous);
    select.innerHTML = "";
    // The placeholder's text depends on what WiFi discovery finds, which comes later: it says
    // "looking" until then, and is rewritten once the WiFi boards are in (2026-09-25 -- it used to be
    // fixed before discovery, so two boards found on WiFi still showed "no board found").
    const hasUsb = choice.ordered.some(isUsbPort);
    let prompt: HTMLOptionElement | null = null;
    if (!choice.selected) {
      prompt = document.createElement("option");
      prompt.value = "";
      prompt.textContent = hasUsb ? "(choose your board)" : "(looking for boards on WiFi…)";
      select.appendChild(prompt);
    }
    if (choice.ordered.length > 0) {
      for (const p of choice.ordered) {
        const opt = document.createElement("option");
        opt.value = p.device;
        opt.textContent = p.description ? `${p.device} -- ${p.description}` : p.device;
        select.appendChild(opt);
      }
      select.value = choice.selected;
    }
    // WiFi transport (2026-09-24): boards on the network go in their own group, filled in when the
    // probe answers (about 1.5 s) so the serial ports show straight away.
    const wifiGroup = document.createElement("optgroup");
    wifiGroup.label = "WiFi";
    for (const [value, label] of manualNetworkTargets) addOption(wifiGroup, value, label);
    addOption(wifiGroup, MANUAL_NETWORK_VALUE, "WiFi address…");
    select.appendChild(wifiGroup);
    if (manualNetworkTargets.has(previous)) select.value = previous;
    if (choice.selected && choice.selected !== previous) {
      logLine(`[ports] found a board on ${choice.selected} -- click "Connect"`, "");
    } else if (!choice.ordered.some(isUsbPort)) {
      logLine('[ports] no USB board found. Plug one in, then click "⟳ ports".', "");
    }
    let boards: NetworkBoardInfo[] = [];
    try {
      boards = await probe.discoverBoards();
    } catch {
      boards = []; // an older backend without discovery, or it went away: just no WiFi list
    }
    const manualOption = wifiGroup.lastElementChild;
    discoveredBoards.clear();
    for (const b of boards) discoveredBoards.set(networkOptionValue(b), b);
    for (const b of boards) {
      const value = networkOptionValue(b);
      if (manualNetworkTargets.has(value)) continue;
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = networkOptionLabel(b);
      wifiGroup.insertBefore(opt, manualOption);
    }
    if (boards.some((b) => networkOptionValue(b) === previous)) select.value = previous;
    const ready = boards.filter((b) => b.wifiTransport && !b.busy);
    if (boards.length > 0) {
      logLine(`[ports] ${boards.length} board${boards.length === 1 ? "" : "s"} found on WiFi: ${boards.map((b) => b.hostname).join(", ")}`, "");
    }
    if (!select.value && ready.length === 1) {
      select.value = networkOptionValue(ready[0]!);
      logLine(`[ports] no USB board, so ${ready[0]!.hostname} on WiFi is selected -- click "Connect"`, "");
    }
    if (prompt && !hasUsb) {
      prompt.textContent =
        boards.length > 0 ? "(choose your board)" : "(no board found -- plug one in, or check its WiFi)";
    }
  } catch (err) {
    select.innerHTML = '<option value="">(backend not running)</option>';
    const detail = err instanceof Error ? err.message : String(err);
    if (onLoad) {
      logLine(`[ports] no backend at ${wsUrl} -- start it with "thingstudio-backend", then click "⟳ ports".`, "err");
    } else {
      logLine(`[list ports failed] ${detail}`, "err");
    }
  } finally {
    await probe.disconnect();
  }
}
el("btnRefreshPorts").addEventListener("click", () => void refreshBackendPorts());

function addOption(parent: HTMLElement, value: string, label: string): void {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  parent.appendChild(opt);
}

// --- WiFi transport (MVP item 6, 2026-09-24) -------------------------------------------------
// docs/working-notes/wifi-transport-scoping.md. The backend does the network work (tcp_relay.py);
// this is the UI: WiFi boards in the port menu, a typed address, the board password when the backend
// has none saved, and Board settings… (hostname and password, over USB only).

let portSelectPrevious = "";
el("backendPortSelect").addEventListener("focus", () => {
  portSelectPrevious = el<HTMLSelectElement>("backendPortSelect").value;
});
el("backendPortSelect").addEventListener("change", async () => {
  const select = el<HTMLSelectElement>("backendPortSelect");
  if (select.value !== MANUAL_NETWORK_VALUE) {
    portSelectPrevious = select.value;
    const board = discoveredBoards.get(select.value);
    if (board && !board.wifiTransport) logLine(noPasswordHelp(board.hostname), "err");
    return;
  }
  const target = await askNetworkAddress();
  if (!target) {
    select.value = portSelectPrevious;
    return;
  }
  const value = `net:${target.host}:${target.tcpPort}`;
  const label = `${target.host}${target.tcpPort === 7462 ? "" : `:${target.tcpPort}`} -- WiFi`;
  if (!manualNetworkTargets.has(value)) {
    manualNetworkTargets.set(value, label);
    const manual = select.querySelector(`option[value="${MANUAL_NETWORK_VALUE}"]`);
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    manual?.parentElement?.insertBefore(opt, manual);
  }
  select.value = value;
  portSelectPrevious = value;
});

/** Resolves with the dialog's return value once it closes ("" when dismissed with Escape). */
function dialogResult(dialog: HTMLDialogElement): Promise<string> {
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
  });
}

async function askNetworkAddress(): Promise<{ host: string; tcpPort: number } | null> {
  const dialog = el<HTMLDialogElement>("netAddressDialog");
  const input = el<HTMLInputElement>("netAddressInput");
  const error = el("netAddressError");
  input.value = "";
  error.textContent = "";
  const check = (e: Event) => {
    if (!parseNetworkAddress(input.value)) {
      e.preventDefault();
      error.textContent = "That isn't a network name or IP address.";
    }
  };
  el("netAddressOk").addEventListener("click", check);
  dialog.returnValue = "";
  dialog.showModal();
  const result = await dialogResult(dialog);
  el("netAddressOk").removeEventListener("click", check);
  return result === "ok" ? parseNetworkAddress(input.value) : null;
}

async function askBoardPassword(hostname: string, retry: boolean): Promise<{ password: string; remember: boolean } | null> {
  const dialog = el<HTMLDialogElement>("netPasswordDialog");
  el("netPasswordTitle").textContent = `Password for ${hostname}`;
  el("netPasswordText").textContent = retry
    ? `That password was wrong. Enter the password set for ${hostname} in Board settings.`
    : `This computer has no saved password for ${hostname}. Enter the one set in Board settings.`;
  const input = el<HTMLInputElement>("netPasswordInput");
  input.value = "";
  dialog.returnValue = "";
  dialog.showModal();
  const result = await dialogResult(dialog);
  if (result !== "ok" || !input.value) return null;
  return { password: input.value, remember: el<HTMLInputElement>("netPasswordRemember").checked };
}

function noPasswordHelp(hostname: string): string {
  return (
    `${hostname} has no WiFi password set, so it won't accept a WiFi connection. Connect it over USB, ` +
    'click "Board settings…" to set a password, then click "⟳ ports".'
  );
}

/** Explains a failed network connect in terms of what to do next (road-to-mvp.md: no silent failure).
 * `board` is what the last probe said about the target, when it was picked from the list. */
function explainNetworkConnectError(err: NetworkConnectError, host: string, board?: NetworkBoardInfo): string {
  switch (err.code) {
    case "busy":
      return `${err.message}. Only one editor can connect over WiFi at a time.`;
    case "board_no_password":
      return noPasswordHelp(err.hostname ?? board?.hostname ?? "The board");
    case "refused":
      // The board only opens its WiFi port once a password is set, so a refusal almost always means none is.
      if (board && !board.wifiTransport) return noPasswordHelp(board.hostname);
      return (
        `Connection refused by ${board?.hostname ?? host}. ` +
        'The board is on the network but not accepting WiFi connections. Has a WiFi password been set? ' +
        'Connect it over USB and use "Board settings…".'
      );
    case "timeout":
      return (
        `${err.message}. Check the board is powered, its flow uses WiFi and has joined a network, ` +
        "and this computer is on the same network. If a .local name doesn't work, try the board's IP address."
      );
    default:
      if (err.message.includes(" -- ")) return err.message; // the backend already said what to do
      return (
        `${err.message}. If the board was reset or its flow was redeployed without WiFi, it may be ` +
        "off the network -- connect over USB to check."
      );
  }
}

/** Connects `t` to a board over WiFi, asking for its password when the backend has none saved (or a
 * saved one is wrong), and saving a typed one if the user asked. Returns false after logging why. */
async function connectOverNetwork(t: BackendTransport, host: string, tcpPort: number): Promise<boolean> {
  let password: string | undefined;
  let remember = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await t.connectNetwork(host, tcpPort, password);
    } catch (err) {
      if (err instanceof NetworkConnectError && (err.code === "no_password" || err.code === "auth_failed") && err.hostname) {
        const answer = await askBoardPassword(err.hostname, err.code === "auth_failed");
        if (!answer) {
          logLine("[connect cancelled] no password entered", "");
          return false;
        }
        password = answer.password;
        remember = answer.remember;
        continue;
      }
      const board = discoveredBoards.get(networkOptionValue({ address: host, port: tcpPort }));
      logLine(`[connect failed] ${err instanceof NetworkConnectError ? explainNetworkConnectError(err, host, board) : err instanceof Error ? err.message : String(err)}`, "err");
      return false;
    }
    if (password !== undefined && remember) {
      const hostname = t.connectedHostname;
      if (hostname) await rememberBoardPassword(hostname, password);
    }
    return true;
  }
  logLine("[connect failed] too many wrong passwords", "err");
  return false;
}

async function rememberBoardPassword(hostname: string, password: string): Promise<void> {
  try {
    await putCredential(currentBackendWsUrl(), "board", hostname, { password });
  } catch (err) {
    logLine(`[board password] not saved on this computer: ${err instanceof Error ? err.message : String(err)}`, "err");
  }
}

function logWifiStatus(hello: HelloMessage): void {
  const readiness = wifiReadiness(hello, activeTarget.value?.board?.wifi ?? null);
  if (readiness === "ready") {
    logLine(
      hello.networkAddress
        ? `[wifi] ${hello.hostname} accepts WiFi connections at ${hello.networkAddress} (${hello.hostname}.local)`
        : `[wifi] ${hello.hostname} has a password set; it accepts WiFi connections while its flow is on a network`,
      "",
    );
  } else if (readiness === "no_password" && !backendTransportOrNull()?.connectedOverNetwork) {
    logLine(`[wifi] ${hello.hostname} only accepts USB until it has a password. Set one in "Board settings…".`, "");
  }
  updateBoardSettingsButton();
}

function updateBoardSettingsButton(): void {
  const btn = el<HTMLButtonElement>("btnBoardSettings");
  const hello = lastHello;
  const readiness = hello ? wifiReadiness(hello, activeTarget.value?.board?.wifi ?? null) : null;
  const show = transport.isConnected && (readiness === "ready" || readiness === "no_password");
  const overNetwork = backendTransportOrNull()?.connectedOverNetwork ?? false;
  btn.hidden = !show;
  btn.disabled = !show || overNetwork || boardAtPrompt;
  btn.title = overNetwork
    ? "Board settings can only be changed over USB."
    : "The board's network name and WiFi password. Changes are made over USB.";
}

el("btnBoardSettings").addEventListener("click", () => {
  const hello = lastHello;
  if (!hello || !hello.hostname) return;
  // Says which board is about to change: with two boards on the bench it's easy to rename the wrong one
  // (2026-09-25 -- the ESP32-C3 was renamed "picow-1").
  el("bsBoard").textContent = boardSettingsTarget(hello, el<HTMLSelectElement>("backendPortSelect").value);
  el<HTMLInputElement>("bsHostname").value = hello.hostname;
  el<HTMLInputElement>("bsPassword").value = "";
  el<HTMLInputElement>("bsConfirm").value = "";
  el<HTMLInputElement>("bsClearPassword").checked = false;
  el<HTMLInputElement>("bsClearPassword").disabled = !hello.authRequired;
  el("bsError").textContent = "";
  const dialog = el<HTMLDialogElement>("boardSettingsDialog");
  dialog.returnValue = "";
  dialog.showModal();
});

function boardSettingsTarget(hello: HelloMessage, portValue: string): string {
  const selection = parsePortSelection(portValue);
  const port = selection.kind === "serial" ? ` on ${selection.port}` : "";
  const flow = hello.currentFlowName ? `, running "${hello.currentFlowName}"` : "";
  return `Changing the ${hello.chipType} board${port}, currently named ${hello.hostname}${flow}.`;
}

el("bsSave").addEventListener("click", (e) => {
  // Validate and save before the dialog closes, so a problem is shown in it rather than lost.
  e.preventDefault();
  void saveBoardSettings();
});

async function saveBoardSettings(): Promise<void> {
  const hello = lastHello;
  const error = el("bsError");
  if (!hello || !hello.hostname) {
    error.textContent = "The board isn't connected any more.";
    return;
  }
  const hostname = el<HTMLInputElement>("bsHostname").value.trim().toLowerCase();
  const password = el<HTMLInputElement>("bsPassword").value;
  const confirm = el<HTMLInputElement>("bsConfirm").value;
  const clear = el<HTMLInputElement>("bsClearPassword").checked;
  const problem = hostnameProblem(hostname) ?? (!clear && (password || confirm) ? passwordProblem(password, confirm) : null);
  if (problem) {
    error.textContent = problem;
    return;
  }
  const newHostname = hostname !== hello.hostname ? hostname : null;
  const newPassword = !clear && password ? password : null;
  if (newHostname === null && newPassword === null && !clear) {
    el<HTMLDialogElement>("boardSettingsDialog").close("cancel");
    return;
  }
  error.textContent = "Saving…";
  const resultP = waitForMessage((m) => m.type === "BOARD_SETTINGS_RESULT", 10_000);
  try {
    await transport.send({ type: "SET_BOARD_SETTINGS", hostname: newHostname, password: newPassword, clearPassword: clear });
    const result = (await resultP) as BoardSettingsResultMessage;
    if (!result.ok) {
      error.textContent = result.error ?? "The board refused the change.";
      return;
    }
  } catch (err) {
    resultP.catch(() => undefined);
    error.textContent = `No answer from the board (${err instanceof Error ? err.message : String(err)}). Is it still connected?`;
    return;
  }
  // Keep this computer's copy of the password under the board's (possibly new) name.
  if (newPassword !== null) {
    await rememberBoardPassword(hostname, newPassword);
  } else if (newHostname !== null && hello.authRequired && !clear) {
    try {
      const saved = await getCredential(currentBackendWsUrl(), "board", hello.hostname);
      if (typeof saved.password === "string") await rememberBoardPassword(hostname, saved.password);
    } catch {
      // No saved password under the old name -- nothing to carry over.
    }
  }
  logLine(
    `[board settings] saved on the ${hello.chipType} board: name ${hostname}` +
      (clear ? ", password removed (USB only now)" : newPassword ? ", new password set" : "") +
      (newHostname ? ". The new name is used from the next time the board joins WiFi (reset it to apply now)." : ""),
    "ok",
  );
  el<HTMLDialogElement>("boardSettingsDialog").close("save");
}
void refreshBackendPorts(true);

// Backend restarts (2026-09-25, Mike: "lots of dead tabs"). This tab checks the backend is there -- every
// 5 s while it is, every second while it isn't -- and picks it back up when it returns, so restarting the
// backend doesn't leave a dead tab. The backend opens a new tab only if none checks in within a couple of
// seconds of starting (backend __main__.py). No automatic reload: the flow isn't saved anywhere else, so a
// reload would lose unsaved work.
let backendAlive = true;
async function watchBackend(): Promise<void> {
  let ok = false;
  try {
    const res = await fetch(`${backendHttpBaseUrl(currentBackendWsUrl())}/api/alive`, { cache: "no-store" });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (!ok && backendAlive) {
    logLine("[backend] stopped -- this tab reconnects by itself when it's back", "err");
  } else if (ok && !backendAlive) {
    logLine("[backend] back. If you rebuilt the editor, save your flow and reload this page to use the new build.", "ok");
    if (!transport.isConnected) void refreshBackendPorts();
  }
  backendAlive = ok;
  setTimeout(() => void watchBackend(), ok ? 5000 : 1000);
}
setTimeout(() => void watchBackend(), 5000);

el("btnDocs").addEventListener("click", () => {
  window.open(docUrl({ label: "Docs", path: "" }), "_blank", "noopener");
});

// Install runtime and Remove flow each open the serial port themselves on the backend, so two at once
// fight over the board (2026-09-24, real Pico: four clicks while the first install waited for a reset
// left four installs failing against each other). One at a time; both buttons are disabled while one
// runs. The backend refuses a second job on a busy port too (ws_relay.py's _BUSY_PORTS).
let boardJobRunning = false;

function exclusiveBoardJob(job: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (boardJobRunning) {
      logLine("[busy] an install or Remove flow is still running -- wait for it to finish", "");
      return;
    }
    boardJobRunning = true;
    el<HTMLButtonElement>("btnInstallRuntime").disabled = true;
    el<HTMLButtonElement>("btnRemoveFlow").disabled = true;
    try {
      await job();
    } finally {
      boardJobRunning = false;
      el<HTMLButtonElement>("btnInstallRuntime").disabled = false;
      el<HTMLButtonElement>("btnRemoveFlow").disabled = false;
    }
  };
}

/** Pushes a fresh device-runtime onto the selected port via the backend's
 * raw-REPL bootstrap (backend/src/thingstudio_backend/raw_repl.py +
 * runtime_installer.py, 2026-09-22) -- MVP item 1 (outstanding-items/
 * deploy-runtime-from-editor.md), for a bare board with no listener.py
 * running at all yet, so there's nothing on the other end to answer a
 * framed §13 message and no existing "connect" session to reuse. Backend-
 * relay only, same as the rest of this file's backend-mode controls --
 * updateConnModeUi() hides this button entirely in "direct" mode.
 *
 * NOT yet verified against real hardware -- see raw_repl.py's own header;
 * this session had no board available to confirm the reset/re-enumeration
 * behavior described below actually happens as expected.
 *
 * Uses its own short-lived BackendTransport (same shape as
 * refreshBackendPorts()'s probe), not the shared `transport` -- installing
 * doesn't require an existing connectPort() session (the backend closes
 * whatever it already has open on this WS connection before installing;
 * see BackendTransport.installRuntime()'s own header). If the *editor's*
 * live session happens to already hold this same port open, that's a
 * separate WS connection from the backend's point of view and its serial
 * port claim would conflict with this one -- disconnected first below, and
 * not silently: told to the user, since Deploy/Check status/Disconnect all
 * go stale for that dropped session either way. */
el("btnInstallRuntime").addEventListener("click", exclusiveBoardJob(async () => {
  const wsUrl = currentBackendWsUrl();
  const portName = el<HTMLSelectElement>("backendPortSelect").value;
  if (!portName) {
    logLine('[install runtime failed] choose a serial port from the list first ("⟳ ports")', "err");
    return;
  }
  if (parsePortSelection(portName).kind !== "serial") {
    logLine("[install runtime failed] installing the runtime needs the board on USB -- choose its serial port", "err");
    return;
  }
  if (transport.isConnected) {
    // The running listener ignores Ctrl-C, and a Pico doesn't reset when the port opens, so ask a
    // board that's still answering to stop at the prompt first -- same as "Remove flow" (2026-09-24).
    // Otherwise the backend keeps trying and asks for a reset or replug.
    if (!boardAtPrompt && lastHelloVersion !== null) {
      try {
        await transport.send({ type: "STOP_TO_PROMPT" });
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        // The backend's own wait-for-a-prompt covers this.
      }
    }
    logLine("[install runtime] disconnecting the current session first -- installing needs exclusive use of the port", "");
    await transport.disconnect();
    setConnectedUi(false);
  }
  logLine(`[install runtime] checking the board on ${portName}, then installing the runtime -- this resets the board`, "");
  const installer = new BackendTransport({ onDebugLine: (line) => logLine(`[backend] ${line}`, "") });
  try {
    await installer.open(wsUrl);
    await installer.installRuntime(
      portName,
      undefined,
      (p) => logLine(`[install runtime] ${p.index}/${p.total} ${p.file}`, ""),
      undefined,
      (text) => logLine(`[install runtime] ${text}`, ""),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const diagnosis = err instanceof InstallRuntimeError ? err.diagnosis : null;
    logAdvice("[install runtime failed]", explainInstallFailure(message, diagnosis), "err");
    return;
  } finally {
    await installer.disconnect();
  }
  // installRuntime() resolving means the backend pushed every file and
  // hard-reset the board (raw_repl.py's install_runtime()) -- the backend
  // deliberately does not auto-reconnect afterward (USB re-enumeration
  // timing after a reset isn't something to chase per board, per CLAUDE.md's
  // "make the failure legible instead" corollary), so this editor doesn't
  // either. The board is rebooting into the newly-installed listener as
  // this line prints; "⟳ ports" may need a moment before the port
  // reappears if the OS re-enumerates the device.
  logLine('[install runtime OK -- board reset into the new runtime. Click "⟳ ports" if needed, then "Connect".]', "ok");
}));

el("btnConnect").addEventListener("click", async () => {
  lastHelloVersion = null;
  lastHelloChipType = null;
  void loadUserDefinitions();
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
    const selection = parsePortSelection(portName);
    if (selection.kind === "none" || selection.kind === "manual") {
      logLine('[connect failed] choose a serial port or a WiFi board from the list first ("⟳ ports")', "err");
      return;
    }
    if (selection.kind === "network") {
      const t = new BackendTransport(transportEvents);
      try {
        await t.open(wsUrl);
      } catch (err) {
        logLine(`[connect failed] ${err instanceof Error ? err.message : String(err)}`, "err");
        return;
      }
      if (!(await connectOverNetwork(t, selection.host, selection.tcpPort))) {
        await t.disconnect().catch(() => undefined);
        return;
      }
      transport = t;
      setConnectedUi(true);
      logLine(`[connected over WiFi via backend -- ${selection.host}]`, "");
      await requestHelloOrExplain();
      return;
    }
    const t = new BackendTransport(transportEvents);
    try {
      await t.open(wsUrl);
      await t.connectPort(portName);
    } catch (err) {
      // connectPort() rejections carry the backend's own NODE_ERROR text
      // (serial_relay.py's SerialRelayError) verbatim; open() rejections
      // (backend unreachable) don't and shouldn't be pattern-matched
      // against connect-failure causes they were never meant to describe.
      const message = err instanceof Error ? err.message : String(err);
      const explained = message.startsWith("NODE_ERROR:") ? explainBackendConnectError(message) : message;
      logLine(`[connect failed] ${explained}`, "err");
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

  // Same for both connection modes -- transport.send() doesn't care which one is live.
  await requestHelloOrExplain();
});

/** Sends HELLO_REQUEST and waits up to HELLO_WAIT_MS for a HELLO. On timeout, says what the board
 * did print instead and what to do next (board-diagnosis.ts) -- road-to-mvp.md's "no silent
 * failure". Used by both Connect and Check status.
 *
 * Why actively ask rather than wait (2026-09-05, real RP2040 hardware -- no reset button on the
 * Pico W): listener.py's _send_hello() only runs once, at boot, so a board that's been running a
 * while already sent its one HELLO long before this connection existed. HELLO_REQUEST
 * (messages.ts) gets a fresh one with no side effects. The wait starts before sending, so a fast
 * reply can't race past it.
 *
 * Why the timeout message classifies instead of guessing (2026-09-23, real ESP32-S2 with no
 * MicroPython): the old fixed text sent the user to a terminal script that no longer applies and
 * never considered that MicroPython itself might be missing. A board with MicroPython but no
 * runtime echoes the framed request back as a SyntaxError (learnings/hardware-bringup-hil-rig.md,
 * 2026-09-18); a board with no MicroPython prints nothing. */
async function requestHelloOrExplain(): Promise<void> {
  debugLinesSinceRequest = [];
  const helloP = waitForMessage((m) => m.type === "HELLO", HELLO_WAIT_MS);
  try {
    await transport.send({ type: "HELLO_REQUEST" });
  } catch (err) {
    // send() failing means the wait below times out the normal way -- the send error itself is
    // still worth showing.
    logLine(`[check status failed] ${err instanceof Error ? err.message : String(err)}`, "err");
  }
  try {
    await helloP;
  } catch {
    const reply = classifyDebugLines(debugLinesSinceRequest);
    logAdvice("[no HELLO]", explainNoHello(reply), "err");
  }
}

el("btnCheckStatus").addEventListener("click", async () => {
  // Same HELLO_REQUEST as the Connect handler above, available any time
  // while connected -- no reset, no redeploy, just "tell me what you are
  // right now." transport.onMessage already logs the resulting HELLO (and
  // re-runs both version checks) the same way any other HELLO does.
  await requestHelloOrExplain();
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

    await loadUserDefinitions();
    await resolveConfigCredentials();
    logTargetResolution(updateActiveTarget());
    const preview = refreshPreview();
    if ("error" in preview) {
      logLine(`[compile error] ${preview.error}`, "err");
      return;
    }
    for (const w of lastCompileWarnings) logLine(`[compile warning] ${w}`, "");

    await mpyReadyPromise;

    // Board-aware -march (MVP item 3) -- see currentNativeArch()'s own
    // header for the auto/manual split. Logged unconditionally, not just
    // on a problem, so which arch a given Deploy actually used is always
    // visible in the console, not just inferable after the fact.
    const nativeArch = currentNativeArch();
    const usesNativeCode = /@micropython\.(viper|native)\b/.test(preview.source);
    logLine(
      `[compile] targeting mpy-cross -march=${nativeArch.arch}` +
        (nativeArch.manual
          ? " (manual override)"
          : activeTarget.value
            ? ` (auto, from the ${activeTarget.value.processor.name} definition)`
            : lastHelloChipType
              ? ` (auto-detected from "${lastHelloChipType}")`
              : " (auto, no board chipType known yet)"),
      "",
    );
    if (!nativeArch.confirmed && usesNativeCode) {
      // Only a real risk when the compiled flow actually emits native
      // code -- see native-arch.ts's header: a wrong -march is byte-
      // identical-harmless for plain bytecode, but MicroPython's .mpy
      // loader checks a native module's required arch against the
      // running device's own at import time, so a wrong guess here fails
      // on-device at Deploy/import time, not silently. Surfaced loud
      // (err-styled) specifically because this is the one case that can
      // actually bite, not just a generic "unconfirmed" footnote.
      logLine(
        `[compile] this flow uses @micropython.viper/native, and -march=${nativeArch.arch} is an unverified guess for this board -- ` +
          "if Deploy fails on-device with an arch/native-module error, pick the right value from the native arch dropdown and redeploy",
        "err",
      );
    }

    let mpyBytes: Uint8Array;
    try {
      mpyBytes = compileToMpy(preview.source, nativeArch.arch);
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
    // lastWifiProvision was computed alongside this same compile, by the currentSource() call
    // refreshPreview() (above) just made -- see that field's own doc comment.
    await transport.send({
      type: "DEPLOY",
      bytecode: mpyBytes,
      staticData: new Uint8Array(0),
      flowName,
      deployId,
      wifiProvision: lastWifiProvision,
    });
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


// --- Command box, stop to prompt, remove flow (2026-09-23) -----------------------------------------
//
// Mike: "a text box to send basic commands to the board, and outputs sent to the console", plus a way
// to reach the Python prompt without rebooting, and a way out of a flow that boot-loops the board.
// While a flow runs, commands go to the listener as EXEC (listener.py's _handle_exec prints the
// result). After "Stop flow & open prompt" (STOP_TO_PROMPT) the listener has exited, so commands go
// to MicroPython's own ">>>" prompt as raw text (ws_relay.py's raw_write), and "Restart Thingstudio"
// sends Ctrl-D. Deploy is disabled while at the prompt: nothing is listening for a DEPLOY frame.

const commandHistory: string[] = [];
let historyIndex = 0;
const RESTART_WAIT_MS = 3500; // listener.py's 3s boot window, plus a little

function updateBoardToolsUi(): void {
  const connected = transport.isConnected;
  el<HTMLInputElement>("cmdInput").disabled = !connected;
  el<HTMLButtonElement>("btnSendCmd").disabled = !connected;
  el<HTMLButtonElement>("btnStopToPrompt").disabled = !connected;
  el<HTMLButtonElement>("btnStopToPrompt").hidden = boardAtPrompt;
  el<HTMLButtonElement>("btnResume").hidden = !boardAtPrompt;
  el<HTMLInputElement>("cmdInput").placeholder = boardAtPrompt
    ? "MicroPython prompt: type a line and press Enter"
    : "Python command, e.g. gc.mem_free()";
  updateDeployButtonEnabled();
  updateBoardSettingsButton();
}
updateBoardToolsUi();

function backendTransportOrNull(): BackendTransport | null {
  return transport instanceof BackendTransport ? transport : null;
}

async function sendCommand(): Promise<void> {
  const input = el<HTMLInputElement>("cmdInput");
  const code = input.value;
  if (!code.trim()) return;
  input.value = "";
  commandHistory.push(code);
  historyIndex = commandHistory.length;
  logLine(`» ${code}`, "");
  try {
    if (boardAtPrompt) {
      const bt = backendTransportOrNull();
      if (!bt) throw new Error("the prompt needs the backend connection");
      bt.rawWrite(code + "\r");
    } else {
      await transport.send({ type: "EXEC", code });
    }
  } catch (err) {
    logLine(`[command failed] ${err instanceof Error ? err.message : String(err)}`, "err");
  }
}

el("btnSendCmd").addEventListener("click", () => void sendCommand());
el<HTMLInputElement>("cmdInput").addEventListener("keydown", (ev) => {
  const input = ev.target as HTMLInputElement;
  if (ev.key === "Enter") {
    ev.preventDefault();
    void sendCommand();
  } else if (ev.key === "ArrowUp" && historyIndex > 0) {
    ev.preventDefault();
    historyIndex -= 1;
    input.value = commandHistory[historyIndex] ?? "";
  } else if (ev.key === "ArrowDown" && historyIndex < commandHistory.length) {
    ev.preventDefault();
    historyIndex += 1;
    input.value = commandHistory[historyIndex] ?? "";
  }
});

el("btnStopToPrompt").addEventListener("click", async () => {
  try {
    await transport.send({ type: "STOP_TO_PROMPT" });
  } catch (err) {
    logLine(`[stop failed] ${err instanceof Error ? err.message : String(err)}`, "err");
    return;
  }
  boardAtPrompt = true;
  lastHelloVersion = null;
  updateBoardToolsUi();
  logAdvice(
    "[prompt]",
    {
      text:
        "Flow stopped. Commands now go straight to MicroPython's prompt. Click \"Restart Thingstudio\" " +
        "when you're done -- Deploy is off until then. A board running a runtime older than 2.0.0 ignores " +
        "this; update it with \"Install runtime…\".",
      doc: DOC_COMMANDS,
    },
    "",
  );
});

el("btnResume").addEventListener("click", async () => {
  const bt = backendTransportOrNull();
  if (!bt) return;
  try {
    bt.rawWrite("\x04"); // Ctrl-D: MicroPython soft reset -> main.py -> listener + saved flow
  } catch (err) {
    logLine(`[restart failed] ${err instanceof Error ? err.message : String(err)}`, "err");
    return;
  }
  boardAtPrompt = false;
  updateBoardToolsUi();
  logLine("[restart] restarting Thingstudio on the board (about 3 seconds)…", "");
  await new Promise((r) => setTimeout(r, RESTART_WAIT_MS));
  if (transport.isConnected) await requestHelloOrExplain();
});

el("btnRemoveFlow").addEventListener("click", exclusiveBoardJob(async () => {
  const portName = el<HTMLSelectElement>("backendPortSelect").value;
  if (!portName) {
    logLine('[remove flow failed] choose the board\'s port first ("⟳ ports")', "err");
    return;
  }
  if (parsePortSelection(portName).kind !== "serial") {
    logLine("[remove flow failed] removing a flow needs the board on USB -- choose its serial port", "err");
    return;
  }
  if (!window.confirm("Remove the saved flow from the board? The flow on your canvas isn't affected.")) return;
  if (transport.isConnected) {
    // A board that's still answering can stop at the prompt by itself, so no reset is needed.
    if (!boardAtPrompt && lastHelloVersion !== null) {
      try {
        await transport.send({ type: "STOP_TO_PROMPT" });
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        // Falls through to the reset path below -- the backend keeps trying either way.
      }
    }
    await transport.disconnect();
    setConnectedUi(false);
  }
  logLine(`[remove flow] stopping the board on ${portName}…`, "");
  const remover = new BackendTransport({ onDebugLine: (line) => logLine(`[backend] ${line}`, "") });
  try {
    await remover.open(currentBackendWsUrl());
    await remover.removeFlow(portName, (text) => logLine(`[remove flow] ${text}`, ""));
  } catch (err) {
    logAdvice(
      "[remove flow failed]",
      { text: err instanceof Error ? err.message : String(err), doc: DOC_BOARD_STUCK },
      "err",
    );
    return;
  } finally {
    await remover.disconnect();
  }
  logLine('[remove flow OK] The saved flow is gone and the board has restarted without it. Click "Connect".', "ok");
}));
