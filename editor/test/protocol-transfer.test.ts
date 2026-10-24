// SPDX-License-Identifier: Apache-2.0
// editor/test/protocol-transfer.test.ts
//
// protocol/transfer.ts against a scripted fake board: the editor's half of SPEC §7 (resends, the commit's wait,
// restarts, failures). The shared exchange vectors (protocol-exchanges.test.ts) check the same conversations
// against the script both sides run; these cover the editor-only cases (a disconnect, the restart rule).

import { describe, expect, it } from "vitest";
import type { Message } from "../src/protocol/messages.js";
import { deployFlow, flowPieces, installLibrary, sendPieces, type TransferEvent, type TransferLink, type TransferTiming } from "../src/protocol/transfer.js";

const FAST: TransferTiming = { pieceTimeoutMs: 30, pieceRetries: 2, commitTimeoutMs: 60 };

type Board = (sent: Message, reply: (m: Message) => void) => void;

/** A link to a fake board: `board` sees each sent message and may reply. Replies resolve every matching wait,
 * like app/main.ts's onMessage does. */
function fakeLink(board: Board): { link: TransferLink; sent: Message[]; reply: (m: Message) => void } {
  type Waiter = { match: (m: Message) => boolean; resolve: (m: Message) => void; timer: ReturnType<typeof setTimeout> };
  let waiters: Waiter[] = [];
  const sent: Message[] = [];
  const reply = (m: Message): void => {
    waiters = waiters.filter((w) => {
      if (!w.match(m)) return true;
      clearTimeout(w.timer);
      w.resolve(m);
      return false;
    });
  };
  const link: TransferLink = {
    send: async (m) => {
      sent.push(m);
      setTimeout(() => board(m, reply), 0);
    },
    waitFor: (match, timeoutMs) =>
      new Promise((resolve, reject) => {
        const w: Waiter = {
          match,
          resolve,
          timer: setTimeout(() => {
            waiters = waiters.filter((x) => x !== w);
            reject(new Error("timeout waiting for device response"));
          }, timeoutMs),
        };
        waiters.push(w);
      }),
  };
  return { link, sent, reply };
}

const flowAck = (offset: number, ok = true, code: string | null = null, error: string | null = null): Message => ({
  type: "FLOW_ACK", offset, ok, code, error,
});
const deployAck: Message = { type: "DEPLOY_ACK", freeFlashBytes: 1000, freeRamBytes: 2000, freeIdfHeapBytes: null, largestIdfHeapBlockBytes: null };
const hello = (deployId: string | null): Message => ({
  type: "HELLO", chipType: "esp32", runtimeVersion: { major: 13, minor: 1, patch: 0 }, runtimeBuild: null,
  currentFlowName: deployId ? "f" : null, currentFlowDeployId: deployId, freeFlashBytes: 1, freeRamBytes: 1,
  freeIdfHeapBytes: null, largestIdfHeapBlockBytes: null, safeMode: false, hostname: null, authRequired: false,
  authScheme: null, hasWifi: false, networkAddress: null, dependencies: null,
});
const COMMIT = { flowName: "f", deployId: "d1", wifiProvision: null, dependencies: null, staticData: null };
const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

/** A well-behaved board: stores every piece, answers the commit. */
const goodBoard: Board = (m, reply) => {
  if (m.type === "FLOW_PUT") reply(flowAck(m.offset));
  if (m.type === "FLOW_COMMIT") reply(deployAck);
  if (m.type === "DEP_PUT") reply({ type: "DEP_ACK", name: m.name, file: m.file, offset: m.offset, ok: true, code: null, error: null });
  if (m.type === "DEP_COMMIT") reply({ type: "DEP_RESULT", name: m.name, ok: true, code: null, error: null, freeFlashBytes: 5 });
};

const types = (sent: Message[]) => sent.map((m) => (m.type === "FLOW_PUT" ? `FLOW_PUT@${m.offset}` : m.type));

describe("flowPieces", () => {
  it("splits at pieceBytes and keeps an empty flow as one empty piece", () => {
    expect(flowPieces(BYTES, 4).map((p) => [p.offset, p.data.length, p.total])).toEqual([[0, 4, 10], [4, 4, 10], [8, 2, 10]]);
    expect(flowPieces(new Uint8Array(0), 4).map((p) => [p.offset, p.data.length])).toEqual([[0, 0]]);
  });
});

describe("deployFlow", () => {
  it("sends each piece after the last is answered, then the commit", async () => {
    const { link, sent } = fakeLink(goodBoard);
    const out = await deployFlow(link, BYTES, COMMIT, { pieceBytes: 4, timing: FAST });
    expect(out.kind).toBe("deployed");
    expect(types(sent)).toEqual(["FLOW_PUT@0", "FLOW_PUT@4", "FLOW_PUT@8", "FLOW_COMMIT"]);
    expect(sent[3]).toMatchObject({ type: "FLOW_COMMIT", total: 10, flowName: "f", deployId: "d1" });
  });

  it("resends a piece whose answer was lost, then carries on (SPEC §7.2: any piece may be resent)", async () => {
    let lost = true;
    const events: TransferEvent[] = [];
    const { link, sent } = fakeLink((m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 4 && lost) {
        lost = false; // stored, but the ack never arrives
        return;
      }
      goodBoard(m, reply);
    });
    const out = await deployFlow(link, BYTES, COMMIT, { pieceBytes: 4, timing: FAST, onEvent: (e) => events.push(e) });
    expect(out.kind).toBe("deployed");
    expect(types(sent)).toEqual(["FLOW_PUT@0", "FLOW_PUT@4", "FLOW_PUT@4", "FLOW_PUT@8", "FLOW_COMMIT"]);
    expect(events).toMatchObject([{ kind: "resend", reason: "timeout", attempt: 1 }]);
  });

  it("resends straight away on a Garbled answer", async () => {
    let garble = true;
    const events: TransferEvent[] = [];
    const { link, sent } = fakeLink((m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 0 && garble) {
        garble = false;
        reply(flowAck(0, false, "Garbled", "bad base64"));
        return;
      }
      goodBoard(m, reply);
    });
    const out = await deployFlow(link, BYTES, COMMIT, { pieceBytes: 4, timing: { ...FAST, pieceTimeoutMs: 5000 }, onEvent: (e) => events.push(e) });
    expect(out.kind).toBe("deployed");
    expect(types(sent).slice(0, 2)).toEqual(["FLOW_PUT@0", "FLOW_PUT@0"]);
    expect(events).toMatchObject([{ reason: "garbled", detail: "bad base64" }]);
  });

  it("gives up after pieceRetries resends with no answer, and sends no commit", async () => {
    const { link, sent } = fakeLink(() => {});
    const out = await deployFlow(link, BYTES, COMMIT, { pieceBytes: 4, timing: FAST });
    expect(out).toMatchObject({ kind: "pieces-failed", failure: { code: "Timeout" } });
    expect(types(sent)).toEqual(["FLOW_PUT@0", "FLOW_PUT@0", "FLOW_PUT@0"]);
  });

  it("stops at any refusal other than Garbled", async () => {
    const { link, sent } = fakeLink((m, reply) => {
      if (m.type === "FLOW_PUT") reply(flowAck(m.offset, false, "WriteFailed", "flash error"));
    });
    const out = await deployFlow(link, BYTES, COMMIT, { pieceBytes: 4, timing: FAST });
    expect(out).toMatchObject({ kind: "pieces-failed", failure: { code: "WriteFailed", message: "flash error" } });
    expect(sent).toHaveLength(1);
  });

  it("does not take a DEPLOY_ERROR sent during the pieces as the commit's answer (audit finding 4)", async () => {
    let first = true;
    const { link } = fakeLink((m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 0 && first) {
        first = false;
        reply(flowAck(0, false, "Garbled", "MemoryError"));
        reply({ type: "DEPLOY_ERROR", code: "MemoryError", message: "no room to decode the message" });
        return;
      }
      goodBoard(m, reply);
    });
    const out = await deployFlow(link, BYTES, COMMIT, { pieceBytes: 4, timing: FAST });
    expect(out.kind).toBe("deployed");
  });

  it("reports the commit's refusal", async () => {
    const { link } = fakeLink((m, reply) => {
      if (m.type === "FLOW_COMMIT") reply({ type: "DEPLOY_ERROR", code: "MissingDependency", message: "mqtt_as is not on the board" });
      else goodBoard(m, reply);
    });
    expect(await deployFlow(link, BYTES, COMMIT, { timing: FAST })).toEqual({
      kind: "refused", code: "MissingDependency", message: "mqtt_as is not on the board",
    });
  });

  it("reports no answer to the commit", async () => {
    const { link } = fakeLink((m, reply) => {
      if (m.type !== "FLOW_COMMIT") goodBoard(m, reply);
    });
    expect(await deployFlow(link, BYTES, COMMIT, { timing: FAST })).toEqual({ kind: "no-answer", timeoutMs: FAST.commitTimeoutMs });
  });

  it("takes a HELLO in place of the commit's answer as a restart", async () => {
    const { link } = fakeLink((m, reply) => {
      if (m.type === "FLOW_COMMIT") reply(hello("d1"));
      else goodBoard(m, reply);
    });
    const out = await deployFlow(link, BYTES, COMMIT, { timing: FAST });
    expect(out).toMatchObject({ kind: "restarted", hello: { currentFlowDeployId: "d1" } });
  });

  it("ends the pieces on a restart HELLO, but not on one that answers a HELLO_REQUEST", async () => {
    const restartBoard: Board = (m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 4) reply(hello(null));
      else goodBoard(m, reply);
    };
    const a = fakeLink(restartBoard);
    expect(await deployFlow(a.link, BYTES, COMMIT, { pieceBytes: 4, timing: FAST })).toMatchObject({ kind: "restarted" });
    expect(types(a.sent)).toEqual(["FLOW_PUT@0", "FLOW_PUT@4"]);

    const b = fakeLink((m, reply) => {
      restartBoard(m, reply);
      if (m.type === "FLOW_PUT" && m.offset === 4) reply(flowAck(4));
    });
    const out = await deployFlow(b.link, BYTES, COMMIT, { pieceBytes: 4, timing: FAST, isRestartHello: () => false });
    expect(out.kind).toBe("deployed");
  });

  it("rejects when the link fails (a disconnect), rather than resending", async () => {
    const link: TransferLink = {
      send: async () => {},
      waitFor: () => Promise.reject(new Error("disconnected")),
    };
    await expect(deployFlow(link, BYTES, COMMIT, { timing: FAST })).rejects.toThrow("disconnected");
  });
});

describe("installLibrary", () => {
  const pieces = [
    { type: "DEP_PUT" as const, name: "lib", file: "lib.mpy", offset: 0, total: 6, data: new Uint8Array(3) },
    { type: "DEP_PUT" as const, name: "lib", file: "lib.mpy", offset: 3, total: 6, data: new Uint8Array(3) },
  ];
  const commit = { type: "DEP_COMMIT" as const, name: "lib", hash: "h", files: { "lib.mpy": 6 } };

  it("installs: pieces, commit, result", async () => {
    const { link, sent } = fakeLink(goodBoard);
    expect(await installLibrary(link, pieces, commit, { timing: FAST })).toMatchObject({ kind: "installed", result: { freeFlashBytes: 5 } });
    expect(types(sent)).toEqual(["DEP_PUT", "DEP_PUT", "DEP_COMMIT"]);
  });

  it("resends a library piece the board couldn't read (the Garbled answer is about the last line sent)", async () => {
    let garble = true;
    const { link, sent } = fakeLink((m, reply) => {
      if (m.type === "DEP_PUT" && m.offset === 3 && garble) {
        garble = false;
        reply(flowAck(0, false, "Garbled", "bad base64"));
        return;
      }
      goodBoard(m, reply);
    });
    expect((await installLibrary(link, pieces, commit, { timing: { ...FAST, pieceTimeoutMs: 5000 } })).kind).toBe("installed");
    expect(types(sent)).toEqual(["DEP_PUT", "DEP_PUT", "DEP_PUT", "DEP_COMMIT"]);
  });

  it("reports a refused piece and a refused commit", async () => {
    const a = fakeLink((m, reply) => {
      if (m.type === "DEP_PUT") reply({ type: "DEP_ACK", name: "lib", file: "lib.mpy", offset: m.offset, ok: false, code: "NoSpace", error: "flash full" });
    });
    expect(await installLibrary(a.link, pieces, commit, { timing: FAST })).toMatchObject({ kind: "pieces-failed", failure: { code: "NoSpace" } });
    const b = fakeLink((m, reply) => {
      if (m.type === "DEP_COMMIT") reply({ type: "DEP_RESULT", name: "lib", ok: false, code: "Incomplete", error: "lib: lib.mpy arrived incomplete", freeFlashBytes: null });
      else goodBoard(m, reply);
    });
    expect(await installLibrary(b.link, pieces, commit, { timing: FAST })).toEqual({ kind: "refused", code: "Incomplete", message: "lib: lib.mpy arrived incomplete" });
  });

  it("ignores another library's answers", async () => {
    const { link } = fakeLink((m, reply) => {
      if (m.type === "DEP_COMMIT") {
        reply({ type: "DEP_RESULT", name: "other", ok: false, code: "X", error: "x", freeFlashBytes: null });
        reply({ type: "DEP_RESULT", name: "lib", ok: true, code: null, error: null, freeFlashBytes: 1 });
      } else goodBoard(m, reply);
    });
    expect((await installLibrary(link, pieces, commit, { timing: FAST })).kind).toBe("installed");
  });
});

describe("sendPieces", () => {
  it("sends nothing for no pieces", async () => {
    const { link, sent } = fakeLink(goodBoard);
    expect(await sendPieces(link, [], { timing: FAST })).toBeNull();
    expect(sent).toEqual([]);
  });
});
