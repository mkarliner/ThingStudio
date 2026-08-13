# mpy-cross-wasm

Vendored build artifacts, not an npm package — `mpy-cross` is a custom
Emscripten build, nothing to `npm install`. See
`docs/working-notes/repo-structure-and-conventions.md` for why this stays
outside the npm+lockfile dependency policy that covers everything else.

## What's here

- `mpy-cross.wasm`, `mpy-cross.mjs` — the WASM build of `mpy-cross` itself
  (Emscripten output: wasm binary + ES module glue). Meant to be `fetch()`'d
  as normal static assets by a real build — not inlined/base64'd the way
  `pocs/poc-b/index.html`'s POC harness did for `file://` convenience.

Copied byte-for-byte from `pocs/poc-b/` (verified via `sha256sum` at copy
time — both files identical, not rebuilt). This is **not** a fresh build or
a fresh re-verification against a native `mpy-cross`; it's the exact
artifact POC-B already validated (see its dated Results below). A real
rebuild-and-reverify pass is only needed when the target MicroPython
version actually changes.

## Provenance and validation (carried over from `pocs/poc-b/README.md`)

Built by cross-compiling `mpy-cross` from stock
[`micropython/micropython`](https://github.com/micropython/micropython)
(commit `3a89fc2411d78c63b4092e5c00b7b0e01e68513c`, 2026-08-10) — not a
board-specific fork — via Emscripten, using the stock repo's own
`mpy-cross/Makefile` with `CC=emcc` and Emscripten's linker flags passed
through `LDFLAGS_EXTRA`:

```bash
make -j2 BUILD=build-wasm \
  CC=emcc \
  STRIP=true \
  SIZE=true \
  LDFLAGS_ARCH="-Wl,-Map=\$@.map,--gc-sections" \
  LDFLAGS_EXTRA="-Os -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 \
                 -s EXPORT_NAME=createMpyCross \
                 -s EXPORTED_RUNTIME_METHODS=FS,callMain,ccall,cwrap,allocateUTF8 \
                 -s EXPORTED_FUNCTIONS=_main,_malloc,_free \
                 -s ENVIRONMENT=web,worker -s INVOKE_RUN=0" \
  PROG:=mpy-cross.mjs
```

No source changes to MicroPython were needed. Full recipe detail,
including the non-obvious `-Os`-at-link-time flag and the toolchain
substitution used (Ubuntu-packaged Emscripten instead of `emsdk`, no
network access to `storage.googleapis.com` in that build environment):
`pocs/poc-b/README.md`.

**Validated 2026-08-11**: compiling the same snippet with this WASM build
and with a native desktop `mpy-cross` build from the identical commit
produced **byte-for-byte identical output** (SHA-256 match) — not just
plausibly-correct bytecode. Loads and compiles cleanly in a real Chrome
tab, ~0.87ms average compile latency after warmup (n=50), no special
hosting requirements (no threads, no COOP/COEP headers needed). Full
numbers: `pocs/poc-b/README.md`'s Results table.

## Re-verification checklist for the next MicroPython version bump

Not done yet since it hasn't been needed yet (still the same commit
POC-B validated). When it is:

1. Rebuild `mpy-cross.wasm`/`mpy-cross.mjs` from the new MicroPython
   commit using the recipe above.
2. Build a native (non-WASM) `mpy-cross` from the same commit.
3. Compile an identical snippet both ways, forcing the same embedded
   source filename on each side, and `sha256sum` the two `.mpy` outputs.
4. Record the result here with a dated entry, same as this file's
   provenance section — don't silently replace the artifact without one.

§5 already calls this an ongoing responsibility, not a one-time
integration — worth wiring into CI once there's a real MicroPython build
step to hang it off, per `docs/working-notes/repo-structure-and-conventions.md`.
