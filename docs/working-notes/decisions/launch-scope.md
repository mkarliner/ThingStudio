# Decisions — Launch scope (product work the launch plan made launch-critical)

Status: detail file for `decisions.md`'s "Launch scope" index entry. Full reasoning and the work list:
`docs/working-notes/launch-mvp-scope-briefing.md`. Marketing-only decisions from the same session
(audiences, messages, channels, community, measurement) are in the marketing plan's decisions log, in the
separate ThingStudioMarketing repo — not logged here.

- **2026-10-05 — one public launch, after the headliner works.** Mike's call over a two-stage launch (quiet
  preview, then a big one): "we have enough idea of the GUI system to be able to implement fairly quickly."
  Gates in order: GUI system and headliner; a newcomer test with a target-group tester; Homebrew and
  Windows on real hardware; confirm the Pico W WiFi-password bug is fixed.
- **2026-10-05 — headliner: "a touch panel for the things you already own"** on a Freenove FNK0104B
  (ESP32-S3, ILI9341, FT6336U capacitive touch): BME280 readings shown and published over MQTT; a Tasmota or
  WLED device's state shown and toggled by touch; unknown/stale values shown when the network drops. Chosen
  over the classic CYD so viewers can buy the same board; the CYD stays supported.
- **2026-10-05 — GUI templating system moved from POST-MVP to the launch path.** Container/constraint layout
  (flexbox, X Intrinsics), no absolute positioning, built properly — Mike: "a half-assed implementation for
  a headliner would turn into a millstone." Scope is cut in the widget set (label, value, button, status),
  not in the layout model. Supersedes the `[POST-MVP]` "Templating UI nodes for displays" item.
- **2026-10-05 — headless compile/validate raised in priority.** AI authoring of flows and add-ons is now
  part of the pitch ("use AI, without the slop"), and an agent needs to validate its own output. Supports
  Mike's earlier idea of moving the compiler to the backend; a Node CLI around the existing compiler is the
  cheap first option to check.
- **2026-10-05 — a user-facing AI-authoring doc** (for agents working in the user's folder, not the repo)
  becomes launch work, tested like a newcomer test.
- **2026-10-09 — the headliner board is the Freenove FNK0104S (4.0", ST7796, 320x480), not the FNK0104B.**
  Mike's own unit, already running the GUI and touch. ILI9341 support leaves the launch path. Detail and the
  CYD gate for custom firmware images: `decisions/gui-layout.md`.
- **2026-10-10 -- headliner split.** The toggle is dropped from the showreel flow (not useful on video). The headliner
  is the BME280 readouts, trends and MQTT publish; a separate external-controls flow (Tasmota/WLED state, toggle,
  unknown/stale) keeps the launch acceptance. Mike's call.

- **2026-10-30 -- a tester-ready milestone sits before the MVP; MVP keeps the hero demos.** Mike, as he found the
  priorities docs drifted: "there is a milestone prior to MVP which is tester ready... I want a deliverable that
  tests clean onboarding and basic functions, probably includes more tutorials." The MVP still means the launch
  scope (headliner/hero demonstrations and the rest of `launch-mvp-scope-briefing.md`); tester-ready is the
  deliverable before it. Thingstudio is soft-launched, so feedback now arrives as a trickle of real users;
  clean onboarding, basic functions and more tutorials should be the tracked, tested deliverable first. To be
  written up as `docs/tester-ready.md` (position chosen the same day; scope of "basic functions" still TBD with
  Mike), alongside demoting `mvp-feature-priorities.md` (2026-08-11) to a historical record.
- **2026-10-30 -- the AGENTS.md interface rule renamed to "tester-hardened".** Mike chose "tester-hardened"
  (over "initial-testers-ready") so the rule "Architecture first at subsystem interfaces: MVP-ready is not
  tester-ready" no longer collides with the new pre-MVP tester-ready milestone's name, which is what people
  will say out loud. Rename pending application (this session stopped; it is the first edit of the next one),
  with a dated note then added to `decisions/subsystem-interfaces.md`.
