# Learnings — Cowork remote-device testing environment

Status: detail file, split out of `learnings.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading (plus, for this file, incident detail moved down from `CLAUDE.md`'s trimmed rule sections — see `learnings.md`'s "Already promoted" section). See `learnings.md` for the index and this log's own maintenance rule.


- **The cloud session's own staged read-only mirror of the repo (under
  the uploads directory) can be a partial/curated snapshot, not a full
  checkout -- don't trust it for `npm test`/`vitest run` without first
  confirming the full `src`/`test` tree is actually present.** Discovered
  2026-08-20: the mirror available during the custom-node session was
  missing `src/compiler/errors.ts` and several other node-library/test
  files, so a same-session verification attempt (tried because the device
  bridge to Mike's machine was down) failed on unrelated
  import-resolution errors, not real regressions in the new code. When
  `device_bash` can't reach Mike's machine either, there is currently no
  way to get a fully trustworthy test/typecheck signal from inside the
  cloud session alone for this project -- say so plainly rather than
  reporting a red result as if it were a real one, and defer the actual
  verification to Mike's machine.
- **A plain (non-git) file on the shared live-mounted repo can silently
  lose content mid-edit if something else writes to it around the same
  time -- not only a git-lock hazard.** Discovered 2026-09-06: mid-session,
  `CLAUDE.md`'s on-disk working-tree copy was found missing two entire
  rule sections and part of a third (truncated mid-sentence), while
  `git show HEAD:CLAUDE.md` confirmed the last-committed version was fully
  intact -- something else (most likely Mike editing the same file live,
  or an autosave/tool touching it) wrote a partial/interrupted version to
  disk between an earlier read and a later one in the same session. No
  error, no lock file, nothing to notice -- just quietly wrong content.
  Recovered by rebuilding from `git show HEAD:<path>` rather than trusting
  the on-disk copy. Same root cause as the `.git/*.lock` issue (a shared
  live mount, two independent writers) but on an ordinary file with no
  lock mechanism to even fail loudly with. Worth a `git diff`/
  `git show HEAD:<path>` sanity check before trusting a live-mounted
  file's on-disk content is what it was last time you looked, especially
  mid-session on a file the human might also have open -- and especially
  before basing further edits on that content, the way this session
  nearly did.
