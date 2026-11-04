# Decisions — Custom firmware images (all targets)

Status: decision, started 2026-11-04. Family-level calls for Thingstudio's own MicroPython images, one per target
chip. The classic-ESP32 image's own history (why freeze, chunked deploy, local build, publish gate) stays in
`classic-esp32-firmware.md`; this file holds what applies to every target.

- **2026-11-04 — Scope is not shape (Mike).** The classic-ESP32 image was scoped as the only image
  (2026-10-22: "S2/S3/C3 are out … the same technique applies when a board needs it"), and the tooling was then
  built for exactly one: `firmware/classic-esp32/`, `BOARD` and `MPY_VERSION` constants in `build.sh`,
  `--chip esp32` in `install.sh` and the merge step, the image-name pattern in `publish.sh`, the filesystem offset
  copied by hand from one partition table, CI naming the one directory. The decision anticipated a second image;
  the code made it a rewrite. Mike: "assuming that the classic ESP32 would be the only custom image is in direct
  contradiction of my rule about not painting into an architecture corner." Rule added to `AGENTS.md` ("Scope is
  not shape", under "No premature optimization"): one instance is a folder or entry, decision notes that narrow
  to one carry "A second one would need: …", and tests iterate over the registry.
- **2026-11-04 — Every image is rebuilt at each runtime bump (Mike).** An image freezes `runtime.py`, the
  listener and the libraries, so a runtime major bump makes every published image one the current editor refuses
  to deploy to (the classic image at 14.1.0 against an editor on 15.0.0 is the case that showed it). So a runtime
  bump is not finished until each target's image is rebuilt at that version, flashed, recorded in its
  `tested.json` and offered in `firmware/builds.json`. Enforcement is a release gate, not a merge gate: the build
  needs ESP-IDF on Mike's Mac, and `publish.sh` already requires the image's build commit to be an ancestor of the
  tag, so a merge gate would block every bump PR on a build that has to follow it. Gate: the Release workflow's
  first job runs `tools/firmware_targets.py current --tag <tag>` and refuses the tag unless every target has a
  `tested.json` entry at the tag's runtime version, built from a commit the tag contains; CI on every push runs
  the same check with `--warn`, so the gap shows from the day the bump merges. `publish.sh` uploads nothing unless
  every target passes the same test. Versions match exactly, not just the major: a minor bump changes frozen code
  too (14.1.0 changed what Install runtime does on an image).
- **2026-11-04 — A target is a folder: `firmware/targets/<id>/`.** `target.json` holds the facts (label,
  `family` = processor id, esptool `chip`, `idfTarget`, pinned `micropython` and `espIdf` tags, flash `address`,
  the port's `portSdkconfig` fragments); `board/` holds `mpconfigboard.h`, `sdkconfig.board`, `partitions.csv`;
  `tested.json` its records. The scripts (`build.sh`, `install.sh`, `record-tested.sh`, `publish.sh`), the
  frozen set and the patches are shared in `firmware/` and take a target. `tools/firmware_targets.py` is the one
  reader of target facts; `check` fails a folder missing a part, a `chip` that disagrees with the processor
  definition's `flash.chip`, a catalogue entry whose family, address or label disagrees, or a Thingstudio build with
  no folder. `build.sh` generates `mpconfigboard.cmake` and the partition-table sdkconfig lines from `target.json`,
  so the board name and IDF target have one home. The image name is `thingstudio-<id>-<version>-<sha>.bin`; a tree
  with uncommitted changes under `device-runtime/` or `firmware/` builds `...-dirty.bin`, which nothing records or
  publishes. The catalogue entry is created from `target.json` by `firmware_catalogue.py --image` on a target's
  first published image, so adding a target needs no hand edit of `builds.json`. Ids kept `classic-esp32` (it is
  already in published asset names and board `variant`s), plus `esp32-c3` and `esp32-c5`.
  **A second one would need:** a folder of those five files; nothing else changes.
- **2026-11-04 — Version pins are per target, in `target.json`; all three start at MicroPython v1.29.0 and
  ESP-IDF v5.5.2.** Per target because the C5 needed a newer MicroPython than the classic image had (1.28.0,
  ESP-IDF 5.4) and the next chip may need a different one again; a global pin would make that a fork. Equal for
  now because 1.29.0 is what every stock build in `builds.json` already is, v5.5.2 is 1.29.0's recommended ESP-IDF
  (`ports/esp32/README.md` at the tag; it supports 5.3–5.5.4), and the C5 needs a 5.5 release. `build.sh`
  refuses a MicroPython or ESP-IDF checkout at any other tag (it used to warn): the pin is what makes a published
  image rebuildable, so a mismatch is a fact, and facts are refused. The stdin ring-buffer patch applies to 1.29.0
  unchanged.
- **2026-11-04 — Merged images, written at the target's `address`.** `merge_bin --target-offset <address>`; the
  catalogue build carries the same `address`. Classic and C3 at 0 (classic as before: the merged file starts with
  padding up to its bootloader at 0x1000), C5 at 0x2000 (its bootloader's offset; written at 0 a C5 does not
  boot). `build.sh` checks that `flash_args`' lowest offset is not below the address.
- **2026-11-04 — The C5 image has no PSRAM support.** The stock build includes `sdkconfig.spiram_quad` and probes
  for PSRAM; the ESP32-C5-340X's C5-FH4 module has none, and the probe prints errors at every boot. Left out, as
  the classic image leaves PSRAM out. **A second one would need:** a C5-with-PSRAM board is its own target folder
  (`esp32-c5-spiram`), not a flag.
- **2026-11-04 — `.github/workflows/firmware.yml` removed.** It had never completed a build, was not the build
  path (2026-10-23), named the classic image throughout, and would have needed a matrix over targets to keep
  meaning anything. The trigger to build in CI stays as `classic-esp32-firmware.md` states it: when images need
  rebuilding without the maintainer's machine, design CI as the release path, per target, from scratch.
