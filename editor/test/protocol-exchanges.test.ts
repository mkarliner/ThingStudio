// SPDX-License-Identifier: Apache-2.0
// editor/test/protocol-exchanges.test.ts
//
// The editor's half of interfaces/protocol/vectors/exchanges.json (SPEC.md §7). For each exchange that gives the
// editor something to do (a deploy or a library), a TransferSession (protocol/transfer.ts, the editor.transfer
// machine) runs against a scripted board: every message the editor sends must be the script's next editor line,
// and the script's board lines are played back in reply -- except "lost" ones, which never arrive. A board line
// marked "illegal" must be reported as an illegal move; nothing else may be. The board runs the same file against
// its real listener (device-runtime/test/test_exchanges.py), so both sides are held to one conversation.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeMessageBody, encodeMessageBody } from "../src/protocol/codec.js";
import { MessageType, type Message } from "../src/protocol/messages.js";
import { TransferSession, type TransferEvent, type TransferOutcome } from "../src/protocol/transfer.js";
import { libraryMessages } from "../src/compiler/flow-dependencies.js";

interface Step {
  editor?: Record<string, unknown>;
  board?: Record<string, unknown>;
  editorRaw?: string;
  garbled?: boolean;
  lost?: boolean;
  illegal?: boolean;
}
interface Exchange {
  name: string;
  sides?: string[];
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

/** {"$bytes"}, {"$flow"}, {"$flowLength"} -> values, recursively. */
function resolve(v: unknown, flow: Uint8Array): unknown {
  if (v && typeof v === "object" && !(v instanceof Uint8Array)) {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.$bytes === "string") return Uint8Array.from(Buffer.from(o.$bytes, "hex"));
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
  return a.type === b.type && Buffer.from(encodeMessageBody(a)).equals(Buffer.from(encodeMessageBody(b)));
}

function hex(_k: string, v: unknown): unknown {
  return v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v;
}

describe("protocol exchanges (editor side)", () => {
  const forEditor = exchanges.filter((e) => e.editor && (e.sides ?? ["board", "editor"]).includes("editor"));

  it("has exchanges for the editor to run", () => {
    expect(forEditor.length).toBeGreaterThan(0);
  });

  for (const ex of forEditor) {
    it(ex.name, async () => {
      const flow = new TextEncoder().encode(ex.flowSource ?? "");
      const steps = ex.steps;
      let cursor = 0;
      const events: TransferEvent[] = [];
      const session: TransferSession = new TransferSession(
        {
          send: async (sent) => {
            const step = steps[cursor];
            if (!step?.editor) throw new Error(`the editor sent ${sent.type}, but the script has no editor line here (step ${cursor})`);
            const want = normalize(step.editor, flow);
            if (!sameMessage(sent, want)) {
              throw new Error(`step ${cursor}: the editor sent ${JSON.stringify(sent, hex)}, the script says ${JSON.stringify(want, hex)}`);
            }
            cursor += 1;
            const replies: Message[] = [];
            while (cursor < steps.length && steps[cursor]!.board) {
              const b = steps[cursor]!;
              if (!b.lost) replies.push(normalize(b.board!, flow));
              cursor += 1;
            }
            setTimeout(() => replies.forEach((r) => session.receive(r)), 0);
          },
        },
        { timing: TIMING, onEvent: (e) => events.push(e) },
      );

      let outcome: TransferOutcome;
      if (ex.editor!.deploy) {
        const d = ex.editor!.deploy;
        const commit = normalize(steps.find((s) => s.editor?.type === "FLOW_COMMIT")!.editor!, flow) as Message & { type: "FLOW_COMMIT" };
        const { type: _t, total: _total, ...rest } = commit;
        outcome = await session.deploy(resolve(d.bytes, flow) as Uint8Array, rest, d.pieceBytes);
      } else {
        const l = ex.editor!.library!;
        const files = Object.fromEntries(Object.entries(l.files).map(([f, v]) => [f, resolve(v, flow) as Uint8Array]));
        const { pieces, commit } = libraryMessages(l.name, l.hash, files, l.pieceBytes);
        outcome = await session.install(pieces, commit);
      }
      const code = outcome.kind === "refused" ? outcome.code : outcome.kind === "pieces-failed" ? outcome.failure.code : undefined;
      expect({ kind: outcome.kind, code: ex.outcome?.code === undefined ? undefined : code }).toEqual({ kind: ex.outcome!.kind, code: ex.outcome!.code });
      expect(cursor, "the editor stopped before the script's last line").toBe(steps.length);
      const illegal = events.filter((e) => e.kind === "illegal");
      expect(illegal.length, `illegal moves reported: ${JSON.stringify(illegal)}`).toBe(steps.filter((s) => s.board && s.illegal).length);
    });
  }
});
