// Headless verification of checkpoint 1's core mechanism: does the
// connectioncreate pipe actually stop an incompatible connection from ever
// being added to the graph? Exercises the real `rete` package installed in
// node_modules, not a reimplementation — same sockets.ts/validation.ts logic
// inlined here since this is a plain .mjs smoke test, not a bundled TS build.
import { NodeEditor, ClassicPreset } from "./node_modules/rete/rete.esm.js";

class BoolSocket extends ClassicPreset.Socket {
  constructor() { super("bool"); }
  isCompatibleWith(s) { return s instanceof BoolSocket; }
}
class StringSocket extends ClassicPreset.Socket {
  constructor() { super("string"); }
  isCompatibleWith(s) { return s instanceof StringSocket; }
}

const editor = new NodeEditor();
let rejectedCount = 0;
editor.addPipe((context) => {
  if (context.type === "connectioncreate") {
    const source = editor.getNode(context.data.source);
    const target = editor.getNode(context.data.target);
    const outSocket = source.outputs[context.data.sourceOutput].socket;
    const inSocket = target.inputs[context.data.targetInput].socket;
    if (!inSocket.isCompatibleWith(outSocket)) {
      rejectedCount++;
      return; // stop propagation, exactly like validation.ts
    }
  }
  return context;
});

const inject = new ClassicPreset.Node("inject");
inject.addOutput("msg", new ClassicPreset.Output(new StringSocket(), "msg"));

const gpio = new ClassicPreset.Node("gpio_out");
gpio.addInput("signal", new ClassicPreset.Input(new BoolSocket(), "signal"));

await editor.addNode(inject);
await editor.addNode(gpio);

// Case A: string output -> bool-only input. Must be rejected.
await editor.addConnection(new ClassicPreset.Connection(inject, "msg", gpio, "signal"));
const afterMismatch = editor.getConnections().length;

// Case B: swap inject's output socket to Bool (mirrors the panel's
// retypeOutput()) and retry. Must succeed.
inject.outputs.msg.socket = new BoolSocket();
await editor.addConnection(new ClassicPreset.Connection(inject, "msg", gpio, "signal"));
const afterMatch = editor.getConnections().length;

console.log(JSON.stringify({
  mismatchRejected: afterMismatch === 0 && rejectedCount === 1,
  matchAccepted: afterMatch === 1,
  connectionsAfterMismatch: afterMismatch,
  connectionsAfterMatch: afterMatch,
  pipeRejectionCount: rejectedCount,
}, null, 2));

if (afterMismatch !== 0 || afterMatch !== 1) {
  console.error("CHECKPOINT 1 FAILED");
  process.exit(1);
}
console.log("CHECKPOINT 1 PASSED: incompatible connection never entered editor.getConnections(); compatible one did.");
