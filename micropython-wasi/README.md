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

- Source artifact: the `micropython-wasm` 0.1a2 wheel from PyPI (Apache-2.0 package), file
  `micropython_wasm/artifacts/micropython-wasi.wasm`.
- Wheel SHA-256: `a57989e2b56e9603438b98c55bb7edc6f275366a37a43dcd25952d465e01dc19`
- WASM SHA-256: `1c054a4d21d4a6589bc568821ebf562889988ddaaf8a17a2e2985a56cf228051`
- Reported by the artifact: `MicroPython v1.27.0-preview.225.g3f6d144cb8 on 2026-06-02; linux [Clang 19.1.5]`.
  The `g3f6d144cb8` suffix is the MicroPython source commit; the build was made from
  `pull/13676/head` by upstream's `scripts/build_micropython_wasi.py`.
- The artifact was **not rebuilt here** — it is copied byte-for-byte from the wheel, the same
  hash-recorded manual-vendoring discipline as `mpy-cross-wasm/`. Upstream's build recipe: wasi-sdk 25,
  `make -C mpy-cross`, `make -C ports/unix submodules`, `make -C ports/unix VARIANT=wasi`, then a Binaryen
  `wasm-opt --translate-to-exnref` postprocess (upstream notes that the full spill-pointers pipeline fails).

A rebuild is due when Thingstudio's target MicroPython version moves, alongside the same review that updates
`mpy-cross-wasm/`. Rebuild from a **pinned MicroPython commit**, not the moving PR head.

## Licence

MicroPython is MIT (`docs/third-party-licenses.md`). `micropython-wasm`'s packaging is Apache-2.0. The module is
unmodified. It imports a small `micropython_wasm.host_call`/`host_result_cap` host module that the wheel's build
added for its own host-function bridge; Thingstudio's shim stubs both, so the hook has no host capabilities beyond
stdout and argv.

## Usage

`editor/src/compile-hook/wasi.ts` implements the WASI preview1 calls the module imports (no `node:wasi` — the
same shim runs in the browser and in tests). The module is instantiated with a command line of
`micropython -c <code>`; stdout carries the hook's JSON result behind a sentinel marker.
