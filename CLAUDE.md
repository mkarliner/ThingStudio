# Project rules for Thingstudio (Claude Code)

@AGENTS.md

Shared project rules live in `AGENTS.md`, imported above. The two sections below are specific to the Claude
Code agent sandbox, which shares a live-mounted copy of this repo with Mike's real Mac. Other runtimes (opencode)
work directly in the repo and don't load this file, so these rules don't apply to them.

## Interface specs (applies to Claude Code, from `AGENTS.md`)

The `AGENTS.md` sections **"Architecture first at subsystem interfaces"** and **"Interface specs: read before you
implement, change only with permission"** apply to Claude Code in full, imported above. In particular, before
implementing or changing any code that emits, parses, stores or transmits something a cross-subsystem interface
defines (the wire protocol in `interfaces/protocol/` first, and each later spec as it lands): read that spec, run its
conformance test, and do not change the interface itself without Mike's explicit permission in the session.

## Git writes from the agent sandbox

The agent sandbox and Mike's real Mac share the same live-mounted repo, and the sandbox cannot delete files it just
created there (`Operation not permitted` on unlink) — confirmed for `.git/index.lock`, `.git/HEAD.lock`, and
`.git/objects/*/tmp_obj_*`. `git add`/`git commit` from the sandbox routinely leave one of these behind, which then
blocks the *next* git command (from either side) until someone with real delete permission — Mike, in a real Terminal
— removes it.

Read-only git commands from the sandbox (`status`, `log`, `diff`) are fine to run for what they report, but **they are
not lock-free** -- confirmed 2026-09-12: a plain `git status -sb` from the sandbox left a `.git/index.lock` behind
(git's own opportunistic index-refresh writing the index during a status check), which then blocked a real
`git commit` run from Mike's own Terminal minutes later, silently -- the commit just didn't happen, `git status` kept
showing everything as modified, and it took an explicit `rm -f .git/index.lock` from Mike's Terminal to clear it. So:
before handing Mike any `git add`/`git commit` sequence to run himself, also tell him to `rm -f .git/index.lock` first
regardless of what ran in the sandbox before it -- don't assume a prior read-only sandbox command left no lock just
because it didn't write anything. For writes (`add`, `commit`) themselves, still hand Mike the exact command(s) to run
himself in a real Terminal, rather than running `git commit` from the sandbox. Full incident: `learnings.md`'s
"Already promoted to the project rules" section.

## npm install / build / test from the agent sandbox

Same shared-mount hazard as the git-lock issue above, different symptom: never run `npm ci`/`npm install`,
`vite build`, `vite dev`, or `vitest`/`npm test` from the agent sandbox directly against the live-mounted `editor/`.
`make` counts too: every target except `clean`/`distclean` runs npm, and it builds a `.venv` of Linux binaries.
The sandbox (`device_bash`) is a Linux VM; Mike's Mac is darwin — packages with platform-specific native bindings
(rollup, esbuild/rolldown, etc.) get installed as their Linux build into the shared `node_modules` tree, breaking the
identical files on Mike's Mac afterward. Confirmed twice — full incident detail:
`docs/working-notes/learnings/editor-build-tooling.md`.

Read-only checks (`node -v`, whether `node_modules` exists at all, reading `package.json`) are fine from the sandbox.
For anything that writes into or resolves through `node_modules` for real — install, build, dev server, test run —
hand Mike the exact command(s) to run himself, same pattern as git writes. If the sandbox genuinely needs its own
test/build signal, extract the project (excluding `node_modules`) into the cloud session's own workspace and run
`npm ci` fresh there instead of touching the shared mount.
