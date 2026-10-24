# Layout: filling the page, and page dots in a footer

Status: ruled by Mike 2026-10-24 (`decisions/gui-layout.md`); not built. Both came from looking at the CYD running
the card demo, and both are about a page looking finished rather than about missing capability.

## Fill the remaining space on a page

**The rule (Mike, 2026-10-24):** a GUI layout should be able to fill up the remaining space on a page.

**What happens today.** `grow` exists on every element, containers included (`Placed` in `gui/screens.ts`), and
`layoutPage()` gives the root the whole screen (`layout.ts`: "root fills the whole screen"). Free space along a
container's main axis is shared among children by `grow` weight, and `justify` can otherwise spread or park it.

**So the gap is not the primitive, it is the default and the affordance.** In
`test-flows/gui-hero-cyd-theme.flow.json` no container carries `grow`, so the content ends at y=205 of 320 and the
bottom 115 rows are blank page. Nothing in the outline suggests a card could take that space, and there is no
"fill" control -- just a numeric `grow` field next to `gap` and `padding`.

Options to choose between (not decided):

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

Open questions: does the footer shrink the content area (so a filling card stops above it) or overlay the bottom
of the page? Shrinking is the honest layout; overlaying is what a phone does. Only the first keeps "fill" and
"footer" composable without the author thinking about it.

## Not part of this

Both are layout/style work in the GUI subsystem, not node-format work (`decisions/gui-layout.md`, 2026-10-15).
Neither changes the flow file format in a way a deployed board would need: the footer is editor layout plus a
`"footer"` entry in the page table (or dots emitted by the screen node), and `fill` is a `grow` value the current
device already honours -- so neither needs a runtime version bump until something device-side changes.
