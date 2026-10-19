// The worker-backed hook runner: reuse, timeout-termination and restart, with a fake worker (the real
// Worker cannot be constructed in Vitest's Node environment).

import { describe, expect, it, vi } from "vitest";
import type { CompileContext } from "../src/node-library/compile-context.js";
import { createWorkerHookRunner, type HookWorkerHandle, type HookWorkerFactory } from "../src/compile-hook/runner.js";

const context = { version: 1, node: {}, flow: { nodes: [], configs: [] }, referencedConfigs: {}, target: null } as unknown as CompileContext;

type Responder = (message: Record<string, unknown>, reply: (m: unknown) => void) => void;

class FakeWorker implements HookWorkerHandle {
  terminated = false;
  sent: Record<string, unknown>[] = [];
  private handler?: (m: unknown) => void;
  private errorHandler?: (e: unknown) => void;
  constructor(private readonly respond: Responder) {}
  postMessage(message: unknown): void {
    const msg = message as Record<string, unknown>;
    this.sent.push(msg);
    this.respond(msg, (reply) => this.handler?.(reply));
  }
  onMessage(handler: (message: unknown) => void): void {
    this.handler = handler;
    handler({ type: "ready" });
  }
  onError(handler: (error: unknown) => void): void {
    this.errorHandler = handler;
  }
  fail(error: unknown): void {
    this.errorHandler?.(error);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function factory(respond: Responder): { create: HookWorkerFactory; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const create: HookWorkerFactory = () => {
    const w = new FakeWorker(respond);
    workers.push(w);
    return w;
  };
  return { create, workers };
}

const echo: Responder = (message, reply) => {
  if (message.type === "run") reply({ type: "result", id: message.id, ok: true, value: { properties: { seen: message.id } } });
};

describe("createWorkerHookRunner", () => {
  it("runs hooks through one worker and returns the worker's value", async () => {
    const { create, workers } = factory(echo);
    const runner = createWorkerHookRunner({ createWorker: create });
    await expect(runner.run("hook", context, {}, "x")).resolves.toEqual({ properties: { seen: 1 } });
    await expect(runner.run("hook", context, {}, "x")).resolves.toEqual({ properties: { seen: 2 } });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBe(false);
    expect(workers[0]!.sent.filter((m) => m.type === "run")).toHaveLength(2);
  });

  it("a hook error comes back as a rejected run", async () => {
    const { create } = factory((message, reply) => {
      if (message.type === "run") reply({ type: "result", id: message.id, ok: false, error: "compile hook raised ValueError: bad" });
    });
    const runner = createWorkerHookRunner({ createWorker: create });
    await expect(runner.run("hook", context, {}, "x")).rejects.toThrow(/ValueError: bad/);
  });

  it("a timeout terminates the worker, rejects, and the next call gets a fresh worker", async () => {
    vi.useFakeTimers();
    try {
      let runCount = 0;
      const { create, workers } = factory((message, reply) => {
        if (message.type !== "run") return;
        runCount++;
        if (runCount === 1) return; // never answers -> timeout
        reply({ type: "result", id: message.id, ok: true, value: { properties: { ok: true } } });
      });
      const runner = createWorkerHookRunner({ createWorker: create, timeoutMs: 1000 });
      const first = runner.run("loop", context, {}, "x");
      const assertion = expect(first).rejects.toThrow(/timed out after 1000 ms/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(workers[0]!.terminated).toBe(true);

      const second = runner.run("hook", context, {}, "x");
      await vi.advanceTimersByTimeAsync(0);
      await expect(second).resolves.toEqual({ properties: { ok: true } });
      expect(workers).toHaveLength(2);
      expect(workers[1]!.terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a worker that never becomes ready times out instead of hanging", async () => {
    vi.useFakeTimers();
    try {
      const handle: HookWorkerHandle = {
        postMessage: () => {},
        onMessage: () => {},
        onError: () => {},
        terminate: vi.fn(),
      };
      const runner = createWorkerHookRunner({ createWorker: () => handle, initTimeoutMs: 100 });
      const run = runner.run("hook", context, {}, "x");
      const assertion = expect(run).rejects.toThrow(/did not start within 100 ms/);
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(handle.terminate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a worker script load error rejects the run instead of hanging", async () => {
    let fail: ((e: unknown) => void) | undefined;
    const handle: HookWorkerHandle = {
      postMessage: () => {},
      onMessage: () => {},
      onError: (handler) => {
        fail = handler;
      },
      terminate: vi.fn(),
    };
    const runner = createWorkerHookRunner({ createWorker: () => handle });
    const run = runner.run("hook", context, {}, "x");
    const assertion = expect(run).rejects.toThrow(/failed to start: script load failed/);
    fail?.(new Error("script load failed"));
    await assertion;
    expect(handle.terminate).toHaveBeenCalled();
  });

  it("an interpreter that fails to load rejects the run instead of hanging", async () => {
    const runner = createWorkerHookRunner({
      createWorker: (url) => {
        // Replace the ready handshake with an init error.
        const handle: HookWorkerHandle = {
          postMessage: () => {},
          onMessage: (handler) => handler({ type: "init-error", error: `could not load ${url}` }),
          onError: () => {},
          terminate: () => {},
        };
        return handle;
      },
    });
    await expect(runner.run("hook", context, {}, "x")).rejects.toThrow(/could not load/);
  });
});
