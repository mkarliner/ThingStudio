# Continuation brief: context-diet Phases A-C landed; install the agent tooling, then Phase D

Status: brief, 2026-10-30, end of session. All work is on **`docs/context-diet`**, committed, tree clean:
`ff2cd1f` and earlier are pushed nowhere yet — push/merge are Mike's call. The prior brief
(`priorities-restage-and-context-diet-briefing.md`) planned the work; Phases A-C are done, the scope
discussion happened, Phase D has not started.

## What this session did

- **Phase A** (`1e35dc1`): `docs/tester-ready.md` written (definition + TBD scopes + feedback loop), cross-linked
  both ways with `docs/road-to-mvp.md`; `AGENTS.md` heading renamed to "MVP-ready is not tester-hardened";
  `mvp-feature-priorities.md` demoted with a status banner (sweep finding: nothing new to add — everything is
  tracked, superseded or done); stale "live sources of truth" pointer replaced.
- **Phase B** (`b94578c`): `AGENTS.md` compressed 503 → 325 lines. Mike reviewed and accepted 325 (over the
  plan's 180-220 estimate). Narratives moved out to two NEW decisions files: `decisions/third-party-pinning.md`
  (pin inventory table, exceptions, rationale) and `decisions/handoff-notes.md` (naming incident, environment-
  facts incident), both indexed in `decisions.md`. Non-negotiated: the remaining bulk is operative bullets
  (fault-handling corollaries, npm rules, interface-spec list); further compression means editing operative
  text, only on Mike's steer.
- **The tester-ready scope discussion** (`ff2cd1f`, with Mike): five-step tutorial ladder (blink → function
  read/write → node context → HTTP in → MQTT publish), learner profiles as the design axis
  (path-follower / adventurer / reader / sample-scavenger / goal-driven arriver), and the
  adventurous-user learning (the newest user went blink → straight to MQTT) written into `tester-ready.md`'s
  TBD section, `decisions/launch-scope.md`, and one **[P1] + [TR]** item in `outstanding-items.md`. The
  adventure-related onboarding-report question ("what did you try next, and what happened?").
- **Phase C** (`51c9a4d`): all 86 `outstanding-items/*.md` detail files swept against current code by four
  subagents. Outcome: 7 closures NEW to `resolved.md` ("Added 2026-10-30" section — backend-distribution-story,
  runtime-install-from-editor/editor-deploy, gpio-pin-range, low-memory-warning, presets-design,
  documentation-site, user-docs-GitHub-Pages); 35 detail files carry a dated `> **2026-10-30 sweep:**` banner
  (resolutions or drift corrections, bodies untouched); one new **[TR]** tag in the index tags line, applied to
  the tutorials/user-docs/execution-model/ESP32-C6 items; `cross-platform-requirement.md` parked under
  "Flagged as ambiguous"; index "Last audited" header updated. Index links verified to resolve.
  - Three items remain genuinely ambiguous open: `cross-platform-requirement.md` (parked),
    `mqtt-upstream-issue-decision.md` and `rp2350-bringup.md` (both index items whose next step is Mike's own
    call; left in place).

## Open / next in line

1. **Install the agent tooling on this Debian 13 box** — see Environment facts below; nothing local has run
   the test suites this session. `apt install npm python3-venv` is the fix (Mike's call on this shared box, or
   the editor suite keeps running on the Mac).
2. **Phase D — briefing archive sweep.** ~44 top-level briefings; propose a landed/still-live split by agent,
   Mike scans the list before executing. The 9 grandfathered `next-session-picks-*` files stay unrenamed.
   Optional one-line-per-file `BRIEFINGS.md`.
3. **The tutorial ladder itself** — authored work, [P1] + [TR] in `outstanding-items.md`. Also owed when
   tutorial work starts: success-point pointers ("next, pick:"), the MQTT missing-config FAQ entry, the
   function-node pin caveat note, the HTTP-in open-port note, and the onboarding-report question.
4. Post-pull housekeeping: the tester-hardened rename and [TR] tag both want a `learnings.md`-style consistency
   grep ("MVP-ready is not tester-ready", "[MVP-READY]"), after any pull — history files keep the old name.

## Environment facts

- **Repo**: /home/mike/ThingStudio, branch `docs/context-diet` at `51c9a4d`, based on d312e9f; working tree
  clean; every commit by `git -c user.name=… -c user.email=…` per-invocation — **no git identity is configured
  on this box** (author recorded as Michael Karliner <mike@karliner.net>); Mike may want `git config` once.
- **Node**: exists (`/usr/bin/node` v20.19.2, meets the Makefile floor) — **npm is NOT installed** (Debian
  nodejs package only). Installing npm here does not follow the `editor/` install rules (that's macOS/Homebrew
  instructions) — `apt install npm python3-venv` is Debian's own paths, untested here.
- **Python**: exists, **no venv/ensurepip** — `make check-protocol` fails at check-python until
  `apt install python3-venv`. `python3 -m py_compile` works for syntax-only checks.
- **No micropython / mpy-cross built** on this box; `device-runtime/test/README.md` has the ~2 min recipe, needs
  a scratch dir (never the shared Mac mount).
- **Local test runs this session: none.** All Phase A-C/commits are docs-only. Last full green run: the
  Mac, 2026-10-20 (editor 1130 passed / 2 skipped, backend 301; MicroPython 109); runtime 12.x-14.x has landed
  since, so the MicroPython suite is the one under suspicion on next hardware contact.
- **Serial ports / boards: not touched this session.**
- **Hackaday page** (Mike's public project page): he applied all six reviewed edits this session, verified
  live with a cache-busted fetch (plain fetch returns a byte-identical stale snapshot — see
  `learnings/public-page-fetch-caching.md`). Nothing further owed there; the site/docs
  "Thingstudio" → "ThingStudio" rename follow-up was discussed, not done — Mike hasn't called it.
- **`npx` policy**: none installed yet; if the next session runs anything with npx, per `CLAUDE.md` never
  outright — `--no` or pre-install only.
