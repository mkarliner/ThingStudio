# Vendored: `ssd1306`

Source: [micropython/micropython-lib](https://github.com/micropython/micropython-lib),
`micropython/drivers/display/ssd1306/ssd1306.py` on the `master` branch.
License: MIT — this specific file carries no per-file license header or
per-package `metadata.txt` license override, so it falls under
micropython-lib's own repo-root `LICENSE`, which states "Files not belonging
to a particular module are provided under the MIT license" as the default for
anything not separately licensed. Corroborated independently: this file's own
git history (`git log -- micropython/drivers/display/ssd1306/ssd1306.py`)
shows it was moved into micropython-lib from the main `micropython/micropython`
repo (commit `a5e2f32`, "Move 'ssd1306' display driver from main repo"), and
the main repo is MIT-licensed in full (also already listed as MIT in this
project's own design doc §12 table) — not a newly-authored micropython-lib
module with potentially different terms, an already-MIT file relocated.

Fetched 2026-09-17, for `editor/src/node-library/display-i2c.ts`
(`framebuffer-display-node-scoping.md`'s converged design: an I2C-bus display
sink node family, `display_i2c`, with a `controller` property selecting the
vendored driver — SSD1306 is the first/only controller wired up this session).
Exact commit SHA (last commit to actually touch this path, found via a real
`--filter=blob:none` full-history clone's own `git log -- <path>` after an
initial shallow clone gave a misleading boundary-commit result — see
"Verification" below for why the shallow attempt was discarded rather than
trusted):

- `ssd1306.py`: commit `a08087249fda8a7994f7c54ccaad29fb9fcc448a` (2023-02-03,
  "top: Update Python formatting to black \"2023 stable style\"").

SHA-256, upstream file exactly as fetched (no local patch applied):

- `ssd1306.py`: `b9f5331c75297774bced61bdfd12c37d4363336d064d7cf58967c88d807efbe5`

## Verification note: a shallow clone gave a wrong commit SHA, caught before trusting it

The first attempt at finding this file's last-touched commit used `git clone
--depth 50` (this repo is a large monorepo, too big to want a full clone by
default) — `git log -1 -- <path>` against that shallow clone returned a
completely unrelated commit ("requests: Support unicode in json and data
payloads"), because the actual last change to this specific path fell outside
the 50-commit shallow window and git silently returned the shallow boundary
commit instead of erroring. Caught by noticing the returned commit message
had nothing to do with a display driver, not by any tooling guarantee — worth
flagging so a future vendoring session doesn't trust a shallow clone's `git
log -- <path>` result at face value. Fixed by re-cloning with `--filter=blob:
none` (full commit history, blobs fetched lazily — fast enough for a big repo
while still giving accurate full-history path log), which gave the commit
above and was cross-checked by extracting the file content at that exact
commit (`git show <sha>:<path>`) and diffing it byte-for-byte against the
original raw-file download — identical.

## Why vendored rather than hand-rolled

Same "wrap an existing, well-tested driver rather than re-derive the
controller's init command sequence by hand" reasoning as `st7789py_mpy`
(`st7789py_mpy/README.md`) and this project's existing vendoring precedent
generally. This is the reference MicroPython SSD1306 driver (originally
Adafruit's, now maintained as part of `micropython-lib` itself, moved from the
main `micropython/micropython` repo rather than a third-party fork) — about
as close to "the standard implementation" as this ecosystem has for this
chip.

## Structure

One base class, `SSD1306(framebuf.FrameBuffer)` — subclasses `framebuf
directly (`framebuf.MONO_VLSB` format, buffer = `width * (height // 8)`
bytes), matching this project's own framebuffer-as-universal-in-RAM-surface
convention for display nodes generally (`framebuffer-display-node-scoping.md`)
even more directly than `st7789py_mpy` does — this file *is* a `FrameBuffer`,
not just something that accepts one. Two bus-specific subclasses:
`SSD1306_I2C(width, height, i2c, addr=0x3C, external_vcc=False)` and
`SSD1306_SPI(width, height, spi, dc, res, cs, external_vcc=False)`. Only
`SSD1306_I2C` is wired into `display-i2c.ts`'s codegen this session — SSD1306
wired over SPI instead of I2C is a real, supported wiring this driver already
handles, but out of scope for the first pass (`display_i2c` own node is
I2C-bus-only by design; a SPI-wired SSD1306 would need to go through
`display_spi` instead, which doesn't have this controller in its own picklist
yet) — flagged as a known gap, not silently dropped.

## No patches needed

Only imports are `micropython.const` and `framebuf`, both standard
MicroPython, no relative/package imports to flatten — same "no patches needed"
situation as `st7789py_mpy`, unlike `primitives_events`'s two import-only
patches. Vendored byte-for-byte identical to upstream; the SHA-256 above is
both the "as fetched" and "as committed" hash.
