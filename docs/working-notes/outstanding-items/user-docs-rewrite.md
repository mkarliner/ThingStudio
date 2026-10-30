# User docs: pages still to rewrite to the style guide
> **2026-10-30 sweep:** Update: the "Decisions needed" bullet on clock/ntp is done — `clock.md` is replaced by
  `ntp.md`. The P2/P3 rewrite outstanding list stands.


Status: open, 2026-10-11. From the docs style review (`docs-style-review.md`); rules in `docs-style-guide.md`.

Done in the review session: `index.md`, `thingstudio-folder.md` (new), `supported-hardware.md` (new),
`editor-tour.md` (new), `installation-details.md`, `command-line.md` (new); targeted fixes only in `first-flow.md`,
`nodes/clock.md`, `nodes/display-spi.md`, `nodes/gui.md` (opening), `getting-started.md` (step order).

Priority is the order a newcomer meets the page, then how far it is from the guide. Word counts as of 2026-10-11.

## P1: the first hour

Rewritten 2026-10-11 (Part 1 of `user-docs-rewrite-briefing.md`); awaiting Mike's review (Part 2). Calls and
factual fixes: `docs-style-review.md`, "Rewrite log (2026-10-11)".

1. `getting-started.md` (493), `installing-micropython.md` (514), `connecting.md` (232), `installing-runtime.md`
   (178), `first-flow.md` (515). Full pass: only step order and links changed so far. Check "you" isn't overdone.
2. `working-in-the-editor.md` (936). Split from Canvas basics, wording untouched: Presets and Config nodes are long
   and explain design reasons ("This is deliberate..."). Cut to what and how.
3. `sensor-display.md` (971). The brief's sample task guide; not yet reviewed with Mike.
4. `debugging.md` (1741). The brief's sample troubleshooting page; not yet reviewed. Longest hand-written page.

## P2: reference the reader looks up

5. **Done 2026-10-11.** Node pages brought to the fixed layout; `display-i2c.md`, `touch-panel.md`, `bme280.md`
   chip lists now link to Supported hardware; `display-spi.md` and `gui.md` trimmed. Calls:
   `docs-style-review.md`, "Node pages rewrite (2026-10-11)".
6. **Done 2026-10-11** (`nodes/index.md`).
7. `boards.md` (1462): built-in board and processor tables now overlap Supported hardware; keep pin detail here,
   tested status there.
8. `custom-nodes.md` (1346), `faq.md` (759), `flow-lifecycle.md` (624, older verbose style), `wifi-connection.md`
   (648), `check-a-flow.md` (487).

## P3: background

9. `background/*`, `coming-from/*`: check against the reader rule (programmers; don't teach basics).

## Decisions needed

- `wifi-provisioning.md` (404): added to the nav after Connecting over WiFi (Mike, 2026-10-11). Rewrite with P2.
- Node page fixed layout, limitations rule, word list additions: confirmed by Mike, 2026-10-11.
- A "Future" page inviting feedback: on the backlog (Mike, 2026-10-11), not for the rewrite sessions.
- `nodes/clock.md`: replaced by `ntp.md` in the next dev session (Mike, 2026-10-11). Don't rewrite it.

Not in scope: `ai-authoring.md`, `nodes-catalog.md` (AI readers, own style).
