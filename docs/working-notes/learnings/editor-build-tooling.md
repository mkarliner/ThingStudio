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
