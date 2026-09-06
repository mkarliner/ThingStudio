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
