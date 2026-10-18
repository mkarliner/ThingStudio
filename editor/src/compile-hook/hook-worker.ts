// SPDX-License-Identifier: Apache-2.0
// editor/src/compile-hook/hook-worker.ts
//
// The browser Worker entry for package compile hooks. Vite bundles this file when runner.ts builds its
// worker (new Worker(new URL("./hook-worker.ts", import.meta.url), { type: "module" })). It has no Node
// APIs: the wasm is fetched once from the URL the main thread sends, then each request runs one hook.
//
// The worker is the containment boundary: the main thread terminates it when a hook exceeds its budget, so
// a runaway hook never blocks the editor.

import { runHookOnce } from "./run-hook.js";

interface InitMessage {
  readonly type: "init";
  readonly wasmUrl: string;
}

interface RunMessage {
  readonly type: "run";
  readonly id: number;
  readonly hookSource: string;
  readonly context: unknown;
  readonly properties: Record<string, unknown>;
}

type Incoming = InitMessage | RunMessage;

interface Reply {
  readonly type: "result";
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

let wasmBytes: Uint8Array | null = null;
let wasmUrl = "";

async function loadWasm(url: string): Promise<Uint8Array> {
  if (wasmBytes) return wasmBytes;
  wasmUrl = url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}: HTTP ${res.status}`);
  wasmBytes = new Uint8Array(await res.arrayBuffer());
  return wasmBytes;
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const msg = event.data;
  if (msg.type === "init") {
    try {
      await loadWasm(msg.wasmUrl);
      (self as unknown as { postMessage(m: unknown): void }).postMessage({ type: "ready" });
    } catch (err) {
      (self as unknown as { postMessage(m: unknown): void }).postMessage({ type: "init-error", error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const reply: Reply = await (async () => {
    try {
      const bytes = await loadWasm(wasmUrl);
      const value = await runHookOnce({ wasmBytes: bytes, hookSource: msg.hookSource, context: msg.context, properties: msg.properties });
      return { type: "result", id: msg.id, ok: true, value };
    } catch (err) {
      return { type: "result", id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  })();
  (self as unknown as { postMessage(m: unknown): void }).postMessage(reply);
};
