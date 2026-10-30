# Tester-ready

2026-10-30

The deliverable before the [MVP](road-to-mvp.md). Where the MVP means the launch scope — the headliner and hero
demonstrations, `working-notes/launch-mvp-scope-briefing.md`, decisions in `working-notes/decisions/
launch-scope.md` — **tester-ready** is the smaller, earlier deliverable: the state where a stranger can arrive,
follow the docs, and succeed, and where the friction they hit gets fixed as it arrives.

It exists because Thingstudio is soft-launched: real users are arriving now, as a trickle. Their feedback sets
the work between here and the MVP. The full reasoning for staging things this way: `working-notes/decisions/
launch-scope.md` (2026-10-30).

## The definition

Tester-ready is met when a newcomer, working from the docs alone, from a fresh machine and a supported board:

- **Gets to a first blink in 15 minutes or less** — install, MicroPython if needed, first deploy.
- **Completes the onboarding without stopping** — every step the docs ask for works as written.
- **Gets basic functions working first time** — scope: [TBD, with Mike](#the-tbd-scopes).
- **Never hits a silent failure** — when something goes wrong, they are told what happened and what to do next.

"Probable completion includes more tutorials" — which ones is part of the same TBD scope discussion.

The first three criteria are the same bar set by [road-to-mvp.md](road-to-mvp.md)'s acceptance test; that test,
run deliberately with `working-notes/validation/newcomer-test-script.md`, remains the instrument. What changes
is who does the testing: the soft launch means it also happens continuously, one report at a time.

## The feedback loop

While the soft launch runs, **every user friction is handled in the same change that would have fixed it anyway**:

- A confusing error or a "why does it do that" question becomes a short entry in `docs/user-guide/faq.md` or
  `docs/user-guide/debugging.md`, in the same change.
- A friction that needs product work instead becomes a milestone item in `working-notes/outstanding-items.md`,
  tagged [P1]-[P3] under a tester-ready heading.

Neither queues up for a later round. A friction that neither fits is narrative, not tracking — write the FAQ
entry anyway.

## After tester-ready

Tester-ready done does not close the MVP. The MVP keeps its own definition and scope
([road-to-mvp.md](road-to-mvp.md), `working-notes/launch-mvp-scope-briefing.md`); the launch gates — headliner,
newcomer test with a target-group tester, Homebrew and Windows on real hardware, the Pico W WiFi-password bug —
are unchanged. Tester-ready just says a stranger's first hour works, and that the loop of report → fix → doc is
running without prompting.

## The TBD scopes

Two scope questions are deliberately left open until discussed with Mike, neither blocking the rest of this
doc:

1. **What "basic functions" must cover** — blast a list of node kinds and the flows a tester is expected to be
   able to build first time.
2. **Which tutorials are in** — which board/node combinations get a step-by-step tutorial between here and the
   MVP.

Agreed scope lands as an amendment to [the definition above](#the-definition), dated.
