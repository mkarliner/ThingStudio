// SPDX-License-Identifier: Apache-2.0
// editor/src/app/rete/validation.ts
//
// Checkpoint 1's mechanism (rete-migration-decision.md's evidence base,
// pocs/poc-rete/README.md), wired in as live infrastructure back when
// sockets.ts's single AnySocket always returned true from isCompatibleWith
// (sub-decision 3 -- no type system in that session). This pipe is why
// §6's real socket types (sockets.ts, wire-type-system-scoping.md) could
// be dropped in later without also having to build this interception
// point at the same time: editor.addPipe intercepts every
// `connectioncreate` message before editor.addConnection() adds it to the
// graph -- the same call a real drag's drop gesture makes internally --
// so a rejected connection is never added and never rendered
// (architecturally the same class of behavior as Litegraph's
// isValidConnection, "can't drop it", not Drawflow's "flash then rip
// out"). Ported from pocs/poc-rete/src/validation.ts; see that file's
// header for the fuller mechanism writeup and what is/isn't confirmed
// about real-browser drag feel.

import type { Schemes, Editor } from "./schemes";
import type { ThingstudioSocket } from "./sockets";

export function getConnectionSockets(editor: Editor, connection: Schemes["Connection"]) {
  const source = editor.getNode(connection.source);
  const target = editor.getNode(connection.target);
  const output = source && (source.outputs as Record<string, { socket: ThingstudioSocket } | undefined>)[connection.sourceOutput];
  const input = target && (target.inputs as Record<string, { socket: ThingstudioSocket } | undefined>)[connection.targetInput];

  return { source: output?.socket, target: input?.socket };
}

export function canCreateConnection(editor: Editor, connection: Schemes["Connection"]): boolean {
  const { source, target } = getConnectionSockets(editor, connection);
  // Input decides what it accepts, matching §6's real "editor refuses the
  // connection outright" contract. Every socket type this app ever
  // constructs (sockets.ts) implements isCompatibleWith -- ThingstudioSocket
  // documents that as a real contract instead of casting to `any` at each
  // call site.
  return !!source && !!target && target.isCompatibleWith(source);
}

export function installConnectionValidation(editor: Editor, onRejected?: (connection: Schemes["Connection"]) => void): void {
  editor.addPipe((context) => {
    if (context.type === "connectioncreate") {
      if (!canCreateConnection(editor, context.data)) {
        onRejected?.(context.data);
        return; // stop propagation -- same mechanism the Validation guide documents
      }
    }
    return context;
  });
}
