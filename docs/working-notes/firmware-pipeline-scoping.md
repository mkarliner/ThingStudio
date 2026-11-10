# Custom firmware images: one-command pipeline (scoping)

Status: scoping, 2026-11-10. Step 1 (CI builds) done the same day: `.github/workflows/firmware-images.yml`, green
on its first run (about 4 minutes per target). Step 2 written the same day: `firmware/bench.py` with a `bench.json`
per target (Mike: the checks are enough; boards C5-340X, a C3 module board, CYD); not yet run on hardware. Mike: CI is fine (3000 minutes a month at most). Asked for by Mike after Discussions #19: "We need a fully automated way to create the
custom images. There are too many steps for me to do reliably." Step 3 not built yet; the decisions at the end are
Mike's.

## Today's steps, per runtime bump

From `firmware/README.md` and `claude/firmware-images-build-and-record-briefing.md`:

1. Keep ESP-IDF v5.5.2 and MicroPython v1.29.0 checkouts on the Mac, source `export.sh` in every shell.
2. Commit first (a dirty tree gives a `-dirty.bin` that can't be recorded).
3. Per target (3): `build.sh`, find the port, disconnect the editor, `install.sh` (BOOT/RESET dance on the C5-340X),
   connect in the editor, check the version line and frozen libraries, deploy a flow three times, read `[memory]`,
   type a `record-tested.sh` line by hand.
4. Commit `tested.json`.
5. Per target: `firmware_catalogue.py --image ... --url ...`; then `catalogue_sign.py sign`; commit.
6. Tag; wait for the draft release; `publish.sh vX`; `publish.sh vX --publish`.

Roughly 25 commands across two machines' worth of state, with three places where a typo or a wrong checkout costs
an hour. Only one part needs Mike: a board on a cable. Everything else can be a machine's job.

## Proposal: three steps, one human

### 1. CI builds the images (no toolchain on the Mac)

A `firmware-images` GitHub Actions workflow, a matrix over `tools/firmware_targets.py list`:

- Runs in Espressif's `espressif/idf` container at each target's `espIdf` tag (pinned by digest), clones
  MicroPython at the target's `micropython` tag (cached), runs the existing `firmware/build.sh`.
- Triggers: push to `main` touching `device-runtime/` or `firmware/`, and manual dispatch.
- Uploads each target's image, `.sha256` and `main.py` as artifacts named by commit.
- Built from a clean checkout, so never `-dirty`. And real builds: GitHub reaches the ESP-IDF component registry, so
  the cloud-session caveat in `learnings/firmware-builds.md` (GitHub copies of two components) doesn't apply.

`build.sh` stays the one build recipe; the Mac can still run it, but no longer has to.

### 2. One command at the bench: `firmware/bench.py`

Run on the Mac with the boards to hand:

1. Downloads the CI images for `HEAD` (`gh run download`); refuses if HEAD has none or the tree is dirty.
2. For each target, in turn: "Plug in the CYD and press Enter". Finds the new serial port itself (the port list
   before and after), warns if the editor holds it, runs `install.sh`, and on the C5-340X prints the BOOT/RESET step
   when flashing doesn't start.
3. Smoke test through `test-flows/device_cli.py` (headless, no editor): HELLO reports the expected runtime version;
   the frozen libraries are all present; deploy the target's smoke flow, then deploy over it twice while it runs;
   capture `[memory]` after each. Smoke flows live in `firmware/targets/<target>/smoke.flow.json` (C3/C5 a BLE
   flow, classic the CYD theme demo, per the 2026-11-05 briefing).
4. Shows the result and the note it will record ("CYD: HELLO 15.1.0, 21 libraries frozen, theme demo deployed 3x,
   free 38 KB / IDF largest 31 KB"); Mike answers y/n. Yes runs `record-tested.sh` with that note.
5. After the last target: adds each image to `builds.json` with its release URL, signs the catalogue (the one
   passphrase prompt), and prints the single commit-and-tag sequence for Mike's Terminal.

A failure stops at that target with the console lines, and records nothing.

### 3. The release workflow attaches the images

Instead of `publish.sh` on the Mac: on a tag, the Release workflow downloads the CI artifacts for the tagged commit
(the same bytes the bench tested; their hashes are in `tested.json`), checks them against `tested.json` exactly as
`publish.sh` does today, and attaches them to the draft. Mike publishes the draft.

### Mike's part, after this

```
git push                     # CI builds the images
firmware/bench.py            # plug in each board when asked; type the signing passphrase once
<paste the commit-and-tag lines it prints>
```

## Work, roughly

1. CI workflow, plus `build.sh` reading the IDF/MicroPython locations from the container: half a day, mostly
   waiting on CI runs.
2. `bench.py` and the three smoke flows: a day. `device_cli.py` already deploys and triggers; it needs a mode that
   prints HELLO and `[memory]` as JSON for the script to read.
3. Release workflow attach step, replacing `publish.sh`'s upload half: a couple of hours.
4. `firmware/README.md` rewritten around the three steps; the old manual route kept as a short appendix.

## Decisions for Mike

1. **CI builds, or keep building on the Mac?** CI is the main saving (no toolchain, never dirty), and the tested bytes
   become the published bytes. Cost: each push touching the runtime spends ~15 CI minutes.
2. **How much should the bench check?** The proposal: version, frozen set, three deploys, memory figures. A
   per-flow output check (e.g. BLE scan saw a device) is possible but makes the bench depend on the room.
3. **Which board per target** for the bench prompt: the 2026-11-05 briefing's (C5-340X, a C3 module board, CYD)?
