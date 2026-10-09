# GUI nodes (preview)

Show readings on a display as pages of labels, numbers, bars and lights. A preview: the nodes work, but
pages are laid out by editing the flow file. The GUI view, where you lay them out by dragging, is coming.

## The nodes

- **gui screen** — one per display. Sends the screen each time it changes, in strips of about 5 KB, so
  a whole frame never has to fit in memory at once. Wire it to a [display spi](display-spi.md) node with
  the same width, height and frame format.
- **gui readout** — shows `msg.payload` as a number with units. Set the lowest and highest value it will
  show, and how many decimals. Its space is sized for that range.
- **gui label** — shows `msg.payload` as text.
- **gui bar** — a bar that fills between *empty at* and *full at*.
- **gui light** — on when `msg.payload` is true, off when false.
- **gui button** — a touch button with text on it. A `msg.payload` replaces the text (send `ON` or `OFF` from a
  toggle). It needs nothing wired to it. Give it a **name**: that is the topic of its events.
- **gui touch** — the screen's touch input. Wire a [touch](touch-i2c.md) node into it. A finger landing on a
  button on the visible page sends `{topic: <button's name>, payload: 'down'}`; lifting sends `'up'`. The button
  is drawn inverted while it is held. A touch on anything that isn't a button sends nothing, and a modal on
  screen takes all the touches. `test-flows/gui-touch-freenove-s3-4in.flow.json` turns the page with a button.
- **gui navigator** — changes the page. Send `next`, `prev`, `back`, `home` or a page name. Sends the new
  page name when it changes.
- **gui modal** — a full-screen message. Send any payload to open it, `None` to close it. If several are
  open, the highest priority shows and the rest wait.

Each widget starts as `--` until a value arrives. With **stale after** set, a value that isn't updated in
time is dimmed (or underlined, on a black-and-white display), so an old reading never looks current.

## Colour

Set the gui screen's frame format to `rgb565` for full colour, with the same format on the display. White text,
grey for stale values, and a green accent for bars and lights that are on. Greys use less memory and send faster,
so use them on boards with little RAM.

## Laying out pages

Select the gui screen node and open **Properties**: each page is listed as an outline of its rows and columns,
top to bottom in the order things appear on screen. Use ↑ and ↓ to move an element earlier or later, ⇥ to move
it into the row or column above it, ⇤ to move it out of its container, ✕ to remove it, and ⚙ to set its font,
grow, gap or padding. Add a widget, spacer, text, row, column or page dots from the bar under each page, add
and reorder pages (the order of the page dots) from the page's own ↑ ↓, and add a layout for a modal. There is
no preview yet: if it doesn't fit, Deploy says which widget, on which page. The outline is a view of the
flow file's `"screens"` section, which you can also edit by hand.

Pages live in the flow file, under `"screens"`, keyed by the gui screen node's id. A page is a tree of
`row` and `column` containers holding widgets (`"kind": "widget", "node": "<id>"`), fixed `text`,
`pagedots` and `spacer`s. `test-flows/gui-hero-cyd.flow.json` is a complete example for the CYD.

If something doesn't fit, Deploy stops and says which widget, on which page, needs how many pixels.
