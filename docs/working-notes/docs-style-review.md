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

#### `first-flow.md` and Canvas basics (2026-10-11)

> In blink a led, we have a table of just two board's led pins. It's better to reference the supported hardware page
> (and mention the Pins button on the canvas).
>
> Canvas basics (better name is Editor Tour or something like that, is in the wrong place. If you can't find your way
> around the UI, how are you going to make your first flow?

> split the page. (i'd prefer if the tour screen shot had an overlay of arrows with text labels, other wise I have to
> go back and forth from the picture to the list.

Done: `editor-tour.md` is Getting started step 3 (later steps renumbered 4-6); the reference half of Canvas basics
is `working-in-the-editor.md`. `tools/screenshots.py` now draws labels in a margin with arrows (run in the cloud
container against Mike's `editor/dist`; the VM can't download Chromium).

> are still the wrong order, I'm going
> * Thingstudio (computer)
> * micropython (board)
> * Thingstudio (computer)
> * connect(board)
>
> understand?  pages and the manual in general shouldn't break the logical folow unecessarily

Done: tour is step 2, MicroPython step 3.

#### `installing-more.md` (2026-10-11)

> [Getting started] covers installing Thingstudio. This page covers the rest. ??
> Whats wrong with this

Then "yes" to the fix: renamed `installation-details.md`, opening says what's on the page, sections reordered to
match Getting started (packages, installer script, source); start options and the CLI runtime install moved to a new
`command-line.md`.

## Patterns

Grouped from the remarks above. Each is written up, with examples, in `docs-style-guide.md`.

- **Reader:** programmers (Node-RED, MicroPython, C/C++); don't teach basics. (Opening answers; "Most microcontroller
  programs are one big loop" remark.)
- **Voice:** neutral, no humour, no "we". (Opening answers; Built on standard parts.)
- **Current state only:** no internal terms, no "preview"/"coming", nothing likely to change. (Opening answers;
  stock-firmware removal; GUI (preview).)
- **Name things:** reader's terms, editor's labels, specific nouns. (Opening paragraph; "These docs"; i2c device.)
- **No false sizing words.** ("small chain", "small bundle".)
- **Order follows the work.** (Section order on Home; Getting started; More on installing.)
- **Open with the page's purpose.** (More on installing.)
- **Lists get an intro sentence; link choices go in lists.** (Built on standard parts; background tip.)
- **One home for changing facts.** (display-spi controller list; Blink an LED pin table.)
- **Pictures labelled in place.** (Editor tour.)
- **Design follows docs:** a node that's awkward to document may be badly designed. (clock; logged as an item.)


## Rewrite log (2026-10-11)

Part 1 of `user-docs-rewrite-briefing.md`: the P1 pages, rewritten from the guide alone. Per page: calls the guide
didn't settle, then factual fixes (checked against `editor/src`, `device-runtime/src`, `backend/src`).

### Cross-page calls

- **Node name styling:** the guide says "names as in the palette" but not bold or code. Used code (`gpio out`) in
  prose and reference pages, bold in tutorial steps where the reader drags the node (**timer**). Not consistent
  with every existing page.
- **GUI node names:** the palette shows `screen`, `readout`, `button` in a GUI group; the guide's word list says
  `gui screen`. Followed the guide and `nodes/gui.md`: `gui screen`, `gui readout`, `gui button`.
- **"Every list has a sentence before it":** on troubleshooting lists the sentence is filler ("Each symptom below
  has its own fix"). Added it anyway. The rule may want an exception for symptom lists under their own heading.
- **Console text:** quoted exact console messages (connecting, debugging). They change when the code's wording
  changes; the guide's "one home for changing facts" doesn't say whether that applies to UI text.
- **Console level:** several pages described lines that only show at **Info**. Said which level a line needs
  wherever a page shows or describes console output. Worth a rule.
- **Picture labels vs editor labels:** the editor tour's picture says "Console" and "Compiled source"; the panels
  are titled "Device console" and "Compiled source (preview)". Kept the picture's names. The guide doesn't say
  which wins, or what to do when an editor label has a banned word ("preview").
- **Durations:** treated "about half a minute" like a sizing word and removed it.

### `getting-started.md`

- The page is both the Getting started overview and step 1; opening sentence names both.
- Moved "read the script first" into the installer section, from between the two choices (order rule;
  `CLAUDE.md`'s `curl | sh` rule still met).
- "Start Thingstudio": the three routes as a list (choices rule).
- "a supported board" (linked to `boards.md`) became "a board that runs MicroPython", linking Supported hardware
  (one home rule; `CLAUDE.md`'s unsupported-boards rule).
- Kept "Start Thingstudio if it isn't running" on steps 2 and 4: each page can be opened on its own (Help →
  Getting started). The guide doesn't say whether steps repeat prerequisites.
- Factual: none.

### `editor-tour.md`

- Added intro sentences to the three lists.
- Factual: "Board buttons ... or remove the saved flow" was wrong; Remove flow is in Tools, the console buttons are
  Stop flow & open prompt / Restart Thingstudio. Custom nodes go in the group they name, else General, not "their
  own group".

### `installing-micropython.md`

- Kept the chip/build and esptool address tables: task data, not support status, so not moved to Supported
  hardware.
- Download mode moved after the commands, as the fallback ("try without it first" was buried).
- Dropped "for beginners" from Thonny (reader rule). Other chips named as STM32, nRF, SAMD per `CLAUDE.md`.
- Factual: "To try another chip, add a processor definition" now points at Supported hardware's Other boards.

### `connecting.md`

- Factual: **Connect** doesn't turn green; it becomes **Connected · Disconnect**, as soon as the port opens, not
  after the runtime replies. The chip type, runtime version and free memory only show at Info. Port pre-selection
  is "the only USB device", not "the only board".

### `installing-runtime.md`

- Added: after an upgrade, a runtime major mismatch blocks Deploy (`version.ts`).
- Factual: per-file progress only shows at Info. You don't need to be connected; Install runtime disconnects first.

### `first-flow.md`

- Factual: the sample console output had `[compiled -- ...]` (Debug) and `[memory]` (Info) lines a reader at Normal
  never sees. Deploy is also greyed out after a deploy until the flow changes, at the prompt, and while restarting.
  Pin fields take the GPIO number.

### `working-in-the-editor.md`

- Cut Presets and Config nodes to what and how (dropped "This is deliberate..." and the direct-mode remarks).
- Wiring rules as a table.
- Dropped "Current limitations" (no resizable panes): the guide says no lists of what's missing, and no page is
  where the reader meets it.
- Factual: wire rules were wrong: `any` goes into `bytes`, `string` goes into `number`/`int`, `int` doesn't go into
  `string`, and the "explicit conversion" node doesn't exist (logged:
  `outstanding-items/function-output-into-typed-inputs.md`). The flow label *is* sent to the board for a gui button
  with no board label. Presets also exist on the Touch panel config. Node status: seven node types, not three. The
  I2C bus and Touch panel configs weren't listed.

### `sensor-display.md`

- Gave the full display spi settings as a table, since no Freenove preset ships (one home vs a tutorial needing
  values: kept them in the tutorial).
- The example flow turns pages with a `gui navigator`, which is hidden from the palette. Mentioned it in one line;
  **question for Mike:** is a timed page turn worth a palette node, or should the example drop it?
- Factual: "steps 2 to 4" should be 3 to 5. No "Freenove 4.0" preset" exists on a new install. bme280 address is a
  0x76/0x77 menu, not a number. The touch panel config wasn't explained. Labels: "room for (characters)", "bottom
  at / top at", "+" not "new". "Skip MQTT and you need WiFi only for the clock" was wrong: the clock doesn't join
  WiFi. The example flow isn't installed with Thingstudio; linked it on GitHub and said to pick your own
  credentials.

### `debugging.md`

- Reordered by the work: tools (console, commands), then connecting, deploying, running, recovering. Kept the
  tool-named headings (Console, Commands, Restarting the board): the editor links to their anchors, and the guide's
  "symptom first" doesn't say what to do with a tools section on a troubleshooting page.
- Renamed "Known platform limitation: WiFi/MQTT connect ordering" to the symptom, "WiFi Internal State Error on
  deploy".
- Added "Deploy is greyed out".
- Factual: the Board won't connect table didn't match the console's wording and missed three cases (install mode,
  install stalled) and the port-open errors (`connect-error-help.ts`). `[memory]` shows only at Info. Help menu
  item is "About Thingstudio"; "source preview panel" is Compiled source.

### Added on the way

- `faq.md`: why a function won't wire into `pwm out`; why Deploy is greyed out after a deploy.
- `outstanding-items/function-output-into-typed-inputs.md`, plus an index line.

## Remarks during the rewrite (2026-10-11)

Mike, sent while Part 1 was running (read against the pages as they were):

> In blink a led:
> After how it works, suggest the reader try a few mods
> - changed the timing
> - use a different method for the blink
>  - check the gpio value and set the led the other way
>  - use a context value (make a link to contexts)
>
> Point out how this shows that flows are stateless unless explictly give state with context
>
> - If it doesn't blink should also link to troubleshooting
>
> Sections
>
> There is only
> - Background
> - Getting Started
> - Node reference
>
> After blink a led, its just a list of non-getting-started items with no obvious order

Done: `first-flow.md` has "Try these changes" (timing, read the pin, `context`) and a closing line on where a flow
keeps state; "If it doesn't blink" ends with a link to Debugging & troubleshooting. Nav regrouped: Tutorials,
Building flows, Boards and networks, Node reference, Extending and automating, Troubleshooting.

Sorted (Part 2's four kinds), as candidates for the guide once Mike confirms:

- **Rule missing:** a tutorial ends with changes for the reader to try, each teaching one idea, and says what they
  show.
- **Rule missing:** a troubleshooting section on a task page ends with a link to the main troubleshooting page.
- **Rule missing:** the nav groups pages into sections in the order of the reader's work; no loose top-level pages
  after Getting started. The "order follows the reader's work" rule covers pages and sections within a page, not
  the nav's grouping.

### Editor tour picture (2026-10-11)

> Many of the labels just repeat whats in the UI, 'Compiie - deploy' doesn't give me any new information.  Maybe
> ;Deploy flow to board' etc? The flow tabs label is at the bottom pointing to the top..
>
> Board buttons is just wrong. It should be 'escape to REPL' Similarly python prompt, which not right.

> You can have the label bigger and it doesn't matter too much if they obscure some of the screen, this image is
> just so people can navigate around....

Done: labels say what each part is for ("Deploy flow to board", "Escape to REPL", "Run Python on the board");
`editor-tour.md` uses them as the bullet names and names the UI control in the text. `tools/screenshots.py`:
18 px labels, labels on one side spread so they don't overlap, a "below" side (the flow tabs label now sits under
the tabs, pointing up), wider right margin. Regenerated in the cloud container; settles the "picture labels vs
editor labels" call in the rewrite log.

- **Rule missing (Pictures):** a label says what the part is for, in words the UI doesn't already show. Labels can
  be large and cover the screenshot; finding your way matters more than what they hide.

### `working-in-the-editor.md` opening (2026-10-11)

> Wire types, node labels, presets, config nodes, node status and notes: the parts of the editor the [editor
> tour](http://127.0.0.1:8765/docs/editor-tour/) doesn't cover.
>
> not very useful

Done: the opening now says what the reader can do with the page (wire mismatched types, name a node, reuse
settings, keep passwords out of flow files, see a node's state on the board).

- **Rule unclear (Open with what the page is for):** the rewrite read "what the page covers" as a list of topics,
  plus a pointer to another page. The rule should say: what the reader can do after reading it, in their terms, not
  a table of contents. Bad example: this opening.

> I think working in the editor could be Editor details or editor in depth without an intro
>
> rather than list the unrelated topics in the intro para turn wiring,flow label, etc into subsection

Done: page titled "Editor in depth" (file name unchanged, so links and anchors hold), no intro; each topic is its
own section. Link text updated on every page that pointed here.

- **Rule unclear (Open with what the page is for):** a page of unrelated reference topics needs no opening at all;
  a title that says what it is ("Editor in depth") and one section per topic does the job. The rule should allow
  that.

### `wifi-provisioning.md` opening (2026-10-11)

> A device can learn its WiFi credentials on its own, over the air, instead of having them baked into a flow.
>
> is just not right.
>
> 'You can leave wifi credentials blank to be filled in at run time

Done: rewritten from the reader's action ("You can leave a flow's WiFi network and password out, and enter them on
the board when it first starts"); "Turning it on" says to leave the credential blank (checked: `wifi-status.ts`
needs no SSID when security is unmanaged). Rest of the page brought to the guide on the way (P2 page): numbered
setup steps, "yet" removed, `PORT` instead of a macOS device name, added the 10-minute portal timeout
(`wifi_provision.py`'s `_PORTAL_TIMEOUT_S`) and the 8-character password minimum.

- **Rule missing (Say what the reader does):** open with what the reader does, in plain terms, not what the system
  does in its own vocabulary ("learn its credentials over the air", "baked into a flow").

### `getting-started.md` opening (2026-10-11)

> Getting started takes you from a new board to a blinking LED in six steps. This page is step 1: installing and
> starting Thingstudio.
>
> not useful

Done: the opening is now the list's lead-in only, "From a new board to a blinking LED:".

- **Rule unclear (Open with what the page is for):** third remark of the same kind today (with Editor in depth and
  WiFi provisioning). The rewrite kept describing the page itself ("This page is step 1", "takes you from").
  Proposed rule: no sentences about the page or the docs; start with the content. Where the title and the first
  heading already say it, add nothing.

Same fix applied, unprompted, to the other openings written in Part 1 that described the page:
`installing-micropython.md`, `connecting.md`, `installing-runtime.md`, `editor-tour.md` ("How to...", "The parts
of...") and `debugging.md` (opening removed; its sections say what they are).
