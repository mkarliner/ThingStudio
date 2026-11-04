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
  tag, so a merge gate would block every bump PR on a build that has to follow it. Gate design and the per-target
  version pins: see the next entries once settled.
