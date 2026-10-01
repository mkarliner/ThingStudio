# Newcomer test: session script

Status: working note, 2026-09-30. The MVP finish line (`../mvp-remaining-work-briefing.md`): a fresh machine and
a fresh board to a blinking LED in 15 minutes, following only the docs. This is the script for running that test
with one volunteer. First run: macOS. Results go at the bottom, one dated section per session.

## Who

One volunteer from the audience the docs are written for: someone who can write a little Python and wire an LED,
and who hasn't used Thingstudio. Node-RED, MicroPython or Arduino experience is fine, and worth noting. Not
someone who has watched Thingstudio being built.

## Before the session

- **Machine:** a Mac on macOS 15 or later, in a user account that has never run Thingstudio. A new account on your
  own Mac is fine; your usual account is not (stale Local Network entries, `learnings/backend-security-research.md`).
  Don't install anything in it: no Python, no Homebrew, no Xcode tools. The test includes finding out what's
  missing.
- **Board:** a plain Raspberry Pi Pico (RP2040, not the W), **without** MicroPython. Its LED is on GPIO 25, and
  MicroPython goes on by drag and drop, so the first run tests the docs rather than esptool. An ESP32 board is a
  later run: its route needs `pip install esptool`, and a fresh Mac has no `pip` (a likely finding in itself).
- **Cable:** a USB cable that carries data. Test it beforehand with another board.
- **Browser:** Safari, the default. Don't set up Chrome.
- **Clock and notes:** a timer, and the log below printed or open on another device.
- **Docs:** check https://docs.thingstudio.net/ loads and matches the release you expect the volunteer to install.

## What to hand over

The board, the cable, the Mac, and this one line on a card:

> Make the LED on this board blink using Thingstudio. Start at docs.thingstudio.net.

Nothing else. No verbal tour, no hints about MicroPython or the terminal.

## Rules for you

- Ask them to think aloud. Say once that you're testing the docs, not them.
- Don't help. Don't answer questions; say "what would you do if I weren't here?" and log the question.
- If they're stuck for **3 minutes** on one thing, give the smallest hint that gets them moving, and log it as a
  failure point. A hint is a docs bug.
- Stop at **30 minutes**, blinking or not.
- Don't fix anything mid-session, even something small. Note it and keep going.

## What to watch

Note the clock time when they reach each point. Expected route, in order:

| # | Checkpoint | Docs page |
| --- | --- | --- |
| 1 | Opens the docs, reads or skips the introduction | Home |
| 2 | Realises the board needs MicroPython | Home → Installing MicroPython |
| 3 | Downloads `RPI_PICO` firmware and copies it on with BOOTSEL | Installing MicroPython |
| 4 | Runs the `curl … \| sh` installer in Terminal | Getting started |
| 5 | Starts `thingstudio`; the editor opens in the browser | Getting started |
| 6 | Connects to the board | Getting started |
| 7 | Installs the runtime | Getting started |
| 8 | Builds timer → function → gpio out, pin 25 | Blink an LED |
| 9 | Deploys; the LED blinks | Blink an LED |

Also watch for: what they read and what they skip, where they hesitate, anything they type that fails, any
message from Thingstudio they don't understand, and anything they go to a search engine for.

## Log

One row per stall, question, error or hint.

| Time | Checkpoint | What happened | What they said or asked | Hint given? | Docs or product fix |
| --- | --- | --- | --- | --- | --- |
| 2026-09-30 | 1-3 | Unsure whether he had to install MicroPython at all. Home's "Next" sent him to Installing MicroPython; its first check needed Thingstudio, which he didn't have yet; it ended "Go back to Getting started". | (not recorded verbatim) | Yes: coaching through most of the MicroPython install | *docs*: route restructured into numbered steps, 2026-10-01. *product*: see `../outstanding-items.md`, "Install MicroPython from the editor". |
| 2026-09-30 | 4-9 | Connect, runtime install, build and deploy went without trouble. LED blinked. | | No | none |

## Afterwards, with the volunteer (5 minutes)

1. What was the most confusing moment?
2. Was there anything you expected the docs to say that they didn't?
3. Did you read the introduction? Did it help, or get in the way?
4. Which message from Thingstudio did you not understand?
5. What would you try next with it?

## Afterwards, on your own

- Every log row becomes a docs fix or an item in `../outstanding-items.md`, with the time it cost.
- Write a Results section below: date, volunteer's background (not their name), board, total time, checkpoint
  times, the three worst stalls.
- Pass means the LED blinked within 15 minutes with no hints. Anything else is a fail, with a list of what to fix
  before the next run.

## Results

### 2026-09-30, macOS, first run

Recorded 2026-10-01 from Mike's account; checkpoint times weren't logged.

- **Volunteer:** an experienced programmer, but new to microcontrollers, Node-RED and Arduino. Not quite the
  target audience (a little Python, can wire an LED); close enough to count, and a realistic one.
- **Board and release:** not recorded here. v0.1.2 wasn't tagged on the day, so the installer would have served
  0.1.1. Confirm with Mike before the next run's comparison.
- **Total time:** 27 minutes, LED blinking.
- **Worst stall:** installing MicroPython, almost all of the coaching. Root cause: the docs route wasn't a straight
  line (see the log). Steps 4-9 (install, connect, runtime, blink) went fine.

**Verdict: fail.** The LED blinked, but at 27 minutes and with hints, against 15 minutes and none. The failure is
concentrated in one place: getting MicroPython onto the board. Fixed before the next run: the onboarding docs are
now one numbered route (Getting started → Install MicroPython → Connect → Install runtime → Blink an LED), each
page pointing only forward (`../decisions/documentation-process.md`, 2026-10-01). Next run: Mac again, plain Pico,
v0.1.2 published, a different volunteer, to check the restructure on its own before moving to Windows or Linux.
