// SPDX-License-Identifier: Apache-2.0
// editor/src/app/main.ts
//
// Bare-minimum editor app shell: canvas (Litegraph, four real node types
// via nodes.ts) -> real compiler (compiler/compile.ts, the same one the
// off-device tests exercise) -> real mpy-cross WASM cross-compile
// (vendored from mpy-cross-wasm/, see editor/public/vendor/mpy-cross) ->
// real §13 DEPLOY over WebSerial (protocol/transport.ts). No save/load
// gap remains (flow-file/ is wired in below); the HELLO/version gate
// (version.ts) is now wired in too -- see the "WebSerial connect /
// deploy" section below for the caveat that shapes how it's wired (a
// device already running when Connect fires has no fresh HELLO to gate
// on, since opening a WebSerial port doesn't reset the board).

import { compile } from "../compiler/compile.js";
import type { NodeLineRange } from "../compiler/compile.js";
import type { GraphData } from "../compiler/graph.js";
import { buildRegistry } from "../node-library/registry.js";
import { WebSerialTransport, type WebSerialPort } from "../protocol/transport.js";
import type { Message, ProtocolVersion } from "../protocol/messages.js";
import { decideDeploy } from "../protocol/version.js";
import { registerCanvasNodeTypes } from "./nodes.js";
import { buildFlowFile, parseFlowFile, serializeFlowFileText, FlowFileError, type FlowFile, type FlowFileEdge, type CanvasNodeSnapshot } from "../flow-file/flow-file.js";
import { saveFlowFileToDisk, openFlowFileFromDisk } from "../flow-file/file-io.js";

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

registerCanvasNodeTypes();

// ---------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LG: any = (window as unknown as { LiteGraph: any }).LiteGraph;
const graph = new LG.LGraph();
const canvasEl = el<HTMLCanvasElement>("graph-canvas");
const canvas = new LG.LGraphCanvas(canvasEl, graph);
canvas.allow_searchbox = true;

function resize(): void {
  const wrap = el("canvas-wrap");
  canvasEl.width = wrap.clientWidth;
  canvasEl.height = wrap.clientHeight;
  canvas.resize();
}
window.addEventListener("resize", resize);
resize();
graph.start();

let placeCount = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addNode(type: string): any {
  const node = LG.createNode(type);
  const col = placeCount % 3;
  const row = Math.floor(placeCount / 3);
  node.pos = [80 + col * 220, 80 + row * 160];
  graph.add(node);
  placeCount++;
  canvas.setDirty(true, true);
  return node;
}
document.querySelectorAll<HTMLButtonElement>("[data-add-node]").forEach((btn) => {
  btn.addEventListener("click", () => addNode(btn.getAttribute("data-add-node")!));
});
el("clear-canvas").addEventListener("click", () => {
  graph.clear();
  placeCount = 0;
});

// ---------------------------------------------------------------------
// Flow save/load (flow-file/) -- the canvas-coupled half. flow-file.ts
// owns the actual format (pure, off-device testable); this is just the
// glue reading/writing a live Litegraph graph, same split transport.ts
// (protocol machinery) vs. main.ts's Connect handler (the raw
// requestPort() call) already uses.
// ---------------------------------------------------------------------
function extractCanvasSnapshot(): { nodes: CanvasNodeSnapshot[]; edges: FlowFileEdge[] } {
  // node.pos is a Float32Array-backed accessor (nodes.ts/Litegraph
  // internals), not a plain array -- JSON.stringify would emit
  // {"0":x,"1":y} instead of [x,y] without this explicit copy.
  const nodes: CanvasNodeSnapshot[] = allCanvasNodes().map((n) => ({
    id: n.id,
    type: n.type,
    properties: n.properties ?? {},
    pos: [n.pos[0], n.pos[1]],
    ...(n.size ? { size: [n.size[0], n.size[1]] as [number, number] } : {}),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const links: any[] = Object.values((graph as any).links ?? {});
  const edges: FlowFileEdge[] = links.map((l) => [l.origin_id, l.origin_slot, l.target_id, l.target_slot]);
  return { nodes, edges };
}

/**
 * Reconstructs the canvas from a parsed flow file. Verified against the
 * vendored Litegraph source before writing this (not guessed): per-node
 * `configure({properties, pos, size})` -- not the graph-level
 * `configure()`, which bundles link IDs/slot data our git-friendly format
 * deliberately doesn't save -- already syncs both `node.properties` AND
 * each widget's displayed value from `properties` in one call (Litegraph's
 * own widget/property-binding logic), and `connect()` accepts a raw
 * numeric target node ID directly, resolving it via getNodeById
 * internally. A referenced node type that isn't registered (a newer/
 * unknown type, or a typo from hand-editing the file) is reported and
 * skipped, along with any edge touching it, rather than aborting the
 * whole load -- CLAUDE.md's fault-handling priority applied to file I/O:
 * a partially-bad file should still load what it can.
 */
function applyFlowFile(file: FlowFile): void {
  graph.clear();
  placeCount = 0;
  const skippedNodeIds = new Set<number>();

  for (const n of file.nodes) {
    const node = LG.createNode(n.type);
    if (!node) {
      skippedNodeIds.add(n.id);
      logLine(`[load: skipped node ${n.id}, unknown type "${n.type}"]`, "err");
      continue;
    }
    node.id = n.id;
    graph.add(node, true);
    const layoutEntry = file.layout[String(n.id)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configureData: Record<string, any> = { properties: n.properties };
    if (layoutEntry) {
      configureData.pos = layoutEntry.pos;
      if (layoutEntry.size) configureData.size = layoutEntry.size;
    }
    node.configure(configureData);
  }

  for (const [originId, originSlot, targetId, targetSlot] of file.edges) {
    if (skippedNodeIds.has(originId) || skippedNodeIds.has(targetId)) continue; // already reported above
    const originNode = graph.getNodeById(originId);
    if (!originNode) {
      logLine(`[load: skipped edge from missing node ${originId}]`, "err");
      continue;
    }
    if (!originNode.connect(originSlot, targetId, targetSlot)) {
      logLine(`[load: failed to connect node ${originId} slot ${originSlot} -> node ${targetId} slot ${targetSlot}]`, "err");
    }
  }

  placeCount = file.nodes.length;
  canvas.setDirty(true, true);
}

el("btnSaveFlow").addEventListener("click", async () => {
  try {
    const { nodes, edges } = extractCanvasSnapshot();
    const text = serializeFlowFileText(buildFlowFile(nodes, edges));
    const saved = await saveFlowFileToDisk(text, "flow.flow.json");
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
    applyFlowFile(file);
    logLine(`[flow loaded -- ${file.nodes.length} node(s)]`, "ok");
    refreshPreview();
  } catch (err) {
    const message = err instanceof FlowFileError ? `invalid flow file: ${err.message}` : err instanceof Error ? err.message : String(err);
    logLine(`[load failed] ${message}`, "err");
  }
});

// code editor modal for the function node
const modal = el("code-modal");
const textarea = el<HTMLTextAreaElement>("code-modal-textarea");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editingNode: any = null;
(window as unknown as { thingstudioOpenCodeEditor: (node: unknown) => void }).thingstudioOpenCodeEditor = (node) => {
  editingNode = node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textarea.value = (node as any).properties.code;
  modal.classList.add("open");
  textarea.focus();
};
el("code-modal-save").addEventListener("click", () => {
  if (editingNode) editingNode.properties.code = textarea.value;
  modal.classList.remove("open");
  editingNode = null;
});
el("code-modal-cancel").addEventListener("click", () => {
  modal.classList.remove("open");
  editingNode = null;
});

// ---------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------
const consoleEl = el("console");
function logLine(text: string, cls?: "ok" | "err" | ""): void {
  const row = document.createElement("div");
  const now = new Date();
  const ts = now.toLocaleTimeString(undefined, { hour12: false }) + "." + String(now.getMilliseconds()).padStart(3, "0");
  row.innerHTML = `<span class="t">[${ts}] </span><span class="${cls ?? ""}"></span>`;
  row.querySelector("span:last-child")!.textContent = text;
  consoleEl.appendChild(row);
  consoleEl.scrollTop = consoleEl.scrollHeight;
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
const registry = buildRegistry();

// Node-ID line ranges from the most recent successful compile -- stashed
// here rather than threaded through refreshPreview()'s return value so the
// Deploy handler's mpy-cross error path (which runs after Deploy's own
// re-compile, see currentSource()'s call sites) can look a line number up
// without re-plumbing it through another layer.
let lastNodeLineRanges: NodeLineRange[] = [];

function currentSource(): string {
  const graphData = graph.serialize() as GraphData;
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
// ---------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function allCanvasNodes(): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (graph as any)._nodes ?? [];
}

function clearNodeHighlights(): void {
  for (const node of allCanvasNodes()) {
    if (node._thingstudioDefaultColor !== undefined) {
      node.color = node._thingstudioDefaultColor;
      node.bgcolor = node._thingstudioDefaultBgcolor;
    }
  }
  canvas.setDirty(true, true);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function highlightNode(nodeId: number): any {
  const node = graph.getNodeById(nodeId);
  if (!node) return null; // stale ID (since-removed node, or a redeploy landed on a different graph) -- not a reason to crash the console
  if (node._thingstudioDefaultColor === undefined) {
    node._thingstudioDefaultColor = node.color;
    node._thingstudioDefaultBgcolor = node.bgcolor;
  }
  node.color = "#e05555";
  node.bgcolor = "#5a1f1f";
  canvas.setDirty(true, true);
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
  logLine(`[compile error attributed to node ${range.nodeId} (${node.type}), source line ${lineNo}]`, "err");
}

function highlightNodeFromNodeError(nodeIdRaw: string): void {
  // §13's NODE_ERROR.nodeId is a string on the wire (messages.ts's own
  // "verbose over terse" convention), but Litegraph's own node IDs are
  // numeric -- the device is untrusted input either way (CLAUDE.md's
  // fault-handling priority), so a non-numeric/garbled ID is dropped
  // rather than trusted blindly.
  const nodeId = Number(nodeIdRaw);
  if (!Number.isFinite(nodeId)) return;
  const node = highlightNode(nodeId);
  if (!node) return;
  logLine(`[runtime error attributed to node ${nodeId} (${node.type})]`, "err");
}
// Litegraph 0.7.18 has no reliable "graph changed" callback worth
// depending on sight-unseen, so the preview is kept fresh by a plain
// poll rather than an assumed hook -- crude, but correct, and cheap
// enough at 1s for a bare-minimum tool. Deploy also always re-compiles
// from the live graph right before sending, so this poll is only ever
// a display convenience, never the source of truth for what gets sent.
refreshPreview();
setInterval(refreshPreview, 1000);

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
const EDITOR_TARGET_VERSION: ProtocolVersion = { major: 0, minor: 1, patch: 0 };

const HELLO_WAIT_MS = 3000; // generous over a real boot's timing; only gates the "unverified" warning below, never blocks Connect itself

// Set from the most recent HELLO this connection has seen; null means
// "no HELLO yet this connection" (either still waiting, or the device
// was already running and none is coming -- see the constraint above).
// Reset on every fresh Connect and on disconnect so a stale version from
// a previous device never silently carries over to a new one.
let lastHelloVersion: ProtocolVersion | null = null;

const transport = new WebSerialTransport({
  onMessage(message) {
    logLine(`[${message.type}] ${JSON.stringify(message, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v))}`, "ok");
    if (message.type === "NODE_ERROR") highlightNodeFromNodeError(message.nodeId);
    if (message.type === "HELLO") {
      lastHelloVersion = message.runtimeVersion;
      const decision = decideDeploy(message.runtimeVersion, EDITOR_TARGET_VERSION);
      logLine(`[version check] ${decision.reason}`, decision.allowed ? "ok" : "err");
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
    logLine(line, "");
  },
  onDisconnect(reason) {
    logLine(`[disconnected] ${reason ? String(reason) : "(clean)"}`, "");
    lastHelloVersion = null;
    setConnectedUi(false);
  },
});

function setConnectedUi(connected: boolean): void {
  el("pill").textContent = connected ? "connected" : "disconnected";
  el("pill").className = connected ? "pill connected" : "pill disconnected";
  el<HTMLButtonElement>("btnConnect").disabled = connected;
  el<HTMLButtonElement>("btnDisconnect").disabled = !connected;
  el<HTMLButtonElement>("btnDeploy").disabled = !connected;
}

el("btnConnect").addEventListener("click", async () => {
  const nav = navigator as unknown as { serial?: { requestPort(): Promise<WebSerialPort> } };
  if (!nav.serial) {
    logLine("[Web Serial API not available -- use Chrome or Edge, served over http(s)://]", "err");
    return;
  }
  lastHelloVersion = null;
  try {
    const port = await nav.serial.requestPort();
    await transport.connect(port);
  } catch (err) {
    logLine(`[connect failed] ${err instanceof Error ? err.message : String(err)}`, "err");
    return;
  }
  setConnectedUi(true);
  logLine("[connected @ 115200 baud -- opening the port does not reset the board]", "");
  logLine("[if nothing appears below, the board's listener may not be running -- press its physical reset button]", "");

  // Only gates the warning below -- transport.onMessage already handles
  // (and logs) a HELLO whenever it actually arrives, on its own schedule,
  // independent of this wait. See this section's header comment for why
  // a timeout here is expected and not itself an error.
  try {
    await waitForMessage((m) => m.type === "HELLO", HELLO_WAIT_MS);
  } catch {
    logLine(
      "[no HELLO received yet -- version compatibility is unverified; Deploy will proceed without the check until one arrives (reset the board to get one now)]",
      "",
    );
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

    const ackP = waitForMessage((m) => m.type === "DEPLOY_ACK" || m.type === "DEPLOY_ERROR", DEPLOY_TIMEOUT_MS);
    await transport.send({ type: "DEPLOY", bytecode: mpyBytes, staticData: new Uint8Array(0) });
    try {
      const result = await ackP;
      if (result.type === "DEPLOY_ERROR") {
        logLine(`[deploy failed] ${result.code}: ${result.message}`, "err");
      } else {
        logLine("[deploy OK -- flow is running on the device]", "ok");
      }
    } catch {
      logLine(`[deploy timeout] no DEPLOY_ACK/DEPLOY_ERROR within ${DEPLOY_TIMEOUT_MS}ms`, "err");
    }
  } finally {
    btn.disabled = !transport.isConnected;
  }
});

if (!("serial" in navigator)) {
  logLine("[Web Serial API not available -- use Chrome or Edge, served over http(s)://]", "err");
  el<HTMLButtonElement>("btnConnect").disabled = true;
}
