// SPDX-License-Identifier: Apache-2.0
// editor/src/app/main.ts
//
// Bare-minimum editor app shell: canvas (Litegraph, four real node types
// via nodes.ts) -> real compiler (compiler/compile.ts, the same one the
// off-device tests exercise) -> real mpy-cross WASM cross-compile
// (vendored from mpy-cross-wasm/, see editor/public/vendor/mpy-cross) ->
// real §13 DEPLOY over WebSerial (protocol/transport.ts). No save/load,
// no HELLO/version pre-flight gate (version.ts exists but is deliberately
// not wired in here -- explicit scope decision for this first hands-on
// pass, per the "bare minimum" brief), no polish. The goal is exactly
// "build a flow, deploy it, see it run" -- everything else is out of
// scope until that round-trip is proven by hand.

import { compile } from "../compiler/compile.js";
import type { GraphData } from "../compiler/graph.js";
import { buildRegistry } from "../node-library/registry.js";
import { WebSerialTransport, type WebSerialPort } from "../protocol/transport.js";
import type { Message } from "../protocol/messages.js";
import { registerCanvasNodeTypes } from "./nodes.js";

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

const mpyReadyPromise: Promise<void> = (async () => {
  const createMpyCross = await waitForMpyCrossFactory(10000);
  MpyModule = await createMpyCross({
    print: (t: string) => logLine("[mpy-cross] " + t, ""),
    printErr: (t: string) => logLine("[mpy-cross] " + t, "err"),
  });
  logLine("[mpy-cross WASM ready]", "ok");
})().catch((err) => {
  logLine(`[mpy-cross load error] ${err instanceof Error ? err.message : String(err)}`, "err");
});

function compileToMpy(source: string): Uint8Array {
  if (!MpyModule) throw new Error("mpy-cross not ready yet");
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

function currentSource(): string {
  const graphData = graph.serialize() as GraphData;
  const { source } = compile(graphData, registry);
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
// own). Deliberately no HELLO/version-gate check (version.ts) in this
// bare-minimum pass -- see this file's header.
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

const transport = new WebSerialTransport({
  onMessage(message) {
    logLine(`[${message.type}] ${JSON.stringify(message, (_k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v))}`, "ok");
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
});

el("btnDisconnect").addEventListener("click", async () => {
  await transport.disconnect();
  setConnectedUi(false);
});

const DEPLOY_TIMEOUT_MS = 30000; // comfortably exceeds listener.py's own READ_TIMEOUT_S=8 across a few internal phases

el("btnDeploy").addEventListener("click", async () => {
  const btn = el<HTMLButtonElement>("btnDeploy");
  btn.disabled = true;
  try {
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
