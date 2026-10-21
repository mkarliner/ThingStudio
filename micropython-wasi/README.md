# micropython-wasi

The MicroPython interpreter used to run a package's optional `<name>.compile.py` hook at compile time
(`interfaces/node-compile-context/SPEC.md`). A vendored build artifact, not an npm package — see
`docs/working-notes/repo-structure-and-conventions.md` for why this stays outside the npm+lockfile policy.

## What's here

- `micropython-wasi.wasm` — a WASI command module running MicroPython's `ports/unix` with `VARIANT=wasi`.
- A byte-identical copy lives at `editor/public/vendor/micropython-wasi/micropython-wasi.wasm` (the editor
  fetches it as a static asset; the CLI/tests read this folder directly). Hashes verified equal at copy time.

This build is **experimental upstream**: MicroPython PR
[#13676](https://github.com/micropython/micropython/pull/13676) ("Experimental WASI support for ports/unix") is
still open, not merged. That is acceptable for a hook interpreter (the hook code is plain Python, compiled once
per node at compile time) but it is the reason this lives as a pinned vendored artifact rather than a build step.

## Provenance

Built here from the pinned MicroPython commit `3f6d144cb` (PR #13676 head, 2025-09-30) with:

- **wasi-sdk 25.0** (`clang 19.1.5-wasi-sdk`), pinned by the variant's `WASI_SDK` path.
- **Binaryen version_123** (`wasm-opt`), for the `--translate-to-exnref` postprocess. The build's own
  `--spill-pointers` pipeline fails, as upstream documents, so the artifact is the translated raw link.
- The `micropython-wasm` host usercmodule, vendored under `tools/micropython-wasi-usercmodule/` (Apache-2.0), so the
  host imports match the wheel's build.

Artifact SHA-256: `49e76057f67398ef8c78c42fb065fba1d07e436a992557381cfddb5b57375987` (370,907 bytes).

Rebuild:

```sh
export PATH="/path/to/binaryen-version_123/bin:$PATH"
python3 tools/build_micropython_wasi.py --wasi-sdk /path/to/wasi-sdk-25.0-x86_64-linux
```

The script checks out the pinned commit, builds `mpy-cross` and `ports/unix` with `VARIANT=wasi`, runs the
exception-handling translation, and copies the result to both this folder and
`editor/public/vendor/micropython-wasi/`.

This artifact replaces the previous byte-for-byte copy of the `micropython-wasm` 0.1a2 wheel
(SHA-256 `1c054a4d21d4a6589bc568821ebf562889988ddaaf8a17a2e2985a56cf228051`). It is the same size, but not
byte-identical: the toolchain patch versions and the build paths differ. The hash above is authoritative now; the
editor and this folder are checked equal by `editor/test/micropython-wasi-artifact.test.ts`.

## Licence

MicroPython is MIT (`docs/third-party-licenses.md`). `micropython-wasm`'s packaging is Apache-2.0. The module is
unmodified. It imports a small `micropython_wasm.host_call`/`host_result_cap` host module that the wheel's build
added for its own host-function bridge; Thingstudio's shim stubs both, so the hook has no host capabilities beyond
stdout and argv.

## Usage

`editor/src/compile-hook/wasi.ts` implements the WASI preview1 calls the module imports (no `node:wasi` — the
same shim runs in the browser and in tests). The module is instantiated with a command line of
`micropython -c <code>`; stdout carries the hook's JSON result behind a sentinel marker.
