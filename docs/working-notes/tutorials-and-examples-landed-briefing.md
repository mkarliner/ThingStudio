# Tutorials and examples landed; the D1 R32 carried them

Status: continuation brief, filed 2026-11-01. The ladder's first two tutorials are written, reviewed live with Mike
over the local docs server, and reworked on his findings; the examples split shipped around them; the board story
(advice on the custom image, the D1 R32 definition, the after-flash lines) is settled. Next natural session:
tutorial 3, MQTT, and the smaller threads below. Supersedes
`briefings-archive/tutorial-ladder-authoring-briefing.md`, whose ladder is reshaped below and whose owed items
are all done or altered.

## What the review changed (settled, don't re-derive)

- **The ladder reshaped:** onboarding ends at a blinking LED (Getting started, steps 1-6); tutorial 1 is "Two
  more blinks" -- gpio read/set *and* `context` in one page, no speed/invert filler ("too trivial"); tutorial 2
  is "Blink from your network" (WiFi credentials, `http in`, finding the board, the open-port line); MQTT is next,
  in that order, then "more to come". The word "ladder" is briefing-only, never in user text. The style guide's
  Voice section now allows a tutorial-title light touch ("Two more blinks", dated), bodies neutral.
- **Tutorial 2's flow carries no timer chain** (Mike's finding: two functions' separate `context`s and a 2 Hz
  blink drowned the request's toggle): the request is the only event, the reply and the pin agree, the LED holds
  its level between requests. Page and flow both carry that.
- **User text now has a "credentials" story Mike wrote:** flow files hold no secrets; the SSID/password live in
  `~/.thingstudio/credentials/`, named, several per network, one picked per flow.
- **The stateless point is a `!!! note`** box ("An important point to understand") inside tutorial 1: stateless
  events, two reasons (bugs belong to their input; recovery is doing nothing), then "Thingstudio's answer is a
  **context**" -- scoped `context` (node) vs `flow` (whole flow), with `change` honest about not being able to
  invert.

## Landed alongside (all committed; `docs/context-diet` at `8eb1783`)

- **`examples/` (top level)** -- the flows users copy (`blink`, `two-more-blinks`, `http-blink`, `basic-mqtt`,
  `basic-http-request`, `bmp280-test-flow`, the two S3 GUI examples) with a README index. Shipped at the bundle
  root by `tools/make_bundle.py` (a build fails under two flows). `test-flows/` stays the rig/fixtures home; the
  layout gate and the GUI/CLI compile tests walk both. Decision: `decisions/examples-folder.md`.
- **The board story:** the classic-ESP32 custom image is now the advised flash for standard ESP32s (intro of
  `custom-firmware.md`, `installing-micropython.md`); the D1 R32 preselects it (`variant` ->
  `thingstudio-classic-esp32`); both after-flash dialog lines are Connect-first, then Install runtime, with the
  boot-script-only nuance spelled out for the image. Mike's D1 R32 run of tutorial 1 (onboard LED, GPIO 2) is
  recorded in `firmware/classic-esp32/tested.json` under the 14.1.0 hash, and `custom-firmware.md` names the D1
  R32 as the image's second tested board (GPIO flows only, until a GUI flow runs there).
- **FAQ entries:** "Why does compile fail with needs-a-WiFi-network?" (MQTT missing config), "Why do http in
  requests take a second to answer?" (modem-sleep wake, with Mike's measured figures 0.16-1.2 s, warm 0.15-0.20
  s via WireGuard), both linked from the tutorial that meets them. `nodes/change.md` is in the nav.
- "What did you try next, and what happened?" is in the newcomer debrief;
  `outstanding-items.md`'s [TR] entry carries the reshaped progress.

## Uncommitted by instruction (Mike reviews from the live server; commits only on his word)

The working tree holds Mike's remaining review items, none autopushed:

- `editor/src/definitions/boards/wemos-d1-r32.json` -- the `LED: 2` alias (every other board def names its LED;
  the D1 R32's hid it in prose) plus the notes line tying `LED`/`A0`/GPIO 2 together. Tests 54 conformance green.
- The modem-sleep thread: `docs/user-guide/faq.md` (http-in latency entry), the tutorial's VPN/mDNS and
  wake-latency lines, `docs/working-notes/outstanding-items.md` (deferred-modem-sleep evidence + progress), and
  the parked decision `docs/working-notes/decisions/modem-sleep-setting.md` + its `decisions.md` index line.
  Building it would ride the next `ts_wifi`-touching runtime change as a major bump; do not unpark it on your
  own.

## Open threads (next session's easy starts)

1. **Tutorial 3, MQTT** -- publish and subscribe, from tutorial 2's WiFi/broker shape. Open question for Mike:
   which broker a stranger should point at (public test broker vs their own), and whether the `http in` flow's
   config nodes carry over as the brief says. The needs-a-WiFi-network FAQ entry already exists for it.
2. **The "Open example…" affordance** -- how an *installed* copy surfaces `examples/` in the editor (today:
   browse the install folder or the docs' download links; the browser file-dialog shape is the constraint).
   Product idea, Mike's call.
3. **The D1 R32's LED alias** in the working tree: commit on Mike's nod.
4. **A one-off flaky suite run**: one editor test failed once under load (10:21, 2026-11-01), passed on the
   immediate rerun twice. Re-chase only if it reappears; log the name if caught.
5. Tutorial 2's second-board line in `custom-firmware.md` upgrades only when the D1 R32 runs a GUI flow.

## How the docs review loop runs

`/home/mike/ThingStudio/.venv/bin/mkdocs serve --dev-addr 0.0.0.0:8000` (was live at the filing of this note;
bound to the LAN, Mike reads it at `http://192.168.10.216:8000/`). Mike edits against the served pages as they
change; edits stay uncommitted until he says. For a from-scratch rebuild: `pkill -f mkdocs` (careful: don't match
your own shell), `rm -rf site`, `.venv/bin/mkdocs build`, then relaunch `mkdocs serve` in the background.

## Environment facts (this box, verified 2026-11-01)

- **Branch:** `docs/context-diet`, pushed to origin tip `8eb1783`; merge to `main` is Mike's call, as before.
- **Git identity:** still not configured repo-wide -- commit per-invocation:
  `git -c user.name='Michael Karliner' -c user.email='mike@karliner.net'`. sudo is Mike-only.
- **Node/npm:** Node 22.23.4 user-local in `~/.local/bin` (shadows apt's Node 20; open shells may need
  `hash -r`). In `editor/`: `npm ci --ignore-scripts` (a plain install fails); lockfile untouched. The CLI
  rebuilt fine: `cd editor && npm run build:cli` -> `dist-cli/thingstudio-compile.mjs`; board ids like
  `--board board:wemos-d1-r32` select targets. Suites: editor **1300 passed / 2 skipped** (114 files) at final
  run; backend untouched this session (`make backend` recipe stands).
- **Docs toolchain:** `.venv` in the repo root carries mkdocs 1.6.1 + Material; the build is
  `.venv/bin/mkdocs build`; the llms hook runs clean; the only standing build notice in the log is Material's
  MkDocs-2.0 banner. `nodes/change.md`'s no-nav warning is fixed.
- **MicroPython toolchain:** NOT rebuilt this session. The unix-port/`mpy-cross` build recipe in
  `device-runtime/test/README.md` was last built 2026-10-31 in `/tmp/opencode/mpy-src/` (commit `321fba0d16`,
  mpy v6.3); rebuild from the recipe if the device suite is needed.
- **Boards/serial:** this box has no direct board access. Mike's D1 R32 is on WiFi and reachable only through
  his WireGuard tunnel (`http://10.226.212.174:9999/toggle`); mDNS/`.local` does not resolve across it, and even
  on his LAN the scanned subnet is `192.168.10.x` with the board elsewhere -- assume you cannot hit the board
  from here without Mike's help.
- **Curl-timing pattern** that drove the latency finding (runs from a box the board can reach):
  `curl -s -o /dev/null -w "connect=%{time_connect}s ttfb=%{time_starttransfer}s total=%{time_total}s\r\n"`
  per request, slow rows with sleeps, then a rapid volley.
