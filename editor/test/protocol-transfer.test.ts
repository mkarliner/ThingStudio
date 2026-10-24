// SPDX-License-Identifier: Apache-2.0
// editor/test/protocol-transfer.test.ts
//
// protocol/transfer.ts (the `editor.transfer` machine from interfaces/protocol/states.json) against a scripted fake
// board: resends, the commit's wait, restarts, failures, a lost connection, and illegal moves -- which must be
// reported, exactly once, and change nothing. protocol-exchanges.test.ts runs the shared conversation scripts.

import { describe, expect, it } from "vitest";
import { Machine } from "../src/protocol/machine.js";
import type { DepPutMessage, Message } from "../src/protocol/messages.js";
import { flowPieces, TransferSession, type TransferEvent, type TransferTiming } from "../src/protocol/transfer.js";

const FAST: TransferTiming = { pieceTimeoutMs: 30, pieceRetries: 2, commitTimeoutMs: 60 };

type Board = (sent: Message, reply: (m: Message) => void) => void;

/** A session talking to a fake board: `board` sees each sent line and may reply. */
function harness(board: Board, options: { isRestartHello?: () => boolean; send?: () => Promise<void> } = {}) {
  const sent: Message[] = [];
  const events: TransferEvent[] = [];
  const session: TransferSession = new TransferSession(
    {
      send: options.send ?? (async (m) => {
        sent.push(m);
        setTimeout(() => board(m, (r) => session.receive(r)), 0);
      }),
    },
    { timing: FAST, isRestartHello: options.isRestartHello, onEvent: (e) => events.push(e) },
  );
  const illegal = () => events.filter((e) => e.kind === "illegal");
  return { session, sent, events, illegal };
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
const PIECE = 4;

const goodBoard: Board = (m, reply) => {
  if (m.type === "FLOW_PUT") reply(flowAck(m.offset));
  if (m.type === "FLOW_COMMIT") reply(deployAck);
  if (m.type === "DEP_PUT") reply({ type: "DEP_ACK", name: m.name, file: m.file, offset: m.offset, ok: true, code: null, error: null });
  if (m.type === "DEP_COMMIT") reply({ type: "DEP_RESULT", name: m.name, ok: true, code: null, error: null, freeFlashBytes: 5 });
};

const lines = (sent: Message[]) => sent.map((m) => (m.type === "FLOW_PUT" ? `FLOW_PUT@${m.offset}` : m.type));

describe("flowPieces", () => {
  it("splits at pieceBytes and keeps an empty flow as one empty piece", () => {
    expect(flowPieces(BYTES, 4).map((p) => [p.offset, p.data.length, p.total])).toEqual([[0, 4, 10], [4, 4, 10], [8, 2, 10]]);
    expect(flowPieces(new Uint8Array(0), 4).map((p) => [p.offset, p.data.length])).toEqual([[0, 0]]);
  });
});

describe("TransferSession: deploy", () => {
  it("sends each piece after the last is answered, then the commit", async () => {
    const h = harness(goodBoard);
    const out = await h.session.deploy(BYTES, COMMIT, PIECE);
    expect(out.kind).toBe("deployed");
    expect(lines(h.sent)).toEqual(["FLOW_PUT@0", "FLOW_PUT@4", "FLOW_PUT@8", "FLOW_COMMIT"]);
    expect(h.sent[3]).toMatchObject({ type: "FLOW_COMMIT", total: 10, flowName: "f", deployId: "d1" });
    expect(h.illegal()).toEqual([]);
    expect(h.session.state).toBe("idle");
  });

  it("resends a piece whose answer was lost; the late answer is stale, not illegal", async () => {
    let slow = true;
    const h = harness((m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 4 && slow) {
        slow = false;
        setTimeout(() => reply(flowAck(4)), 45); // arrives after the resend went out
        return;
      }
      goodBoard(m, reply);
    });
    const out = await h.session.deploy(BYTES, COMMIT, PIECE);
    expect(out.kind).toBe("deployed");
    expect(lines(h.sent).slice(0, 3)).toEqual(["FLOW_PUT@0", "FLOW_PUT@4", "FLOW_PUT@4"]);
    expect(h.events.filter((e) => e.kind === "resend")).toMatchObject([{ reason: "timeout", attempt: 1 }]);
    await new Promise((r) => setTimeout(r, 60));
    expect(h.illegal()).toEqual([]);
  });

  it("resends straight away on a Garbled answer, for a piece or for the commit", async () => {
    const garble = new Set(["FLOW_PUT@0", "FLOW_COMMIT"]);
    const h = harness((m, reply) => {
      const key = lines([m])[0]!;
      if (garble.delete(key)) {
        reply(flowAck(0, false, "Garbled", "bad base64"));
        return;
      }
      goodBoard(m, reply);
    });
    const out = await h.session.deploy(BYTES, COMMIT, PIECE);
    expect(out.kind).toBe("deployed");
    expect(lines(h.sent)).toEqual(["FLOW_PUT@0", "FLOW_PUT@0", "FLOW_PUT@4", "FLOW_PUT@8", "FLOW_COMMIT", "FLOW_COMMIT"]);
  });

  it("gives up after pieceRetries resends with no answer, and sends no commit", async () => {
    const h = harness(() => {});
    const out = await h.session.deploy(BYTES, COMMIT, PIECE);
    expect(out).toMatchObject({ kind: "pieces-failed", failure: { code: "Timeout" } });
    expect(lines(h.sent)).toEqual(["FLOW_PUT@0", "FLOW_PUT@0", "FLOW_PUT@0"]);
  });

  it("stops at any refusal other than Garbled", async () => {
    const h = harness((m, reply) => {
      if (m.type === "FLOW_PUT") reply(flowAck(m.offset, false, "WriteFailed", "flash error"));
    });
    const out = await h.session.deploy(BYTES, COMMIT, PIECE);
    expect(out).toMatchObject({ kind: "pieces-failed", failure: { code: "WriteFailed", message: "flash error" } });
    expect(h.sent).toHaveLength(1);
  });

  it("takes a DEPLOY_ERROR MemoryError after a Garbled answer as part of that answer, not the result", async () => {
    let first = true;
    const h = harness((m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 0 && first) {
        first = false;
        reply(flowAck(0, false, "Garbled", "MemoryError"));
        reply({ type: "DEPLOY_ERROR", code: "MemoryError", message: "no room to receive the message" });
        return;
      }
      goodBoard(m, reply);
    });
    expect((await h.session.deploy(BYTES, COMMIT, PIECE)).kind).toBe("deployed");
    expect(h.illegal()).toEqual([]);
  });

  it("reports the commit's refusal, and no answer to it", async () => {
    const a = harness((m, reply) => {
      if (m.type === "FLOW_COMMIT") reply({ type: "DEPLOY_ERROR", code: "MissingDependency", message: "mqtt_as is not on the board" });
      else goodBoard(m, reply);
    });
    expect(await a.session.deploy(BYTES, COMMIT)).toEqual({ kind: "refused", code: "MissingDependency", message: "mqtt_as is not on the board" });
    const b = harness((m, reply) => {
      if (m.type !== "FLOW_COMMIT") goodBoard(m, reply);
    });
    expect(await b.session.deploy(BYTES, COMMIT)).toEqual({ kind: "no-answer", timeoutMs: FAST.commitTimeoutMs });
  });

  it("takes an unrequested HELLO as a restart, during the pieces or the commit", async () => {
    const a = harness((m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 4) reply(hello(null));
      else goodBoard(m, reply);
    });
    expect(await a.session.deploy(BYTES, COMMIT, PIECE)).toMatchObject({ kind: "restarted" });
    const b = harness((m, reply) => {
      if (m.type === "FLOW_COMMIT") reply(hello("d1"));
      else goodBoard(m, reply);
    });
    expect(await b.session.deploy(BYTES, COMMIT)).toMatchObject({ kind: "restarted", hello: { currentFlowDeployId: "d1" } });
  });

  it("ignores a HELLO that answers a HELLO_REQUEST", async () => {
    const h = harness(
      (m, reply) => {
        if (m.type === "FLOW_PUT" && m.offset === 4) reply(hello(null));
        goodBoard(m, reply);
      },
      { isRestartHello: () => false },
    );
    expect((await h.session.deploy(BYTES, COMMIT, PIECE)).kind).toBe("deployed");
    expect(h.illegal()).toEqual([]);
  });

  it("rejects when the connection is lost, and is idle again afterwards", async () => {
    const h = harness(() => {});
    const p = h.session.deploy(BYTES, COMMIT, PIECE);
    h.session.connectionLost("the board disconnected");
    await expect(p).rejects.toThrow("the board disconnected");
    expect(h.session.state).toBe("idle");
  });

  it("refuses a second transfer while one is under way", async () => {
    const h = harness(() => {});
    void h.session.deploy(BYTES, COMMIT, PIECE).catch(() => {});
    await expect(h.session.deploy(BYTES, COMMIT, PIECE)).rejects.toThrow("already under way");
    h.session.connectionLost("done");
  });
});

describe("TransferSession: illegal moves are reported, once, and change nothing", () => {
  it("an answer for a piece that was never sent", async () => {
    const h = harness((m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 0) reply(flowAck(8)); // ahead of anything sent
      goodBoard(m, reply);
    });
    expect((await h.session.deploy(BYTES, COMMIT, PIECE)).kind).toBe("deployed");
    expect(h.illegal()).toHaveLength(1);
    expect(h.illegal()[0]).toMatchObject({ move: { event: "strayAck", state: "sending" } });
  });

  it("a DEPLOY_ACK while pieces are still going", async () => {
    const h = harness((m, reply) => {
      if (m.type === "FLOW_PUT" && m.offset === 4) reply(deployAck);
      goodBoard(m, reply);
    });
    expect((await h.session.deploy(BYTES, COMMIT, PIECE)).kind).toBe("deployed");
    expect(h.illegal()).toMatchObject([{ move: { event: "strayResult", state: "sending" } }]);
  });

  it("an answer with nothing under way", () => {
    const h = harness(goodBoard);
    h.session.receive(deployAck);
    h.session.receive({ type: "DEP_RESULT", name: "x", ok: true, code: null, error: null, freeFlashBytes: 1 });
    expect(h.illegal().map((e) => e.kind === "illegal" && e.move.event)).toEqual(["strayResult", "strayResult"]);
    expect(h.session.state).toBe("idle");
  });

  it("but a Garbled answer outside a transfer (to an EXEC line, say) is legal", () => {
    const h = harness(goodBoard);
    h.session.receive(flowAck(0, false, "Garbled", "bad base64"));
    expect(h.illegal()).toEqual([]);
  });

  it("messages that aren't about transfers are not the machine's business", () => {
    const h = harness(goodBoard);
    h.session.receive({ type: "NODE_STATUS", nodeId: "n", state: "connected", text: null } as unknown as Message);
    h.session.receive(hello(null));
    expect(h.events).toEqual([]);
  });
});

describe("TransferSession: install", () => {
  const pieces: DepPutMessage[] = [
    { type: "DEP_PUT", name: "lib", file: "lib.mpy", offset: 0, total: 6, data: new Uint8Array(3) },
    { type: "DEP_PUT", name: "lib", file: "lib.mpy", offset: 3, total: 6, data: new Uint8Array(3) },
  ];
  const commit = { type: "DEP_COMMIT" as const, name: "lib", hash: "h", files: { "lib.mpy": 6 } };

  it("installs: pieces, commit, result", async () => {
    const h = harness(goodBoard);
    expect(await h.session.install(pieces, commit)).toMatchObject({ kind: "installed", result: { freeFlashBytes: 5 } });
    expect(lines(h.sent)).toEqual(["DEP_PUT", "DEP_PUT", "DEP_COMMIT"]);
  });

  it("resends a library piece the board couldn't read", async () => {
    let garble = true;
    const h = harness((m, reply) => {
      if (m.type === "DEP_PUT" && m.offset === 3 && garble) {
        garble = false;
        reply(flowAck(0, false, "Garbled", "bad base64"));
        return;
      }
      goodBoard(m, reply);
    });
    expect((await h.session.install(pieces, commit)).kind).toBe("installed");
    expect(lines(h.sent)).toEqual(["DEP_PUT", "DEP_PUT", "DEP_PUT", "DEP_COMMIT"]);
  });

  it("reports a refused piece and a refused commit", async () => {
    const a = harness((m, reply) => {
      if (m.type === "DEP_PUT") reply({ type: "DEP_ACK", name: "lib", file: "lib.mpy", offset: m.offset, ok: false, code: "NoSpace", error: "flash full" });
    });
    expect(await a.session.install(pieces, commit)).toMatchObject({ kind: "pieces-failed", failure: { code: "NoSpace" } });
    const b = harness((m, reply) => {
      if (m.type === "DEP_COMMIT") reply({ type: "DEP_RESULT", name: "lib", ok: false, code: "Incomplete", error: "lib: lib.mpy arrived incomplete", freeFlashBytes: null });
      else goodBoard(m, reply);
    });
    expect(await b.session.install(pieces, commit)).toEqual({ kind: "refused", code: "Incomplete", message: "lib: lib.mpy arrived incomplete" });
  });

  it("reports another library's result as illegal, and still takes its own", async () => {
    const h = harness((m, reply) => {
      if (m.type === "DEP_COMMIT") reply({ type: "DEP_RESULT", name: "other", ok: false, code: "X", error: "x", freeFlashBytes: null });
      goodBoard(m, reply);
    });
    expect((await h.session.install(pieces, commit)).kind).toBe("installed");
    expect(h.illegal()).toMatchObject([{ move: { event: "strayResult", state: "committing" } }]);
  });
});

describe("Machine", () => {
  it("refuses a table this side can't run", () => {
    expect(() => new Machine("editor.transfer", {}, {}, () => {})).toThrow(/needs .*canRetry/);
  });
});
