// Thingstudio POC-C — app shell: canvas setup, node palette, debug sidebar, code-editor modal.
// See README.md for what this spike is and isn't testing (design doc §15.3).

(function () {
  "use strict";

  var graph = new LiteGraph.LGraph();
  var canvasEl = document.getElementById("graph-canvas");
  var canvas = new LiteGraph.LGraphCanvas(canvasEl, graph);
  canvas.background_image = null;
  canvas.render_canvas_border = false;
  canvas.allow_searchbox = true; // double-click empty canvas = node search
  // Note: Litegraph's shift/ctrl-click and shift/ctrl-drag box-select for multi-select
  // work out of the box and don't need any flag here. There's a separate `multi_select`
  // flag that makes *plain* clicks additive instead of replacing the selection — leave
  // it false (the default); turning it on was tried here and made every node sticky-select,
  // so grabbing one node dragged every previously-clicked node with it.

  window.__ts = { graph, canvas }; // exposed for the browser-driven verification pass

  function resize() {
    var wrap = document.getElementById("canvas-wrap");
    canvasEl.width = wrap.clientWidth;
    canvasEl.height = wrap.clientHeight;
    canvas.resize();
  }
  window.addEventListener("resize", resize);
  resize();

  graph.start(); // continuous execution so inject → wire → debug/gpio/mqtt actually mock-propagates

  // ---------------------------------------------------------------------
  // Palette: explicit "add node" buttons (in addition to Litegraph's own
  // right-click "Add Node" menu and double-click search, both still work).
  // ---------------------------------------------------------------------
  var placeCount = 0;
  function addNode(type) {
    var node = LiteGraph.createNode(type);
    var col = placeCount % 4;
    var row = Math.floor(placeCount / 4);
    node.pos = [80 + col * 220, 80 + row * 160];
    graph.add(node);
    placeCount++;
    canvas.setDirty(true, true);
    return node;
  }

  document.querySelectorAll("[data-add-node]").forEach((btn) => {
    btn.addEventListener("click", () => addNode(btn.getAttribute("data-add-node")));
  });

  document.getElementById("clear-canvas").addEventListener("click", () => {
    graph.clear();
    placeCount = 0;
  });

  document.getElementById("load-example").addEventListener("click", loadExampleFlow);

  function loadExampleFlow() {
    graph.clear();
    placeCount = 0;

    var inject = addNode("thingstudio/inject");
    var fn = addNode("thingstudio/function");
    var gpio = addNode("thingstudio/gpio_out");
    var mqtt = addNode("thingstudio/mqtt_publish");
    var dbg = addNode("thingstudio/debug");

    // lay out left-to-right like a Node-RED flow instead of the grid default
    inject.pos = [60, 200];
    fn.pos = [300, 200];
    gpio.pos = [560, 100];
    mqtt.pos = [560, 260];
    dbg.pos = [560, 420];

    inject.connect(0, fn, 0);
    fn.connect(0, gpio, 0);
    fn.connect(0, mqtt, 0);
    fn.connect(0, dbg, 0);

    canvas.setDirty(true, true);
  }

  // ---------------------------------------------------------------------
  // Debug sidebar — mirrors Node-RED's debug tab: newest entry on top.
  // ---------------------------------------------------------------------
  var debugLog = document.getElementById("debug-log");
  var debugCount = 0;
  window.logDebug = function (label, value) {
    debugCount++;
    var entry = document.createElement("div");
    entry.className = "debug-entry";
    var time = new Date().toLocaleTimeString();
    entry.innerHTML =
      '<span class="debug-time">' +
      time +
      '</span> <span class="debug-label">' +
      label +
      '</span><br><span class="debug-value">' +
      JSON.stringify(value) +
      "</span>";
    debugLog.insertBefore(entry, debugLog.firstChild);
    while (debugLog.children.length > 100) debugLog.removeChild(debugLog.lastChild);
    document.getElementById("debug-count").textContent = debugCount;
  };
  document.getElementById("clear-debug").addEventListener("click", () => {
    debugLog.innerHTML = "";
    debugCount = 0;
    document.getElementById("debug-count").textContent = "0";
  });

  // ---------------------------------------------------------------------
  // Code editor modal for the function node ("node property editing" beyond
  // simple widgets — the real function node will need the same kind of
  // separate editor surface per §6).
  // ---------------------------------------------------------------------
  var modal = document.getElementById("code-modal");
  var textarea = document.getElementById("code-modal-textarea");
  var editingNode = null;

  window.openCodeEditor = function (node) {
    editingNode = node;
    textarea.value = node.properties.code;
    modal.classList.add("open");
    textarea.focus();
  };
  document.getElementById("code-modal-save").addEventListener("click", () => {
    if (editingNode) editingNode.properties.code = textarea.value;
    modal.classList.remove("open");
    editingNode = null;
  });
  document.getElementById("code-modal-cancel").addEventListener("click", () => {
    modal.classList.remove("open");
    editingNode = null;
  });
})();
