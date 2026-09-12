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
