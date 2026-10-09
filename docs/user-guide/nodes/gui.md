# GUI nodes (preview)

Show readings on a display as pages of labels, numbers, bars and lights. A preview: the nodes work, but
pages are laid out by editing the flow file. The GUI view, where you lay them out by dragging, is coming.

## The nodes

- **gui screen** — one per display. Sends the screen each time it changes, in strips of about 5 KB, so
  a whole frame never has to fit in memory at once. Wire it to a [display spi](display-spi.md) node with
  the same width, height and frame format. To use touch, pick a [touch panel](touch-panel.md) in its properties.
- **gui readout** — shows `msg.payload` as a number with units. Set the lowest and highest value it will
  show, and how many decimals. Its space is sized for that range.
- **gui label** — shows `msg.payload` as text.
- **gui bar** — a bar that fills between *empty at* and *full at*.
- **gui light** — on when `msg.payload` is true, off when false.
- **gui button** — a touch button. It has an input, which sets what it shows, and an output, which sends when it is
  tapped. See [Buttons](#buttons).
- **gui navigator** — changes the page. Send `next`, `prev`, `back`, `home` or a page name. Sends the new
  page name when it changes.
- **gui modal** — a full-screen message. Send any payload to open it, `None` to close it. If several are
  open, the highest priority shows and the rest wait. Its output sends how it closed:
  `{topic: <modal's name>, payload: 'ack' | 'timeout' | 'closed'}`.

Each widget starts as `--` until a value arrives. With **stale after** set, a value that isn't updated in
time is dimmed (or underlined, on a black-and-white display), so an old reading never looks current.

## Buttons

A button's **mode** says what a tap does.

- **momentary** — sends its value: `{topic: <button's name>, payload: true}`.
- **toggle** — sends the opposite of its state. It shows its *on* and *off* text.
- **navigate** — changes page: `next`, `prev`, `back`, `home` or a page name. It needs no wires.

A button sends when your finger lifts inside it. Lift outside and nothing is sent. Set **send on** to *press*
to send as soon as it is touched. It is drawn inverted while held.

Leave the value fields blank and a button sends `true` and `false`; for text, `ON` and `OFF`; for a number, `1` and
`0`. The grey placeholder shows which. Type a value to send something else.

A button needs a [touch panel](touch-panel.md) on its screen to be pressed. Deploy warns if a screen has
buttons and no panel, and if a momentary or toggle button's output goes nowhere.

### A toggle that follows the real device

Wire the toggle's input to the device's real state, and its output to whatever switches it:

```
mqtt subscribe (stat/plug/POWER) -> toggle -> mqtt publish (cmnd/plug/POWER)
```

With the input wired, the flow owns the state:

- Before the first report the toggle shows `--` (a dashed outline).
- A tap shows the state you asked for, with a dotted outline, until the input confirms it.
- If the input says something different, the toggle shows what the input says.
- If nothing comes back in time, it returns to the last known state, shows a cross for a moment, and the
  console reports it. See [a toggle goes back](../debugging.md#a-toggle-button-goes-back).

The input is matched against the toggle's *on sends* and *off sends* values. Anything else shows `--`. Tasmota
reports `ON` and `OFF` as text, so for a Tasmota plug set the value type to text and use `ON` and `OFF`.
`test-flows/gui-touch-freenove-s3-4in.flow.json` has this on its last page.

Unwired, the toggle keeps its own state and starts as set by *starts on*.

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
