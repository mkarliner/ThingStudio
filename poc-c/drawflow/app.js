// Thingstudio POC-C — Drawflow variant. Same 5 fake node types & mocks as the
// Litegraph build in ../index.html, built independently on Drawflow's model
// (HTML node bodies + df-* two-way binding, SVG connections) for a direct
// side-by-side per design doc §11/§15.3. See poc-c/README.md for the comparison.
//
// Two things Drawflow does NOT provide out of the box, unlike Litegraph, and
// which this file has to hand-roll:
//   1. Port-type checking on connect (Drawflow has no concept of typed ports at
//      all) — see CONNECTION VALIDATION below: we let the connection form, then
//      inspect it in the `connectionCreated` event and rip it out if the types
//      don't match. That's a "flash then reject" UX, not a "can't even drop it"
//      UX like Litegraph's native isValidConnection gives for free.
//   2. Any execution/dataflow engine — Drawflow is an editor only, no onExecute
//      loop. See PROPAGATION (MOCK EXECUTION) below: firing an inject node walks
//      editor.export() by hand and pushes a value through connected nodes.

(function () {
  "use strict";

  var id = document.getElementById("drawflow");
  var editor = new Drawflow(id);
  editor.reroute = true;
  editor.start();
  window.__ts = { editor };

  // ---------------------------------------------------------------------
  // Port-type table. Drawflow has no native slot-type concept, so we keep
  // our own registry keyed by node type name (mirrors nodes.js in the
  // Litegraph build's addInput/addOutput type args).
  // ---------------------------------------------------------------------
  var PORT_TYPES = {
    inject: { inputs: [], outputs: ["bool"] }, // output[0] type is overridden per-instance below
    function: { inputs: ["*"], outputs: ["*"] },
    gpio_out: { inputs: ["bool"], outputs: [] },
    mqtt_publish: { inputs: ["*"], outputs: [] },
    debug: { inputs: ["*"], outputs: [] },
  };

  function isValidConnection(typeA, typeB) {
    if (typeA === "*" || typeB === "*" || !typeA || !typeB) return true;
    return typeA === typeB;
  }

  function outputType(node) {
    if (node.name === "inject") return node.data.payloadType || "bool";
    return (PORT_TYPES[node.name] && PORT_TYPES[node.name].outputs[0]) || "*";
  }
  function inputType(node) {
    return (PORT_TYPES[node.name] && PORT_TYPES[node.name].inputs[0]) || "*";
  }

  // ---------------------------------------------------------------------
  // Node HTML templates. df-* attributes two-way bind to node.data.
  // ---------------------------------------------------------------------
  var TEMPLATES = {
    inject: function () {
      return (
        '<div class="ts-title">📥 inject</div>' +
        '<div class="ts-body">' +
        '<label>type<select df-payloadType><option value="bool">bool</option>' +
        '<option value="number">number</option><option value="string">string</option></select></label>' +
        '<label>value<input type="text" df-payloadValue></label>' +
        '<label>repeat<select df-repeat><option value="manual">manual</option>' +
        '<option value="1s">1s</option><option value="5s">5s</option><option value="30s">30s</option></select></label>' +
        '<button class="ts-fire">inject now</button>' +
        "</div>"
      );
    },
    function: function () {
      return (
        '<div class="ts-title">ƒ function</div>' +
        '<div class="ts-body"><button class="ts-edit-code">edit code…</button></div>'
      );
    },
    gpio_out: function () {
      return (
        '<div class="ts-title">⚡ gpio out <span class="ts-led"></span></div>' +
        '<div class="ts-body"><label>pin<input type="number" df-pin min="0" max="39"></label></div>'
      );
    },
    mqtt_publish: function () {
      return (
        '<div class="ts-title">📡 mqtt out</div>' +
        '<div class="ts-body">' +
        '<label>topic<input type="text" df-topic></label>' +
        '<label>qos<select df-qos><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>' +
        '<label><input type="checkbox" df-retain style="width:auto"> retain</label>' +
        '<div class="ts-last">—</div>' +
        "</div>"
      );
    },
    debug: function () {
      return '<div class="ts-title">🐞 debug</div><div class="ts-body"><div class="ts-last">—</div></div>';
    },
  };

  var DEFAULT_DATA = {
    inject: { payloadType: "bool", payloadValue: "true", repeat: "manual" },
    function: {
      code:
        "# fake — real node runs precompiled MicroPython (§6), not JS\n" +
        "msg['payload'] = msg['payload']\nreturn msg\n",
    },
    gpio_out: { pin: 2 },
    mqtt_publish: { topic: "thingstudio/out", qos: "0", retain: false },
    debug: {},
  };

  var IN_OUT = {
    inject: [0, 1],
    function: [1, 1],
    gpio_out: [1, 0],
    mqtt_publish: [1, 0],
    debug: [1, 0],
  };

  var placeCount = 0;
  function addNode(type) {
    var col = placeCount % 4;
    var row = Math.floor(placeCount / 4);
    var x = 80 + col * 260;
    var y = 80 + row * 220;
    var io = IN_OUT[type];
    var nid = editor.addNode(
      type,
      io[0],
      io[1],
      x,
      y,
      "ts-" + type,
      JSON.parse(JSON.stringify(DEFAULT_DATA[type])),
      TEMPLATES[type]()
    );
    placeCount++;
    wireNodeChrome(nid);
    return nid;
  }

  // Buttons inside node HTML aren't auto-wired by Drawflow; hook them up
  // once per node after it's placed.
  function wireNodeChrome(nid) {
    var el = document.getElementById("node-" + nid);
    if (!el) return;
    var node = editor.getNodeFromId(nid);
    var fireBtn = el.querySelector(".ts-fire");
    if (fireBtn) fireBtn.addEventListener("click", () => fireInject(nid));
    var editBtn = el.querySelector(".ts-edit-code");
    if (editBtn) editBtn.addEventListener("click", () => openCodeEditor(nid));
    // re-render the output port's advertised type when the combo changes
    var typeSel = el.querySelector("[df-payloadType]");
    if (typeSel) {
      typeSel.addEventListener("change", () => {
        // df-* binding already updated node.data.payloadType; nothing else to do —
        // outputType() reads node.data live at connect-time.
      });
    }
  }

  document.querySelectorAll("[data-add-node]").forEach((btn) => {
    btn.addEventListener("click", () => addNode(btn.getAttribute("data-add-node")));
  });
  document.getElementById("clear-canvas").addEventListener("click", () => {
    editor.clear();
    placeCount = 0;
  });
  document.getElementById("load-example").addEventListener("click", loadExampleFlow);

  function loadExampleFlow() {
    editor.clear();
    placeCount = 0;
    var injectId = addNode("inject");
    var fnId = addNode("function");
    var gpioId = addNode("gpio_out");
    var mqttId = addNode("mqtt_publish");
    var dbgId = addNode("debug");

    editor.updateNodeDataFromId(injectId, editor.getNodeFromId(injectId).data);
    // reposition like a left-to-right flow
    moveNode(injectId, 60, 220);
    moveNode(fnId, 340, 220);
    moveNode(gpioId, 640, 100);
    moveNode(mqttId, 640, 280);
    moveNode(dbgId, 640, 460);

    editor.addConnection(injectId, fnId, "output_1", "input_1");
    editor.addConnection(fnId, gpioId, "output_1", "input_1");
    editor.addConnection(fnId, mqttId, "output_1", "input_1");
    editor.addConnection(fnId, dbgId, "output_1", "input_1");
  }

  function moveNode(nid, x, y) {
    var node = editor.getNodeFromId(nid);
    node.pos_x = x;
    node.pos_y = y;
    var el = document.getElementById("node-" + nid);
    if (el) el.style.transform = "translate(" + x + "px, " + y + "px)";
    editor.updateConnectionNodes("node-" + nid);
  }

  // ---------------------------------------------------------------------
  // CONNECTION VALIDATION (hand-rolled — see file header)
  // ---------------------------------------------------------------------
  editor.on("connectionCreated", function (info) {
    var outNode = editor.getNodeFromId(info.output_id);
    var inNode = editor.getNodeFromId(info.input_id);
    var outT = outputType(outNode);
    var inT = inputType(inNode);
    if (!isValidConnection(outT, inT)) {
      console.warn("rejecting mismatched connection:", outT, "->", inT);
      editor.removeSingleConnection(info.output_id, info.input_id, info.output_class, info.input_class);
      flashRejected();
      return;
    }
  });

  function flashRejected() {
    var notice = document.getElementById("notice");
    var prev = notice.textContent;
    var prevColor = notice.style.color;
    notice.textContent = "Connection rejected: payload type mismatch.";
    notice.style.color = "#ff5050";
    setTimeout(() => {
      notice.textContent = prev;
      notice.style.color = prevColor;
    }, 1600);
  }

  // ---------------------------------------------------------------------
  // PROPAGATION (MOCK EXECUTION) — see file header
  // ---------------------------------------------------------------------
  function castInjectValue(node) {
    var raw = node.data.payloadValue;
    switch (node.data.payloadType) {
      case "bool":
        return raw === "true" || raw === true;
      case "number":
        return Number(raw);
      default:
        return String(raw);
    }
  }

  function fireInject(nid) {
    var node = editor.getNodeFromId(nid);
    var value = castInjectValue(node);
    var el = document.getElementById("node-" + nid);
    if (el) {
      el.style.outline = "2px solid #8f8";
      setTimeout(() => (el.style.outline = ""), 150);
    }
    propagate(nid, value);
  }

  function propagate(nid, value) {
    var node = editor.getNodeFromId(nid);
    var out = node.outputs && node.outputs.output_1;
    if (!out) return;
    out.connections.forEach((conn) => receive(conn.node, value));
  }

  function receive(nid, value) {
    var node = editor.getNodeFromId(nid);
    var el = document.getElementById("node-" + nid);
    switch (node.name) {
      case "function":
        // mock pass-through, no real exec
        propagate(nid, value);
        break;
      case "gpio_out": {
        var led = el && el.querySelector(".ts-led");
        if (led) led.classList.toggle("on", !!value);
        break;
      }
      case "mqtt_publish": {
        var label = "→ " + node.data.topic + ": " + JSON.stringify(value);
        var lastEl = el && el.querySelector(".ts-last");
        if (lastEl) lastEl.textContent = label.slice(0, 40);
        break;
      }
      case "debug": {
        var lastEl2 = el && el.querySelector(".ts-last");
        if (lastEl2) lastEl2.textContent = String(value).slice(0, 30);
        logDebug(node.name + " (#" + nid + ")", value);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Debug sidebar (identical to the Litegraph build's)
  // ---------------------------------------------------------------------
  var debugLog = document.getElementById("debug-log");
  var debugCount = 0;
  window.logDebug = function (label, value) {
    debugCount++;
    var entry = document.createElement("div");
    entry.className = "debug-entry";
    var time = new Date().toLocaleTimeString();
    entry.innerHTML =
      '<span class="debug-time">' + time + '</span> <span class="debug-label">' + label +
      '</span><br><span class="debug-value">' + JSON.stringify(value) + "</span>";
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
  // Code editor modal (identical UX to the Litegraph build's)
  // ---------------------------------------------------------------------
  var modal = document.getElementById("code-modal");
  var textarea = document.getElementById("code-modal-textarea");
  var editingId = null;
  window.openCodeEditor = function (nid) {
    editingId = nid;
    textarea.value = editor.getNodeFromId(nid).data.code || "";
    modal.classList.add("open");
    textarea.focus();
  };
  document.getElementById("code-modal-save").addEventListener("click", () => {
    if (editingId != null) {
      var node = editor.getNodeFromId(editingId);
      editor.updateNodeDataFromId(editingId, Object.assign({}, node.data, { code: textarea.value }));
    }
    modal.classList.remove("open");
    editingId = null;
  });
  document.getElementById("code-modal-cancel").addEventListener("click", () => {
    modal.classList.remove("open");
    editingId = null;
  });
})();
