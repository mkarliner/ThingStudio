# debug

Prints each message's payload to the console, to see what is flowing through a wire.

## Properties

- **full message** — default off. When on, prints the whole message, with `topic` and any other fields the source
  adds, instead of only `payload`.

## Wiring

**Input** — any message.

This node has no output.

## Behavior

Each message prints one line: `DEBUG node=ID payload=VALUE`, or `DEBUG node=ID msg=MESSAGE` with **full message** on.
The value is printed as Python shows it, so a string is in quotes: `payload='hello'`. Click the line in the console
to find the node on the canvas.

The board prints the line, so the console shows it only while the editor is connected.
