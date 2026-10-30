# Layout: filling the page, and page dots in a footer
> **2026-10-30 sweep:** Update: the same-day grid rewrite (`gui-grid-layout-scoping.md`) replaced the flex build
  described below — no `fill`/`grow` in `ScreenOutline.vue`, which is now a row/col/span grid
  editor, and the theme demo flow is re-authored as grid spans. Fill-plus-footer survives as a
  capability of the grid model, not this mechanism.


Status: ruled by Mike 2026-10-24 (`decisions/gui-layout.md`), **built 2026-10-24**. What shipped is smaller than the
first shape: no footer feature at all -- a footer is a container, and page dots are an ordinary widget. See "What
was built" at the bottom.

Both came from looking at the CYD running the card demo, and both are about a page looking finished rather than
about missing capability.

## Fill the remaining space on a page

**The rule (Mike, 2026-10-24):** a GUI layout should be able to fill up the remaining space on a page.

**What happens today.** `grow` exists on every element, containers included (`Placed` in `gui/screens.ts`), and
`layoutPage()` gives the root the whole screen (`layout.ts`: "root fills the whole screen"). Free space along a
container's main axis is shared among children by `grow` weight, and `justify` can otherwise spread or park it.

**So the gap is not the primitive, it is the default and the affordance.** In
`test-flows/gui-hero-cyd-theme.flow.json` no container carries `grow`, so the content ends at y=205 of 320 and the
bottom 115 rows are blank page. Nothing in the outline suggests a card could take that space, and there is no
"fill" control -- just a numeric `grow` field next to `gap` and `padding`.

Options to choose between (option 1 was taken; see "What was built" at the bottom):

1. **A `fill` affordance on the container** -- a checkbox that writes `grow: 1`, the same way `card` writes a
   boolean. Cheapest; keeps the layout engine unchanged.
2. **Default the last card on a page to fill** -- fewer clicks, but a silent layout change for existing flows, and
   wrong when the author wants a short card at the top.
3. **A page-level "fill page" toggle on the root container** -- states the intent once per page.

Worth doing regardless: the outline should show when a page has a large unused area, since that is the thing that
is invisible until a screen is running.

Interaction to keep in mind: a card is drawn to its container's rect (`_fill_round`), so a filling card is already
the right shape -- no device-side change is implied.

## Page dots in a footer

**The rule (Mike, 2026-10-24):** the dots that show which page you are on should be on a footer.

**What happens today.** `pagedots` is an ordinary widget placed in the layout tree like any other
(`gui/screens.ts` `KIND`, `ScreenOutline.vue`'s `@dots` add-choice, `pageDotsNatural`), so it sits wherever the
author drops it -- in the demo at `(112, 211, 16, 6)`, below the card and outside it, which is what made it read as
a stray element rather than as page furniture.

**The shape to build.** A footer the screen reserves at the bottom of the page, with the page dots in it:

- the content area is the page minus the footer;
- the dots are drawn by the screen, not authored as a widget -- so they appear on every page, in one place, styled
  once;
- presence is per-screen (`pages > 1` is the obvious trigger, or an explicit "show page dots" setting);
- the footer is the natural home for the header bar's siblings later (`gui-widget-styles-and-colour-scoping.md`
  already proposes a header bar with title, time and signal -- a header and a footer are one layout idea).

Open question, **answered by Mike 2026-10-24: shrink.** The footer takes rows from the page rather than
overlaying it -- the content area is the page minus the footer, so a filling card stops above the dots and the two
compose without the author having to reason about it. Overlaying would have hidden the bottom of any full-page
content behind the dots, which is the failure mode worth avoiding on a panel this small.

Still to settle when it is built: the footer height (the dots' natural height plus a margin is the obvious
starting point, and page dots are 6 px tall in the demo's layout), and whether a one-page flow shows a footer at
all (no dots to show, so no strip -- the content should get the rows back).

## Not part of this

Both are layout/style work in the GUI subsystem, not node-format work (`decisions/gui-layout.md`, 2026-10-15).
At the time this was scoped, the expectation was that a footer might need a `"footer"` entry in the page table.
The build did not: `fill` is a `grow` value the current device already honours, and the footer is ordinary
containers and widgets, so there is no flow-file format change a deployed board would notice and no runtime bump.

## What was built

Mike, later on 2026-10-24: **the footer is a container, and page dots are just another widget.** No reserved
strip, no footer field, no fixed footer height, no automatic "pages > 1" trigger -- and no pixel-based warning
about unused space (absolute allowances are what the constraint model exists to avoid). So:

- **Fill:** a `fill` checkbox in the outline's container properties writes `grow: 1` (and clears it when
  unticked); the numeric `grow` stays for weights. `editor/src/app/rete/ScreenOutline.vue`.
- **A footer** is a non-growing row after a filling container. The engine already does this: `arrange()` gives
  every child its natural size and shares the leftover among `grow` children, which is the shape the existing
  hero test in `editor/test/gui-layout.test.ts` pins (title / `grow` main / non-grow footer).
- **Composition:** a filling card stops above the row below it, so "fill" and "footer" need no special case.
- **Demo:** `test-flows/gui-hero-cyd-theme.flow.json` now grows each page's card and holds the dots in a plain
  trailing row. Its compiled page table puts the card at `(4, 41, 232, 263)` and the dots at `(112, 310, 16, 6)`
  on a 240x320 screen -- the card ends at 304, the dots sit against the bottom padding.
- **Tests:** a card/footer layout case in `gui-layout.test.ts`; the demo added to the example-flow compile pass in
  `gui-compile.test.ts`. No flow-file, compiler or device change, so no runtime bump.
- **Hardware:** deployed to the CYD 2026-10-24 (`DEPLOY_ACK`, flow `gui-hero-cyd-theme`); the cards run down to
  the dots row and the dots sit at the bottom edge, confirmed on the panel.

The "outline should show a large unused area" idea from the options above was dropped for that reason. If unused
space needs surfacing later, express it as a constraint in the outline, not as a pixel count.

