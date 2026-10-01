# Briefing: documentation review after the first newcomer install

Status: brief, 2026-10-01. For the session after Mike runs the first newcomer test
(`validation/newcomer-test-script.md`). Its job: turn what the newcomer tripped on into fixes, docs first, then go
back to packaging (`mvp-remaining-work-briefing.md`, `packaging-install-routes-briefing.md`).

## Before the test (Mike)

- **Release v0.1.2 first.** `main` is at the 0.1.2 bump (`cb5e2a3`); the tag isn't pushed (agent sessions can't
  push tags). `git tag v0.1.2 && git push origin v0.1.2`, then publish the draft. The newcomer must get 0.1.2: it
  has the onboarding docs, the File/Tools/Help toolbar the docs now describe, Pins…, custom-node auto-load and the
  Windows installer. Installing 0.1.1 against today's online docs would test a mismatch, not the docs.
- **Docs to match.** docs.thingstudio.net follows `main`; check it's current on the morning of the test.
- Run the session exactly as the script says: blank Pico (not W), fresh macOS account, Safari, no hints for 3
  minutes. Log every row; fill in the script's Results section the same day.

## Inputs to the review

- The Results section and log of `validation/newcomer-test-script.md`.
- The volunteer's answers to the five debrief questions.
- Anything Mike noticed that the log doesn't capture (where they read vs. skimmed, what they ignored).

## How to work through it

1. **One row at a time.** For each stall, question, error or hint, decide which of these it is, and say so in a
   column added to the log: *docs* (missing, wrong, unclear, in the wrong place), *product* (the editor or installer
   should have prevented it or said so), *environment* (cable, board, macOS prompt: still worth a docs line if a
   newcomer will meet it again), or *noise* (volunteer-specific, nothing to change).
2. **Fix docs in this session.** Keep to the house style (`CLAUDE.md`, "Human-facing documentation"): short
   sentences, one idea per paragraph, link out rather than inline. Fix the page where the newcomer was when they got
   stuck, not a page they'd have needed to find.
3. **Product fixes go to `outstanding-items.md`,** each with the time it cost the newcomer, unless it's a one-line
   message change (do those now: console messages are the docs a newcomer reads most).
4. **Re-read the route end to end afterwards** (Home → Installing MicroPython → Getting started → Blink an LED) as
   the newcomer would, checking each fix reads in place.
5. **Checks:** `mkdocs build --strict`; an internal link check over the built site; the editor's doc links
   (`board-diagnosis.ts`'s `DOC_*` paths and anchors) still resolve; any console message you changed still has its
   test passing.

## What we already suspect (check against the log; don't fix ahead of evidence)

- **Install runtime is now under Tools** (2026-09-30 toolbar). The console's "no runtime" advice names
  *Tools → Install runtime…*; watch whether the newcomer finds it from that line alone.
- **The ESP32 route needs `pip install esptool`, and a fresh Mac has no `pip`.** Not on this run's path (Pico),
  but if the volunteer looks at it, note the reaction; it decides the next run's board.
- **Pico W vs Pico:** the Pico W's LED isn't on a GPIO. The script specifies a plain Pico; if a W turns up, Blink an
  LED and Pins… both say so; check they were seen.
- **Length of the onboarding.** Home and the Background pages are new. Note whether the volunteer read them,
  skipped via the tip box, or bounced. Too long is a valid finding.
- **macOS prompts:** Local Network (only for WiFi, not this route), the `curl | sh` PATH line, and the browser
  opening. Note any the newcomer didn't understand.
- **"Pins…" and the Board menu:** whether the newcomer used Pins… to find the LED pin, or the table in Blink an
  LED.

## Known docs gaps, independent of the test (MVP item 8, still open)

- Task guides after Blink an LED: read a sensor (bme280 → debug, then MQTT), show something on a display.
- A page per supported display module (SSD1306, ST7789 family incl. M5Stack).
- Troubleshooting from real failures (runtime missing, SPI too fast, `MemoryError`, port busy): check
  `debugging.md` against that list.
- Example flows in the docs deployed on real hardware before a release.

Let the test's findings decide which of these comes first; don't start them before the log is triaged.

## Deliverables

- Docs fixes merged (branch, preview, Mike's OK, as with the onboarding pass), live on docs.thingstudio.net.
- The log annotated, the Results section complete, new product items in `outstanding-items.md`.
- A one-paragraph verdict in Results: pass or fail against "LED blinking within 15 minutes, no hints", and what
  must change before the next run (Mac again, or the first Windows or Linux run).

## Then: back to packaging

From `mvp-remaining-work-briefing.md` and `packaging-install-routes-briefing.md`, still open:

- A real person on real Windows with the `irm | iex` installer (CI's Windows install test passed 2026-09-30).
- Homebrew tap (needs a `mkarliner/homebrew-thingstudio` repo from Mike). winget/scoop: post-MVP.
- `thingstudio` as the command name everywhere (`--help` and startup messages still say `thingstudio-backend`).
- `thingstudio service` helper and launchd/systemd recipes (clean macOS 15 account for Local Network).
- Fresh-VM acceptance per route: Linux x86_64, a Pi, Windows.
- Seeded definition copies hide updated built-ins (`outstanding-items.md`, 2026-09-30): fix before the next release
  that changes a built-in board file.
