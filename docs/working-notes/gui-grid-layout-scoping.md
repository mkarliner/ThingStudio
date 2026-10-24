# GUI grid layout: scoping

Status: scoped 2026-10-24. Mike's ruling: **pixel sizes are not acceptable in the GUI; a screen specifies an
H x W grid, and widget sizes are grid units** (decisions/gui-layout.md). This note is the plan; nothing is built.

## Decisions

- **The screen declares a fixed `columns x rows` grid.** Every screen has one, stored on the `gui_screen` node
  (like its theme), so one screen is one complete definition. Cells map to percentages of the display:
  `cellW = display.width / columns`, `cellH = display.height / rows`, pixel rects rounded when compiled. The
  screen's own display supplies the pixels, so a layout is panel-independent.
- **Placement is a cell span.** An element has `row`, `col`, `rowSpan`, `colSpan` (0-based). Overlap, an element
  outside the grid, or a span of zero are compile errors naming the element and page.
- **The page is one grid.** The row/column tree goes away. A card is a span with `card: true`; its children are
  placed in the same grid. Grouping is for drawing and for moving a set of cells, not for a second coordinate
  system.
- **Text sizes itself to its span.** The compiler picks the largest named font that fits the span (height, and
  the widest text/`--` for the width), and reports when even the smallest does not. The author does not type a
  font size. Readouts pick their digits font and units font on the same rule.
- **Existing flows are re-authored, not migrated.** There are only a few (the CYD theme/dummy demos and the
  headliner). An old `screens` section with a row/column tree is refused with one clear line: this screen needs
  the grid layout again. No legacy pixel mode.

## What changes

**Flow file / screen node.** `gui_screen` properties gain `gridColumns` and `gridRows` (defaults to be chosen,
probably 12 and 8). The `screens` section's pages become:

```json
{ "name": "climate",
  "elements": [
    { "node": "n07-alive", "row": 0, "col": 10, "rowSpan": 1, "colSpan": 2 },
    { "card": true, "row": 0, "col": 0, "rowSpan": 1, "colSpan": 10 },
    { "node": "n03-temp", "row": 1, "col": 0, "rowSpan": 3, "colSpan": 6 }
  ] }
```

Text and page dots are elements too (`{"text": "Living room", ...}` / `{"kind": "pagedots", ...}`). A modal is
a grid of its own. `carousel` and `parent` keep their meaning.

**Compiler (`editor/src/gui/`).** Replace `layout.ts`'s flex pass with a grid pass: cells to rects, gutter
handling, card rects from spans, overlap/bounds checks. `screens.ts` stops asking widgets for natural sizes;
instead it picks each widget's font(s) from its span and builds the same `tsgui_*` calls. `widgets.ts`'s
natural-size functions stay for the font fitting (a font must fit a cell) but stop driving the layout.

**Widgets.** Pixel properties lose their meaning in a layout: `height`, `minWidth`, `diameter`, `colWidth`,
`columns` and `font`/`unitsFont` placements are retired or reinterpreted. A histogram's bar count follows its
span; a light's diameter follows its cell; a bar's height is its row span. The properties that survive describe
what the widget does (ranges, units, text), not how big it is.

**Editor.** `ScreenOutline` becomes a grid editor: a lattice per page, each element showing its span, with
+/- on the four edges and row/col fields as the minimum; "add widget" puts it in the first free cell. The
outline keeps the existing list view as a fallback (row/col/spans as numbers) so the visual grid can follow.

**Docs.** The UI guide's "Laying out pages" and every flow example; the catalog is generated.

## Phasing

1. **Model and compiler** — `gridColumns`/`gridRows` on the screen; pages as element spans; the grid pass;
   auto-font fitting; the three compile errors (overlap, outside, text does not fit). Tests: rect tables for
   known grids, overlap/bounds errors, font fitting.
2. **Re-author the flows** — CYD theme demo, CYD dummy, headliner; re-run their compile and the CYD hardware
   check.
3. **Outline editor** — the lattice view and span controls; keep the list view for accessibility and quick edits.
4. **Docs and catalog** — the guide, examples, FAQ entry for "the layout is now a grid".

Steps 1 and 2 are the cutover: there is no half-converted state (an old screen fails to compile with a clear
message). The device contract does not change — the page table is still pixel rects — so there is no runtime
bump; the editor target only moves if the flow-file `formatVersion` does.

## Open questions for Mike

- Grid defaults: 12 columns x 8 rows for a 240x320 panel, or something coarser/finer? It is per screen, so this
  is only the default a new screen starts with.
- Gutter: a fraction of a cell (say 10%) with no author control, or a screen-level `gutter` property in cells?
- Do rows need fixed heights, or does content decide a row's height (CSS `auto` rows)? Fixed rows are simpler
  and match "H x W grid"; auto rows reintroduce natural sizes.
- A header/footer band: is it just the first/last grid row, or a screen-level concept?
