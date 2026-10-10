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
- **gui trend** — a moving histogram: a row of bars, oldest on the left, newest on the right. See [Trend](#trend).
- **gui light** — on when `msg.payload` is true, off when false.
- **gui button** — a touch button. It has an input, which sets what it shows, and an output, which sends when it is
  tapped. See [Buttons](#buttons).
- **gui navigator** — changes the page from the flow. Send `next`, `prev`, `back`, `home` or a page name. Sends
  the new page name when it changes. It is no longer in the palette (a *navigate* button does the same from the
  screen), but flows that already have one still work.
- **gui modal** — a full-screen message. Send any payload to open it, `None` to close it. If several are
  open, the highest priority shows and the rest wait. Its output sends how it closed:
  `{topic: <modal's name>, payload: 'ack' | 'timeout' | 'closed'}`. Properties: **screen** (the id of the `gui_screen` it
  belongs to), **priority**, and **timeout** in seconds (`0` never closes by itself). The modal's layout is under its
  screen in the flow file, see [Modals in the flow file](#modals-in-the-flow-file).

Each widget starts as `--` until a value arrives. With **stale after** set, a value that isn't updated in
time is dimmed (or underlined, on a black-and-white display), so an old reading never looks current.

## Trend

Shows what a number can't: which way it is heading. Wire it to the first output of a [journal](journal.md), or to
any node that sends a list of numbers (a `None` is a gap), such as a spectrum from a function node.

Each bar is a row's average, with a thin line from the row's min to its max. A gap is empty. A wider space shows more
history: it draws as many bars as fit, newest at the right edge.

- **bottom at / top at** — the range of the bars. Values outside are cut off at the edge. The range is fixed.
- **columns, column width, height** — the natural size: it is as wide as columns times column width, plus the border.
  In a layout it can stretch, and then shows more rows.
- **stale after** — dims the bars if nothing new arrives in this time.

## Buttons

A button's **mode** says what a tap does.

- **momentary** — sends its value: `{topic: <the button's topic>, payload: <its sends value>}`. The **board label** is only the text drawn on the button (blank: the flow label); **sends** is what leaves the output.
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

The input is matched against the toggle's *on sends* and *off sends* values. MQTT delivers text, so the text `true`
matches a true/false toggle and `1` matches a number toggle. Anything else shows `--`. Tasmota
reports `ON` and `OFF` as text, so for a Tasmota plug set the value type to text and use `ON` and `OFF`.
`test-flows/gui-touch-freenove-s3-4in.flow.json` has this on its last page.

Unwired, the toggle keeps its own state and starts as set by *starts on*.

## Colour

Set the gui screen's frame format to `rgb565` for full colour, with the same format on the display. White text,
grey for stale values, and a green accent for bars and lights that are on. Greys use less memory and send faster,
so use them on boards with little RAM.

## Rotating the screen

On the display node, set **orientation** to 0, 90, 180 or 270 (the picture turned clockwise). It is one setting
on each display, so a display can't have two. Set the display's width and height to the panel's own size, and its
rotation to how the panel is mounted (0 to 3, as before). The gui screen wired to that display turns its size to
match and its touch axes follow, so set the screen's width and height to the panel's own size too. With
orientation off the display behaves as it always did. An orientation can't yet be combined with a panel offset
(`xstart`/`ystart`, or the 135x240 panel). `xstart`/`ystart` of `-1` mean "no offset" and are the right values with an
orientation. At 90 or 270 the usable picture is the panel turned: 480 wide by 320 high on a 320x480 panel.

## Modals in the flow file

A modal is laid out like a page, but in the screen's `modals` list, next to `pages`. Each entry names the `gui_modal`
node and gives its layout as `root`. The modal node is not itself placed inside `root`; `root` holds only what the
modal shows (text, and widget nodes wired to it or to the flow):

```json
"screens": { "<screenId>": {
  "pages": [ ... ],
  "modals": [
    { "node": "<modalNodeId>", "root": { "kind": "column", "gap": 8, "padding": 8, "children": [
      { "kind": "text", "text": "Too hot", "font": "font_body24" },
      { "kind": "widget", "node": "<labelId>", "font": "font_body20", "maxChars": 20 }
    ] } }
  ]
} }
```

Send any payload to the modal node to open it; what is drawn is its layout, so wire a label or readout widget in the
layout to the data you want shown (a modal can hold the same widget a page does). Send `None` to close it (a function node
returning a message whose `payload` is `None`). A navigate button in the layout with target `back` acknowledges it,
and a **timeout** above `0` closes it on its own. The modal node's output says which of the three happened.

## Laying out pages

Select the gui screen node and open **Properties**: each page is listed as an outline of its rows and columns,
top to bottom in the order things appear on screen. Use ↑ and ↓ to move an element earlier or later, ⇥ to move
it into the row or column above it, ⇤ to move it out of its container, ✕ to remove it, and ⚙ to set its font,
grow, gap or padding. Each row and column has a **+ add…** menu: pick a widget, spacer, text, row, column or page dots and it
goes at the end of that row or column. Add and reorder pages (the order of the page dots) from the page's own ↑ ↓, and add a layout for a modal. The same widget can be on
several pages of a screen (a navigation button on every page, say). It must be drawn the same way on each, with
the same font and options, and it shows the same value everywhere. Each page's **+ add…** menu lists the widgets
not already on that page. A widget belongs to one screen. Widgets
in a row share it equally, so two buttons side by side are each half the row (never narrower than their text
needs). Set **grow** to `0` on one to keep it at its natural size, or to a bigger number for a bigger share. There is
no preview yet: if it doesn't fit, Deploy says which widget, on which page. The outline is a view of the
flow file's `"screens"` section, which you can also edit by hand.

Pages live in the flow file, under `"screens"`, keyed by the gui screen node's id. A page is a tree of
`row` and `column` containers holding widgets (`"kind": "widget", "node": "<id>"`), fixed `text`,
`pagedots` and `spacer`s. `test-flows/gui-hero-cyd.flow.json` is a complete example for the CYD.

If something doesn't fit, Deploy stops and says which widget, on which page, needs how many pixels.
