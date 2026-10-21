# Spike: mainline `ports/webassembly` as the compile-hook interpreter

Status: spike done, 2026-10-21. Recommendation: **do not switch before the release**; keep the pinned WASI artifact.
**Stage 1 is now done:** it was rebuilt here from `3f6d144cb` with wasi-sdk 25.0 + Binaryen 123
(`tools/build_micropython_wasi.py`), SHA-256 `49e76057…`; see `micropython-wasi/README.md`. Revisit after the CLI is
async or a synchronous Emscripten build is validated.

## Why

The vendored `micropython-wasi.wasm` comes from MicroPython PR #13676, still open. Every WiFi flow now needs that
interpreter to compile, so it is release-critical. The review
(`reviews/2026-10-19-reply-review-and-smoke-test.md`, §14) proposed two stages: rebuild from the pinned commit now,
and spike upstream's maintained `ports/webassembly` before a release. This is stage 2.

## What was built

- Upstream MicroPython `main` at `b70ae1a` (2026-10-19), built with Emscripten **6.0.13** (emsdk `latest`,
  installed under `/tmp`; not a project dependency and nothing vendored).
- `git submodule update --init lib/micropython-lib`, then `make -j4` in `ports/webassembly`.
- Artifacts: `micropython.mjs` 238,608 bytes + `micropython.wasm` 1,117,559 bytes (1.36 MB together), versus the
  vendored WASI module's 370,907 bytes (3.7x larger).

## What the API looks like

```javascript
const { loadMicroPython } = await import("micropython.mjs");
const mp = await loadMicroPython({ stdout: (line) => { ... } });
mp.runPython(code);          // synchronous once loaded
mp.runPythonAsync(code);     // if the code awaits
```

- **Loading is asynchronous** (`loadMicroPython` returns a Promise). `runPython` is synchronous after that.
- `stdout` is a callback, apparently **per line, without the newline**; the WASI runner currently consumes a
  stream and splits on newlines.
- A Python exception throws a JavaScript `PythonError` whose message starts with the traceback.
- `json` and `binascii` are present; the existing hook wrapper (base64 context, sentinel result) ran unchanged and
  printed the expected `OK{"properties": ...}`.
- Reusing one loaded instance works and keeps state; a fresh instance per hook avoids that leakage.

## Measurements (Node, this sandbox)

| | ms |
|---|---|
| first `loadMicroPython` | 30.7 |
| second `loadMicroPython` (warm module cache) | 6.9 |
| first `runPython` (hook-sized code) | 54.2 |
| subsequent runs | fast |

A fresh instance per hook would cost roughly 30-85 ms, still well inside the 1 s budget. The editor worker could
also load once and reuse, at the cost of state leaking between hooks (the current runner does not).

## Why it is not a drop-in

1. **The CLI's synchronous hook path cannot await `loadMicroPython`.** `editor/src/cli/check-flow.ts` runs hooks
   synchronously (`runHookOnceSync`); the Emscripten module loads asynchronously. Options: make
   that path async, or rebuild with `-sWASM_ASYNC_COMPILATION=0` and confirm `loadMicroPython` becomes usable
   synchronously (not tested).
2. **stdout/exception plumbing changes.** A line callback and a JS `PythonError` replace the WASI stdout stream and
   exit code; the sentinel parser needs a small rewrite.
3. **Size.** 1.36 MB fetched by the editor versus 371 KB; acceptable, but a real cost for every first compile.
4. **Build toolchain.** Emscripten plus the `micropython-lib` submodule, instead of wasi-sdk + Binaryen.
5. On the plus side it removes the dependency on an unmerged PR and builds from a maintained release tag.

## Reproduce

```sh
git clone --depth 1 https://github.com/micropython/micropython.git
cd micropython && git submodule update --init --depth 1 lib/micropython-lib
source /path/to/emsdk/emsdk_env.sh        # emcc 6.0.13
make -C ports/webassembly -j4
node ports/webassembly/build-standard/micropython.mjs -c 'print(1+1)'   # or the loadMicroPython API above
```

## Recommendation

- **Release:** keep the vendored WASI artifact (371 KB, sync CLI path, no Emscripten in CI).
- **Do now (stage 1):** rebuild that artifact from the pinned MicroPython commit `3f6d144cb8` with pinned
  wasi-sdk 25 and Binaryen, record the hashes and a build script. Toolchains are not installed in this sandbox, so
  this is still owed; it removes the "unknown artifact" risk without changing the runner.
- **Revisit mainline** once the CLI hook path is async (or a synchronous Emscripten build is proven), and if the
  3.7x size is acceptable. Then the switch is a runner change, not a protocol or package-format change.
