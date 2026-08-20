# Briefing: next session kickoff (written 2026-08-20)

For the next chat. This is a short orientation pointer, not a task
briefing in its own right — the actual task already has a full briefing
(see below). Written after this session's working-notes consolidation
(`outstanding-items.md`, `decisions.md`, `learnings.md` all new since
most of the project's older briefing files were written) plus a
follow-up pass closing gaps against `mikes-questions-and-points.md`.

## Read, in this order

1. `CLAUDE.md` in full, as always — includes two sections added this
   session worth noting explicitly since they postdate most of the
   project's history: "Decisions and learnings logs" and "Read
   `mikes-questions-and-points.md` at the start of every session."
2. `docs/working-notes/outstanding-items.md` — the current map of every
   open item across the project, themed, with pointers back to source
   files. Read this instead of trying to open all 30+ working-notes files
   individually.
3. `docs/working-notes/decisions.md` and `docs/working-notes/learnings.md`
   — append-only indexes of what's already been decided and what's
   already been learned the hard way. Skim both; don't re-derive
   something already settled.
4. `docs/working-notes/mikes-questions-and-points.md` in full — Mike's
   own live scratchpad, per the new standing `CLAUDE.md` rule. Check for
   anything added or changed since 2026-08-20 specifically (today's date
   at the time this briefing was written) — everything in it as of today
   has already been reconciled into `outstanding-items.md`/`decisions.md`
   (see `outstanding-items.md`'s "Coverage note" section for the two
   items that needed an explicit cross-reference, and the new "Node
   authoring / extensibility" and "init node triggered by start of flow"
   entries for the two gaps that had no home anywhere before today).

## The task

`outstanding-items.md`'s own "Next up" section names this project's
sequencing rule: **`redeploy-cleanup-and-network-fault-detection-briefing.md`**
is the next real implementation session, written the session before this
one and still zero-percent implemented (confirmed against `git log` as of
this consolidation — re-check `git log` again before starting, don't
assume that's still true). Read that briefing in full — it's a complete,
ready-to-execute task doc (root cause, recommended fix, success criteria,
stop conditions, already written), this file doesn't duplicate any of it.

Three problems, all reproduced and root-caused, none fixed yet:

1. Redeploying the same flow twice back-to-back fails the first time with
   an `EADDRINUSE`-style `OSError` — a socket isn't released on redeploy.
2. `wifi_status` reports `payload=True` even when no WiFi config was ever
   set up — needs to barf loudly instead of silently reporting a false
   positive.
3. `thingstudio/config/wifi` has no way to declare an intentionally-open
   (no-password) network.

If that briefing's own "Check `git log` before assuming anything below is
committed" turns out to mean it's already been started or finished,
`rp2350-bringup-briefing.md` is the other unstarted "Next up" item
(RP2350 real-hardware bring-up, RP2040's own counterpart already done)
— see `outstanding-items.md`'s "Next up" section for both.

## Standing rules, don't relitigate

- Git writes (`add`/`commit`) go to Mike as exact commands for a real
  Terminal — never run from the sandbox (`CLAUDE.md`, confirmed
  `.git/*.lock` corruption bug on the live-mounted repo). Read-only git
  (`status`/`log`/`diff`) is fine.
- Flag any new npm/Python package before installing, `--ignore-scripts`
  for npm, update `docs/third-party-licenses.md` in the same change.
- Check for stray compiled `.js` (`find editor/src editor/test -name
  "*.js" -type f`) before trusting any test/`tsc` run.
- Update `decisions.md`/`learnings.md` in the same change that produces a
  decision or a hard-won gotcha, not batched for later — and reconcile
  anything new in `mikes-questions-and-points.md` the same way, per the
  new standing rule above.

## Not in scope for this chat

Anything not named above — in particular, don't start on the still-open
"Node authoring / extensibility" backlog item (no design or scope exists
yet, needs its own dedicated scoping session) or the backend build-out
(`outstanding-items.md`'s "Backend / auth" section) unless Mike
redirects; both are real but neither is next in sequence.
