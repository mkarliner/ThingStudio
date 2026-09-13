# Console-click-to-navigate always recenters the viewport, even when the node's already visible

Raised again 2026-09-13 (Mike), clarifying an original "this is annoying, remove it" bullet in
`mikes-questions-and-points.md`. This is **not** a new bug in a broken feature -- the underlying behavior
(clicking a `DEBUG`/`NODE_ERROR` console line pans/zooms the canvas to the named node, via `main.ts`'s
`locateNode()` calling `editor-setup.ts`'s `focusNode()`, a scoped `AreaExtensions.zoomAt()`) was built and
confirmed working by Mike on 2026-09-04 (`outstanding-items/console-node-id-mapping.md`). The complaint is about
*when* it fires, not whether it works.

## The actual complaint

**Loses the current view.** `focusNode()` runs unconditionally on every click, even when the target node is
already fully visible in the current viewport -- discarding whatever part of a large flow Mike was actually
looking at, every single time, not just when navigation is actually needed.

## Likely fix

Only pan/zoom when the target node isn't already comfortably visible in the current viewport (near the edge
should probably still count as "not visible enough"); a click on a node that's already on-screen should just
select/highlight it in place, no view movement. Needs the current viewport bounds (check `rete-area-plugin`'s
actual transform/viewport accessor -- don't assume a specific name without checking) and the node's canvas
position/size to make that comparison.

**Not scoped:** whether "visible" should account for the property panel/palette covering part of the canvas (a
node that's on-screen but occluded by a UI panel probably still wants panning into the clear area).

Priority not explicitly set by Mike 2026-09-13 -- it was originally in `mikes-questions-and-points.md`'s
"Bugs -- priority" section, suggesting he considers it a real one.
