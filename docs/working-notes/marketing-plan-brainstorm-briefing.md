# Briefing: brainstorm a marketing plan

Status: brief, 2026-10-05. For a session with Mike whose job is to brainstorm, then draft, a marketing plan for
Thingstudio's first public release. Nothing here is decided; the session decides it.

## What we're marketing

Thingstudio is a visual way to program microcontrollers. You wire blocks (nodes) in a browser editor, in the style of
Node-RED; Thingstudio compiles the flow to MicroPython and deploys it to the board, which then runs on its own.
Supported: ESP32 family and RP2040/RP2350 boards. Other MicroPython boards may work, untested.

Selling points already written down (docs Home page, 2026-10-01):

- Runs locally. No cloud service, no account, nothing sent home, works offline once installed.
- Plain, indented JSON files for flows and board definitions: git-friendly, no secrets in them.
- Extensible without rebuilding: custom nodes, boards and processors are files dropped into a folder.
- Free and open source, Apache 2.0 (commercial use fine).
- Event-driven code (MicroPython `asyncio`) without having to write the plumbing; a function node for your own Python.
- Deploy takes seconds, no firmware flashing after the one-off MicroPython install.

## Where things stand (honest inputs)

- Pre-v1. v0.1.2 is the current release: macOS signed and notarized, Windows unsigned, Linux x86_64 and aarch64.
  Docs at docs.thingstudio.net; repo public at github.com/mkarliner/ThingStudio.
- First newcomer test (2026-09-30): LED blinked in 27 minutes with coaching, target 15 with none. Almost all of it
  was installing MicroPython. Docs since restructured; the next test hasn't run. The volunteer was an experienced
  programmer new to microcontrollers, not the target audience, and still got there.
- Open MVP work: packaging routes (Homebrew, Windows on real hardware), task guides beyond Blink, the Pico W
  WiFi-password bug (`mvp-remaining-work-briefing.md`).
- One developer. Whatever the plan is, it has to fit around building the product.

## Questions for the brainstorm

1. **Goal.** What does success look like in 6 months: users, GitHub stars, contributors, custom nodes written by
   others, a school or hackspace using it, sponsorship? Pick one or two; they decide everything else.
2. **When.** Launch now as an early preview, or after the MVP finish line (a passing newcomer test)? What has to be
   true before the first big post (Show HN, Hackaday)? A launch only lands once.
3. **Who first.** Candidate audiences, to rank:
   - Node-RED users who want flows on the device itself
   - MicroPython users tired of hand-writing `asyncio` plumbing
   - Arduino users moving up to WiFi/network projects
   - Makers and hackspaces; event badge communities (e.g. EMF Camp)
   - Teachers and schools (needs classroom material; Windows matters)
   - Prototypers in small companies (local-only and Apache 2.0 matter here)
4. **Message.** One sentence per audience. What's the headline: "Node-RED on your microcontroller"? "Event-driven
   MicroPython without the plumbing"? "No cloud, no account"?
5. **Competition and neighbours.** Which tools will people compare it with, and what's the honest difference?
   Starting list to check, not assume: Node-RED, ESPHome, Tasmota, MicroBlocks, MakeCode, XOD, Arduino IDE,
   Thonny, Blockly-based tools. Some are partners rather than rivals (Node-RED on a server + Thingstudio boards
   over MQTT is already in the docs).
6. **Channels.** Rank by reach for the effort: Show HN, Hackaday tip line, Reddit (r/esp32, r/raspberry_pi_pico,
   r/micropython, r/nodered), MicroPython forum and Discord, Node-RED forum, YouTube demo, a blog post or dev log,
   talks (PyCon UK, EMF Camp, local meetups), hackspace demos, newsletters.
7. **Assets.** What has to exist first: a 60-second demo video or GIF (blank board to blinking LED), a landing
   page (or is the docs Home enough?), an examples gallery, a few showcase projects (sensor to MQTT, a display),
   screenshots (now automated), a README that sells in the first screen.
8. **Community.** Where do users ask questions: GitHub Discussions, Discord, a forum? Who answers? How are
   contributed nodes shared?
9. **Measuring.** Thingstudio promises no telemetry, so measurement is external only: release downloads, stars,
   docs-site visits (does the docs host count anything? check, and say so in the docs if it does), issues and
   discussions, mentions. What's worth tracking?
10. **Budget.** Time per week, and any money (domain is in place; Apple Developer ID already paid; hardware
    giveaways? conference tickets?).

## Constraints

- Don't promise what isn't true: no untested boards as "supported", no "15 minutes" until a newcomer test passes.
- No telemetry, ever, to get marketing numbers. The local-only promise is a selling point.
- Every claim on a public page gets checked against the code first, as on the docs Home page.
- Keep the house style for anything public (`CLAUDE.md`, "Human-facing documentation").

## Suggested shape of the session

1. **Research first, briefly:** check the competitor list (what each does, licence, cloud or not, boards), and the
   size and rules of each channel (e.g. self-promotion rules on the subreddits, Show HN guidelines). Bring facts.
2. **Brainstorm with Mike:** go through the questions; capture options, don't settle each one in the moment.
3. **Draft the plan:** goal, audiences ranked, message per audience, launch gates, channels in order, asset list
   with owners, community setup, what to measure, a 3-month timeline.

## Deliverables

- `docs/working-notes/marketing-plan.md` (or a doc in the project): the draft plan, marked draft until Mike agrees.
- Decisions logged in `decisions/` (new topic file `marketing.md`, plus its index line in `decisions.md`).
- Any product or docs work the plan needs (demo flows, landing page, README rewrite) added to `outstanding-items.md`.
