// Thingstudio poc-rete — socket types for the canvas-feel comparison spike
// (see rete-spike-briefing.md; mirrors pocs/poc-c/nodes.js's port-type contract
// exactly, so the mid-drag rejection checkpoint tests the same case POC-C did).
//
// design doc §6: "payload is typed from a small fixed set ... the editor still
// checks payload type compatibility at wire-connect time". Rete has no built-in
// notion of socket "type" beyond identity — compatibility is whatever
// `isCompatibleWith` says, which is exactly the hook validation.ts's
// `connectioncreate` pipe calls. This file is the only place that contract is
// defined.

import { ClassicPreset } from "rete";

// `ClassicPreset.Socket` itself declares no `isCompatibleWith` — every
// concrete socket below adds it, and validation.ts needs a type that
// says so without casting to `any` at every call site.
export interface ThingstudioSocket extends ClassicPreset.Socket {
  isCompatibleWith(socket: ClassicPreset.Socket): boolean;
}

export class BoolSocket extends ClassicPreset.Socket {
  constructor() {
    super("bool");
  }
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    // Deliberately strict, mirrors gpio_out's bool-only input in poc-c —
    // this is the one checkpoint-1 case actually worth failing on.
    return socket instanceof BoolSocket;
  }
}

export class NumberSocket extends ClassicPreset.Socket {
  constructor() {
    super("number");
  }
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    return socket instanceof NumberSocket;
  }
}

export class StringSocket extends ClassicPreset.Socket {
  constructor() {
    super("string");
  }
  isCompatibleWith(socket: ClassicPreset.Socket): boolean {
    return socket instanceof StringSocket;
  }
}

// "*"/any in poc-c — function/debug/mqtt_out inputs. Accepts any of the three
// concrete payload sockets above (inject's output is always one of those
// three, never AnySocket itself, so this doesn't need to accept "any output
// socket" in general, just these three).
export class AnySocket extends ClassicPreset.Socket {
  constructor() {
    super("any");
  }
  isCompatibleWith(): boolean {
    return true;
  }
}

export function socketForPayloadType(type: "bool" | "number" | "string"): ClassicPreset.Socket {
  if (type === "bool") return new BoolSocket();
  if (type === "number") return new NumberSocket();
  return new StringSocket();
}
