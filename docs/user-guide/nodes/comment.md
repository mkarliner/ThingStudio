# comment

Shows a note on the canvas. It does nothing on the board, and nothing about it is sent there.

Use it to explain a flow where people will see it: beside the node it's about, such as "Set **pin** to your
board's LED". Example and tutorial flows use it the same way.

## Properties

- **text** — the note. Shown on the canvas as written, with its line breaks.
- **width (characters)** — default 32. How wide the note is.
- **max lines** — default 8. Longer text is cut off, and the last line fades to show there's more. Make the
  note taller, or the text shorter.

## Wiring

This node has no inputs or outputs.

## Behavior

Compile leaves the node out, so it uses no memory on the board. It's saved in the flow file with the rest of the
flow.
