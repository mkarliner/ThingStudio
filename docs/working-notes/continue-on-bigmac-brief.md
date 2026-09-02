# Thingstudio — handoff brief for next session

Purpose: before continuing work, verify the items below rather than assuming prior session state still holds. Everything here reflects state as of 2026-09-02.

## 1. Where things live

- **Laptop (source of truth for the code):** `/Users/mike/Src/Thingstudio`, reached via the device bridge (`mcp__remote-devices__*`, mounted at `$HOME/mnt/Thingstudio` inside `device_bash`). Real git remote: `origin` → `https://github.com/mkarliner/ThingStudio.git`.
- **Cloud sandbox local copy:** `/home/claude/Src/Thingstudio` — a full git-history snapshot (17MB, `node_modules` excluded) taken from the laptop's working tree. This copy is **session-scoped**: it will not exist in a fresh session unless re-extracted.
- **Durable backup:** `Thingstudio-backup.zip` (7MB, includes full `.git` history, excludes `node_modules` and junk in `_to_delete/`) was delivered to the conversation via `SendUserFile` (file_uuid `9abe1395-0964-4d30-bc53-80f186899476`) and should still be downloadable as a conversation attachment regardless of session state. **Check first**: confirm this attachment is still retrievable before re-doing any backup/extraction work.

## 2. Uncommitted work — needs Mike, not the assistant

A completed feature (inject-node click-only live-fire, new `startup` node, node-ID refactor from numeric to UUID — 54 changed/new files) was written to the laptop repo directly via the device bridge, and Mike was given exact `git add` / `git commit` commands to run himself in a real terminal.

**Check:** has Mike run those commands yet? As of last check (in the cloud sandbox snapshot, which mirrors the laptop's working tree at extraction time), `git status --short` in `/home/claude/Src/Thingstudio` showed **66 lines of uncommitted changes** — matching the feature work, untouched. Re-run `git status --short` against the *laptop* repo (via `device_bash`) to get current truth; the sandbox snapshot is now stale.

Do **not** run `git add`/`git commit`/`git push` from the sandbox on Mike's behalf. This is an explicit standing rule in the project's own `CLAUDE.md`: git writes go to Mike as exact commands to run himself, never executed from the sandbox. This also matches general git-safety practice — never push to a real remote (`origin` here is Mike's actual GitHub repo) without his explicit request.

## 3. Known cleanup item — unresolved

A stray `Thingstudio-backup.zip` (7MB, harmless, untracked by git) was left at the root of the laptop's `~/Src/Thingstudio` folder as a side effect of staging the backup. An attempt to move it into the repo's existing `_to_delete/` convention failed because the device bridge dropped mid-operation, and was not retried.

**Check:** is the device bridge connected? (At the start of this handoff-brief task it briefly reported "Workspace still starting" — a boot-up transient, not necessarily a real disconnect; retry once.) If connected, confirm whether the stray zip is still there and either move it to `_to_delete/` or ask Mike to delete it himself.

## 4. Standing rules to carry forward

- **CLAUDE.md (Thingstudio project):** git writes (`add`/`commit`) go to Mike as commands to run himself; read-only git commands (status, log, diff, remote -v) are fine to run directly.
- Never push to `origin` (the real GitHub repo) without Mike explicitly asking.
- Two separate filesystems are in play and must not be conflated: the laptop (via `mcp__remote-devices__*` / `device_bash`) and the cloud sandbox's own local filesystem (via plain `Bash`). A file written by one tool is not visible to the other.

## 5. Suggested first steps next session

1. Re-confirm the device bridge is connected (`device_bash` with a trivial command).
2. Pull current `git status --short` from the **laptop** repo to see whether Mike has committed the pending feature work.
3. If the sandbox needs the project again, re-extract from the `Thingstudio-backup.zip` conversation attachment (file_uuid above) rather than re-staging from the laptop, unless the laptop has since changed and a fresh copy is needed.
4. Resolve the stray-zip cleanup item (§3) if the bridge is up.
5. Only then resume any new feature work.

