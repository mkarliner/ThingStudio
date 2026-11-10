# GUI nodes

!!! note "Provisional"

    The GUI nodes are provisional: their properties and the page layout may change between releases.

The GUI nodes show readings on a display as pages of numbers, text, bars, lights, histograms and buttons.
[gui screen](#gui-screen) draws the pages of both display kinds:

- **A panel screen** sends them to a [display spi](display-spi.md) node. Every widget node shows the `payload`
  of the messages wired to it.
- **A remote screen** serves the pages to a phone from the board's own web server: the board holds no pixels,
  the phone lays the page out to its own viewport, and input comes back as taps and form submits. Set the
  screen's **display kind**, its **web server** config, and deploy — the phone opens
  `http://<board>:<port>/ts/remote/` and logs in with the board's password. Everything about building one is
  [Remote displays](remote-displays.md). The phone-input widgets on this page — [number field](#number-field),
  [text field](#text-field), [submit](#submit-button) and [slider](#slider) — are remote-screen only: on a
  physical panel they are a compile error.

Lay out the pages in the gui screen's property panel: see [Laying out pages](#laying-out-pages).

The nodes on this page:

- [gui screen](#gui-screen) — one per display.
- [gui readout](#gui-readout) — a number with units.
- [gui label](#gui-label) — text.
- [gui bar](#gui-bar) — a bar between two values.
- [gui light](#gui-light) — on or off.
- [gui button](#buttons) — a touch button.
- [gui histogram](#histogram) — the recent history of a number.
- [number field](#number-field) — an editable number, saved to a settings key.
- [text field](#text-field) — an editable text, saved to a settings key.
- [submit button](#submit-button) — writes the fields of its form and sends one message per save.
- [slider](#slider) — continuous input from a drag on the phone.

<!-- gui modal: left out until the editor can lay a modal out (its layout is written in the flow file).
- **gui modal** — a full-screen message. Send any payload to open it, `None` to close it. If several are
  open, the highest priority shows and the rest wait. Its output sends how it closed:
  `{topic: <modal's name>, payload: 'ack' | 'timeout' | 'closed'}`. Properties: **screen** (the id of the `gui_screen` it
  belongs to), **priority**, and **timeout** in seconds (`0` never closes by itself). The modal's layout is under its
  screen in the flow file, see [Modals in the flow file](#modals-in-the-flow-file).
-->

On a classic ESP32 without PSRAM, a GUI flow needs the [custom firmware for classic ESP32](../custom-firmware.md):
stock MicroPython runs out of memory loading the display stack.

## gui screen

Draws a display's pages of widgets: **panel** screens send them to a [display spi](display-spi.md) node;
**remote** screens serve them to a phone (see [Remote displays](remote-displays.md)).

### Properties

A panel screen takes its width, height and frame format from the display it is wired to, so set them once on the
display. A remote screen has none of that: the phone does its own layout, and the screen carries a web server
config and a WiFi network instead.

- **display kind** — panel or remote. Default panel.
- **name** — the screen's name, sent as `topic`. Default `screen`.
- **web server** (remote only) — the [web server config](remote-displays.md) the board's HTTP server mounts on:
  it sets the port. Default blank.
- **lost link means** (remote only) — what the board decides when the phone goes quiet: **stale** (the phone
  shows stale values, and nothing else happens) or **safe** (the flow is told through `link down`, and a drag
  that stopped turns the output safe; for remote control). Default stale.
- **deadman after (ms)** (remote, lost-link "safe" only) — how quickly "no fresh slider input" counts as gone.
  Default 400.
- **fastest redraw (ms)** — the shortest time between two redraws, or the phone page's message rate. Default 200.
- **next/prev wrap round** (panel only) — whether `next` on the last page goes to the first, and `prev` on the
  first to the last. Default on.
- **grid columns** — the layout grid's columns, 2 to 48. Default 12. See [Laying out pages](#laying-out-pages).
- **grid rows (0 = from the display's shape)** (panel only) — 0 to 64. Default 0, which keeps the cells roughly
  square.
- **touch panel (blank: no touch)** (panel only) — the [touch panel](touch-panel.md) the screen reads, for
  buttons. Default blank. A remote screen needs none: its taps come over the network.
- **theme** and the ten role colors (panel only) — the screen's colors. Default blank, the GUI's own colors.
  See [Themes](#themes). A remote screen's colors are the [phone page's own](remote-displays.md).
- **shared theme config (older flows)** — used only when the theme fields are empty, so a flow saved with a shared
  theme still draws.

### Wiring

**Input** — none. The widgets on its pages get their own wires.

**Output** — a panel screen: the picture, in strips of about 5 KB, each with `y` set to its first row, so a whole
frame never has to fit in memory. Wire it to a display spi node. A remote screen: the page name each time
board-owned navigation changes anything, so the flow can follow where the phone is looking.

## Laying out pages

A display is one fixed panel of a known size, filled by one flow. A page fills it, and its size never changes while
the flow runs. The layout is worked out when the flow compiles: the compiler turns each element's cells into pixel
positions and picks the font for each piece of text, and Deploy sends those numbers. Nothing reflows at runtime, and
the board carries no layout engine. That differs from a web page: nothing responds to a resize or an orientation
change while the flow runs, and a layout is for one panel. A display of a different size means compiling for that
display.

Every screen has a **cell grid**: **grid columns** on the gui screen (12 by default) and **grid rows**
(`0` means "work them out from the display's shape", so cells stay roughly square). A position is a row and a
column, 0-based; a size is a row span and a column span. Nothing is in pixels, so the same layout works on a
different panel.

Select the gui screen node and open **Properties**: each page lists its elements. **⚙** on an element opens
**row**, **col**, **rows** and **cols**; tick **panel** to draw a card behind those cells. **+ add…** puts a
widget, text, page dots or a panel on the page (it starts at row 0, column 0 — set its cells after).
The same widget can be on several pages of a screen (a navigation button on every page, say), and it must have
the same span on each. A widget belongs to one screen.

Text sizes itself: the compiler picks the largest font that fits the element's cells, and Deploy says which
element, on which page, when even the smallest does not fit. Two elements on the same cells, a span outside the
grid, or a panel on top of another panel are also Deploy errors naming the element. The editor doesn't draw the
page; the outline is a view of the flow file's `"screens"` section, which you can also edit by hand.

To put the page dots in a footer, give them the last grid row. The current page's dot is drawn as a pill.

## Widgets

The readout, label, bar, light, button and histogram are widgets: each sits on a page and shows the `payload` of each
message that arrives on its input.

- A widget shows `--` until a value arrives. A `payload` of `None` shows `--` again.
- **stale after (s, 0 = never)**, default 0: a value not updated in that time is dimmed (or underlined, on a
  black-and-white display), so an old reading never looks current.
- **name** is how Deploy names the widget in an error, after its flow label.
- **font (blank = fit the cells)**, where a widget has one: default blank, the largest font that fits its cells.
- A widget that can't draw its value, such as a bar given text, is crossed out and the console shows a
  `[NODE_ERROR]` naming it. The other widgets carry on.

A widget belongs to one screen, and can be on several of its pages.

## gui readout

Shows `payload` as a number with units. A number is drawn with **decimals** places; anything else is drawn as text.

- **caption (above the number)** — a small muted line above the number, such as `Temperature`. Default blank.
- **units** — text after the number. Default blank.
- **decimals** — 0 to 6. Default 1.
- **lowest value** / **highest value** — the range it will show. Defaults 0 and 100. The number's space is sized for
  this range, so the layout doesn't shift as the value changes.

## gui label

Shows `payload` as text.

- **room for (characters)** — how many characters its space is sized for. Default 8.

## gui bar

A bar that fills between two values. A value below **empty at** shows empty, one above **full at** shows full.

- **style** — `solid` (an outline and a fill) or `segments` (a row of cells, lit in the accent color and unlit in the
  track color). Default `solid`.
- **cells** — for `segments`, 1 to 40. Default 10.
- **empty at** / **full at** — defaults 0 and 100. **full at** must be above **empty at**.

## gui light

On when `payload` is true, off when it is false, by Python's `bool()`.

- **style** — `light` (a circle) or `chip` (a filled pill showing a word). Default `light`.
- **chip when on** / **chip when off** — the chip's words. Defaults `On` and `Off`.

## Buttons

A touch button. Its input sets what it shows, and its output sends when it is tapped. A button needs a
[touch panel](touch-panel.md) on its screen to be pressed.

### Properties

- **topic** — the `topic` of the messages it sends. Default blank, the node's id.
- **mode** — what a tap does. Default `momentary`.
    - `momentary` — sends its **sends** value.
    - `toggle` — sends the opposite of its state, and shows its **on shows** or **off shows** text.
    - `navigate` — changes page, to **goes to**. It needs no wires.
- **style** — `box` (outline and text), `filled` (a solid accent button, for the main action) or `switch` (a track
  and knob; it needs `toggle`). Default `box`.
- **value type** — `true / false`, `text` or `number`: the type of what it sends. Default `true / false`.
- **send on** — `release` (when your finger lifts inside the button; lifting outside sends nothing) or `press`.
  Default `release`. The button is drawn inverted while held.
- **board label (drawn on the button)** — `momentary`: the text drawn on it. Default blank, the flow label. A
  `payload` on its input replaces it.
- **sends (the payload)** — `momentary`: what it sends. Default blank.
- **room for (characters, if no text)** — `momentary`: default 8.
- **on sends** / **off sends** — `toggle`: what it sends to turn on and off. Default blank.
- **on shows** / **off shows** — `toggle`: its text. Defaults `ON` and `OFF`.
- **starts on (when nothing is wired in)** — `toggle`: default off.
- **wait for confirmation (s, 5 or more)** — `toggle` with a wired input: how long a tap waits for the input to agree.
  Default 5.
- **goes to** — `navigate`: `next`, `prev`, `back`, `home` or a page name.

A blank value field sends `true` and `false` for `true / false`, `ON` and `OFF` for `text`, and `1` and `0` for
`number`. The gray placeholder shows which.

### Wiring

**Input** — for `momentary`, a `payload` replaces the text drawn on it. For `toggle`, the real state of the thing it
switches; see below.

**Output** — `{'topic': <topic>, 'payload': <value>}` on each tap. A `navigate` button sends nothing.

Deploy warns when a screen has buttons and no touch panel, and when a `momentary` or `toggle` button's output goes
nowhere. A `navigate` button whose **goes to** isn't `next`, `prev`, `back`, `home` or a page on its screen stops the
deploy.

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

Unwired, the toggle keeps its own state and starts as set by *starts on*.

## Histogram

A moving histogram: a row of bars, oldest on the left, newest on the right. It shows what a number can't: which way
it is heading. Wire it to the first output of a [journal](journal.md), or to any node that sends a list of numbers (a
`None` is a gap), such as a spectrum from a function node.

Each bar is a row's average, in the theme's accent color, with a thin line from the row's minimum to its maximum in
the muted color, so the range reads as context behind the value. A gap is empty. A wider space shows more history: it
draws as many bars as fit, newest at the right edge.

- **bottom at** / **top at** — the range of the bars. Defaults 0 and 100. Values outside are cut off at the edge.
- **columns (natural width)**, **column width (px)**, **height (px)** — the natural size, defaults 60, 3 and 48: as
  wide as columns times column width, plus the border. In a layout it can stretch, and then shows more rows.

It shows only the rows its journal kept. With fewer rows than the space holds, the bars sit at the right edge and the
left of the card stays empty; the compiler says how many rows to keep. Raising **rows kept** on the journal fills it.

## Number field

An editable number on a remote display's page (a compile error on a physical panel): the phone shows it as a labeled
number field. It is read from and written to a settings key, so it survives a restart — [Remote
displays](remote-displays.md) builds the whole picture.

What it shows:

- Before the first write it shows the *default value*, and a `--` state marks "not written yet".
- After a submit writes it, the field shows what was written.

- **label** — the text above the field on the phone.
- **settings key** — the key under `runtime.settings` this field reads from and writes to. Blank means the field
  shows its *input* (each message's `payload`, like a readout) and submits nothing.
- **form** — which [submit button](#submit-button) writes this field: fields that share a form name submit together.
- **default value** — what the field holds before the key is written.

**Input** — a number to show (optional). **Output** — none.

## Text field

The same idea as the [number field](#number-field), for text: a labeled text box on the phone, read from and written
to a settings key, surviving a restart.

- **label** — the text above the field.
- **settings key** — the `runtime.settings` key it reads and writes.
- **form** — which [submit button](#submit-button) writes it.
- **default text** — what the field holds before the key is written.

**Input** — text to show (optional). **Output** — none.

## Submit button

A remote display's Save button. One submit writes every [number](#number-field) and [text](#text-field) field with
the same *form* name to the board's settings, and its output sends one message per save — with `{form, keys}` as
`payload` (the keys actually written), and the form name as `topic`. A save is one act: if a value will not convert,
the whole form is refused and nothing is written.

- **label (what the button says)** — the text on the button. Default `Save`.
- **form** — the name of this form; the fields it saves carry the same name.

**Input** — none. **Output** — one message per save.

## Slider

A drag on the phone, for driving something: the slider's position goes to the board at about 20 messages a second,
latest value wins, so the flow sees a moving value rather than a barrage. This is what needs **lost link means:
safe** on the screen: a drag that stops, or a phone that vanished mid-drag, turns the *linked* output safe —
[Remote displays](remote-displays.md) explains how the flow handles it.

- **name** — the slider's label on the phone.
- **low value** / **high value** — the slider's range. Defaults 0 and 100.
- **step (0 = continuous)** — how much one move of the slider advances. Default continuous.

**Input** — none. **Output** — one message per move of the slider, `payload` in the range and the slider's `topic`.

## Themes

By default a screen draws in the GUI's own colors: white text, gray for stale values, and a green accent for bars and
lights that are on. Full color needs the display's frame format set to `rgb565`; the gray formats use less memory and
send faster, so use them on boards with little RAM. To choose your own colors, select the gui screen and set **theme**
(a starting point) and any of the role colors in its Properties: the screen owns its look, and a screen with no theme
keeps the default colors.

A theme is ten roles, so the widgets stay consistent and one theme works on different panels: **background**, **card**,
**foreground**, **muted** (stale values), **track** (a bar's empty part), **accent** (bar fill, lights on), **text on
accent**, **ok**, **warn** and **alarm**. Start from **dark slate**, **light paper** or **vivid** and change any
color; the preset is a starting point, not a lock. **Vivid** has a near-black background, violet cards and a
cyan accent.

Use the **preset** control in the theme's edit form to save your colors by name under
`~/.thingstudio/presets/gui_theme/`, and apply them to another theme later
([Presets](../working-in-the-editor.md#presets)). The three starting points are built in, so a flow that names one
still compiles without a backend.

A panel with fewer colors than that folds the roles onto the ones it has, rather than refusing the theme:

- a **gs4** panel (16 colors) gets every role as its own color;
- a **gs2** panel (4 colors) keeps background, foreground, muted and accent — cards fold to the background, the track
  to muted, ok/warn/alarm to the foreground;
- a **mono** panel (2 colors) is ink and paper: text, bars and lights are ink, backgrounds are paper.

A **panel** is a card behind a group of widgets: tick **panel** on an element in the layout outline and the cells it
covers sit on a filled, rounded rectangle in the theme's **card** color. It follows the theme.

On an indexed panel (gs4, gs2 or mono) the theme also sets the display's palette while a screen is wired to it — one
theme is the whole color scheme, not two lists to keep in step. A palette set on the display itself is ignored while a
themed screen is wired to it, and Deploy says so in the console.

## Rotating the screen

The screen follows its display's **orientation** (see [display spi](display-spi.md#properties)). It takes the
display's size and turns its layout and its touch to match. At 90 or 270 the usable picture is the panel turned: 480
wide by 320 high on a 320x480 panel. A flow that reads touch with a [touch](touch-i2c.md) node instead of a gui
screen sets the same angle on that node, since there is no display for it to follow.

## Seven-segment digits

The `seg7` fonts (`font_seg748`, `font_seg764`, `font_seg796`) have only `0-9 : . -` and a space, so they suit the
`time` and `time_seconds` formats of the [ntp](ntp.md) node. On a 320-pixel-wide screen `font_seg764` fits `14:05`
(221 px) and `font_seg748` fits `14:05:09` (254 px). `font_seg796` is for wider screens. The font is DSEG by
Keshikan (SIL Open Font License 1.1); see
[third-party licenses](https://github.com/mkarliner/ThingStudio/blob/main/docs/third-party-licenses.md).

<!-- Left out until the editor can lay a modal out. Kept for when it can.
## Modals in the flow file

A modal is laid out like a page, but in the screen's `modals` list, next to `pages`. Each entry names the `gui_modal`
node and gives its layout as `elements`. The modal node is not itself placed there; the elements are what the
modal shows (text, and widget nodes wired to it or to the flow):

```json
"screens": { "<screenId>": {
  "pages": [ ... ],
  "modals": [
    { "node": "<modalNodeId>", "elements": [
      { "kind": "text", "text": "Too hot", "row": 0, "col": 0, "rowSpan": 2, "colSpan": 8 },
      { "kind": "widget", "node": "<labelId>", "row": 2, "col": 0, "rowSpan": 2, "colSpan": 12 }
    ] }
  ]
} }
```

Send any payload to the modal node to open it; what is drawn is its layout, so wire a label or readout widget in the
layout to the data you want shown (a modal can hold the same widget a page does). Send `None` to close it (a function node
returning a message whose `payload` is `None`). A navigate button in the layout with target `back` acknowledges it,
and a **timeout** above `0` closes it on its own. The modal node's output says which of the three happened.
-->
