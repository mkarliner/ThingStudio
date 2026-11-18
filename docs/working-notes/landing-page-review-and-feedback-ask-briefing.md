# Landing page review and the feedback ask: briefing

2026-11-16. Written from a review session with Mike, for a session to pick up cold.

## What this is

Mike asked for an outside view of thingstudio.net and of whether the project holds up. This note records
what was found, what Mike said in reply, and the changes to make. The main job is to replace the
"Testers wanted" ask with one that costs the reader one line. Mike agreed the draft wording on 2026-11-16.
Tasks 1 to 3 are for the session. The four page suggestions near the end are parked for Mike to think
about and are not part of the work.

## What was and wasn't looked at

- Read: the homepage text of https://thingstudio.net/ on 2026-11-16, and the project docs
  `claude/marketing-plan.md` and `claude/road-to-mvp.md`.
- Not read: the docs site, the in-browser demo, the Getting started pages, the page's visuals or video,
  the README, or any repo.
- Not known: which repo holds the landing page source (the marketing plan says ThingStudioMarketing is
  the marketing repo and `~/Src/ThingStudio` the product repo; check before editing). Find it first.
- The house style for public writing is in the marketing repo's `CLAUDE.md`, "Writing for the public".
  It was not read in this session. The draft copy below must be checked against it.

## Verdict given to Mike

The project is valid. The idea is sound and nobody else occupies the gap:

- Node-RED MCU Edition needs the Moddable SDK and the board's toolchain to build and flash, and its MCU
  node package on flows.nodered.org showed "updated 3 years ago".
- BIPES is Blockly blocks for MicroPython, not flows.

Feasibility is proven on Mike's bench. The open question is demand, which the beta exists to test.

Doubts raised, as page-level points:

1. The audience is a narrow intersection (can program, uses microcontrollers, wants wires). The plan's
   "no cliff" ladder answers this, and it isn't on the page.
2. "Just ask an AI" is the real competitor, as the marketing plan says. The page mentions AI only for
   generating board definitions.
3. The demo clip is a blink. The Freenove sensor display, the plan's answer to "MicroPython is a toy",
   isn't shown.
4. Ten chips checked by one person looks wide for a beta.
5. The AI declaration from the plan isn't on the landing page.

## What Mike said

- **On depth (point 4):** confidence in the chip coverage rests mainly on MicroPython, which has been
  tested on many platforms. Accepted. The page should say so.
- **On demand:** the evidence is that more than 10 people have very probably tried it. That is different
  from 10 onboarding reports, which may look like too much work to write. The feedback request should
  change.
- He asked for replacement wording, and agreed all of the drafts below as written (2026-11-16).

## Correction: robots.txt is not a problem

The first review said a plain fetch of the site was refused as "robots-disallowed" and that this might
work against `llms.txt`. That was wrong about the cause. `https://thingstudio.net/robots.txt` returns a
GitHub Pages 404: the site has no robots.txt, so nothing on it turns crawlers or AI agents away. The
refusal came from the fetch tool. **Nothing to fix.**

For reference:

- `robots.txt` sits at the site root and tells crawlers which paths they may fetch. It is a request, not
  a lock. No file means everything is allowed.
- `llms.txt` is an informal convention: a Markdown file at the root that gives AI tools a short map of
  the site. Nothing enforces it and not every tool reads it.

Optional, low priority: add a robots.txt that allows everything and points at a sitemap.

## Task 1 (agreed): replace the feedback ask

The current ask wants board, computer, a time for each step and every place the tester stopped. Most
people who try it will say nothing. Replace it with three rungs, cheapest first:

1. One line: board, and how far they got. Success or failure.
2. One sentence about where they got stuck, if they did.
3. The full onboarding report, kept, offered to people with ten minutes.

This fits the marketing plan's definition of "trying it" (a forum post, an issue or a photo counts).

**Needs creating:** a pinned GitHub Discussions thread called "I tried it", the name the agreed draft uses.
The marketing plan also mentions a pinned "What are you building?" thread. Mike hasn't said whether the
two are one thread; ask him before creating it.

### Agreed copy for the homepage, replacing "Testers wanted"

> **Tried it? Tell me in one line**
>
> The idea is that someone with some microcontroller or Node-RED experience can go from a blank board to
> a blinking LED, installing everything on the way, MicroPython included, in about 15 minutes. All you
> need is an ESP32 or a Raspberry Pi Pico.
>
> I can't tell whether that's true without you. Start at Getting started, and when you're done, or when
> you give up, post one line in the "I tried it" thread: your board, and how far you got. "Pico W,
> blinking in 20 minutes" is useful. "ESP32, gave up at the firmware install" is more useful.
>
> If you got stuck, a sentence about where helps me fix it.
>
> And if you have ten minutes, a full onboarding report on GitHub is the most helpful thing of all: how
> long each step took, and every place you stopped, guessed or swore.
>
> Rather keep it private? Email info@thingstudio.net.

### Agreed copy for the end of Getting started, after the LED blinks

> **It's blinking. Tell me?**
>
> One line in the "I tried it" thread, with your board and roughly how long it took, tells me the docs
> work. If something tripped you up on the way, say where.

### Also in Getting started

Add one line at each step where people are likely to give up (the firmware install, the first connect),
since the ones who stop never reach the last page:

> Stuck here? Say so in the "I tried it" thread.

The Getting started pages were not read in this session. Read them and pick the steps from what's there.

### Choices in the copy (agreed with the drafts)

- "Brave souls" and "All polite feedback very gratefully received" were dropped: they suggest hard work
  and expected rudeness.
- The line saying a give-up is "more useful" than a success is deliberate. It is there to get the silent
  ones to post.
- The 15-minute figure stays, worded as an aim. The marketing plan's rule is not to promise it until a
  newcomer test passes; "the idea is" keeps it on the right side of that.

## Task 2 (agreed): say what the chip table means

Next to the "Microcontrollers it runs on" table, add a sentence to the effect that MicroPython carries
the chip support, and what was checked on each board is ThingStudio's layer on top: pins, buses, deploy
and the nodes. Wording is for the session to draft and Mike to approve.

## Task 3 (small fixes, no decision needed)

- Typo in "Try it in your browser": "You can build a flow compile it and read the MicroPython it makes"
  needs a comma after "flow".
- Two sections carry the label "HARDWARE" ("It knows your board" and "Microcontrollers it runs on").
  Give one a different label.

## Page suggestions, parked for Mike to think about

Not part of this work. Mike asked for these to be noted so he can think about them (2026-11-16). Leave
them alone until he says otherwise.

- Show the Freenove sensor-display clip on the page, in place of or beside the blink clip.
- Add the "no cliff" ladder (wire nodes, function node, custom node, share) as a section. The marketing
  plan lists it as a landing-page section.
- Add a short section answering "why not just ask an AI": a visible, editable flow that passes a check,
  with `thingstudio-compile` and the AI-authoring page as evidence. The plan's rule applies: say "passes
  the check", never "works", until an AI-written flow has run on a board.
- Put the AI declaration on the landing page as well as the README and docs Home.

The review suggested doing the first two before pushing for testers.

## Rules that apply

- Check every claim against the code and the docs' Supported hardware page before it goes on the page
  (marketing plan, section 4).
- Public copy follows the marketing repo's house style.
- The product repo's `CLAUDE.md` rules on git writes and npm from the sandbox apply if the page source
  is in a repo mounted from Mike's Mac: hand him the git commands, don't commit from the sandbox.

## Sources

- https://thingstudio.net/ (homepage text, 2026-11-16)
- Node-RED MCU build chain: https://blog.pishop.co.za/?p=34992
- MCU nodes package: https://flows.nodered.org/node/@moddable-node-red/mcu
- BIPES: https://www.hackster.io/news/bipes-brings-block-based-visual-micropython-programming-to-the-raspberry-pi-pico-rp2040-59754e9c9d82
