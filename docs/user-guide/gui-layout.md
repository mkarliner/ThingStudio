# Laying out a display

How a gui screen turns cells into a picture: a fixed panel, no windows, and a layout worked out when the flow
compiles.

## A panel, not a window

A Thingstudio display is one panel of a known size, filled by one flow. There is no window system and no windows:
a page fills the display, and the display's size never changes while the flow runs. Nothing on the board moves
anything because the size changed, because the size never changes.

Pages don't resize either. Turning to another page or setting a widget to a longer value draws in a place that was
decided earlier; it never asks for room.

## The layout is resolved at compile time

When you compile, the compiler turns each element's cells into pixel positions, picks the font each piece of text
needs, and fixes the gutters between them. Deploy sends those numbers, and the board paints them. No layout pass
runs on the board and nothing reflows at runtime.

That is what keeps a GUI flow affordable on a microcontroller: the board carries no layout engine, no font
metrics and no page model, only the numbers needed to draw.

## Compared with a web framework

A web page is laid out by a browser, in a window someone can resize: CSS resolves sizes at runtime, media queries
answer the window, and text reflows when content changes. On a board none of that applies.

- There is no browser and no layout engine in the flow.
- The panel's size is fixed, so nothing responds to a resize or to an orientation change at runtime.
- Text doesn't reflow. An element gets the largest font that fits its cells, chosen at compile time; text that
  doesn't fit is a Deploy error naming the element and the space it needs.
- A layout is for one panel. A display of a different size means compiling for that display, not a reflow.

The cell grid looks like CSS grid because it is a grid of cells and spans, but it is resolved once, when the flow
compiles, rather than by a browser at runtime.

## What that means when you build a page

- The gui screen takes its width and height from the [display spi](nodes/display-spi.md) node it is wired to, so
  set the panel's size there.
- Set **grid columns** on the screen and give each element a row, a column, a row span and a column span. Nothing
  is in pixels, so the same layout works across panels of a similar shape — but not across panels so different
  that elements stop fitting.
- Orientation is a display setting. The screen wired to it turns its layout to match when the flow compiles.

The cells, the outline and the errors to expect are on [GUI nodes](nodes/gui.md#laying-out-pages). A worked example
is in [A sensor display](sensor-display.md).
