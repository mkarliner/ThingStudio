# GUI nodes (preview)

Show readings on a display as pages of labels, numbers, bars and lights. A preview: the nodes work, but
pages are laid out by editing the flow file. The GUI view, where you lay them out by dragging, is coming.

## The nodes

- **gui screen** — one per display. Sends a frame each time the screen changes. Wire it to a
  [display spi](display-spi.md) node with the same width, height and frame format.
- **gui readout** — shows `msg.payload` as a number with units. Set the lowest and highest value it will
  show, and how many decimals. Its space is sized for that range.
- **gui label** — shows `msg.payload` as text.
- **gui bar** — a bar that fills between *empty at* and *full at*.
- **gui light** — on when `msg.payload` is true, off when false.
- **gui navigator** — changes the page. Send `next`, `prev`, `back`, `home` or a page name. Sends the new
  page name when it changes.
- **gui modal** — a full-screen message. Send any payload to open it, `None` to close it. If several are
  open, the highest priority shows and the rest wait.

Each widget starts as `--` until a value arrives. With **stale after** set, a value that isn't updated in
time is dimmed (or underlined, on a black-and-white display), so an old reading never looks current.

## Laying out pages

Pages live in the flow file, under `"screens"`, keyed by the gui screen node's id. A page is a tree of
`row` and `column` containers holding widgets (`"kind": "widget", "node": "<id>"`), fixed `text`,
`pagedots` and `spacer`s. `test-flows/gui-hero-cyd.flow.json` is a complete example for the CYD.

If something doesn't fit, Deploy stops and says which widget, on which page, needs how many pixels.
