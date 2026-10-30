# Continuation brief: priorities re-stage and context diet

Status: brief, 2026-10-30, end of a planning session. Repo sync happened; **no plan edits have been made yet** --
the next session starts Phase A from a clean tree. Everything below was agreed with Mike this session.

## Where things stand

- `main` was synced: local was 1105c61, origin at d312e9f (~100 commits; v0.5.0..v0.11.1 releases, the protocol
  state machine in #3, flashing, backlog triage). Clean fast-forward pull done, working tree clean.
- **A branch exists for the plan: `docs/context-diet`** (created from d312e9f, currently identical to main).
  All phases commit there; Mike backs out by reverting phase commits or dropping the branch. Push/merge are
  his call.
- The backlog triage phase of the plan is **already partly done on the remote** (not by this session):
  `outstanding-items.md` was restructured 2026-10-24 (now 428 lines) and resolved items live in
  `outstanding-items/resolved.md`. Re-read both before Phase A; the plan's numbers below were derived pre-pull
  and are stale, the structure is not.
- Mike's soft launch is live: a trickle of real users is arriving, and `.github/DISCUSSION_TEMPLATE/
  onboarding-reports.yml` (2026-10-26) is the report form. This is why the milestone needs no scheduled tester
  events -- the loop is support-driven.

## Mike's decisions this session (recorded in `decisions/launch-scope.md`, 2026-10-30)

1. **A tester-ready milestone sits before the MVP.** MVP keeps the hero demos (launch scope). Tester-ready is
   a deliverable that tests clean onboarding and basic functions, "probably includes more tutorials".
2. **Rename the AGENTS.md interface rule to "tester-hardened"** so it stops colliding with the milestone name
   ("MVP-ready is not tester-ready" -> "MVP-ready is not tester-hardened").
3. **The milestone doc goes in `docs/tester-ready.md`** (new project doc, beside `road-to-mvp.md`).
4. **Scope of "basic functions" + the tutorial list: TBD, to be discussed with Mike** -- Phase A step 1 ships
   the doc with a marked TBD section and it gets amended when the discussion happens.

## The agreed plan (all on `docs/context-diet`)

- **Phase A -- priorities re-stage.** (1) Write `docs/tester-ready.md`: definition (newcomer succeeds from
  docs alone, no silent failure, blink <=15 min, onboarding + basic functions + tutorials); the soft-launch
  feedback loop (every user friction becomes an faq.md/debugging.md entry or milestone item in the same
  change; `validation/newcomer-test-script.md` remains the instrument for deliberate rounds); explicit
  pointer to what comes after (`launch-mvp-scope-briefing.md`, `decisions/launch-scope.md`). Cross-link both
  ways with `road-to-mvp.md`. (2) Apply the tester-hardened rename: `AGENTS.md` heading + the phrase in the
  section body, a dated note in `decisions/subsystem-interfaces.md` (history kept), check `decisions.md`'s
  index line mentions the old name inside a dated 2026-08 entry -- leave that history as written. (3) Demote
  `mvp-feature-priorities.md` with a status banner (historical record, 2026-08-11; ~87 references in code and
  tests use it as a dated anchor, so keep the file intact) and sweep its genuinely-open items into
  `outstanding-items.md` with the existing tags. (4) Fix the stale "live sources of truth" pointer,
  `outstanding-items.md` line ~417, to name road-to-mvp/tester-ready/launch-brief instead.
- **Phase B -- AGENTS.md diet.** Now 503 lines after the pull (34.4k -> ~36k chars). Compress, never delete:
  operative rule sentences stay, incident narratives/quotes move to `decisions/<topic>.md` files, each section
  keeps a one-line rule + pointer. Biggest cuts: fault-handling corollaries (~50 lines), handoff-filename rule
  (~38), the new-in-pull supply-chain table, npm (~30), version bump (~31). Target ~180-220 lines. Mike
  reviews the diff (it is his voice).
- **Phase C -- outstanding-items detail-file sweep.** The index is already restructured; what remains is
  sweeping the 82 `outstanding-items/*.md` detail files: confirm open/mark resolved against current code, and
  re-tag everything under the tester-ready/MVP definitions. Explore subagents do checks; ambiguous items park
  in the index's existing "Flagged as ambiguous" section.
- **Phase D -- briefing archive sweep.** Landed-topic briefings -> `archive/` (currently 44 top-level
  briefings; ~20 files already archived). The 9 grandfathered `next-session-picks-*` files move unrenamed.
  Optional one-line-per-file `BRIEFINGS.md` index.
- One commit per phase, prompt Mike before each; doc-only, no test suites affected. After each phase,
  grep-check inbound references still resolve (see the session plan: `mvp-feature-priorities`
  and "MVP-ready is not tester" matches must still land somewhere sensible).

## Open / next in line

- The TBD discussion (decision 4 above) gates the tester-ready scope section, not the rest of Phase A.
- This machine's tooling gaps (environment facts) block a local green-run; installing npm / python3-venv is
  Mike's call (`apt install npm python3-venv` on this Debian 13 box), or the editor suite keeps running on the
  Mac as it does now.

## Environment facts

- Repo: /home/mike/ThingStudio (Debian 13 Linux box), branch `docs/context-diet` at the time of stopping,
  based on d312e9f. Everything committed except nothing-but-this-brief (see the commit at handoff time).
- Sync command that worked: `git pull --ff-only` after `git fetch origin` (local was stale-behind; `git
  status` showed no ahead/behind because the tracking ref predated the push).
- `node` exists (`/usr/bin/node`, v20.19.2, meets the Makefile floor) **but npm is not installed** (Debian
  nodejs 20.19.2+dfsg package only). Run `hash -r` in a fresh shell before assuming node resolution.
- `python3` exists but has **no venv/ensurepip** (`make check-protocol` fails at check-python; the fix is
  `apt install python3-venv`). No micropython / mpy-cross built here.
- Consequence of the above: **no local test suites were run this session**; the base's green status rests on
  the v0.11.1 release pipeline (shipped 2026-10-29) plus "tests at the last full run (2026-10-20): editor 1130
  passed / 2 skipped, backend 301, MicroPython 109" (`reviews/2026-10-23-architecture-and-status.md`, runtime
  12.x-14.x work has landed since that run).
- Serial ports / boards: not touched this session.
