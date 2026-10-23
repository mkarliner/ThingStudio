# Briefing: GUI cards don't appear on the CYD panel

Session: 2026-10-23. Continuation handoff — the next session starts here.

**RESOLVED the same day — see "Resolution" below before reading the hypotheses.** The cause was
hypothesis 4: the image on the board predated the card commit. Cards now draw on the CYD.

## The one-sentence topic

The 13.0.0 GUI theme/card work is committed and on the board, but Mike does not see the
cards/panels on the CYD's 240x320 panel, and the host-side probe says the drawing code does
emit card pixels. The open question is **why the band never shows them on real hardware**.

## Resolution (2026-10-23, later the same day)

The board's frozen `thingstudio_gui` was built at `19c3dbf`, one commit before `a4f1e2f` — and
`a4f1e2f` is the commit that added `page_cards()`/`_fill_round()` and the card fill in both draw
paths. At `19c3dbf` the only occurrence of "card" in `gui.py` is the theme role key. The editor
emitted `"cards": [...]` correctly; the library on the board had no code that read the key, so the
failure was silent and total.

How it was pinned down, cheapest first:

- The photo showed **no rectangles at all**, not faint ones — eliminating hypothesis 2 (the
  deployed palette has `bg 0x10A2`, `card 0x3A49`; nothing subtle was hiding).
- The generated Python on the board (`"cards": [(4, 4, 232, 31), (4, 41, 232, 113), (10, 121, 220, 23)]`)
  had non-empty card tables — eliminating hypothesis 1.
- It instantiates `BandSurface`, and `_draw_band` at HEAD does fill cards — eliminating hypothesis 3.
- `git show 19c3dbf:device-runtime/src/vendor/thingstudio_gui/gui.py | grep card` returned only
  the theme role — confirming hypothesis 4.

Fix: rebuilt at HEAD (`out/thingstudio-classic-esp32-13.0.0-a4f1e2f.bin`), reflashed, redeployed
`card-hero2`. Cards render (header card, readings card, sub-card), rounded, in `0x3A49`.

Two side effects to remember: a reflash **erases flows and WiFi credentials** (board now reports
`hasWifi: false`; the card demo does not need them), and `Tools → Install runtime…` would *not*
have fixed this — frozen modules take precedence over `/lib`. Recorded as a learning in
`learnings/micropython-device-runtime.md`.

## What is committed and shipped (done, don't redo)

Runtime/editor are at **13.0.0** (`_RUNTIME_VERSION` in `device-runtime/src/listener.py`,
`EDITOR_TARGET_VERSION` in `editor/src/app/main.ts`). Head is `a4f1e2f`.

- `671565a` gui: draw by theme role, default theme = the old hard-coded colours (13.0.0 bump).
- `2c6a0b9` gui: theme config node with presets (`dark-slate`, `light-paper`) that seed
  editable roles; per-format fold at low colour depth.
- `1105c61` gui: theme owns the display palette on indexed formats (display's own palette is
  ignored, with a warning).
- `f16117e` gui: trend = accent bars + muted range line; min/max ticks only.
- `19c3dbf` test-flows: `test-flows/gui-hero-cyd-theme.flow.json` (dark slate + cards).
- `c9c79ca` compile context: normalise `flow.links` to `[originId, originSlot, targetId, targetSlot]`
  before any hook sees it (adds `flow.links` so packages can see wired neighbours).
- `a4f1e2f` gui: cards on containers (`ContainerSpec.card`, `"cards"` emitted into page and
  modal tables; checkbox in `ScreenOutline.vue`).
- Also landed earlier this arc: `touch` node orientation parity with TS `orientedTouch()`.

Earlier release work already shipped as `v0.4.0` (runtime 12.0.0/12.1.0: no automatic recovery,
5 KB deploy pieces, power-cycle advice, Garbled FLOW_ACK, 8 KB REPL ring-buffer patch), plus docs
(game-over ladder in `debugging.md`/`faq.md`, `custom-firmware.md`, tested-image scripts).

User docs for this work: `docs/user-guide/nodes/gui.md` (Themes / Cards / Trend sections).
Scope/decisions record: `docs/working-notes/gui-widget-styles-and-colour-scoping.md`.

## State of the board

- CYD is flashed with `firmware/classic-esp32/out/thingstudio-classic-esp32-13.0.0-19c3dbf.bin`.
  That image **freezes** `thingstudio_gui`, so any change to gui.py/cards requires a reflash
  (or `Tools → Install runtime…`) before it can be seen — the tested image freezes the library.
- `gui-hero-cyd-theme` was deployed over serial with `/tmp/opencode/deploy_flow.py`.
- Mike then got "no panels". A stronger demo was built and deployed on top (see the uncommitted
  flow diff below): cards on the header and on a readings block, card colour overridden to
  `0x3a49`.

## Uncommitted work (one file)

`test-flows/gui-hero-cyd-theme.flow.json` is modified (+73/−57), not committed:

- theme `card` `8484` → `14921` (`0x3a49`) — a deliberately obvious card colour;
- the readings block re-laid out with nested `column` containers, each `"card": true`,
  `padding: 6`, `gap: 4`;
- `units` written as `\u00b0C` instead of a literal `°`.

This is the demo currently on the board. Decide with Mike whether to keep it (it is a better
test of cards) or revert before the next commit.

## Evidence so far

**Host side: the drawing code does produce card pixels.** `/tmp/opencode/probe_band.py` builds a
`BandSurface` the way the CYD screen does (240x320, 42-row bands, `framebuf.GS4_HMSB`, palette from
the theme fold) with one card rect of `(4, 4, 232, 31)` and calls `_draw_band(0, 42)` directly:

```
card pixels seen in band 0 (index 1): 874
corner (4,4): 1  inside (100, 10): 1  outside (2,2): 0
```

So `page_cards()` + `_fill_round` + palette index 1 work when called directly on a band.

**What that probe does NOT prove:** that the live draw path reaches `_draw_band` for a frame at
all, that `page_cards()` returns non-empty from the *deployed* page table, that the band is
flushed to the panel, or that the frozen library on the board is the 13.0.0 code and not an older
copy. Those are the open hypotheses.

## Hypotheses to test, in order

1. **The panel is drawing, but no card rects are in the deployed page table.** `screen.draw` /
   `page_cards()` read what the editor emitted into `pages`/`modals`. Check the generated Python
   for the deployed flow (`"cards": [...]` per page) before touching the library. If empty, the
   bug is in `editor/src/gui/screens.ts` emission (e.g. cards only emitted for a container kind
   that this flow doesn't use, or emitted under a key the band surface doesn't read).
2. **Cards are drawn but the card colour equals the background.** 874 pixels at `0x2124` next to
   `bg` `0x10a2` on a 4-bit palette can look like nothing on a cheap TN panel. The `0x3a49`
   override in the uncommitted flow exists precisely to rule this out — looking at the photo is
   the fastest test.
3. **The live path never calls `_draw_band` for the frame** (e.g. full-frame `FrameSurface` used
   instead of `BandSurface` on this geometry, or the band list is empty), so only widgets paint.
   Verify which surface class the generated flow instantiates on this CYD layout.
4. **The board is running an older frozen `thingstudio_gui`.** The image was built from `19c3dbf`,
   which *does* contain cards (`a4f1e2f` came after, so the image predates the final card commit).
   Confirm whether `a4f1e2f` changes are inside the frozen library or editor-only; if
   library-side, the image must be rebuilt and reflashed.

Hypothesis 4 is the cheapest to check and would explain everything — the image was built at
`19c3dbf`, and the card work landed as `a4f1e2f` afterwards.

## The immediate next move

Get Mike's photo onto this box and look at it:

```
scp ~/Downloads/20261023_134504.jpg <user>@192.168.10.165:/tmp/opencode/cyd-cards.jpg
```

`/tmp/opencode` is writable and approved. The alternative upload endpoint
(`/tmp/opencode/upload_server.py`, listening on port 8044) may still be running; the photo was
not on any shared mount, which is why base64/scp came up.

Then read the image and answer one question: **are there any card rectangles at all?** That
splits the hypothesis list in half (1/3/4 vs 2).

Report findings to Mike before changing any code — this whole arc is under "fail well, not work
badly", and he wants a report at each step before commits.

## Environment facts that will bite the next session

- Terminal lacks `dialout`. Every serial command must be `sg dialout -c '...'`.
- `/dev/ttyUSB0` can wedge with EIO after some closes; only unplug/replug fixes it. A flash once
  dropped mid-write at default baud (retry succeeded).
- `install.sh` needs `PORT=/dev/ttyUSB0` and must run under `sg dialout`.
- Editor must be at HEAD (13.0.0) or `decideDeploy` blocks the deploy on the major-version gate.
- `gh` auth: working fine-grained token at `/home/agent/.gh_token`; `~/.config/gh` token is dead.
- Useful scripts: `/tmp/opencode/deploy_flow.py <bytecode> <flowName>` (FLOW_PUT/FLOW_COMMIT
  driver), `/tmp/opencode/probe_band.py`, `/tmp/opencode/probe_card.py`,
  `/tmp/opencode/probe_trend.py`, `/tmp/opencode/remove_flow.py`, `/tmp/opencode/reset_cyd.py`.

## Decisions in force (do not relitigate)

- Fail well, not work badly: no automatic recovery chains inside a user action; warn on a
  prediction, refuse only on a fact; every failure line names what happened, the figure, and the
  next step.
- Never refuse a deploy on a memory guess — warn only.
- Deploy pieces stay at 5 KB ("if we must chunk, make it bigger"); no automatic retries/repairs.
- Themes fold at low colour depths (fold, not error).
- Cards are built on containers, not a separate tile widget.
- Trend: accent bars + muted min/max ticks only.
- Theme is a config node; presets seed editable roles ("create palette").
- Image build path: local build, attached to the release by hand (not CI).
- GUI theme applies to every format; default theme = the previous hard-coded colours, so an
  untouched flow looks exactly as before.

## Relevant files

- `device-runtime/src/vendor/thingstudio_gui/gui.py` — `FrameSurface`/`BandSurface`, theme roles,
  `_fill_round`, `page_cards()`, `background_for()`.
- `editor/src/gui/screens.ts` — `ContainerSpec.card`, `"cards"` into page/modal tables.
- `editor/src/node-library/gui-theme-shared.ts` — roles, presets, `resolveThemeForFormat`,
  `themeString`.
- `editor/src/node-library/core-packages/display-spi.ts` — Python hook taking the palette from the
  wired screen's theme.
- `editor/src/node-library/compile-context.ts` — `flow.links` normalisation.
- `editor/src/app/rete/ScreenOutline.vue` — `card` checkbox per container.
- `device-runtime/test/test_gui.py` — card/theme tests.
- `test-flows/gui-hero-cyd-theme.flow.json` — the demo (modified, see above).
- `firmware/classic-esp32/patches/` — the REPL ring-buffer patch from 12.1.0.

## Suggested filename/commit hygiene

Nothing in this brief has been committed yet beyond `a4f1e2f`. Before starting the new session,
consider committing the flow change (if Mike wants to keep it) with something like
`test-flows: a card-heavy CYD demo with an obvious card colour`.
