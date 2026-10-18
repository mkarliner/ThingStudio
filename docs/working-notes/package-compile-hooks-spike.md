# Package compile hooks — interpreter spike (2026-10-18)

Status: spike, 2026-10-18. Answers `package-compile-hooks-scoping.md` §8 step 1. Numbers below are Node 22 on
x86-64 Linux, against a prebuilt artifact (see §5); the browser is not yet measured. No repo dependency was added.

## 1. What was measured

| Measurement | Result |
|---|---|
| Artifact size | 370,907 B raw; 164,337 B gzip (44%) |
| `WebAssembly.compile` (cached module) | ~1.4 ms |
| `WebAssembly.instantiate` (cached module) | 2.9–3.6 ms per instance |
| Hook body, trivial (`print`) | 0.08–0.14 ms |
| Fresh path, cold (compile + instantiate + run) | ~12.7 ms |
| Fresh path, warm (instantiate + run) | ~5.2 ms |
| Realistic hook, 1-node/1-config flow | 5.3 ms instantiate + 0.8 ms run |
| Realistic hook, 200-node/10-config flow (16.5 KB ctx JSON) | 7.9 ms instantiate + 2.4 ms run |
| Infinite loop, synchronous | never returns (no in-process interrupt exists) |
| Infinite loop, worker + `terminate()` after 500 ms | terminated in ~3.8 ms |
| Pure-JS WASI shim (no `node:wasi`) | 3.6 KB source; instantiate 1.7 ms, run 0.12 ms |
| Worker start (shim + wasm, Node) | ~35 ms; terminate ~0.2 ms |

The pure-JS shim is the browser proxy: it implements only the Preview1 calls the module imports, using `DataView`,
`TextEncoder` and the standard `WebAssembly` API — no Node APIs. It replaces `node:wasi` and is faster (instantiate
1.7 ms vs 2.9–3.6 ms). This materially de-risks the browser path: the editor needs a fetch, the standard
`WebAssembly.instantiate` call and the shim, nothing platform-specific.

The hook used in the realistic runs parses the context JSON, finds the WiFi config, computes `deferToMqtt` from the
node list, and prints a JSON result — the shape a network-family hook needs.

**Verdict on cost: acceptable.** Size is in the same class as the existing `mpy-cross.wasm` (353 KB). Per-hook cost
is a few milliseconds on top of a compile; instantiation dominates, so a warm worker (one instance reused per
compile) would bring it to roughly the hook body cost. Loading is lazy, so flows without hooks pay nothing.

## 2. The blocking finding: no synchronous budget in JS

The scoping note assumed a synchronous, instruction-budgeted call. **That does not exist in JavaScript-hosted
WebAssembly.** Fuel and epoch interruption are Wasmtime/WASI-runtime features; the browser and Node's `node:wasi`
offer neither. A guest `while True: pass` blocks the calling thread forever. The only containment available is to
run the hook in a Worker and terminate it, which makes the hook (and therefore `compile()`) **async**.

Two ways to keep it synchronous, both worse:

- **Patch MicroPython's VM loop** to call a host `tick()` import that throws when a budget is exhausted. This means
  maintaining a MicroPython fork (a check in the interpreter's dispatch loop) on top of an already-experimental
  WASI variant. The project's `mpy-cross-wasm` deliberately uses stock MicroPython; a fork breaks that.
- **Accept no budget.** Against the fault-handling priority: one malicious or buggy package hangs the editor tab.

**Recommended amendment:** async `compile()`, hooks run in a persistent worker (browser Web Worker,
`worker_threads` in the CLI), a per-hook wall-clock budget (~1 s) and a per-compile budget, terminate and recreate
the worker on expiry, and report a `CompileError` naming the package. Worker termination measured clean (~4 ms).
The cost is the async ripple through `compile()`'s callers (app, CLI, dev tools, ~100 test call sites) — mechanical,
but it must be an explicit decision, not slipped in.

## 3. What the spike did not settle

- **The browser.** The pure-JS shim runs the module without `node:wasi`, so the browser path needs only standard
  WebAssembly + fetch; actual browser timing (expected in the same range) and CSP/WASM-instantiation rules still
  need checking when the editor is wired.
- **Worker cold-start latency.** Not measured precisely; a persistent warm worker avoids paying it per hook, but the
  first compile in a session does.
- **The artifact's provenance.** The tested wasm came from `micropython-wasm` 0.1a2 (Apache-2.0, built from
  MicroPython PR #13676, an experimental `ports/unix VARIANT=wasi`). It was downloaded only for this spike and is
  not a project dependency. A real implementation needs a pinned, documented build (the `mpy-cross-wasm` pattern)
  and a `docs/third-party-licenses.md` entry.
- **State across hooks.** Each measurement used a fresh instance. Whether hooks share an instance (and therefore
  Python globals) is a design choice; fresh instances are simpler and match determinism.

## 4. Recommendation

**Go**, subject to a real-browser check when the editor is wired. The interpreter cost is not the problem; DoS
containment is, and the worker-termination answer is acceptable now that async `compile()` is accepted (Mike,
2026-10-18). If the browser path fails, the fallback is option 2 (runtime flow manifest) for the network family, not
a synchronous hook.

## 5. Reproducing

The spike scripts lived outside the repo (`/tmp/opencode/mpwasm/`): a Node `WASI` runner, a realistic-hook runner,
and a worker-termination test. The only external artifact was the wheel
`micropython_wasm-0.1a2-py3-none-any.whl` from PyPI; nothing was added to the repo. Re-run by downloading that
wheel, extracting `micropython_wasm/artifacts/micropython-wasi.wasm`, and instantiating it with `node:wasi`
(stub the `micropython_wasm.host_call`/`host_result_cap` imports).
