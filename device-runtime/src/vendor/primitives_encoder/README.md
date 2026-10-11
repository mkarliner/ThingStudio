# Vendored: `Encoder` (`primitives.encoder`)

Source: [peterhinch/micropython-async](https://github.com/peterhinch/micropython-async),
`v3/primitives/encoder.py` on the `master` branch. License: MIT (`MIT License`, `Copyright (c) 2016 Peter Hinch` —
read from the repo's root `LICENSE`).

Fetched 2026-10-11 for `editor/src/node-library/encoder.ts` (the `encoder` node,
`docs/working-notes/adc-encoder-neopixel-briefing.md`). Pin: commit
`2258b693281508aeda119757875a9d0c9b9e5f5d` — the last commit to touch this path, per the GitHub commits API for the
path, not just `master` HEAD at fetch time.

SHA-256, upstream exactly as fetched (no local patches):

- `encoder.py`: `ce40d75dd6cbdbbafb3bff77b38c8783c4e2feaff3b622b727c835ad301e6eef`

## Why vendored rather than hand-rolled

Same call as `primitives_events`/`primitives_aadc`: a small, auditable quadrature decoder whose hard-IRQ edge
handling and detent tracking are not worth re-deriving (its own header credits the community fixes that made the
state table correct).

## How it works (what the node relies on)

- `Encoder(pin_x, pin_y, v=0, div=1, vmin=None, vmax=None, mod=None, callback=..., delay=100)`. Two pins with
  pull-ups; hard-IRQ edge callbacks update an internal count (`_v`).
- A `_run` coroutine waits for an edge, sleeps `delay` ms (debounce + rate limit), then applies `div` (round), then
  `vmin`/`vmax` clamp, then `mod`, and calls `callback(lcv, delta)` in the asyncio context and sets a trigger.
- The async iterator (`__anext__`) yields the current value each settled change; **it does not carry the delta** —
  the node's own codegen remembers the previous value to compute `delta = value - prev`.
- `value()` returns the current divided/limited value.
- Not for CNC-grade counting (its own docs).

## Notes

- `div` is applied by rounding; `vmin`/`vmax` clamp; `mod` wraps. Order is division, clamp, modulo.
- `delay` (default 100 ms) is both a debounce and a callback/trigger rate limit, not an IRQ debounce.
