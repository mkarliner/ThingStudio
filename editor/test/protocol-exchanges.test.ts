// SPDX-License-Identifier: Apache-2.0
// editor/test/protocol-exchanges.test.ts
//
// The editor's half of interfaces/protocol/vectors/exchanges.json (SPEC.md §7). For each exchange that gives the
// editor something to do (a deploy or a library), protocol/transfer.ts runs against a scripted board: every message
// the editor sends must be the script's next editor line, and the script's board lines are played back in reply
// (except "lost" ones, which never arrive). The board runs the same file against its real listener
// (device-runtime/test/test_exchanges.py), so both sides are held to one conversation.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeMessageBody, encodeMessageBody } from "../src/protocol/codec.js";
import { MessageType, type DepPutMessage, type Message } from "../src/protocol/messages.js";
import { deployFlow, installLibrary, type TransferLink } from "../src/protocol/transfer.js";
import { libraryMessages } from "../src/compiler/flow-dependencies.js";

interface Step {
  editor?: Record<string, unknown>;
  board?: Record<string, unknown>;
  editorRaw?: string;
  garbled?: boolean;
  lost?: boolean;
}
interface Exchange {
  name: string;
  flowSource?: string;
  editor?: {
    deploy?: { bytes: unknown; pieceBytes: number };
    library?: { name: string; hash: string; files: Record<string, unknown>; pieceBytes: number };
  };
  outcome?: { kind: string; code?: string };
  steps: Step[];
}

const exchanges = (
  JSON.parse(readFileSync(new URL("../../interfaces/protocol/vectors/exchanges.json", import.meta.url), "utf8")) as {
    exchanges: Exchange[];
  }
).exchanges;

const TIMING = { pieceTimeoutMs: 40, pieceRetries: 2, commitTimeoutMs: 200 };

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/** {"$bytes"}, {"$flow"}, {"$flowLength"} -> values, recursively. */
function resolve(v: unknown, flow: Uint8Array): unknown {
  if (v && typeof v === "object" && !(v instanceof Uint8Array)) {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.$bytes === "string") return hexToBytes(o.$bytes);
    if (Object.keys(o).length === 1 && "$flow" in o) return flow;
    if (Object.keys(o).length === 1 && "$flowLength" in o) return flow.length;
    return Object.fromEntries(Object.entries(o).map(([k, val]) => [k, resolve(val, flow)]));
  }
  return v;
}

/** A script message as the codec would deliver it: through the real encoder and decoder, so absent optional
 * fields come back as null, and a message the codec wouldn't accept fails here. */
function normalize(raw: Record<string, unknown>, flow: Uint8Array): Message {
  const m = resolve(raw, flow) as Message;
  return decodeMessageBody(MessageType[m.type], encodeMessageBody(m));
}

function sameMessage(a: Message, b: Message): boolean {
  return Buffer.from(encodeMessageBody(a)).equals(Buffer.from(encodeMessageBody(b))) && a.type === b.type;
}

/** Plays `steps` as the board. Returns the link, and a check that every editor line was sent. */
function scriptedBoard(steps: Step[], flow: Uint8Array) {
  let cursor = 0;
  type Waiter = { match: (m: Message) => boolean; resolve: (m: Message) => void; timer: ReturnType<typeof setTimeout> };
  let waiters: Waiter[] = [];
  const deliver = (m: Message): void => {
    waiters = waiters.filter((w) => {
      if (!w.match(m)) return true;
      clearTimeout(w.timer);
      w.resolve(m);
      return false;
    });
  };
  const link: TransferLink = {
    send: async (sent) => {
      const step = steps[cursor];
      if (!step?.editor) throw new Error(`the editor sent ${sent.type}, but the script has no more editor lines here (step ${cursor})`);
      const want = normalize(step.editor, flow);
      if (!sameMessage(sent, want)) {
        throw new Error(`step ${cursor}: the editor sent ${JSON.stringify(sent, hexReplacer)}, the script says ${JSON.stringify(want, hexReplacer)}`);
      }
      cursor += 1;
      const replies: Message[] = [];
      while (cursor < steps.length && steps[cursor]!.board) {
        const b = steps[cursor]!;
        if (!b.lost) replies.push(normalize(b.board!, flow));
        cursor += 1;
      }
      setTimeout(() => replies.forEach(deliver), 0);
    },
    waitFor: (match, timeoutMs) =>
      new Promise((resolveP, reject) => {
        const w: Waiter = {
          match,
          resolve: resolveP,
          timer: setTimeout(() => {
            waiters = waiters.filter((x) => x !== w);
            reject(new Error("timeout waiting for device response"));
          }, timeoutMs),
        };
        waiters.push(w);
      }),
  };
  return { link, done: () => cursor === steps.length };
}

function hexReplacer(_k: string, v: unknown): unknown {
  return v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v;
}

describe("protocol exchanges (editor side)", () => {
  const forEditor = exchanges.filter((e) => e.editor);

  it("has exchanges for the editor to run", () => {
    expect(forEditor.length).toBeGreaterThan(0);
  });

  for (const ex of forEditor) {
    it(ex.name, async () => {
      const flow = new TextEncoder().encode(ex.flowSource ?? "");
      const board = scriptedBoard(ex.steps, flow);
      let kind: string;
      let code: string | undefined;
      if (ex.editor!.deploy) {
        const d = ex.editor!.deploy;
        const commitStep = ex.steps.find((s) => s.editor?.type === "FLOW_COMMIT")!;
        const commit = normalize(commitStep.editor!, flow) as Message & { type: "FLOW_COMMIT" };
        const { type: _t, total: _total, ...rest } = commit;
        const outcome = await deployFlow(board.link, resolve(d.bytes, flow) as Uint8Array, rest, { pieceBytes: d.pieceBytes, timing: TIMING });
        kind = outcome.kind;
        code = outcome.kind === "refused" ? outcome.code : outcome.kind === "pieces-failed" ? outcome.failure.code : undefined;
      } else {
        const l = ex.editor!.library!;
        const files = Object.fromEntries(Object.entries(l.files).map(([f, v]) => [f, resolve(v, flow) as Uint8Array]));
        const { pieces, commit } = libraryMessages(l.name, l.hash, files, l.pieceBytes);
        const outcome = await installLibrary(board.link, pieces as DepPutMessage[], commit, { timing: TIMING });
        kind = outcome.kind;
        code = outcome.kind === "refused" ? outcome.code : outcome.kind === "pieces-failed" ? outcome.failure.code : undefined;
      }
      expect({ kind, code: ex.outcome?.code === undefined ? undefined : code }).toEqual({ kind: ex.outcome!.kind, code: ex.outcome!.code });
      expect(board.done(), "the editor stopped before the script's last line").toBe(true);
    });
  }
});
