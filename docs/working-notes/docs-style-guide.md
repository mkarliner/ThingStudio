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

Neutral. No "we", no jokes, no chattiness. The docs are AI-written and readers know it; an AI being personal puts
people off. "You" is fine for instructions.

- Good: "Reports on any board, listed or not, are welcome."
- Bad: "Other MicroPython boards should work too, but we can't test everything."

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
