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

## Patterns

(Not grouped yet.)
