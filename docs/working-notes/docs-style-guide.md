# User docs style guide

Status: draft, 2026-10-11; all rules confirmed by Mike the same day. "Draft" comes off after the guide has
been tested on a rewrite (`user-docs-rewrite-briefing.md`, Part 2). Built from Mike's remarks in
`docs-style-review.md` (2026-10-10/11). Applies to `docs/user-guide/`. Not to `ai-authoring.md` or the generated
`nodes-catalog.md`: those are written for AI readers and keep their own style.

## Reader

Programmers: Node-RED users, MicroPython users, C/C++ embedded people (including PlatformIO). Not beginners to
programming. Explain what's specific to Thingstudio, not Python, loops or MQTT.

- Good: "`msg` is a dict, with the main value in `msg['payload']`. Return it to pass it on, or return nothing to
  stop it."
- Bad: "Some knowledge of Python, enough to write a few lines."

## Voice

Neutral. No jokes in reference and node pages, no chattiness. The docs are AI-written and readers know it; an AI
being personal puts people off. "You" is fine for instructions. A tutorial's title may carry a light touch
("Two more blinks", Mike, 2026-11-01); its body stays neutral.

- Good: "Reports on any board, listed or not, are welcome."
- Bad: "Other MicroPython boards should work too, but we can't test everything."

## Places for Mike's own voice

Most of the docs stay neutral (Voice, above). A few places are better in a person's voice: warmer, a little humorous,
personal. Those are Mike's to write, because the docs are AI-written and an AI being personal puts readers off.
(Mike, 2026-11-02.)

A session that writes or edits the docs:

- **Flags such a place** when it meets one, and does not write the personal voice itself. It writes the neutral
  version, so the page is complete, and tells Mike in its summary: the page, the heading, and what the spot is for.
- **Keeps the list below**, so a place is flagged once. Mike removes an entry when he has written it.
- **Leaves Mike's words as they are** once he has written them. They are settled text.

What suits it: a welcome, an opening that says why, the moment a first success lands, an invitation to say how it
went, a tutorial's title or opening. What doesn't: node pages and reference material, troubleshooting and FAQ steps,
error and console message text (which stays terse), step-by-step install and setup instructions, warnings, safety
notes and anything about hardware limits. Text people use to get something done stays plain, so it is quick to read
when something has gone wrong.

This list is the master. Mike keeps a working copy as a document in the ThingStudio project, with the same columns;
when the two differ, this one wins. (Mike, 2026-11-04.)

Flagged so far, each with neutral text in place until Mike writes his own:

- 2026-11-02 `index.md`: the opening paragraphs, which say what Thingstudio is. First thing a visitor reads; sets
  the tone for the whole guide.
- 2026-11-02 `getting-started.md`: the opening line, and the "Getting help" section. A welcome, and a human answer
  to "who do I ask?".
- 2026-11-02 `first-flow.md`: the moment the LED blinks (end of "Deploy"), and "Tell us how it went". The payoff of
  the first hour, and the invitation to report back.
- 2026-11-02 `tutorials/`: the opening paragraph of Web Blink, Blink from anywhere and A sensor display, and the
  titles of Web Blink and Blink from anywhere. They set the mood for each project.
- 2026-11-02 `background/` and `coming-from/`: the opening of each page. It explains why the project exists and
  speaks to newcomers from other tools.

Written by Mike, so settled text:

- 2026-11-02 `tutorials/two-more-blinks.md`: the opening paragraphs. The worked example for "Tutorial openings",
  below.

## Tutorial openings

A tutorial's opening is a handshake: it tells the reader where they stand and where the page takes them, before any
step. Derived from Mike's rewrite of the Two more blinks opening (2026-11-02), which replaced a session's draft; that
page is the worked example. The draft failed by packing mechanism into one sentence. (Mike, 2026-11-02.)

- **Start from what the reader has now,** in the second person: "If you've followed Getting started, you now have a
  board with a blinking LED." Not from the flow or the feature.
- **Say what they will learn, as ideas, not mechanism:** "directly access the hardware through MicroPython", not
  "`% 2` turns the count into 1, 0, 1, 0". The mechanism belongs in the steps.
- **Recap the previous flow in one line of node names,** bold, in wire order, linked to the page that built it.
  No explanation of how it works; the reader just built it.
- **Say once what changes and what stays,** in one sentence: "We'll just be changing the function node."
- **Offer both routes together:** build it step by step, or open the finished flow. Both in the same paragraph.
- **One job per paragraph:** situation and goal, recap and scope, variants, then how to get the finished flow.
- **Speaking voice is fine here:** "you've", "we'll". Still no "this page" or "this section" (the lint enforces it).
- **Put a hint where it applies.** A tip about one step goes at that step, not in the opening.

Mike writes these openings (Places for Mike's own voice, above); a session that has to write one follows this list
and flags the place.

## A refusal says it is deliberate, once

When Deploy or the editor stops on purpose (a deploy that won't fit, a WiFi config a node won't accept), the
troubleshooting page says so in one short clause, so the stop doesn't read as a bug. Nothing more: no history and no
defence of the design. Happy-path and reference pages leave the clause out. (Mike, 2026-11-01.)

- Good: "Deploy stops here on purpose; freeing or restarting is yours to invoke."
- Bad: "Deploy does not try to fix this for you: it reports the failure and stops, because freeing or restarting on
  your behalf would leave the board in a state you didn't choose."

## Say what's true now

Describe the current state only. No "v1", "preview", "not yet", "coming", decision dates or project history. Don't
state something likely to change, even as a selling point. Planned features may go on one clearly labelled page
that asks for feedback.

- Good: "Lay out the pages in the gui screen node's property panel."
- Bad: "A preview: the nodes work, but pages are laid out by editing the flow file. The GUI view ... is coming."

## Use the reader's words, and name things

Use the terms the reader already knows ("low-code", "node-based editor", "compiles"), and the editor's own labels.
Name the specific thing rather than "this" or "these".

- Good: "The docs on docs.thingstudio.net follow the latest code. The docs inside Thingstudio ... match the version
  you have installed."
- Bad: "These docs follow the latest code."

## No sizing words that may be false

Avoid "small", "simple", "a few", "quick" unless they're true for every case.

- Good: "A message is a dict, with its main value in `payload`."
- Bad: "A message is a small bundle of data."

## Order follows the reader's work

Sections and pages go in the order the reader does things: understand, build, extend, run. Don't switch between
computer and board, or between topics, unless the work does. Keep everything about one thing in one place.

- Good: Getting started: install Thingstudio, tour the editor (computer), install MicroPython, connect (board).
- Bad: package download, then installer paths, then installer upgrade, then package upgrade.

## Open with what the page is for

The first sentence says what this page covers. Not a pointer to another page, not "the rest".

- Good: "How Thingstudio is packaged, where it puts its files, how to upgrade and remove it, and how to build it from
  source."
- Bad: "Getting started covers installing Thingstudio. This page covers the rest."

## Lists

Every list has a sentence before it saying what it is. Choices between links go in a list, not a sentence.

- Good: "Thingstudio tries not to reinvent the wheel." followed by the list.
- Bad: a bare list straight after a heading.

## One home for changing facts

Hardware support (boards, processors, display, touch and sensor chips, and what's tested) lives on
[Supported hardware](../user-guide/supported-hardware.md). Other pages link there rather than keep their own lists.

- Good: "**controller** — the display chip. See Supported hardware."
- Bad: "`ST7789` (240x240, 135x240, 240x320) or `ST7796` (320x480)" on the node page.

## One home for facts shared by many nodes

A fact that holds for every node, or for every node of one kind (every source, every network node), lives on one
page. A node page links to it in one line where the reader needs it, or leaves it out. The node page keeps only what
is specific to that node. (Mike, 2026-11-04.)

- Good, on `timer`: "A node error in this node's chain stops the chain. See Reading a node error."
- Bad, on `inject`: "The board sends the value from the last deploy. After changing value or payload type, deploy
  again." True of every node's properties; Flow lifecycle says it once.

Homes so far:

- What the board runs and when a change reaches it: [Flow lifecycle](../user-guide/flow-lifecycle.md), Deploy.
- What a node error does, including stopping its chain: [Debugging](../user-guide/debugging.md), Reading a node
  error.
- Which outputs feed which inputs, and what a fork does to a message: [Editor in
  depth](../user-guide/working-in-the-editor.md), Wiring.
- How a typed value (`inject`, `startup`, `change`) is read: [Editor in
  depth](../user-guide/working-in-the-editor.md), Typed values.
- Status dots: [Editor in depth](../user-guide/working-in-the-editor.md), Node status.

## Quote console messages exactly

A message the editor or the board prints is quoted as printed, in backticks: same case, same punctuation, `--`
included, so a reader can search for it. Shorten only by cutting the variable part to a placeholder such as `HOST:PORT`.
(Mike, 2026-11-04.)

- Good: `[inject: connect to a device first -- clicking only fires while live]`
- Bad: "The console says to connect to a device first."

## Defaults on node pages

Every property in a node page's Properties list gives its default as "Default X.", or says "Required." when it has
none. (Mike, 2026-11-04.)

- Good: "**interval (ms)** — the time between messages, in milliseconds. Default 1000."

## Page types

- **Tutorial / task guide:** one job, in the order you do it. Getting started, Blink an LED, A sensor display.
- **Node page:** a reference, looked up, not read through. Fixed layout: one-line purpose, Properties, Wiring
  (inputs and outputs), Behavior, Errors. Examples go in tutorials.
- **Concept / reference page:** one topic, opening sentence says what's covered.
- **Troubleshooting / FAQ:** symptom or question first, then what to do.

## Pictures

Use a screenshot where words are weak. Crop so the relevant part is big enough to read. Label parts on the picture
itself, with arrows, rather than numbers keyed to a list (`tools/screenshots.py` draws them).

## Limitations

State a limit plainly where the reader meets it, with what to do instead. No lists of what's missing.

## Words

- Use: flow, node, wire, message, `payload`, source / transform / sink, config node, runtime, deploy.
- Node names as in the palette: `i2c device`, `gui screen`. Config names as in the editor: "I2C bus".
- Avoid: "load bearing", "simply", "just", "small", "v1", "preview", "not yet supported".
