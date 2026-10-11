# Vendored: `AADC` (`primitives.aadc`)

Source: [peterhinch/micropython-async](https://github.com/peterhinch/micropython-async),
`v3/primitives/aadc.py` on the `master` branch. License: MIT (`MIT License`, `Copyright (c) 2016 Peter Hinch` —
read from the repo's root `LICENSE`).

Fetched 2026-10-11 for `editor/src/node-library/adc.ts` (the `adc` node,
`docs/working-notes/adc-encoder-neopixel-briefing.md`). Pin: commit
`0fb2f22d1b130d63be2ec4d66958c4f6eb8106b3` (2024-05-09, "Docs and code: Remove all references to uasyncio.") — the
last commit to touch this path, per the GitHub commits API for the path, not just `master` HEAD at fetch time (the
same tightened-pin standard `primitives_events/README.md` and `threadsafe_event/README.md` set).

SHA-256, upstream exactly as fetched (no local patches):

- `aadc.py`: `123f446dd7786a6a292a21359366f226b078329886b749fcb20357f4fe852ba9`

## Why vendored rather than hand-rolled

Resolves design doc §11's open `micropython-async` adoption question for the ADC, the same call the
`eswitch`/`ebutton` nodes made for switches/buttons (`primitives_events/README.md`). `AADC` is small enough to audit
in full and its stream-I/O wait mechanism (an `io.IOBase` whose `ioctl` drives an `asyncio.StreamReader`) is not
worth re-deriving.

## How it works (what the node relies on)

- `AADC(adc)` wraps a `machine.ADC`. Awaiting it (it is an async iterator via its `StreamReader`) yields the last
  reading as an `int` once it is out of (or, with `sense(False)`, inside) the configured bounds.
- `read_u16(last=False)` reads 0–65535 now (`last=True` returns the value cached by the last bounds check).
- `__call__(lower, upper)` sets bounds: `upper=None` means "`lower` is ± the current value" (relative); otherwise
  the two are absolute.
- No callbacks; it uses the stream poll mechanism.

## Notes

- ADC2 pins do not work with WiFi on ESP32 — the `adc` node's compile refuses them (checked against the board
  definitions), not this file.
- `read_u16()` gives raw counts; volts come from `machine.ADC.read_uv()` in the node's own codegen, not from this
  file (so the calibration is the port's, not a hard-coded 3.3 V assumption).
