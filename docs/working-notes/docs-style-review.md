# User docs style review

Status: in progress, 2026-10-10. Brief: `user-docs-style-review-briefing.md` (project doc). Mike's remarks are
recorded verbatim first, then grouped. Interpretation goes in the "Patterns" section only.

## Remarks, verbatim

### Opening questions (2026-10-10)

- **Reader:** "NodeRed and micropython programmers, possibly C/C++ programmers, which is not the same as arduino,
  maybe platformIo folks"
- **Voice:** "neutral, although I'll do some specific edits, we can't hide the fact that it's AI generated. You are
  not good at humour and an AI being personal puts peoples backs up. Please note this"
- **Node pages:** "Node pages are references. tutorials are separate"
- **Internal terms:** "Internal terms should be removed. The user docs should reflect only the current state. There
  may be a case for a 'futures' section to elicit responses from users."
- **Screenshots:** "Screenshots are useful. sometimes croped to make sure the relevant bits are big enough"

### Page reactions

#### `index.md`, opening paragraph (2026-10-10)

Mike's own rewrite of the opening (pasted, not yet saved to the repo; he says it "needs adjustment"):

> Thingstudio is a visual, low code way to program microcontrollers. It uses a web based editor to show you a node
> based editor that represents your program as boxes, which represent functional blocks and wires, which represent
> the flow of data between them.  This style has been inspired by [Node-RED](https://nodered.org/).
>
> Thingstudio turns the diagram (canvas) into [MicroPython](https://micropython.org/), a version of Python for
> microcontrollers, compiles it and sends it to your board to run. Once the program is on your board, it no longer
> needs to be connected to the editor and will on its own, including after reboots.
>
> With Thingstudio everything runs locally on your own computer, there is no cloud service involved.

#### `index.md`, feature list and "background" tip (2026-10-10)

Mike's edit, pasted (changes from the repo: "Your files, in git" became "Git friendly"; the tip's links became a
list; the admonition type became `Fastrack`):

> - **Git friendly.** Thingstudio's files, your programs and your board definitions, are plain, indented
>   JSON that you save where you like. [...rest of list unchanged...]
>
> !!! Fastrack "Already know the background?"
>     If you already know Node-RED, MicroPython or Arduino, read the section/s about what's difference for you or
>     go straight to [Getting started](getting-started.md).
>  - [Node-RED](coming-from/node-red.md)
>  - [MicroPython](coming-from/micropython.md)
>  - [Arduino and C](coming-from/arduino.md).

#### Separate note: the `.thingstudio` folder (2026-10-10)

> The docs have no mention of .thingstudio features, like credentials storage, presets, etc. We need a section to
> describe this in general before we go on to their user in particiular bits of the system

Done as a draft: `docs/user-guide/thingstudio-folder.md`, in the nav before Canvas basics. Also corrected
`installing-more.md`, which said flows live in `~/.thingstudio` (they don't: flows save wherever you choose; the
backend's `flows/` store is unused).

#### `index.md`, "What's different" section (2026-10-10)

On "Most microcontroller programs are one big loop. Read the sensors, check the buttons, update the outputs, go round
again. It works, but every new job makes the loop longer and its timing harder to reason about.":

> It reads awkwardly. We could say
> A typical programming enviroment for microcontrollers, like say Arduino, consist of a 'setup' section, run at boot
> time, and a main loop. It might do something like....
>
> * Read the sensors
> * ....
>
> This bit is to remind people what's awkward about this pattern, not to teach them it. Asynch programing is not such
> a well known skill and we do need to explain that and why we're making it easier, but we may also point out that
> Thingstudio is based on solid foundations of standard python and a popular, well maintained packages i

(Message cut off at "packages i".)

On the "Built on standard parts" list, its "Stock MicroPython firmware, no custom build to flash" item:

> remove  stock MicroPython firmware, with no custom build to flash as it may not be true in time.

#### `index.md`, "Where your own code goes" (2026-10-10)

Mike: "tell me whats wrong with this", then, on the critique: "yes let's see what you've learnt". Rewritten by
Claude; awaiting his reaction.

#### `index.md`, section order (2026-10-10)

> events, nodes and wire /  running on the board / your own python are the wrong order. It's not a natural flow

#### `index.md`, "Events, nodes and wires" (2026-10-10)

> drawn as a small chain of nodes (it may not be small)
> A message is a small bundle of data (same)
>
> Each response to an event is drawn as a small chain of nodes. A node does one job: fire every second, read a pin,
> run some Python, switch an output.
>
> not useful. How about
>
> There are three types of nodes:

#### `index.md`, "Built on standard parts" (2026-10-10)

> the bullets have no intro sentence, like:
> Thingstudio tries not to reinvent the wheel,
> Micropython gives us the underlyiing  event driven primitives
> We use tried and tested libraries for extra functionality and hardware drivers
> What comes out is plain Python. You can read....

#### `index.md`, "What you need" (2026-10-10)

> In what you need, we can call out ESP32 and rpxxxx, and actually have a page that lists what's configured and what
> we've been able to actually test and invite the reader to provide us with issues or confirmation. They can also get
> a hint that AI's really good at generating say processor definitions....

Drafted as `docs/user-guide/supported-hardware.md`. "Tested" column built from working notes
(`board-definitions-verified-briefing.md`, the ESP32-C3 WiFi pass in `outstanding-items.md`, boards.md's Freenove
row); awaiting Mike's confirmation.

#### `index.md`, closing line (2026-10-10)

> These docs follow the latest code. (the docs on our website...) (the docs  inside TS....

#### `nodes/clock.md` (2026-10-10)

On "The board asks the NTP server once WiFi is up (the flow needs a WiFi setting, which an MQTT node brings in),":

> not true, you can have a clock with no MQTT just a wifi...

Checked: WiFi is joined by wifi_status, wifi_gate, mqtt publish/subscribe, http request, http in, udp send/receive
(callers of `wifiSetupStatement`); clock only checks `isconnected()`. A clock-only flow compiles and never syncs.

On the clock page's opening ("The time and date, from the internet, as text for a display. Wire a timer in, and the
time and date out to two labels to make a clock page."):

> it this is what it does, its wrongly designed. It's then a gui node not a general.
>
> there should be a strict division, ntp node and text display with a 7 seg option.

(A design remark, not a docs one: the node mixes time sync, time zone, and display formatting.)

> I think ntp can have an option to format. unix time, and a few variations on date and time,
> remove the current node (silly Sonnet)
>
> log the item for fixing, we're doing docs

Logged: `outstanding-items/ntp-node-replaces-clock.md`.

#### `nodes/display-spi.md` (2026-10-10)

On "**controller** — the display chip: `ST7789` (240x240, 135x240, 240x320) or `ST7796` (320x480). An ST7796 panel
has no offset, so leave xstart / ystart at `-1`.":

> is probably going to be difficult to keep up to date. Maybe one page with currently supported hardware and a link
> from that page. May be the same pages as boards and processors

Done: `supported-boards.md` became `supported-hardware.md` (displays, touch, sensors added); display-spi links to it.

#### Node naming (2026-10-10)

> i2c should i2c device, i2c busses should be singular

Done: palette label `i2c` → `i2c device` (`palette.ts`, label only; type `thingstudio/i2c` unchanged), page titles,
nav and links; "I2C buses" → "I2C bus" to match the config's own label. Catalog needs regenerating on the Mac.

> GUI nodes (preview) ????

Done: "(preview)" removed from title, nav and node index. The intro also said pages are laid out by editing the flow
file and "the GUI view ... is coming"; out of date (the property panel has the page outline). Rewritten to the
current state; "There is no preview yet" in Laying out pages reworded.

## Patterns

(Not grouped yet.)
