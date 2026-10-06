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
