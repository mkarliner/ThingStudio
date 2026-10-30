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

Two scope questions were left open until discussed with Mike, neither blocking the rest of this doc. The
discussion happened in session, 2026-10-30; the agreed scope is written below and [the definition
above](#the-definition) already says "probable completion" for both. Both remain Mike's to amend.

1. **Basic functions: the tutorial ladder.** Each tutorial starts from the previous flow and adds one concept,
   so a user keeps a working flow while learning:

   1. Onboard → blink the LED (the existing Getting started).
   2. Blink extended — a `function` node reads the pin state and writes the inverse (
      `machine.Pin(n).value` read-modify-write in verbatim code, the docs' sanctioned raw-hardware path). The
      tutorial states the caveat: the compile-time pin checker cannot see inside function code, so a wrong pin
      there fails on the board, not at compile.
   3. State — the LED's state stored in node context (`context.set('led', not context.get('led', False))`), the
      case the context model was built for; one sentence that `change` does the same without code (flow
      variables).
   4. Connected — blink the LED from an `http in` node, reusing step 3's toggle. Drags forward the WiFi
      config/credential step and "how do I find the board on my network", which a connected tutorial should
      teach; carries the one-line security note that HTTP in is an open LAN port.
   5. MQTT — publish and subscribe, from the HTTP-in flow's config nodes. In scope not because the ladder
      reaches it naturally, but because real users demonstrably go there by themselves (below).

2. **Learner profiles: the design axis for tutorials.** Users arrive in different modes, and every tutorial
   page serves all of them rather than there being separate structures per mode:

   - **Path-follower** — does the directed steps; needs one unambiguous success at each step.
   - **Adventurer** — pokes, gets an unexpected result, works backward; needs loud, attributed failures
     (their loop is error → explanation, so a silent failure kills it) and pointers at success points.
   - **Reader** — reads the docs before touching anything; maximally damaged by docs-vs-product contradictions.
   - **Sample-scavenger** — grabs the nearest importable flow resembling their goal and edits it; the majority
     Node-RED style; needs the complete importable flow per tutorial plus good failure messages when edits break.
   - **Goal-driven arriver** — arrives with a specific goal ("BME280 publish to Home Assistant"); needs
     task-first navigation, already the stated docs rule.

   Consequences already in motion: task guides before reference; the tutorials carry an importable flow,
   linear steps and a "went off the path?" troubleshooting link; and onboarding reports gain the question
   **"what did you try next, and what happened?"** — the profile list gets tested against real behavior.

3. **The "getting adventurous" learning (2026-10-30).** The most recent new user got past blinking an LED and
   went straight to try MQTT. The learning stands above the ladder: users do not follow the directed path — a
   bit of success and they get adventurous. Design consequence agreed: don't fight it, wire it — attach
   pointers at success points ("next, pick:" with 2-3 links), make the adventure fail loudly (MQTT's missing
   WiFi/broker config must be a one-line compile error and an FAQ entry, not silence), and treat tutorial
   validation as watching where a user leaves the path, not only whether they complete it.

Tutorial content work itself is tracked in `outstanding-items.md`; this doc carries the scope, not the
schedule.
