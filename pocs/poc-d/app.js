// Thingstudio POC-D — app shell: canvas (Litegraph, trimmed to 3 node types),
// the hardcoded graph→Python compiler (compiler.js), mpy-cross WASM (vendored
// from POC-B) for the real cross-compile step, and a WebSerial deploy panel
// extending POC-A's harness protocol with a binary .mpy path. See README.md
// for exactly what's proven vs. what needs a real hardware run to confirm.
import createMpyCross from "./mpy-cross.mjs";

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------
var graph = new LiteGraph.LGraph();
var canvasEl = el("graph-canvas");
var canvas = new LiteGraph.LGraphCanvas(canvasEl, graph);
canvas.allow_searchbox = true;

function resize() {
  var wrap = el("canvas-wrap");
  canvasEl.width = wrap.clientWidth;
  canvasEl.height = wrap.clientHeight;
  canvas.resize();
}
window.addEventListener("resize", resize);
resize();
graph.start();

var placeCount = 0;
function addNode(type) {
  var node = LiteGraph.createNode(type);
  var col = placeCount % 3;
  var row = Math.floor(placeCount / 3);
  node.pos = [80 + col * 220, 80 + row * 160];
  graph.add(node);
  placeCount++;
  canvas.setDirty(true, true);
  return node;
}
document.querySelectorAll("[data-add-node]").forEach((btn) => {
  btn.addEventListener("click", () => addNode(btn.getAttribute("data-add-node")));
});
el("clear-canvas").addEventListener("click", () => {
  graph.clear();
  placeCount = 0;
});
el("load-example").addEventListener("click", () => {
  graph.clear();
  placeCount = 0;
  var inject = addNode("thingstudio/inject");
  var fn = addNode("thingstudio/function");
  var gpio = addNode("thingstudio/gpio_out");
  inject.pos = [60, 200];
  fn.pos = [340, 200];
  gpio.pos = [620, 200];
  inject.connect(0, fn, 0);
  fn.connect(0, gpio, 0);
  canvas.setDirty(true, true);
});

// code editor modal for the function node
var modal = el("code-modal");
var textarea = el("code-modal-textarea");
var editingNode = null;
window.openCodeEditor = function (node) {
  editingNode = node;
  textarea.value = node.properties.code;
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
var consoleEl = el("console");
function logLine(text, cls) {
  var row = document.createElement("div");
  var now = new Date();
  var ts = now.toLocaleTimeString(undefined, { hour12: false }) + "." + String(now.getMilliseconds()).padStart(3, "0");
  row.innerHTML = '<span class="t">[' + ts + "] </span>" + '<span class="' + (cls || "") + '"></span>';
  row.querySelector("span:last-child").textContent = text;
  consoleEl.appendChild(row);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
function classify(line) {
  if (line.startsWith("MPY_OK") || line.startsWith("DEPLOY_OK")) return "ok";
  if (line.startsWith("MPY_ERR") || line.startsWith("DEPLOY_ERR")) return "err";
  if (line.startsWith("MEM ")) return "mem";
  return "";
}
el("btnClear").addEventListener("click", () => (consoleEl.innerHTML = ""));

// ---------------------------------------------------------------------
// mpy-cross WASM (vendored from poc-b — see that POC's README for how this
// build came about and its own verification).
// ---------------------------------------------------------------------
var MpyModule = null;
var mpyReady = createMpyCross({
  print: (t) => logLine("[mpy-cross] " + t, ""),
  printErr: (t) => logLine("[mpy-cross] " + t, "err"),
}).then((m) => {
  MpyModule = m;
  logLine("[mpy-cross WASM ready]", "ok");
});

function compileToMpy(source) {
  if (!MpyModule) throw new Error("mpy-cross not ready yet");
  MpyModule.FS.writeFile("/in.py", source);
  try {
    MpyModule.FS.unlink("/out.mpy");
  } catch (e) {}
  var exitCode = MpyModule.callMain(["-o", "/out.mpy", "/in.py"]);
  if (exitCode !== 0) {
    var stderr = "";
    try {
      stderr = MpyModule.FS.readFile("/err.txt", { encoding: "utf8" });
    } catch (e) {}
    throw new Error("mpy-cross exited " + exitCode + (stderr ? ": " + stderr : " (see console log above for stderr)"));
  }
  return MpyModule.FS.readFile("/out.mpy"); // Uint8Array
}

// ---------------------------------------------------------------------
// Compile button (preview only, no device needed)
// ---------------------------------------------------------------------
el("btnCompile").addEventListener("click", () => {
  try {
    var result = window.ThingstudioCompiler.compile(graph.serialize());
    el("source-preview").textContent = result.source;
  } catch (e) {
    el("source-preview").textContent = "COMPILE ERROR: " + e.message;
  }
});

// ---------------------------------------------------------------------
// WebSerial — extends POC-A's protocol with a base64-encoded .mpy line
// (see writeMpyFrame below for why it's base64 and not raw binary)
// ---------------------------------------------------------------------
var port = null;
var writer = null;
var keepReading = false;
var lineWaiters = [];

function onLine(line) {
  logLine(line, classify(line));
  var arrivalTime = performance.now();
  lineWaiters = lineWaiters.filter((w) => {
    if (w.match(line)) {
      clearTimeout(w.timer);
      w.resolve({ line, arrivalTime });
      return false;
    }
    return true;
  });
}
function waitForLine(match, timeoutMs) {
  return new Promise((resolve, reject) => {
    var timer = setTimeout(() => {
      lineWaiters = lineWaiters.filter((w) => w.timer !== timer);
      reject(new Error("timeout"));
    }, timeoutMs);
    lineWaiters.push({ match, resolve, reject, timer });
  });
}
async function readLoop() {
  var decoder = new TextDecoder();
  var buf = "";
  keepReading = true;
  while (port && port.readable && keepReading) {
    var reader = port.readable.getReader();
    try {
      while (true) {
        var { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buf += decoder.decode(value, { stream: true });
          var idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            var line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.length) onLine(line);
          }
        }
      }
    } catch (e) {
      logLine("[read error] " + e, "err");
    } finally {
      reader.releaseLock();
    }
  }
}

async function connect() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
  } catch (e) {
    logLine("[connect failed] " + e, "err");
    return;
  }
  writer = port.writable.getWriter();
  readLoop();
  el("pill").textContent = "connected";
  el("pill").className = "pill connected";
  el("btnConnect").disabled = true;
  el("btnDisconnect").disabled = false;
  el("btnDeploy").disabled = false;
  el("btnReset").disabled = false;
  logLine("[connected @ 115200 baud — NOTE: opening the port does not reset this board]", "");
  logLine("[if you don't see HARNESS_BOOTING/HARNESS_READY below, try 'Reset device', or press the board's physical reset button]", "");
}

// Best-effort only — see the button's title text and README. Whether this
// does anything at all depends on the board having a USB-serial bridge chip
// with RTS wired to EN/reset (the classic esptool/Arduino auto-reset trick).
// Boards with native USB (no separate bridge chip) or different wiring won't
// respond to this; physical reset remains the reliable fallback either way.
async function resetDevice() {
  if (!port) return;
  try {
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise((r) => setTimeout(r, 150));
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    logLine("[sent RTS reset pulse — if the board didn't react, this board's wiring doesn't support it; use the physical reset button]", "");
  } catch (e) {
    logLine("[reset signal not supported on this port/board: " + e + " — use the physical reset button]", "err");
  }
}
el("btnReset").addEventListener("click", resetDevice);
async function disconnect() {
  keepReading = false;
  try {
    if (writer) {
      writer.releaseLock();
      writer = null;
    }
    if (port) await port.close();
  } catch (e) {
    logLine("[disconnect error] " + e, "err");
  }
  port = null;
  el("pill").textContent = "disconnected";
  el("pill").className = "pill disconnected";
  el("btnConnect").disabled = false;
  el("btnDisconnect").disabled = true;
  el("btnDeploy").disabled = true;
  el("btnReset").disabled = true;
}
el("btnConnect").addEventListener("click", connect);
el("btnDisconnect").addEventListener("click", disconnect);

// Matches harness.py's current protocol: base64-encoded bytecode on a single
// text line, decoded with readline() device-side. Replaced an earlier
// length-prefixed raw-binary framing (MPY-BEGIN len=<N> + N raw bytes +
// MPY-END) after real hardware testing found that reading a specific byte
// count from sys.stdin (read(n)/readexactly(n)) hangs this port's event loop
// outright — not slow, not erroring, just never yields back at all. See
// harness.py's file header and poc-d/README.md for the full story.
// readline() has been reliable throughout, so the payload rides on that
// instead.
function bytesToBase64(bytes) {
  var binary = "";
  var chunkSize = 0x8000;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function writeMpyFrame(bytes) {
  var enc = new TextEncoder();
  var frame = "###MPY-B64:" + bytesToBase64(bytes) + "###\n";
  await writer.write(enc.encode(frame));
}

async function deployOnce() {
  var compileResult;
  try {
    compileResult = window.ThingstudioCompiler.compile(graph.serialize());
  } catch (e) {
    logLine("[compile error] " + e.message, "err");
    return;
  }
  el("source-preview").textContent = compileResult.source;

  var mpyBytes;
  var t0 = performance.now();
  try {
    mpyBytes = compileToMpy(compileResult.source);
  } catch (e) {
    logLine("[mpy-cross error] " + e.message, "err");
    return;
  }
  var t1 = performance.now();
  el("mCompileMs").textContent = Math.round(t1 - t0);
  el("mMpySize").textContent = mpyBytes.length;

  var clickT = performance.now();
  // Must comfortably exceed the device's own worst-case wait: harness.py's
  // READ_TIMEOUT_S applies to up to 3 sequential phases (header/body/trailer)
  // before it gives up and emits MPY_ERR itself. If this is shorter than
  // that, the browser can show "timeout" while the device is still validly
  // working -- confirmed as a real bug here, not just theoretical: the
  // MPY_OK/MPY_ERR line still showed up in the console a beat after the
  // browser's old 5s window gave up, since onLine() logs every line
  // regardless of whether a waiter was still around to match it.
  var DEPLOY_TIMEOUT_MS = 30000;
  var okP = waitForLine((l) => l.startsWith("MPY_OK") || l.startsWith("MPY_ERR"), DEPLOY_TIMEOUT_MS).catch(() => ({ timeout: true }));
  await writeMpyFrame(mpyBytes);
  var okRes = await okP;

  if (okRes && !okRes.timeout) {
    el("mRt").textContent = Math.round(okRes.arrivalTime - clickT);
    if (okRes.line.startsWith("MPY_OK")) {
      var m = okRes.line.match(/before=(-?\d+) after=(-?\d+) dt_ms=(-?\d+)/);
      if (m) {
        el("mMemBefore").textContent = m[1];
        el("mMemAfter").textContent = m[2];
      }
    } else {
      logLine("[deploy failed] " + okRes.line, "err");
    }
  } else {
    logLine("[deploy timeout] no MPY_OK/MPY_ERR within 5s", "err");
  }
}

el("btnDeploy").addEventListener("click", async () => {
  el("btnDeploy").disabled = true;
  try {
    await mpyReady;
    await deployOnce();
  } finally {
    el("btnDeploy").disabled = false;
  }
});

if (!("serial" in navigator)) {
  logLine("[Web Serial API not available — use Chrome or Edge, served over http(s)://]", "err");
  el("btnConnect").disabled = true;
}
