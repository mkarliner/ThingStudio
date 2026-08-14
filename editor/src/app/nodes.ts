// SPDX-License-Identifier: Apache-2.0
// editor/src/app/nodes.ts
//
// Litegraph canvas node classes for the bare-minimum editor
// (docs/working-notes/mvp-feature-priorities.md's "actually create, edit
// and run a flow" goal). Ported from pocs/poc-d/nodes.js, generalized
// from that POC's hardcoded 3-type set to the four types this editor
// exposes (inject/function/debug/gpio_out) and wired against the REAL
// node-library/compiler.ts registry instead of poc-d/compiler.js's
// hardcoded single-shape compiler -- so `node.properties` here has to
// match exactly what each node-library/*.ts's codegen* reads:
//   - inject:   payloadType, payloadValue, repeat        (node-library/inject.ts)
//   - function: code                                     (node-library/function-node.ts)
//   - debug:    (none -- debug.ts reads only node.id)     (node-library/debug.ts)
//   - gpio_out: pin                                       (node-library/gpio-out.ts)
//
// No `@types/litegraph` dependency exists for this vendored 0.7.18 build
// (see editor/public/vendor/litegraph/LITEGRAPH-LICENSE for provenance),
// so this file talks to the global `LiteGraph` the vendored
// litegraph.min.js <script> tag puts on `window` via a narrow structural
// `any` rather than pulling in ambient types this project doesn't
// otherwise need -- same reasoning transport.ts gives for its own
// hand-rolled `WebSerialPort` interface instead of `@types/web-serial`.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LG: any = (window as unknown as { LiteGraph: any }).LiteGraph;

export function registerCanvasNodeTypes(): void {
  // ---------------------------------------------------------------------
  // inject
  // ---------------------------------------------------------------------
  function InjectNode(this: any) {
    this.properties = { payloadType: "bool", payloadValue: "true", repeat: "manual" };
    this.addOutput("msg", "*");
    this.addWidget(
      "combo",
      "type",
      this.properties.payloadType,
      (v: string) => {
        this.properties.payloadType = v;
      },
      { values: ["bool", "number", "string"] },
    );
    this.addWidget("text", "value", this.properties.payloadValue, "payloadValue");
    this.addWidget("combo", "repeat", this.properties.repeat, "repeat", { values: ["manual", "1s", "5s", "30s"] });
    this.color = "#2e5c2e";
    this.bgcolor = "#1f3f1f";
    this.size = [190, 130];
  }
  InjectNode.title = "inject";
  InjectNode.desc = "Fires once at Deploy time (manual) or on a repeat interval";
  LG.registerNodeType("thingstudio/inject", InjectNode);

  // ---------------------------------------------------------------------
  // function
  // ---------------------------------------------------------------------
  function FunctionNode(this: any) {
    this.properties = { code: "msg['payload'] = msg['payload']\nreturn msg\n" };
    this.addInput("msg", "*");
    this.addOutput("msg", "*");
    this.addWidget("button", "edit code…", null, () => {
      const w = window as unknown as { thingstudioOpenCodeEditor?: (node: unknown) => void };
      w.thingstudioOpenCodeEditor?.(this);
    });
    this.color = "#6e5b2e";
    this.bgcolor = "#3f341f";
    this.size = [180, 84];
  }
  FunctionNode.title = "function";
  FunctionNode.desc = "Real MicroPython -- the code property is compiled verbatim into the flow";
  LG.registerNodeType("thingstudio/function", FunctionNode);

  // ---------------------------------------------------------------------
  // debug
  // ---------------------------------------------------------------------
  function DebugNode(this: any) {
    // No `properties` at all -- node-library/debug.ts's codegenSink reads
    // only node.id, nothing configured on the node itself.
    this.addInput("msg", "*");
    this.color = "#2e4a6e";
    this.bgcolor = "#1f2c3f";
    this.size = [140, 50];
  }
  DebugNode.title = "debug";
  DebugNode.desc = "Prints the inbound payload to the device's serial console";
  LG.registerNodeType("thingstudio/debug", DebugNode);

  // ---------------------------------------------------------------------
  // gpio out
  // ---------------------------------------------------------------------
  function GpioOutNode(this: any) {
    // Default 12 -- on the LuatOS ESP32-C3 test board this is wired to a
    // visible onboard LED (matches poc-d's own default/reasoning).
    this.properties = { pin: 12 };
    this.addInput("signal", "*");
    this.addWidget("number", "pin", this.properties.pin, "pin", { min: 0, max: 39, step: 10, precision: 0 });
    this.color = "#6e3b3b";
    this.bgcolor = "#3f1f1f";
    this.size = [170, 76];
  }
  GpioOutNode.title = "gpio out";
  GpioOutNode.desc = "Real digital GPIO output once deployed -- bool-only input";
  LG.registerNodeType("thingstudio/gpio_out", GpioOutNode);
}
