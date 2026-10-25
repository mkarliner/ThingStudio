# Decisions — firmware catalogue (flashing from the editor)

Status: decision, 2026-10-25. Supersedes the per-board `firmware` block in `editor-firmware-flashing-scoping.md`.

## Target model: Thonny's shape, our trust rules

Mike: "Look at what Thonny does. I think that is our target in general." After reading Thonny's own flashing dialogs
(`esptool_dialog.py`, `base_flashing_dialog.py`, `uf2dialog.py`):

- **The chip family owns the knowledge.** A family (ESP32, ESP32-S2/S3/C3, RP2040, RP2350, nRF52840) says which
  tool writes it, which esptool chip id it is, and where the image starts (0x1000 for ESP32/S2, 0 otherwise).
  Thonny computes the address from the family and never asks. It lives in the processor descriptor's `flash`
  block, because processors are already the chip axis — one place, not one per board.
- **A build is a variant inside a family**, with versions. Stock MicroPython builds and our own frozen-runtime
  images are both variants; the supplier says which is which, so the dialog can tell the user that one needs
  Install runtime afterwards and the other only the boot script.
- **A board is a shortcut, not a recipe.** It may name one variant (`"variant": "esp32-generic"`); images are
  never named on a board. That is what made the flash recipes reach nobody who already had a seeded copy, and it
  is the drift the one-vocabulary rule exists to prevent.
- **The catalogue is data in the repo** (`firmware/builds.json`), pinned with a sha256 per version, reviewed like
  any other file. Thonny fetches its catalogue from a server and downloads without a hash; we keep the pin, so a
  new MicroPython release appears when we ship it, not before. Said plainly in the docs.
- **Erase before writing is the default** (`write_flash --erase-all` on the same command — one job, one step).
  Thonny's default, and the reason a first install on a board with a stale partition table works.
- **Ask the tool what it already knows.** A chosen local file's family comes from `esptool image_info`, and a
  mounted UF2 volume's model from its own `INFO_UF2.TXT`. Neither is guessing: the image and the board state what
  they are. This is what replaced the address dropdown the first cut invented.
- **Not copied from Thonny:** fetching the catalogue from a remote server at flash time (unpinned download path);
  per-backend handler classes (our tool registry plus data is the package-extensible shape).

## Variants are builds, not boards

An ESP32 with extra PSRAM is not a different board to us, it is a different build: `esp32-spiram` sits beside
`esp32-generic` under the same family, and the user picks it by name. Same for single-core SOLO and the 2 MB D2WD
part, and for the S3 generic versus SPIRAM_OCT. This is why the family owns the address and the tool and the build
only owns an image: a variant changes the image, never how it is written.

A build may carry an `address` of its own: Thingstudio's classic-ESP32 image is one merged file written at 0, while
the esp32 family's address is 0x1000, so the build's address has to win over the family's (found before it shipped
-- the old CYD block had `offset: 0` and that is why).

A build also carries an optional `note`, shown under the list, for the thing the label cannot say in one line —
"this image predates the frozen library inventory, so Deploy still pushes the libraries a flow uses".

Our own entry is written by `tools/firmware_catalogue.py`, not by hand: it reads the version and the sha256 off the
built image, checks the URL's file name against it, and refuses anything not in `tested.json`. Four fields that
describe one file are four chances to disagree.

**A build we ship under our own name must be in `firmware/classic-esp32/tested.json`.** That record is keyed by
sha256, so `editor/test/firmware-assets.test.ts` asserts every `supplier: "thingstudio"` version's hash is a key in
it: an untested image cannot become a one-click option by editing the catalogue alone.

## Future: manufacturer-supplied catalogue repositories

Mike, 2026-10-25, while this was being built: "an extension of what we're doing is to allow board manufacturers to
supply a URL which adds a catalogue of board definitions, available builds etc. Think the kind of model that apt
uses to add a new apt repository."

Worth keeping open, and cheap to keep open now:

- The loader takes a **list of catalogue sources**, not one hardcoded file. The built-in source is the repo's
  `firmware/builds.json`; a second source is a path or URL later.
- A source carries board/processor definitions plus builds. That is the `apt` shape: an index with its own
  signature, a `sources.list`-like user file, and an explicit "add this repository" action with a trust prompt.
- Trust is the whole design, and it is stricter for us than for `apt`: a source can propose a board definition
  (harmless, reviewable data) and a *build to flash* (arbitrary bytes onto the user's hardware). So a source's
  builds need a pinned hash **inside the source**, and a source that is not ours gets an explicit, named
  acceptance — never silent. Not built now; recorded so the loader's shape does not foreclose it.

2 entries of this topic live in `outstanding-items/firmware-catalogue-repositories.md` when it is picked up.
