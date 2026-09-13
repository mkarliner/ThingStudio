# Palette ordering: group related nodes together, not just by kind

Mike's clarification, 2026-09-13, of the old "arrange to menu to better reflect workflow (connect/open/save...)"
bullet in `mikes-questions-and-points.md` -- originally ambiguous, read at the time as being about a top-level
menu/toolbar. **It's actually about the node palette**: related nodes (his example: `mqtt_publish`/
`mqtt_subscribe`) should sit next to each other, not be split apart by the palette's current ordering rule.

## Confirmed in the actual code

`PaletteSidebar.vue`'s own header (2026-08-21 entry) documents the convention directly: within a `palette.ts`
`group` (`mqtt_publish`/`mqtt_subscribe` are both `group: "network"`), display order follows a
source-then-transform-then-sink convention. `mqtt_subscribe` (a source-kind node) sits with the other sources
(`wifi_status`, `udp_receive`, `http_in`); `mqtt_publish` (a sink) sits with the other sinks/transforms
(`udp_send`, `http_request`, `delay`). So the two mqtt nodes -- a matched pair anyone would expect to see
together -- end up in visually separate parts of the same group.

## Not a one-line fix -- needs a design decision

The existing source-then-sink convention exists for a real reason: a newcomer scanning the palette top-to-bottom
for "how do I start a flow" sees sources first. Naively regrouping by protocol/family instead would lose that.
Options worth weighing when this gets picked up:

- A sub-grouping within each `group` -- family clusters, with source-then-sink ordering only applied *within* a
  family, not across the whole group.
- Pinning explicitly-declared "families"/"pairs" together as a special case, leaving the general convention
  alone for ungrouped node types.
- Dropping the source-then-sink convention in favor of family-first now that there are enough multi-node
  families (mqtt, http, udp) that splitting them may be a bigger source of friction than the sources-first
  ordering was solving.

**Priority: P1 (Mike, 2026-09-13).**
