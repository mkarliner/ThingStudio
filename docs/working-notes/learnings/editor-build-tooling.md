# Learnings — Editor / build tooling

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **`vite build` does not type-check** — esbuild strips types rather than
  checking them. A green build proves nothing about type correctness;
  `tsc --noEmit` is the only real check. Cost real bugs in the poc-rete
  spike before this was learned. `rete-migration-implementation-briefing.md`.
- **Litegraph's file-picker `accept` filter doesn't reliably match
  compound/multi-dot extensions** (`.flow.json`) in Chromium's File
  System Access API — even a file just saved with that exact name showed
  up greyed out on open. Fixed by filtering on the single trailing
  extension (`.json`) instead; the saved filename can still be
  `flow.flow.json` as a convention. `editor-hands-on-briefing.md`.
- **`execFileSync` deadlocks Node's own event loop when the child process
  needs to talk back to an in-process test server.** `execFileSync`
  blocks the entire single-threaded event loop until the child exits, but
  an `http.Server` needing to *answer* the child's request lives on that
  same event loop — it can never respond while blocked, and the child
  hangs until its own timeout. Reproduced outside vitest (a plain Node
  script) before concluding it wasn't a codegen bug. Fixed by switching to
  async `execFile`. `mvp-validation-plan.md`, `http_request` Results
  entry.
- **Node's `http` module defaults to chunked transfer-encoding whenever a
  handler doesn't set `Content-Length` itself** — and this project's
  hand-rolled `http_request` client deliberately doesn't support chunked
  (documented v1 gap). Any local test server stood up against this node
  needs an explicit `Content-Length` header to be usable.
  `mvp-validation-plan.md`, same entry.
- **Packages with platform-specific native bindings get installed as the
  sandbox's own Linux build when `npm ci`/`install`/`vite build`/`vitest`
  run against the live-mounted `editor/`, silently breaking the identical
  files on Mike's real Mac afterward.** Same root cause as the `.git/*.lock`
  issue above — the agent sandbox (a Linux VM) and Mike's Mac (darwin)
  share the same live-mounted `node_modules` tree. Confirmed twice:
  `npx vitest run` via the device bridge failed with "Cannot find native
  binding" (`@rolldown/binding-darwin-x64` vs. the sandbox's own linux
  x86_64) on 2026-08-20; a `npm ci --ignore-scripts` + `npm run build` run
  from the sandbox on 2026-09-02 "succeeded" inside the VM but left Mike's
  real `npm run dev` broken afterward. Promoted to a standing CLAUDE.md
  rule: never run install/build/dev-server/test from the sandbox against
  the shared mount — hand Mike the command, or extract the project
  (excluding `node_modules`) into the cloud session's own workspace for a
  self-contained signal instead.

- **The cloud agent sandbox's own isolated `npm ci` (in its own workspace,
  not the shared mount -- the fallback the rule above recommends) can
  itself be blocked by the session's egress policy, even for
  `registry.npmjs.org`.** Confirmed 2026-09-12 building multi-output-port
  support: extracting `editor/` (excluding `node_modules`) into a scratch
  workspace and running `npm ci` there failed with `403 Forbidden` on
  every package tried (`why-is-node-running`, then `vue`, then a plain
  `lodash` fetched with a bare `curl`) -- looked at first like npmjs.org-
  side rate-limiting (the agent proxy's own `noProxy` list includes
  `registry.npmjs.org`, meaning traffic goes there directly, bypassing the
  policy-enforcing proxy), but `curl -i` against the registry showed the
  real cause: `x-deny-reason: host_not_allowed` -- this session's own
  network egress allowlist, not npmjs.org. Not fixable from inside the
  sandbox; a genuine egress-policy 403 isn't something to retry or route
  around. Fallback used instead: `node_modules` already existed on Mike's
  Mac (he runs `npm run dev` there), so `tsc --noEmit`/`vitest run` were
  verified by handing Mike the exact commands to run himself in his own
  Terminal -- same pattern as git writes -- rather than either the
  blocked sandbox install or (per the standing rule above) running
  against the shared mount.

- **The editor's vendored `mpy-cross` WASM never passed `-march=<arch>`, invisible until the first real
  `@micropython.viper` flow tried to Deploy.** Discovered 2026-09-18, `display_spi`'s `frameFormat:
  "gs4"` first real-hardware deploy attempt: `compileToMpy()` (`editor/src/app/main.ts`) calls
  `MpyModule.callMain(["-o", "/out.mpy", "/in.py"])` with no `-march` -- fine for ordinary bytecode
  (architecture-independent), but mpy-cross's native-code emitter (what a `@micropython.viper`/
  `@micropython.native`-decorated function actually needs) requires an explicit target, and its
  absence produced `SyntaxError: invalid arch` on a real Deploy click, not a viper/codegen bug. Gap
  existed since this pipeline was built -- just never exercised, since nothing before `gs4` ever
  emitted viper code through the real browser Deploy path (the earlier off-device spike used a
  from-scratch native `mpy-cross` build with its own explicit `-march`; the vitest suite's pymock
  `viper` stub never calls mpy-cross at all). Confirmed the real supported arch list by `strings`-ing
  `editor/public/vendor/mpy-cross/mpy-cross.wasm` directly (`x86, x64, armv6, armv6m, armv7m, armv7em,
  armv7emsp, armv7emdp, xtensa, xtensawin, rv32imc, rv64imc, host, debug`) rather than guessing.
  `xtensawin` is correct for every board this project currently targets (ESP32/ESP32-C3/ESP32-S3, all
  Xtensa, all using the same native-emitter ABI). Verified the fix against the real WASM module run
  directly under Node (not the browser) before shipping it: the exact gs4-generated source now
  compiles cleanly, and a plain non-viper snippet produces byte-identical `.mpy` output with or without
  the flag (SHA-256 match) -- zero regression risk for every other flow type. Fixed with a single named
  `MPY_CROSS_MARCH` constant, not scattered inline, specifically so it's one place to extend, not a
  rearchitecture, whenever an ARM-family board (RP2040/RP2350 -- already real boards elsewhere in this
  project) ever needs viper/native code too; no board/architecture concept exists anywhere in the
  compile pipeline yet to pick a different value automatically, flagged as a real open gap, not solved
  here. `docs/working-notes/outstanding-items/display-spi-framebuffer-memory.md`,
  `decisions/node-authoring.md`'s 2026-09-18 entries.

## The editor's MicroPython end-to-end tests read `device-runtime/` from beside the editor, 2026-10-09

`gui-compile.test.ts` (run with `MICROPYTHON_BIN` set) copies `gui.py` and the widget modules from
`../../device-runtime/src` relative to the test file. In a scratch copy of the tree, copy `device-runtime/` again
after editing it: a stale copy runs the old library against newly generated code and fails with an
`AttributeError` on a method the new code calls, which looks like a codegen bug and isn't. Also: a build started
with `nohup ... &` from a tool call dies with that call's shell, so build the MicroPython unix port in
steps (`make -C mpy-cross`, then `make submodules`, then `make`), each inside one call.

## `npm install` on this tree needs `--legacy-peer-deps`; `npm ci` does not, 2026-10-24

Two separate things, both hit on the editor's dependency tree.

**The resolver bug.** With npm 10.9.9, a plain `npm install` (with or without a `package-lock.json` present) dies
with `npm error Cannot read properties of null (reading 'edgesOut')`. The stack is
`arborist/build-ideal-tree.js` `#loadPeerSet`, reached while resolving vitest's optional browser peers
(`@vitest/browser-playwright@5.0.5` appeared immediately before it in the debug log). Nothing in this project's
`package.json` is at fault -- it reproduces on a clean extraction with the tree unchanged. `npm install
--legacy-peer-deps` resolves and installs; the lock it writes is then reproducible with a plain `npm ci`, which is
what was verified (clean `npm ci` from the generated lock, then the suite). So: generate a lock with
`--legacy-peer-deps`, consume it with `npm ci`.

**The audits.** A fresh `npm ci` reported 6 vulnerabilities (2 moderate, 4 high) -- all dev-tooling, none shipped:
`vite` 8.2.1 (dev-server file serving, `?vite-wasm-instance` byte leak, launch-editor on Windows),
`vitest`/`@vitest/mocker` (test-only path traversal and mock injection), `vue` 3.5.41 via
`@vue/server-renderer` (SSR XSS -- this app never server-renders), and `source-map-js` 1.2.1 (build-time DoS).
All had non-major fixes. Fixes applied: `vite` `^8.3.5`, `vitest` `^4.1.12`, `vue` `3.5.44`, plus the lock's
transitives -- audit now 0. Verified in a scratch extraction (`git archive HEAD` to `/tmp/opencode/npm-check`, never
the live-mounted `editor/`, per `CLAUDE.md`): 1189 tests pass, `vite build` and the CLI build both succeed.

Raising the floors in `package.json` (not just refreshing the lock) is deliberate: a lock refresh alone would let a
later resolve pick a vulnerable version again.

**A table embedded in a Python compile hook needs generating from its TypeScript source** (2026-10-24). Adding a
third GUI theme preset (`vivid`) to `gui-theme-shared.ts` was not enough: `display-spi.ts`'s `compileHook` is a
Python string that carried its *own* `_THEME_PRESETS` and `_THEME_DEFAULT`, so the hook silently fell back to the
default colours and the demo's palette came out wrong -- only the compiled Python showed it, and the flow still
deployed. The existing `display-spi-theme-palette.test.ts` iterated the TypeScript preset table, so it failed as
soon as it ran; that test is the reason this was caught before hardware. Fixed the cause rather than the symptom:
the hook's role tuple, default and preset table are now interpolated from `gui-theme-shared.ts` at module load,
so there is one table. Rule of thumb: anything a `compileHook` string duplicates from TS (role lists, defaults,
enumerations) should be interpolated, not typed twice, or the two will drift on the next edit.

## The vendored `micropython-wasi.wasm` needs WasmGC; Node 20 can't run it, 2026-10-31

First full editor-suite run on the Debian box (Node 20.19.2 from apt): 226 tests failed across 22 files, all
tracing to one root cause — every compile-hook test failed with
`WebAssembly.compile(): invalid value type 'noexternref', enable with --experimental-wasm-gc`
(vendored at `editor/public/vendor/micropython-wasi/micropython-wasi.wasm`; `editor/src/compile-hook/wasi.ts`
loads it). The wasm is built with the WasmGC typed-refs features, which ship by default in V8 11.9+; Node
20.19's V8 is 11.3, and there the flag doesn't even exist — attempting `NODE_OPTIONS=--experimental-wasm-gc`
is rejected outright ("is not allowed in NODE_OPTIONS"), so nothing short of a newer Node helps. Everything
not touching the hook interpreter passed on Node 20, which made it look like a dozen specific bugs rather than
one environment gap. The Makefile's existing floor (`^20.19 || >=22.12`) only encoded Vite 8/rolldown's need;
it never knew about the wasm's, so `make` blessed a Node the suite cannot run. Fixed in the same change:
floor is now `>=22.12` with a message naming the wasm, and the box got Node 22.23.4 (official tarball,
SHASUM-verified, user-local in `~/.local/opt`, symlinked into `~/.local/bin`). Note the browser mattered too —
WasmGC shipped clear back in Chrome 119 / Firefox 121 / Safari 17.2 (late 2023), so no practical browser is
affected; this was purely a Node-runtime floor misstated by its only check.
