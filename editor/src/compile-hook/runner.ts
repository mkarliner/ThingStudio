// SPDX-License-Identifier: Apache-2.0
// editor/src/compile-hook/runner.ts
//
// The worker-backed CompileHookRunner (node-library/compile-hooks.ts's injected runner): a persistent
// browser Worker that loads the WASI interpreter once, runs one hook per request, and is terminated and
// recreated when a hook exceeds its wall-clock budget. Termination is the containment boundary -- a
// synchronous interpreter cannot be interrupted in place.
//
// The worker factory is injected so the runner can be tested without a real Worker.

import type { CompileHookRunner } from "../node-library/compile-hooks.js";
import type { CompileContext } from "../node-library/compile-context.js";

export interface HookWorkerHandle {
  postMessage(message: unknown): void;
  /** Called once; the runner routes every message from this worker through it. */
  onMessage(handler: (message: unknown) => void): void;
  terminate(): void;
}

export type HookWorkerFactory = (wasmUrl: string) => HookWorkerHandle;

export const DEFAULT_HOOK_WASM_URL = "/vendor/micropython-wasi/micropython-wasi.wasm";

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorkerHookRunnerOptions {
  readonly wasmUrl?: string;
  /** Per hook, milliseconds (interfaces/node-compile-context/SPEC.md, 1 s). */
  readonly timeoutMs?: number;
  readonly createWorker: HookWorkerFactory;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function createWorkerHookRunner(options: WorkerHookRunnerOptions): CompileHookRunner {
  const wasmUrl = options.wasmUrl ?? DEFAULT_HOOK_WASM_URL;
  const timeoutMs = options.timeoutMs ?? 1000;
  let nextId = 1;
  let worker: HookWorkerHandle | null = null;
  let ready: Promise<void> | null = null;
  const pending = new Map<number, Pending>();

  function failAll(message: string): void {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pending.clear();
  }

  function discardWorker(message: string): void {
    failAll(message);
    worker?.terminate();
    worker = null;
    ready = null;
  }

  function ensureWorker(): Promise<void> {
    if (ready) return ready;
    worker = options.createWorker(wasmUrl);
    const current = worker;
    ready = new Promise<void>((resolve, reject) => {
      current.onMessage((message) => {
        if (!isRecord(message)) return;
        if (message.type === "ready") {
          resolve();
          return;
        }
        if (message.type === "init-error") {
          reject(new Error(String(message.error ?? "compile-hook interpreter failed to load")));
          return;
        }
        if (message.type === "result" && typeof message.id === "number") {
          const p = pending.get(message.id);
          if (!p) return;
          pending.delete(message.id);
          clearTimeout(p.timer);
          if (message.ok) p.resolve(message.value);
          else p.reject(new Error(String(message.error ?? "compile hook failed")));
        }
      });
    });
    // A failed load leaves nothing usable behind; a later call gets a fresh worker.
    ready.catch(() => {
      if (worker === current) {
        worker = null;
        ready = null;
      }
    });
    return ready;
  }

  return {
    async run(hookSource, context: CompileContext, properties) {
      await ensureWorker();
      const active = worker;
      if (!active) throw new Error("compile-hook worker is not running");
      const id = nextId++;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          discardWorker(`compile hook timed out after ${timeoutMs} ms`);
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        active.postMessage({ type: "run", id, hookSource, context, properties });
      });
    },
  };
}

/** The browser factory. Vite bundles hook-worker.ts as a module worker. Kept separate from the runner so
 * Node-side tests and the CLI never construct a browser Worker. */
export function browserHookWorkerFactory(): HookWorkerFactory {
  return (wasmUrl) => {
    const worker = new Worker(new URL("./hook-worker.ts", import.meta.url), { type: "module" });
    worker.postMessage({ type: "init", wasmUrl });
    return {
      postMessage: (m) => worker.postMessage(m),
      onMessage: (handler) => {
        worker.onmessage = (event: MessageEvent) => handler(event.data);
      },
      terminate: () => worker.terminate(),
    };
  };
}
