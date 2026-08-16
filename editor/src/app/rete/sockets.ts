// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/sockets.ts
//
// Sub-decision 3 (rete-migration-decision.md): the real editor has no wire
// type checking today -- every port in app/nodes.ts is declared "*"
// (LG.addOutput("msg", "*"), LG.addInput("signal", "*") despite gpio_out's
// own "bool-only input" description). This migration preserves that
// behavior exactly instead of introducing a type system Rete would make
// easy to add -- §6's real socket types are their own task, immediately
// after this migration, so any regression stays attributable (same
// sequencing reasoning as POC-D's).
//
// One socket class, used for every port on every node type in nodes.ts --
// this IS the "*"-equivalent, not a placeholder for a half-built type
// system. `ClassicPreset.Socket` itself declares no `isCompatibleWith` --
// validation.ts needs a type that says one exists without casting to `any`
// at every call site, same reasoning pocs/poc-rete/src/sockets.ts's own
// `ThingstudioSocket` interface gives.

import { ClassicPreset } from "rete";

export interface ThingstudioSocket extends ClassicPreset.Socket {
  isCompatibleWith(socket: ClassicPreset.Socket): boolean;
}

export class AnySocket extends ClassicPreset.Socket implements ThingstudioSocket {
  constructor() {
    super("any");
  }
  isCompatibleWith(): boolean {
    return true;
  }
}
