// Thingstudio POC-C — fake node type definitions for the canvas-feel spike (design doc §15.3).
//
// These are throwaway stand-ins for the real v1 node set (§6). Behavior is mocked:
// no compiler, no msg envelope, no device. The one thing modeled faithfully is the
// port-type contract from §6 ("payload is typed from a small fixed set ... the editor
// checks payload type compatibility at wire-connect time") — slot types below (bool,
// number, string, any) drive Litegraph's own built-in connection-type check, so
// dragging a mismatched wire is rejected by the library itself, not a bolted-on check.

(function () {
  "use strict";
  var LG = window.LiteGraph;

  // ---------------------------------------------------------------------
  // inject — manually (or on a repeat interval) fires a fake msg
  // ---------------------------------------------------------------------
  function InjectNode() {
    this.properties = { payloadType: "bool", payloadValue: "true", repeat: "manual" };
    this.addOutput("msg", "bool");
    this.addWidget(
      "combo",
      "type",
      this.properties.payloadType,
      (v) => {
        this.properties.payloadType = v;
        this.outputs[0].type = v;
        // dropping the output type invalidates any now-mismatched existing links
        this.disconnectOutput(0);
      },
      { values: ["bool", "number", "string"] }
    );
    this.addWidget("text", "value", this.properties.payloadValue, "payloadValue");
    this.addWidget(
      "combo",
      "repeat",
      this.properties.repeat,
      (v) => {
        this.properties.repeat = v;
        this._setupTimer();
      },
      { values: ["manual", "1s", "5s", "30s"] }
    );
    this.addWidget("button", "inject now", null, () => this.fire());
    this.color = "#2e5c2e";
    this.bgcolor = "#1f3f1f";
    this._lastFired = null;
    this.size = [190, 150];
  }
  InjectNode.title = "inject";
  InjectNode.desc = "Fake — manually or on-schedule fires a test message into the flow (§6)";

  InjectNode.prototype.onAdded = function () {
    this._setupTimer();
  };
  InjectNode.prototype.onRemoved = function () {
    if (this._timer) clearInterval(this._timer);
  };
  InjectNode.prototype._setupTimer = function () {
    if (this._timer) clearInterval(this._timer);
    var ms = { manual: 0, "1s": 1000, "5s": 5000, "30s": 30000 }[this.properties.repeat];
    if (ms) this._timer = setInterval(() => this.fire(), ms);
  };
  InjectNode.prototype._castValue = function () {
    var raw = this.properties.payloadValue;
    switch (this.properties.payloadType) {
      case "bool":
        return raw === "true" || raw === true;
      case "number":
        return Number(raw);
      default:
        return String(raw);
    }
  };
  InjectNode.prototype.fire = function () {
    this._lastFired = this._castValue();
    this.setOutputData(0, this._lastFired);
    this.boxcolor = "#8f8";
    this.setDirtyCanvas(true);
    setTimeout(() => {
      this.boxcolor = null;
      this.setDirtyCanvas(true);
    }, 150);
  };
  InjectNode.prototype.onExecute = function () {
    if (this._lastFired !== null) this.setOutputData(0, this._lastFired);
  };
  LG.registerNodeType("thingstudio/inject", InjectNode);

  // ---------------------------------------------------------------------
  // gpio out — fake digital output, deliberately typed bool-only
  // ---------------------------------------------------------------------
  function GpioOutNode() {
    this.properties = { pin: 2 };
    this.addInput("signal", "bool");
    this.addWidget(
      "number",
      "pin",
      this.properties.pin,
      "pin",
      { min: 0, max: 39, step: 10, precision: 0 }
    );
    this.color = "#6e3b3b";
    this.bgcolor = "#3f1f1f";
    this._state = false;
    this.size = [170, 76];
  }
  GpioOutNode.title = "gpio out";
  GpioOutNode.desc = "Fake digital GPIO output — bool-only input, mirrors the real port-type contract (§6)";

  GpioOutNode.prototype.onExecute = function () {
    var v = this.getInputData(0);
    if (v !== undefined) this._state = !!v;
  };
  GpioOutNode.prototype.onDrawForeground = function (ctx) {
    if (this.flags.collapsed) return;
    ctx.beginPath();
    ctx.arc(this.size[0] - 18, 16, 7, 0, Math.PI * 2);
    ctx.fillStyle = this._state ? "#57ff57" : "#333";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000";
    ctx.stroke();
  };
  LG.registerNodeType("thingstudio/gpio_out", GpioOutNode);

  // ---------------------------------------------------------------------
  // mqtt publish — fake sink, accepts any payload type (like the real MQTT node)
  // ---------------------------------------------------------------------
  function MqttPublishNode() {
    this.properties = { topic: "thingstudio/out", qos: "0", retain: false };
    this.addInput("msg", "*");
    this.addWidget("text", "topic", this.properties.topic, "topic");
    this.addWidget("combo", "qos", this.properties.qos, "qos", { values: ["0", "1", "2"] });
    this.addWidget("toggle", "retain", this.properties.retain, "retain");
    this.color = "#3b3b6e";
    this.bgcolor = "#1f1f3f";
    this._lastLabel = "";
    this.size = [210, 120];
  }
  MqttPublishNode.title = "mqtt out";
  MqttPublishNode.desc = "Fake MQTT publish sink — no real broker, accepts any payload type (§6)";

  MqttPublishNode.prototype.onExecute = function () {
    var v = this.getInputData(0);
    if (v !== undefined) {
      this._lastLabel = "→ " + this.properties.topic + ": " + JSON.stringify(v);
    }
  };
  MqttPublishNode.prototype.onDrawForeground = function (ctx) {
    if (this.flags.collapsed || !this._lastLabel) return;
    ctx.fillStyle = "#9aa7ff";
    ctx.font = "10px monospace";
    ctx.fillText(this._lastLabel.slice(0, 30), 6, this.size[1] - 6);
  };
  LG.registerNodeType("thingstudio/mqtt_publish", MqttPublishNode);

  // ---------------------------------------------------------------------
  // function — fake, pass-through only. Real node runs precompiled MicroPython (§6),
  // not JS; this just exercises the "open an editor for a code property" interaction.
  // ---------------------------------------------------------------------
  function FunctionNode() {
    this.properties = {
      code:
        "# fake — real node runs precompiled MicroPython (§6), not JS\n" +
        "# this editor does not execute anything\n" +
        "msg['payload'] = msg['payload']\n" +
        "return msg\n",
    };
    this.addInput("msg", "*");
    this.addOutput("msg", "*");
    this.addWidget("button", "edit code…", null, () => {
      if (window.openCodeEditor) window.openCodeEditor(this);
    });
    this.color = "#6e5b2e";
    this.bgcolor = "#3f341f";
    this.size = [180, 84];
  }
  FunctionNode.title = "function";
  FunctionNode.desc = "Fake — real node runs precompiled MicroPython, not JS (§6)";

  FunctionNode.prototype.onExecute = function () {
    var v = this.getInputData(0);
    if (v !== undefined) this.setOutputData(0, v); // mock pass-through, no real exec
  };
  LG.registerNodeType("thingstudio/function", FunctionNode);

  // ---------------------------------------------------------------------
  // debug — logs received values to the sidebar panel, like Node-RED's debug tab
  // ---------------------------------------------------------------------
  function DebugNode() {
    this.properties = { toSidebar: true };
    this.addInput("msg", "*");
    this.color = "#555555";
    this.bgcolor = "#2b2b2b";
    this._last = undefined;
    this.size = [170, 66];
  }
  DebugNode.title = "debug";
  DebugNode.desc = "Fake — prints a value to the inspector, like Node-RED's debug sidebar (§8)";

  DebugNode.prototype.onExecute = function () {
    var v = this.getInputData(0);
    if (v !== undefined && v !== this._last) {
      this._last = v;
      if (window.logDebug) window.logDebug(this.title + " (#" + this.id + ")", v);
      this.setDirtyCanvas(true);
    }
  };
  DebugNode.prototype.onDrawForeground = function (ctx) {
    if (this.flags.collapsed || this._last === undefined) return;
    ctx.fillStyle = "#cccccc";
    ctx.font = "10px monospace";
    ctx.fillText(String(this._last).slice(0, 26), 6, this.size[1] - 6);
  };
  LG.registerNodeType("thingstudio/debug", DebugNode);
})();
