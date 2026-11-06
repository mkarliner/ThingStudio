# Release plan: v0.12.0 and the next tester round

Status: plan, 2026-11-06. Not yet agreed by Mike. It collects the work of 2026-10-24 to 2026-11-06 into one
release, and gets that release ready for the next round of test announcements, where people from the target
communities onboard themselves. The version number is a proposal: runtime 15.0.0 is a major runtime bump, so
v0.12.0 rather than v0.11.3.

Sources: `custom-firmware-family-briefing.md`, `firmware-images-build-and-record-briefing.md`,
`phase-5-node-pages-done-briefing.md`, `user-guide-editing-landed-briefing.md`, `remote-display-spike-briefing.md`,
`outstanding-items.md` ([TR] items), `docs/tester-ready.md`, the marketing plan (ThingStudioMarketing repo).
State read from `git log` on 2026-11-06: `main` at `6c6e52d6`, branch `custom-firmware-family` 7 commits ahead.

## What goes in

Already on `main` since v0.11.2:

- **BLE, phases 1-3**: `ble scan`, `ble advertise`, GATT peripheral (`ble characteristic in/out`, `ble uart in/out`),
  the board as a central (`ble peer`, `ble read/write/notify`). `ts_ble` is a package. Phases 1-2 checked on the
  ESP32-C5.
- **ESP32-C5** processor and the ESP32-C5-340X board definition; the XIAO nRF52840 (Sense) smoke tested.
- **Runtime 15.0.0**: flow libraries may be packages.
- `thingstudio-compile` checks custom node packages; `--arch` follows `--board`.
- **The user manual rewrite**: Phase 5 done (every node page against the code), tutorials folder, lean node catalog.
- `adc` sends once per crossing; `i2c device` checks its bus; whole-number intervals; console follows new lines
  only while scrolled to the bottom.

On branch `custom-firmware-family` (PR #11), not yet on `main`:

- **Custom firmware family**: one Thingstudio image per chip (classic ESP32, ESP32-C3, ESP32-C5), MicroPython
  v1.29.0 / ESP-IDF v5.5.2, the release gate that refuses a tag without a tested image per target.
- The remote display scoping note, decisions and spike briefing (working notes only; nothing user-facing).

Uncommitted on Mike's checkout (2026-11-06, this session):

- **Kitchen-sink board**: a built-in board definition (`kitchen-sink-c3`, the LuatOS ESP32C3-CORE with a pot on
  GPIO 0, a button on GPIO 3 and a WS2812 on GPIO 6) and a user-guide page on wiring it, for the `adc` and later
  tutorials. Docs fixed on the way: `variant` documented, copying a built-in to describe your own wiring, decimal-only
  `number` values, `npm ci --ignore-scripts`. `test-flows/kitchen-sink.flow.json`: BOOT on GPIO 9, unwired encoder
  removed.

On branch `claude/kind-gates-wmjfjq`, 1 commit: "Refuse Deploy from a tab running an old editor build". Useful for
testers who upgrade with a tab left open. **Proposed in.**

Not in this release: the remote display (its spike is separate work and can run in parallel; nothing in the user
docs mentions it, per "say what's true now").

## Critical path

```
1 merge #11 -> 2 build/flash/record 3 images -> 3 docs from measurements -> 5 bump + tag -> 6 publish
4 tester-facing fixes (parallel with 2-3) ------------------------------------^
6 publish -> 7 fresh-machine check -> 8 announce
```

The firmware images are the long pole: the Release workflow refuses the tag until all three targets have a
tested 15.0.0 image built from a commit the tag contains.

## 1. Integrate (Mike, ~30 min)

1. Commit the uncommitted remote-display notes on `custom-firmware-family` (`BRIEFINGS.md`, `decisions.md`,
   `decisions/remote-display.md`, the two remote-display briefings and the scoping note).
2. Merge PR #11 into `main`.
3. Merge `claude/kind-gates-wmjfjq` (or say no).
4. CI green on `main`. Confirm `editor/test/cli-describe.test.ts` passes (it failed on 2026-11-04 before the
   `describe.ts` restore in `b4ca4586`; the Phase 5 run had 1,362 green afterwards). Note the flaky
   `test_ws_relay` if it fails, rather than re-running until it passes.

```sh
cd ~/Src/ThingStudio && rm -f .git/index.lock
git add docs/working-notes && git commit -m "Working notes: remote display decisions and spike briefing"
git push
# then merge PR #11 on GitHub, and:
git fetch origin && git checkout main && git pull --ff-only
git status --short -- device-runtime firmware     # must print nothing before building
```

## 2. Custom firmware: build, flash, test, record (Mike, live boards, half a day)

Full recipe: `firmware-images-build-and-record-briefing.md`. In order:

| Target | Board | Flow to run, then redeploy over it twice | Question it answers |
|---|---|---|---|
| `esp32-c5` | ESP32-C5-340X | BLE flow (`ble scan` → `debug`, or `ble characteristic out`) | Does the image fix the BLE redeploy `MemoryError`? |
| `esp32-c3` | "ESP32C3 module" board (or LuatOS CORE) | BLE flow; then BLE + WiFi if it fits | Same; and is there room for WiFi with BLE? |
| `classic-esp32` | CYD | `gui-hero-cyd-theme` | No regression from 14.1.0 at the new pins |

Note the `[memory]` line at fresh boot, with the flow running, and after each redeploy. Record each with
`firmware/record-tested.sh`. Done when `python3 tools/firmware_targets.py current` prints nothing and the three
`tested.json` are committed.

A failure is a finding: if the C5 or C3 still hits `MemoryError`, the release can still ship, but the docs keep
the soft "more likely to fit" wording and the tester post doesn't promise BLE redeploys on those chips.

While the boards are out (each is minutes, and each is something a tester would hit):

- **BLE phase 3 two-board test**: `test-flows/ble-peer-counter.flow.json` on a second board,
  `ble-central-c5.flow.json` on the C5. The central nodes ship in this release unchecked on hardware otherwise.
- **Kitchen-sink board**: run the page's "Check each part" list on Mike's board. Its NeoPixel step doubles as the
  colour-order check below (it should light green).
- **`neopixel` colour order** [P2]: send `0xff0000` to a WS2812 strip with order GRB. If it lights green, the node
  double-reorders; fix before release (a one-line change, `outstanding-items.md` has the shape).
- **`adc` once-per-crossing** on a potentiometer, with and without poll.
- **"Blink from anywhere"** tutorial run (MQTT, the ladder's step 5): still carries "Work in progress". Testers go
  to MQTT by themselves (`tester-ready.md`), so this is the tutorial most worth un-bannering.

## 3. Docs from the measurements (session, ~1 hour, after 2)

- `custom-firmware.md` "Memory and the board": C3 and C5 rows; drop "not measured yet"; un-soften "What it
  changes" if every redeploy worked.
- `faq.md`: a C3 BLE+WiFi entry with the figure, if it doesn't fit.
- `nodes/ble.md`: NimBLE allows 4 connections on every ESP32 build.
- `supported-hardware.md`: the C3 and C5 rows' Tested column from what ran.
- Tutorial banners: remove "Work in progress" from any tutorial that ran clean; fix it from the run otherwise.
- `python3 tools/docs_lint.py`, `mkdocs build --strict`, the link check.

## 4. Tester-facing fixes (session, parallel with 2, ~half a day in a cloud clone)

Ranked by what a newcomer meets first. The [TR] items are tester-ready gates.

1. **[TR] Reword the `[wifi] … reachable over WiFi` console line** (discussion #5: a first-timer read it as
   "connected" while his flow's WiFi was failing). Small, editor-side.
2. **Plain console line for an unreachable MQTT broker** (same family; adventurers go to MQTT next).
3. **[TR] [P2] ESP32-C6/H2/P4 resolve as a classic ESP32.** More likely to bite now that the C3 and C5 are
   promoted: someone will bring a C6. An unknown ESP32 variant should resolve to no processor.
4. **[TR] A local classic-ESP32 Thingstudio image installs at `0x1000`** through **Or use your own image file**
   and doesn't boot. The docs now say to set **Address** `0x0`; the fix reads the start address out of the image
   (`outstanding-items.md`, Boards / definitions). Matters once 15.0.0 images sit on the releases page.
5. `examples/http-blink.flow.json` shipped with **full message** ticked, so the Web Blink tutorial can drop the
   instruction (optional).

Anything here that touches the wire protocol or another interface spec follows `AGENTS.md` (read the spec, run
its conformance test, Mike's permission to change it). None of the five should.

## 5. Bump and tag (Mike, 15 min)

The v0.11.2 lesson: the tag went out before `backend/pyproject.toml` said 0.11.2 and the Release workflow failed.
So the bump is its own commit, pushed and green, before the tag.

```sh
cd ~/Src/ThingStudio && rm -f .git/index.lock
# edit backend/pyproject.toml: version = "0.12.0"
git commit -am "release: v0.12.0" && git push
# wait for CI green, then:
git tag v0.12.0 && git push origin v0.12.0
```

The Release workflow checks the version and the firmware gate. Release notes: short, from "What goes in" above,
leading with what a tester can do (BLE, the C3/C5, the rewritten manual), then the firmware images.

## 6. Publish the firmware (Mike, 20 min)

`firmware/publish.sh v0.12.0`, then `tools/firmware_catalogue.py --image … --url …` per target. Then two calls:

- **Board variants**: do `esp32-c5-340x.json` and the C3 board files point at the new Thingstudio images, as the
  D1 R32 and CYD do at the classic one? (Can only be set after publish: `definitions.test.ts` requires the build
  to exist.) Recommended yes for the C5, whose stock image is the one with the redeploy problem.
- **Old 14.x classic builds** in `builds.json`: drop them or keep them for the record.

## 7. Fresh-machine check (Mike, ~1 hour)

Testers will follow the docs from a blank machine, so do it once on the released artifacts, timing it against the
15-minute bar in `tester-ready.md`: install from the docs (macOS, and Windows if a machine is to hand), MicroPython
onto a supported board, first blink, then one custom-firmware install on the C5. Anything that stops you becomes a
FAQ entry or a fix before announcing, per the tester-ready feedback loop.

Also confirm the **Onboarding reports** Discussions category exists (the form in
`.github/DISCUSSION_TEMPLATE/onboarding-reports.yml` needs it, and nobody has checked).

## 8. The test announcements (Mike's words)

This is a tester round, not the launch: Show HN and the Hackaday tip stay unused, since each lands once
(marketing plan §9). Communities that suit a "come and try it, tell us where it breaks" post, from the plan's
launch-week list:

- MicroPython GitHub Discussions and Discord, show-and-tell.
- r/esp32 and r/micropython (read each subreddit's self-promotion rules first; not yet checked).
- Node-RED forum, Share Your Projects (frame as "flows on the microcontroller", generous to Node-RED MCU).
- A London hackspace, in person or on its list.

What each post carries:

- One line on what it is, one on what's new (BLE, the C3/C5, a rewritten manual).
- The boards to bring, quoted from Supported hardware's Tested column, no more.
- The ask: install from the docs alone, blink, then go wherever curiosity takes you, and file an Onboarding
  report, including "what did you try next, and what happened?".
- The AI declaration (marketing plan §4) or a link to it.

Before posting: the README still opens with the weak one-line AI note; swap in the declaration (marketing plan
§14). The GoatCounter note and landing page are nice to have, not gates for a tester round.

Afterwards: every report becomes a FAQ/debugging entry or a [TR] item in the same change (`tester-ready.md`), and
the reports get counted toward the marketing plan's "trying it" target.

## Owners at a glance

| Step | Who | Blocks |
|---|---|---|
| 1 Integrate | Mike | 2 |
| 2 Firmware + hardware checks | Mike, boards | 3, 5 |
| 3 Docs from measurements | session | 5 |
| 4 Tester-facing fixes | session (cloud clone) | 5 |
| 5 Bump + tag | Mike | 6 |
| 6 Publish firmware, variants | Mike (+ session for the catalogue edits) | 7 |
| 7 Fresh-machine check | Mike | 8 |
| 8 Announce | Mike | — |

## Decisions for Mike

1. Version: v0.12.0?
2. Include `claude/kind-gates-wmjfjq`?
3. If the C5/C3 images still hit `MemoryError` on a BLE redeploy: ship and say so, or hold?
4. Which of step 4's fixes are gates for this round, and which can follow in v0.12.1?
5. Board variants for the C3/C5 after publish; keep or drop the 14.x classic builds.
6. Which communities this round, and whether the remote display spike runs alongside (it does not block).
