# POC-B: `mpy-cross`-to-WASM toolchain spike

Tests the claim in design doc &sect;5 (see &sect;15.2 for exact scope): `mpy-cross`
actually runs client-side in a browser as WebAssembly, confirming the
"browser-only, no install" claim in &sect;4 rather than assuming it from someone
else's tech demo.

**Files**

- `mpy-cross.wasm`, `mpy-cross.mjs` &mdash; the WASM build of `mpy-cross` itself
  (Emscripten output: wasm binary + ES module glue), kept here for reference/
  reuse. Not fetched by `index.html` at runtime (see below).
- `index.html` &mdash; the browser harness. Self-contained: the glue JS and the
  wasm binary (base64) are inlined directly into the page, so it's one file
  you can double-click and open straight from disk, no server required.
  Compiles a hardcoded snippet, times it, shows the output bytecode as hex,
  and runs a 50&times; compile benchmark.

## Where the WASM build came from

Precedent cited in &sect;5/&sect;15.2 is the micro:bit Foundation's
[`micropython-browser-compiler-playground`](https://github.com/microbit-foundation/micropython-browser-compiler-playground),
an experimental repo that gets a whole micro:bit MicroPython build (Clang,
GNU Make, CPython, and `mpy-cross`) running in-browser via Emscripten &mdash;
much more than POC-B needs, since it's solving "compile a full board firmware
image in the browser," not "cross-compile a `.mpy` file." The one piece
relevant here is `wasm-build/build-mpycross.sh`, which showed the actual
recipe: `mpy-cross` is a small, self-contained C program, and it turns out
Emscripten can compile it more or less like any other Makefile-driven C
project &mdash; `CC=emcc`, disable `strip`/`size` (host post-build steps that don't
apply to a `.wasm` artifact), and pass Emscripten's own linker flags
(`ALLOW_MEMORY_GROWTH`, exported runtime methods, etc.) through `LDFLAGS`.

POC-B adapted that recipe rather than reusing the microbit-foundation build
directly, for one reason: that build compiles `mpy-cross` from
`microbit-foundation/micropython-microbit-v2`, a fork tuned for micro:bit
firmware. Thingstudio targets stock ESP32/RP2040 MicroPython (&sect;3, &sect;5), so
POC-B instead cross-compiles `mpy-cross/` straight from
[`micropython/micropython`](https://github.com/micropython/micropython)
(commit `3a89fc2411d78c63b4092e5c00b7b0e01e68513c`, 2026-08-10) &mdash; the same
source this project would actually ship against.

Build recipe (`mpy-cross/Makefile`, stock repo):

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

No source changes to MicroPython were needed &mdash; `mpy-cross` builds as WASM
unmodified. The one non-obvious flag is `-Os` in `LDFLAGS_EXTRA`: without it,
Emscripten's *link* step (a separate decision from the `-Os` already used to
compile each object) defaults to the `-O0`/debug variant of its bundled musl
libc, which is a different cached build than the one produced while compiling
the project's own `.c` files &mdash; forcing `-Os` at link time keeps both
consistent and avoids rebuilding libc twice.

Toolchain note: this was built in a sandboxed Linux VM with no access to
`storage.googleapis.com` (where `emsdk` fetches prebuilt Clang/Node), so the
build used Ubuntu 22.04's packaged `emscripten` 3.1.5 + `clang-13`/`lld-13`
+ `binaryen` instead, extracted from `.deb`s into a local prefix (no root
available either). Functionally equivalent to a normal `emsdk install`; noted
here only because it's a materially different path than the precedent's
Docker-based build, in case this needs reproducing.

## Why `index.html` inlines everything instead of `fetch`-ing the `.wasm`

The natural approach &mdash; `<script type="module">` importing `mpy-cross.mjs`,
which `fetch()`s `mpy-cross.wasm` &mdash; works fine served over `http://`, and
is almost certainly what a real Thingstudio editor build would do (bundled
and served normally, not opened from disk). But per &sect;15.2's own framing
("browser-only, no install"), the POC harness itself should be a bare page
you can just open, and ES module `fetch()` calls are blocked under `file://`
by Chrome's CORS handling for local files. So `index.html` instead: strips
the two ES-module-only bits out of the Emscripten glue (`import.meta.url`,
`export default`) so it runs as a plain classic `<script>`, and passes the
wasm binary directly as `Module.wasmBinary` (decoded from an inlined base64
string) so the module never calls `fetch`/`readFile` for it at all. Result:
open the file, no server, no CORS issue. This inlining is a POC-harness
convenience, not a recommendation for how the real editor should ship the
module &mdash; production would fetch `mpy-cross.wasm` as a normal static asset.

## Running it

Just open `index.html` in Chrome or Edge (double-click, or `File &rarr; Open`).
Click **Compile once** to compile the hardcoded snippet and see timing +
output hex. Click **Run 50&times; compile benchmark** for repeated-call latency
(avg/min/max). **Download last .mpy** saves the raw bytecode if you want to
feed it to a desktop MicroPython install yourself.

## Validating the output is real, correct bytecode

Chose the "round-trip through a stock desktop `mpy-cross`" path from
&sect;15.2's two options (hardware round-trip is the stretch goal; no POC-A
device was available in this environment to attempt it).

Built a native `mpy-cross` from the exact same MicroPython commit
(`make` in `mpy-cross/`, no special flags) and compiled the same snippet
both ways, forcing the same embedded source filename on each side
(`-s snippet.py`) so the only variable is the compiler itself:

```
$ sha256sum native_out.mpy wasm_out.mpy
eb7e656f...  native_out.mpy
eb7e656f...  wasm_out.mpy
```

**Byte-for-byte identical.** The WASM build isn't producing some
approximation of correct bytecode &mdash; it's the same compiler, same output,
down to the hash.

Also attempted running the compiled `.mpy` on a native MicroPython (unix
port, same commit) to close the loop end-to-end. Built the `minimal`
variant (the `standard` variant needs `mbedtls`/`berkeley-db` submodules,
out of scope for this spike) and found that variant doesn't set
`MICROPY_PERSISTENT_CODE_LOAD` (it doesn't inherit
`variants/mpconfigvariant_common.h`, where that's turned on) &mdash; so it can't
load *any* `.mpy` file, WASM-produced or not; confirmed by feeding it the
native build's own output and getting the identical error. Not a WASM
correctness issue, just a variant config gap; the byte-identical hash above
is the actual validation for this spike, and it's conclusive on its own.

## Results (2026-08-11, Chrome, `micropython/micropython` @ `3a89fc24`)

| Criterion | Target | Observed |
|---|---|---|
| Loads and compiles valid bytecode in a real Chrome/Edge tab | yes/no | **yes** &mdash; verified in an actual Chrome tab (not just Node), zero console errors, single network request for the whole page |
| Compile latency, small snippet | comfortably under 100ms | **8.9ms** first compile (cold); **50&times; benchmark: avg 0.87ms, min 0.20ms, max 12.5ms** (n=50) &mdash; roughly 100&times; under target after warmup |
| WASM module instantiation time | &mdash; | **17.2ms** |
| `mpy-cross.wasm` size | &mdash; | **353,073 bytes** (344.8&nbsp;KB) |
| `mpy-cross.mjs` glue JS size | &mdash; | **67,186 bytes** (65.6&nbsp;KB, uncompressed) |
| Combined shippable bundle | &mdash; | **~410&nbsp;KB** uncompressed (wasm + glue JS served as separate static assets, as a real build would); the 533&nbsp;KB `index.html` in this repo is larger only because it base64-inlines the wasm for the `file://`-friendly POC harness (~33% base64 overhead) &mdash; not representative of production size |
| Output correctness | valid, correct bytecode | **byte-identical** (SHA-256 match) to a native desktop `mpy-cross` build from the same commit |
| Special hosting requirements | known quantity | **none** &mdash; no `-pthread`/`SharedArrayBuffer` in the build (confirmed by grep on the glue JS), so no COOP/COEP cross-origin-isolation headers needed; a plain static file server is sufficient |

**Verdict:** POC-B's central question is answered yes, cleanly. `mpy-cross`
runs client-side as WASM with no server-side compile step, output bytecode
is provably correct (not just plausible), compile latency is roughly two
orders of magnitude under the "invisible in a deploy click" target, and
there's no exotic hosting requirement (no threads, no special headers) to
carry into &sect;10's v1 planning.
