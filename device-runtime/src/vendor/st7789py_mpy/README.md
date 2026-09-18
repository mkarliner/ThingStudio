# Vendored: `st7789py_mpy`

Source: [devbis/st7789py_mpy](https://github.com/devbis/st7789py_mpy), `st7789py.py`
on the `master` branch. License: MIT (confirmed via the repo's own root `LICENSE`
file, fetched and read directly).

Fetched 2026-09-17, for `editor/src/node-library/display-spi.ts`
(`framebuffer-display-node-scoping.md`'s converged design: an SPI-bus display sink
node family, `display_spi`, with a `controller` property selecting the vendored
driver). Pin reference, exact commit SHA (last commit to actually touch this path,
via a real clone's own `git log -- st7789py.py`, not just `master` HEAD at fetch
time -- same standard `primitives_events/README.md`/`threadsafe_event/README.md`
set):

- `st7789py.py`: commit `c7d4b89b0835777bad7f42d27c5a0d8b9215f6ad` (2019-12-27, "Add
  support for the TTGO 135x240 LCD").

SHA-256, upstream file exactly as fetched (no local patch applied — see "No
patches needed" below):

- `st7789py.py`: `e07f8bbabb1898560693845fa237117bcc95107a035739e2adad18de8e295e80`

Verification: fetched twice independently — once via a raw-file download
(`raw.githubusercontent.com`), once via a full `git clone` of the upstream repo —
and `diff`ed byte-for-byte identical before anything else was done, same
discipline as `primitives_events/README.md`'s own "an improvement on the prior
two vendorings' own honesty caveats" note. Both fetches ran with normal outbound
network access (this session, not a web-fetch tool that summarizes/paraphrases
content — confirmed the difference matters: an earlier same-session web-fetch
summary of this same file mischaracterized its class structure as a
non-existent `ST77xx`/`ST7789` split with `ST77xx` cut off mid-read; the real
file, read in full below, does in fact have exactly that split, but the
summary tool's word wasn't trusted for the exact constructor signature or the
reset/cs-optional behavior that follows — both re-derived from the real
source directly).

## Why vendored rather than hand-rolled

`framebuffer-display-node-scoping.md` and the original
`framebuffer-st7789-display-briefing.md` before it settled this: wrap an
existing, well-tested driver rather than re-derive the ST7789's SPI command
sequence and MADCTL/rotation bit-twiddling by hand, same "prefer a maintained
implementation over re-deriving subtle hardware-protocol logic" standard this
project already applies to `mqtt_as`/`ThreadSafeEvent`/`primitives_events`.
Chosen over `russhughes/st7789_mpy` specifically because that one is a native C
module requiring a custom-compiled/frozen MicroPython firmware build — a hard
incompatibility with this project's stock-MicroPython + `mpremote cp`
deployment model (confirmed via that repo's own README: "written in C", CMake
build instructions, prebuilt firmware images). This one is pure Python, works
unmodified on stock MicroPython, and explicitly supports both 240×240 and
135×240 panels (the TiDAL badge's own panel) without extra configuration.

## Structure (worth knowing before extending the `controller` picklist)

Two classes, not one: `ST77xx` (the base — SPI write plumbing, window/address-
window commands, `fill`/`rect`/`line`/`blit_buffer` pixel primitives, generic
`init()` = hard reset + soft reset + sleep-mode-off) and `ST7789(ST77xx)` (the
subclass — the actual ST7789 init command sequence: `COLMOD`, `MADCTL`
rotation/mirror encoding, `INVON`, `NORON`, `DISPON`). Only `ST7789` is used by
the node's codegen today. This split is upstream's own design, not something
added locally — worth noting because other ST77xx-family chips (ST7735, etc.)
could in principle subclass the same `ST77xx` base cheaply later, whereas a
genuinely different command family (ILI9341, ILI9342, GC9A01 — none of which
are ST77xx derivatives) would need its own separate vendored file entirely.
See `outstanding-items.md`'s vendor-file-growth tracking item — deliberately
not solved by this vendoring, just flagged so it's visible before a fifth or
sixth controller quietly grows `VENDOR_FILES` for every board regardless of
whether that board has a display at all.

## `reset`/`cs` are safely optional despite no `=None` default

`ST77xx.__init__(self, spi, width, height, reset, dc, cs=None, backlight=None,
xstart=-1, ystart=-1)` — `reset` has no default in the signature, but every
method that touches it (`reset_low`/`reset_high`/`hard_reset`) guards with `if
self.reset:` first, so passing `reset=None` explicitly (a board with reset
tied high in hardware, no GPIO control — e.g. the "Cheap Yellow Display"
family, per `framebuffer-display-node-scoping.md`'s CYD notes) already works
with zero patch needed. Confirmed by reading every call site, not assumed from
the signature alone — an earlier same-session note (before this file was
actually read in full) wrongly assumed a patch would be needed here; it isn't.
Same already-optional behavior for `cs`, which does default to `None` in the
signature.

## `xstart`/`ystart` and non-240×240/135×240 panels

`ST77xx.__init__` hardcodes `xstart`/`ystart` offsets only for exactly
240×240 and 135×240 panels; any other resolution passed without explicit
`xstart`/`ystart` raises `ValueError`.

**Corrected 2026-09-17, found on real TiDAL hardware:** this note used to say
the node's codegen always passes explicit `xstart=0, ystart=0` regardless of
panel size, reasoning that covered an arbitrary-resolution panel this table
doesn't know about. That was wrong for TiDAL's own 135×240 panel specifically
— this driver's own table wants `xstart=52, ystart=40` there, not `0, 0` —
and TiDAL is the one board this project actually has hardware for. `xstart`/
`ystart` are real `display_spi` node properties now, defaulting to `-1`
("not overridden," passed straight through to this driver's own `__init__`),
so 240×240 and 135×240 panels get this table's correct offset automatically
and any other resolution gets a real `ValueError` from `__init__` itself
(fixable by setting `xstart`/`ystart` explicitly on the node) instead of a
silent wrong offset — see `display-spi.ts`'s own codegen and its header
comment's full self-correction story for where this is set now.

## No patches needed

Unlike `primitives_events` (which needed two import-flattening patches for
this project's flat vendor-file-on-device-filesystem convention), this file's
only imports are `time`, `micropython.const`, and `ustruct` — all standard
MicroPython, no relative/package imports to flatten. Vendored byte-for-byte
identical to upstream; the SHA-256 above is both the "as fetched" and "as
committed" hash, since there is no before/after distinction for this file the
way there is for `events.py`/`delay_ms.py`.
