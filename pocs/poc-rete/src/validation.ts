// Thingstudio poc-rete — checkpoint 1 (rete-spike-briefing.md #1): does
// Rete's socket-type system reject an invalid connection mid-drag, or only
// after the fact ("connect then validate and rip it back out" — the
// Drawflow pattern that lost the original POC-C comparison)?
//
// Mechanism, per retejs.org/docs/guides/validation#connections-validation:
// `editor.addPipe` intercepts every `connectioncreate` message. Returning
// `undefined` (a bare `return`) stops the message — the SAME call
// `editor.addConnection()` makes internally when the connection-plugin's
// drag gesture completes on drop, and that call happens BEFORE any
// render-plugin listener draws the wire (render plugins subscribe to the
// same pipe, downstream of validation, not upstream of it). So a rejected
// connection is never added to the graph and never rendered — architecturally
// the same class of behavior as Litegraph's `isValidConnection` ("can't drop
// it"), not Drawflow's hand-rolled `connectionCreated` handler that lets the
// wire form and then calls `removeSingleConnection()` a frame later ("flash
// then reject"). Confirmed programmatically in the test below (the
// connection is never present in `editor.getConnections()`), which exercises
// the exact interception point a real drag uses. What this file's headless
// test does NOT confirm: what the cursor/wire actually look like mid-drag in
// a real browser (does Rete give any visual "can't drop here" affordance, or
// does the wire just silently fail to attach on release?) — that's a real,
// open UX detail the docs don't specify, and per this project's own
// convention it's Mike's hands-on judgment call, not something to assume
// from the pipe architecture alone.

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
  // connection outright" contract (the input socket's isCompatibleWith is
  // the one poc-c's port-type table actually enforces). Every socket type
  // this app ever constructs (sockets.ts) implements `isCompatibleWith` —
  // `ThingstudioSocket` documents that as a real contract instead of
  // casting to `any` at each call site.
  return !!source && !!target && target.isCompatibleWith(source);
}

export function installConnectionValidation(editor: Editor, onRejected?: (connection: Schemes["Connection"]) => void): void {
  editor.addPipe((context) => {
    if (context.type === "connectioncreate") {
      if (!canCreateConnection(editor, context.data)) {
        onRejected?.(context.data);
        return; // stop propagation — same mechanism the Validation guide documents
      }
    }
    return context;
  });
}
