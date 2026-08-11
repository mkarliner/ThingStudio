// Thingstudio POC-D — canvas node types. Trimmed to the 3 types this spike's
// compiler actually handles (see design doc §15.5): inject, function, gpio_out.
// Definitions copied from poc-c/nodes.js (Litegraph, settled per §11/§15.3) —
// same properties/widgets, so the compiler below can read them directly.
// Difference from POC-C: these are no longer mock-only. "Deploy" (app.js) walks
// this exact graph, compiles it to real MicroPython (compiler.js), cross-compiles
// it to real .mpy bytecode (mpy-cross.wasm, from POC-B), and runs it on real
// hardware. The in-canvas mock behavior (LED indicator, fire button flash) still
// exists too, purely as visual feedback while authoring — it doesn't feed the
// compiler.

(function () {
  "use strict";
  var LG = window.LiteGraph;

  // ---------------------------------------------------------------------
  // inject
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
        this.disconnectOutput(0);
      },
      { values: ["bool", "number", "string"] }
    );
    this.addWidget("text", "value", this.properties.payloadValue, "payloadValue");
    this.addWidget(
      "combo",
      "repeat",
      this.properties.repeat,
      "repeat",
      { values: ["manual", "1s", "5s", "30s"] }
    );
    // No "inject now" button here on purpose (POC-C had one, purely a canvas
    // flash with no wiring to anything real). It was actively misleading in
    // this build, where there IS a real device on the other end: it looked
    // like a live trigger but did nothing -- didn't touch `payloadValue`,
    // didn't compile, didn't talk to the device. The only real trigger in
    // this POC's scope is Deploy itself: with the default `repeat: manual`,
    // the compiled flow fires exactly once, at the moment it's deployed,
    // baked into the generated code (see compiler.js). Editing "value" only
    // takes effect on the next full Deploy, not live -- no live re-fire
    // round-trip exists in this protocol (§15.5 explicitly scopes that out).
    this.color = "#2e5c2e";
    this.bgcolor = "#1f3f1f";
    this.size = [190, 130];
  }
  InjectNode.title = "inject";
  InjectNode.desc = "Fires once, at Deploy time (manual) or on a repeat interval — compiled for real, no live re-fire (§15.5)";
  LG.registerNodeType("thingstudio/inject", InjectNode);

  // ---------------------------------------------------------------------
  // gpio out
  // ---------------------------------------------------------------------
  function GpioOutNode() {
    // Default 12 rather than an arbitrary pin: on the LuatOS ESP32-C3 test
    // board this is actually wired to a visible onboard LED (13 also is;
    // POC-A used both). An unwired pin "works" but gives zero visible
    // feedback, which looks identical to "nothing changed" -- change this
    // per-node in the canvas if testing on different hardware.
    this.properties = { pin: 12 };
    this.addInput("signal", "bool");
    this.addWidget("number", "pin", this.properties.pin, "pin", { min: 0, max: 39, step: 10, precision: 0 });
    this.color = "#6e3b3b";
    this.bgcolor = "#3f1f1f";
    this._state = false;
    this.size = [170, 76];
  }
  GpioOutNode.title = "gpio out";
  GpioOutNode.desc = "Real digital GPIO output once deployed — bool-only input (§6)";
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
  // function
  // ---------------------------------------------------------------------
  function FunctionNode() {
    this.properties = {
      code: "msg['payload'] = msg['payload']\nreturn msg\n",
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
  FunctionNode.desc = "Real MicroPython this time — the code property is compiled verbatim into the flow (§6, §15.5)";
  LG.registerNodeType("thingstudio/function", FunctionNode);
})();
