# Outstanding items — working-notes backlog

Status: index, restructured 2026-08-22 from the 2026-08-19 consolidated map
(`working-notes-consolidation-briefing.md`). **This restructuring only changed shape, not content or status** — it
did not re-audit anything against `git log` or re-verify what's landed. Each item below is a 1-2 line pointer; the
full reasoning for any item with more than that lives in `outstanding-items/<slug>.md`. Read this file plus
`docs/thingstudio-design-doc.md` to get an accurate picture of what's open across the whole project without opening
every file in `docs/working-notes/`.

Originally compiled by auditing every file in `docs/working-notes/` (including `validation/mvp-validation-plan.md`)
against its own stated success criteria/stop conditions, cross-checked against `git log` and against
`docs/thingstudio-design-doc.md`'s own resolved/open sections. Where a file's resolution status couldn't be
confirmed with confidence, it was flagged as open rather than guessed closed — see "Flagged as ambiguous" at the
bottom. That audit is not redone here; item status reflects the 2026-08-19/2026-08-21 audit plus whatever's noted
inline, not a fresh check.

**2026-09-06 pass:** re-checked every active item's own status (not a full re-audit against `git log`) and moved six items that were already marked implemented-and-verified, or already resolved as a decision, out of the active sections into the new "Resolved" section near the bottom — nothing deleted, just compressed to a pointer so this file stays quick to read. Everything else here is untouched.

**2026-09-06 priority pass, complete:** Mike triaged every active item below, one at a time, item by item -- each tagged inline with **[P1]**-**[P5]** (1 = highest), **[POST-MVP]** (explicitly deferred until after MVP), **[TRACKING]** (a rollup pointer, not independently prioritized), folded into another item, moved to "Resolved" (confirmed done/verified during the pass), or deleted outright on his call. The four untagged bullets under "Next up" are meta pointers (a handoff-doc link, two already-fully-closed items) rather than open work, deliberately left out of the pass.

## Next up (already flagged before this audit, unstarted)

- **Prior handoff doc: `framebuffer-st7789-display-briefing.md`.** Written 2026-09-17 as a scoping-only
  briefing for a new display node, prompted by the eswitch/ebutton real-hardware session on the EMF 2022
  TiDAL badge. Superseded the same day, after Mike corrected the badge's actual firmware (stock
  MicroPython, not TiDAL-Firmware) and widened scope beyond just the TiDAL/ST7789 case ("there are many
  other boards") -- the briefing's own two-layer architecture recommendation (built-in
  `framebuf.FrameBuffer` plus a vendored pure-Python push driver) held up, but the node shape converged
  on two bus-family node types (`display_spi`/`display_i2c`), not one `display_st7789`-shaped node. See
  "Resolved" below for what actually got built.
- **Prior handoff doc: `wifi-gate-and-protocol-fix-briefing.md`.** Written 2026-09-14, supersedes
  `credential-store-implementation-briefing.md` below as the live "what's next" pointer -- covers
  WiFi-provisioning real-hardware hardening, the new `thingstudio/wifi_gate` node built end-to-end
  and real-hardware smoke-tested, and a real DEPLOY-encoding protocol bug found and fixed along the
  way (unrelated to `wifi_gate` itself). One open thread it carried forward from the prior handoff,
  the eswitch/ebutton scratch note sitting in `mikes-questions-and-points.md`'s "## Nodes" section --
  **resolved 2026-09-17**, folded into the now-built eswitch/ebutton item (see "Resolved" below) and
  removed from that file.
- **Prior handoff doc: `credential-store-implementation-briefing.md`.** Written 2026-09-14 after the
  WiFi/MQTT-broker credential-store feature (Mike's own fresh ask, not drawn from this backlog) landed and
  was committed (`712cded`), plus four rounds of UX fixes from Mike's own hands-on browser testing the same
  day -- opens with what landed, flags one tension worth a quick check-in (an auto-save fix cut against Mike's
  own standing "close is just to escape without saving" note; he removed that note from
  `mikes-questions-and-points.md` mid-session, read as tacit acceptance but not explicitly confirmed), then the
  usual open-threads/next-candidates sections. Real `pytest`/`vitest` runs not yet confirmed -- still open.
  Also flags a new scratchpad note (Button/Switch/ADC nodes) that duplicates the already-tracked
  eswitch/ebutton item below. Supersedes
  `palette-ordering-and-multi-panes-landed-briefing.md` as the live "what's next" pointer -- that briefing's own
  work (palette ordering, multiple panes) was already fully closed with nothing left open; this session's work
  was unrelated to it. Everything that briefing carried forward as still-open (inject-click-opens-property-sheet
  bug -- since resolved 2026-09-13, see "Resolved" below; `CLAUDE.md` msg/payload convention; router/switch
  node; TCP send/listen-receive; node-flow-execution docs; deploy-runtime-from-editor) is untouched by today's
  session -- still open, tracked in this file's own backlog rather than re-listed here.
- **MQTT real-hardware validation + network follow-ups (in progress, mostly closed).** **Mike's direct request, top priority (2026-08-22).** `http_request`'s config-node migration, canvas migration, Problem 2a's loud-error extension, and its real-hardware GET/POST pass (ESP32, 2026-09-06) are all done and committed (`43f4eec`, `5956a1b`). The wifi_status-vs-mqtt_as ordering-race fix passed real-hardware verification on RP2040 but failed retest on ESP32 (2026-09-05) -- narrowed, not eliminated; **resolved 2026-09-06 as an accepted, documented limitation (Mike's call, not a further fix) -- see the "Resolved" section below.** Current briefing: `http-request-canvas-and-network-followups-briefing.md` (supersedes `wifi-race-fix-verification-and-network-followups-briefing.md`, itself superseding `mqtt-hardware-validation-and-network-followups-briefing.md`) -- fully overtaken by events above; nothing left in this item's own scope needs a next session. ([detail](outstanding-items/mqtt-hardware-validation.md))
- **Sequencing override set by Mike, 2026-08-20 — fully closed 2026-09-06.** Custom node authoring + docs done 2026-08-20; the narrow docs-only validation session run by Mike 2026-09-06, clean pass (docs sufficient, no gaps); normal backlog order now resumes. ([detail](outstanding-items/sequencing-override.md))
- **[P5]** **RP2350 (Pico 2 / Pico 2 W) bring-up — in progress, wiring deferred.** Follow-up to the RP2040 bring-up session. **2026-09-06 (plain Pico 2, non-W): MicroPython flash + runtime deploy + boot-to-HELLO confirmed working.** Functional interrupt-flow pass and the memcheck RAM comparison against RP2040's ~209KB-free baseline deferred by Mike until he has time to wire the button. ([detail](outstanding-items/rp2350-bringup.md))

## Launch MVP (added 2026-10-05)

Product work the launch plan made launch-critical. Order, spec and reasoning:
`launch-mvp-scope-briefing.md`; decisions: `decisions/launch-scope.md`. Tagged **[LAUNCH]** (a gate for the
one public launch) or **[LAUNCH-NICE]** (helps the launch, not a gate); Mike hasn't P-ranked these yet.
Marketing-only work (copy, channels, video, community) is tracked in the ThingStudioMarketing repo,
not here.

- **[LAUNCH]** **GUI templating system, built properly.** Container/constraint layout (flexbox / X
  Intrinsics), GUI view, `screens` section, unknown/stale value states; widgets limited to label, value,
  button, status. Supersedes the `[POST-MVP]` templating item under "Network / config nodes".
  Design: `decisions/gui-layout.md`, `gui-layout-widget-system-scoping.md`.
- **[LAUNCH]** **Freenove FNK0104S board support -- built 2026-10-08, hardware checks owed.** Board
  definition `freenove-s3-4in`, ST7796 in `display_spi`, full colour, landscape; install docs name the
  `SPIRAM_OCT` S3 build. Replaces the FNK0104B (2026-10-09, `decisions/launch-scope.md`); ILI9341 is no longer
  launch work. Hardware-checked 2026-10-10 with `test-flows/gui-orientation-test-freenove-s3-4in.flow.json`: touch lands right at 90, 180 and 270, and
  the press highlight holds and releases (hold, slide off). Orientation 0 is the unturned picture the earlier hero/touch flows already used.
  `st7796py`'s README updated 2026-10-10 (confirmed on Mike's panel only).
- **[LAUNCH]** **CYD gate for custom firmware images.** Run the gate in `decisions/gui-layout.md` (2026-10-09)
  on a classic CYD. Pass: custom images are post-MVP. Fail: build a small set of custom images (classic ESP32
  first) with the packaging, hosting and flashing-docs work that brings. `frozen-firmware-spike-briefing.md`.
- **[LAUNCH]** **Button rework -- built and hardware-checked 2026-10-09.** Two-faced nodes in the compiler;
  button output, modes and controlled toggle; modal close reason; touch panel config node (with presets) polled by
  the gui screen; `gui_touch` removed (`decisions/gui-layout.md` 2026-10-09, `gui-button-rework-briefing.md`).
  Mike checked on the FNK0104S: the plug toggle (confirm and 5 s revert), release-outside, navigate, equal rows,
  text confirming a toggle. Still owed: the touch panel's landscape axes (from the earlier review) and a
  rotation control (display rotation, screen size and touch axes are three separate settings and nothing links
  them; a "rotate 0/90/180/270" choice would set all three). Not done: the GUI view's button properties;
  GT911/CST820 panel controllers.
- **[LAUNCH-NICE]** **Palette: one colour per group.** Per `decisions/gui-layout.md` 2026-10-09: recolour every
  kind in `palette.ts` by group, `ebutton`/`eswitch` as "gpio button"/"gpio switch". (Done: the GUI labels have no
  `gui` prefix and the group is "GUI".) Retake the annotated editor screenshots in the user docs afterwards.
- **[LAUNCH]** **`touch_i2c` node (FT6336U first).** Event source; design for the GT911/FT6236/CST820
  family. `touch-input-briefing.md`. `touch_spi` (classic CYD) can follow.
- **[LAUNCH]** **Headliner (showreel) flow and task guide** -- the flow is built
  (`test-flows/gui-headliner-sensor-freenove-s3-4in.flow.json`): BME280 readouts, trends and MQTT publish are all
  hardware-checked 2026-10-10. A clock page (third page, `clock` node + seven-segment label) was added 2026-10-10 and is
  hardware-checked 2026-10-10 (NTP sync, summer time, `ntptime` present on the S3). The task guide is written (`docs/user-guide/sensor-display.md`, 2026-10-10).
- **[LAUNCH]** **External controls example flow (split from the headliner, Mike 2026-10-10).** **Moved to the end of the MVP queue (Mike, 2026-10-10).** A Tasmota plug or WLED
  strip: its state subscribed and shown, an on-screen toggle over MQTT, unknown/stale values, WiFi pulled changes the
  screen. Carries the launch acceptance for touch, MQTT both ways and unknown/stale on hardware. Mike chooses the
  device. Not built.
- **[LAUNCH]** **Trend (moving histogram) widget and `journal` node -- built and hardware-checked 2026-10-10, after being
  decided 2026-10-07 and untracked until then.** Built: see `decisions/gui-layout.md` (2026-10-10). Still open: memory on the Pico/CYD; a `series` port type, autoscale. Original note: Mike asked for an rrdtool/Cacti-style live histogram, and the headliner flow wants one beside the
  temperature number (it currently has only a plain `gui_bar`, copied from the hero flow). Decisions are in
  `decisions/gui-layout.md` (2026-10-07) and scoping in `gui-layout-widget-system-scoping.md`: one `journal` node per
  time scale, cascaded; the trend widget is a pure view of one journal; unknown is a gap. Open: how a series crosses
  the msg. Suggested (2026-10-10, not decided): a list payload, so the same widget also draws any array (a
  spectrum from a function node), the journal being just one producer. First version: one journal (fixed step, ring,
  gaps) and one widget (min-max bars with the average marked); cascading and the message format settled with Mike
  first. Memory-bounded: check the Pico and CYD.
- **[LAUNCH]** **Memory-gate example flows on the common boards (Mike, 2026-10-09).** **Moved to the end of the MVP queue (Mike, 2026-10-10).** Besides the headliner (S3,
  PSRAM), define a few more examples that run on the most common boards: **RP2040/RP2350 (Pico W, Pico 2 W)** and
  **classic ESP32 (the CYD, no PSRAM)**. Their job is to find the memory limits: if these work, memory is not an
  issue until after the MVP. Candidates: classic ESP32 -- the GUI hero (readouts, MQTT, strips) on the CYD, display
  only until `touch_spi` exists; Pico W -- a small mono OLED GUI (`display_i2c`, gs1) with MQTT readouts and a GPIO
  button; both with WiFi and MQTT up, as a real flow would. Each runs for a while and records free heap before and
  after deploy and at steady state; what breaks feeds the board memory budget the compiler should check
  (`decisions/gui-layout.md`, 2026-10-06 Pico constraint). Not scoped further yet.
- **[LAUNCH]** **Newcomer test with a target-group tester** (a maker who knows MicroPython). Re-runs the
  `road-to-mvp.md` acceptance test after the docs restructure.
- **[RESOLVED 2026-10-10]** **Pico W WiFi-password bug** -- Mike has confirmed on hardware (at least twice) that it is fixed.
- **[LAUNCH]** **Headless compile/validate.** CLI first (existing TS compiler under Node); a backend move is
  its own design call. Needed for AI authoring.
- **[LAUNCH]** **User-facing AI-authoring doc,** tested by a fresh agent session against a set task. Where
  it lives (workspace `AGENTS.md`, docs page + `llms.txt`, skill) is open.
- **[LAUNCH-NICE]** **Download the generated Python** (viewing already works).
- **[LAUNCH-NICE]** **Landing page and README rewrite: technical side.** Content comes from the
  ThingStudioMarketing repo; hosting, GoatCounter on the page, and a docs/README note saying GoatCounter is used
  and what it counts.
- **[LAUNCH-NICE]** **WS2812 node, speaker/tone node, analog-input node.**
- **Repo-root `AGENTS.md` is empty (0 lines)** although `CLAUDE.md` imports it with `@AGENTS.md`. Fill it or
  drop the import. Found 2026-10-05.

## Boards / definitions

- **[P2]** **ESP32-C6 (and H2, P4...) detected as a classic ESP32 -- new bug, 2026-09-30.** Found by a test for the
  Pins… page. `target.ts`'s processor match is a substring test on the normalized MCU name, and
  `processors/esp32.json` matches "ESP32", so a board reporting "... with ESP32C6" resolves to the classic ESP32:
  its pin checks and its native arch (`xtensawin`, where the C6 is RISC-V) both apply. Not an MVP chip, but it
  fails silently rather than saying "unknown processor". Fix: stop "ESP32" matching when a letter-variant
  suffix follows (S2/S3/C3/C6/H2/P4), or match exact names per processor; either way an unknown ESP32 variant
  should resolve to no processor, which the Pins… page and the console already explain.

- **[P3]** **Board header data for the LOLIN S2 Mini and the CYD -- new item, 2026-09-30.** The Pins… page shows
  physical pins from a board's `header` (Pico family done, from Raspberry Pi's own pinouts). The S2 Mini's
  maker prints labels but no pin numbers, so it needs a position scheme (e.g. by row and place) agreed first; the
  CYD's P1/P3/CN1 connectors vary between units and are community-documented. Only add either from a source
  checked against a real board: a wrong header is worse than none.
- **[P3]** **Seeded copies of built-in definitions hide later updates -- noted 2026-09-30.** The backend copies
  built-in board/processor files into `~/.thingstudio` once, and a user copy always wins
  (`builtin_reference.py`'s documented cost). So the Pico `header` added 2026-09-30 doesn't reach anyone who
  already ran Thingstudio until they delete `boards/pico*.json` and restart. The console does say the file
  "replaces the built-in" once the content differs. A fix: remember what was copied (a hash), and refresh a copy
  the user never edited.

## Network / config nodes

- **Board forgets its WiFi-transport password on a power cycle -- new bug, 2026-09-27 (Mike, Pico W).** Password
  set over USB (Board settings…), WiFi connect worked; after unplugging and replugging, the board reported no
  password set and needed setting again over USB. `board_settings._save()` is the only writer of `/_board.json`
  (temp file + `os.rename`), and nothing deletes it (Remove flow / Install runtime / recovery don't touch it).
  Next: over USB, read `/_board.json` before and after a power cycle (console box:
  `import os; print(os.listdir('/')); print(open('/_board.json').read())`) to tell "not reaching flash" from
  "read back wrong at boot"; check boot output for `BOARD_SETTINGS_ERR`. Seen while testing packaging, not
  caused by it.
  **2026-09-30: not reproduced.** Same Pico W: `/_board.json` held salt + key (hostname `ts-3c0c31`) before a
  power cycle, and a WiFi connect with the password worked after it, so the key survived. Code review found no
  path that loses it: `_save()` closes the temp file before `os.rename` (fine on littlefs), nothing on the board
  or backend deletes or rewrites the file except "Board settings…" Save, and the editor's "no password" comes only
  from HELLO's `authRequired`. One quirk noted, not the cause here: `listener.py` imports `board_settings` and
  `net_transport` in one `try`, so a failed `net_transport` import also drops `board_settings` -- but that shows
  as `hostname: null` ("old runtime"), not "no password". If it comes back: run the command above before and
  after the power cycle, and keep the first console lines after reconnecting.

- **[P4]** **Suspected: `mqtt_publish`/`mqtt_subscribe` sharing one broker client have no publish-after-subscribe-confirmed ordering guarantee at flow boot -- likely (co-)cause of a real silent-failure hardware test, 2026-09-02, unconfirmed pending a targeted fix+retest.** ([detail](outstanding-items/mqtt-pubsub-boot-race.md))
- **[P4]** **MQTTS (MQTT over TLS) — not built, deferred on Mike's explicit call (2026-08-21).** Vendored `mqtt_as`'s `config` dict already has unused `ssl`/`ssl_params` keys; checked against the one-way-door principle before deferring — a config's `properties` is a plain JSON blob, so this isn't a one-way door. Nothing reserved. ([detail](outstanding-items/mqtts-tls-deferred.md))
- **[POST-MVP]** **TCP send / TCP listen-receive — never built; deferred past MVP (Mike, 2026-09-26).** `udp-tcp-nodes-implementation-briefing.md` scoped four node types; only UDP send/receive landed. TCP send needs a lazy-expiry connection cache; TCP listen-receive needs a callback-to-coroutine bridge design. Tracked in `mvp-feature-priorities.md` Tier 1 item 5 point 3. ([detail](outstanding-items/tcp-send-listen-receive.md))
- **[P3]** **I2C/SPI sensor nodes — BME280/BMP280 built 2026-09-26** (on Pico hardware; TCS34725/MPU-9250 go through the generic `i2c` node until a tutorial needs a dedicated one). Was: not started at all. Tier 1 item 3, gated on having actual sensor hardware on hand. Also carries an unresolved fault-handling question (stuck I2C device hang) Mike flagged 2026-08-16, and gates on the I2C/SPI slave-mode witness-rig spike. ([detail](outstanding-items/i2c-spi-sensor-nodes.md))
- **[TRACKING]** **Network nodes' real hardware pass — partially closed.** UDP send/receive: real hardware pass done (echo-tester flow). `http_request`: real hardware pass done 2026-09-06 (ESP32, GET+POST). `wifi_status`: real hardware pass done 2026-09-10 (completeness fields + emit-on-change behavior confirmed). `mqtt_publish`/`mqtt_subscribe`: first real hardware pass 2026-08-21 surfaced the WiFi reconnect-race bug; fix needs a second pass to confirm it holds. ([detail](outstanding-items/network-hardware-pass-status.md))
- **[POST-MVP]** **Whether to file an upstream issue for the `mqtt_as` WiFi-reconnect race — undecided, Mike's call.** Real bug confirmed against current `master` of peterhinch/micropython-mqtt, but the same class of fix has been raised before (#59, #61, #57) without landing — which is exactly why Thingstudio fixed it locally instead. ([detail](outstanding-items/mqtt-upstream-issue-decision.md))
- **[P3]** **Filter / event-compression node — built 2026-09-26** (`filter-node-spec.md`; off-device tests only, not yet on hardware). Tier 1 item 5 point 2, pulled into v1 alongside interrupt/pin-change but never implemented until then. Buildable with zero new compiler capability (reuses `timer.ts`'s per-instance state pattern) — just not done yet. **2026-09-08, Mike's call: deferred until the eswitch/ebutton nodes land** (Network / config nodes section, above) -- picked over this when choosing the next priority item. ([detail](outstanding-items/filter-event-compression-node.md))
- **`udp_send`'s `timeout` property and `udp_receive`'s `poll interval` property — answered 2026-09-06, both real and load-bearing.** `udp_send`'s `timeoutMs` bounds the `sendto()` `EAGAIN`-retry loop (rare but real full-send-buffer case), per CLAUDE.md's bound-every-network-call rule. `udp_receive`'s `pollMs` is the actual polling cadence of a non-blocking-socket workaround for a real MicroPython `asyncio` gap (no datagram-await primitive on any port -- micropython/micropython#13382) -- a genuine responsiveness-vs-CPU trade-off, not cosmetic, though its 20ms default is still unvalidated against real back-to-back hardware traffic (tracked under the network-hardware-pass item). No code change needed, just documentation the question was answered.

- **[P3]** **Config-node Functor/Singleton pattern — new item, 2026-09-08 (Mike's ask).** Investigate using the Functor/Singleton pattern (peterhinch/micropython-samples' `functor_singleton`) for WiFi config and other global config-node objects: the first node instantiated for a given config is the real one; further nodes referencing the same config get the existing instance instead of creating a new one. Resolves multiple nodes accessing/mutating the same config item with low/no code. **GPIO/ADC and other hardware config nodes being singletons (no palette presence) is the concrete motivating example, folded into this same item** — also handles pin-conflict-by-construction for config nodes specifically (distinct from the broader [P5] pin/resource-conflict-detection item above, which covers cross-node-type conflicts more generally). **2026-09-25: editor side done for WiFi** (`decisions/config-nodes-tier1-scope.md`) -- the generic
  `singleton` flag on a config type. GPIO needs a *keyed* singleton (one instance per pin), which the flag doesn't
  cover yet, and the device-side half (generated code sharing one runtime object, e.g. `Pin(5)`) isn't started.
  **2026-09-26: both halves exist, used by the I2C bus.** Editor: `keyField` on a config type (one config per
  key). Device: `runtime.shared(kind, key, signature, factory)`, Hinch's pattern keyed, with a mismatched
  signature raising and the table cleared on redeploy (`decisions/config-nodes-tier1-scope.md`). GPIO pins are
  the obvious next user.
- **[P4]** **AADC (Peter Hinch's §5 ADC-monitoring driver) node — deferred follow-up, 2026-09-17.** Split off from the eswitch/ebutton item below (now resolved) when eswitch/ebutton were built -- scoped out of that pass on Mike's call rather than bundled in, per [DRIVERS.md §5](https://github.com/peterhinch/micropython-async/blob/master/v3/docs/DRIVERS.md). Not started. His DRIVERS.md collection more broadly stays a candidate source for further nodes later, not scoped now.
- **[P4]** **Remove the `interrupt` node's debounce option — new item, 2026-09-17, side effect of eswitch/ebutton landing.** `eswitch`/`ebutton` now own debounce for the switch/button use case (`ESwitch.debounce_ms`/`EButton.debounce_ms`), so `interrupt`'s own separate debounce-cooldown option (`interrupt.ts`) is redundant for that use case -- but `interrupt` is still the only source node for a raw, non-debounced pin-change event, so this isn't a clean "always remove," and removing a property is a breaking change to any already-saved flow using it. Flagged for Mike's call, not removed here.
- **[P4]** **`interrupt` node still has no way to enable an internal pull resistor -- new item, 2026-09-17.** `eswitch`/`ebutton` just picked up a `pull` (none/up/down) property, prompted by a real EMF 2022 TiDAL badge test needing the chip's own internal pull-up on most of its buttons; `interrupt` has the identical "no internal pull, wire an external one" limitation and wasn't touched in that pass (scoped to the button test at hand). Same shape of fix if picked up: a `pull` property, default "none", threaded into `machine.Pin(pin, machine.Pin.IN, ...)`. ([detail](decisions/node-authoring.md))
- **[SUPERSEDED 2026-10-05 → Launch MVP: GUI templating system]** **Templating UI nodes for displays — new item, 2026-09-08, split from the SSD1306 ask.** Generic way to template/lay out what gets drawn to a display node -- LVGL (or similar) was floated 2026-09-17 as the likely shape ("the more generic the actual graphics interface is the better"), sitting in front of the now-built `display_spi`/`display_i2c` nodes rather than replacing them; those nodes' full-frame-only `bytes` input was deliberately kept graphics-framework-agnostic with this in mind, but nothing LVGL-specific is built. Not scoped, expected to be hard (Mike's characterization).
- **`display_spi`/framebuffer construction can blow the classic-ESP32 heap for a full-resolution
  RGB565 frame — new item, 2026-09-18, scoped (not built) per Mike's ask.** A full 240x320 RGB565
  frame is 153,600 bytes, which the CYD bring-up session hit as a hard `MemoryError` on a classic
  ESP32 (`learnings/hardware-bringup-hil-rig.md`) -- worked around there only by building/pushing the
  frame one strip at a time, not by any node-level fix. Mike's own suggested shape: build the frame in
  a lower bit depth (a 4-bit/16-color indexed buffer, a quarter the memory), expanding each pixel to
  real RGB565 only at blit time -- since corroborated by a real-world GS4-framebuffer UI driver Mike
  found, with concrete numbers (<100ms/frame at 240x320 using `@micropython.viper`, no SPIRAM needed,
  ~11-color Material-inspired palette). Scoped in
  `outstanding-items/display-spi-framebuffer-memory.md`, including the real memory math and the
  corroborating reference. **Architectural fork resolved 2026-09-18** (`decisions/node-authoring.md`):
  option 1 (real `frameFormat`/`palette` properties, `display_spi` does the expansion internally),
  extended to four depths (rgb565/gs4/gs2/mono) at Mike's own ask, palette-driven throughout. A
  standalone off-device spike the same day confirmed `@micropython.viper` works for the expansion loop
  and is far faster than plain Python (`learnings/micropython-device-runtime.md`), though real-hardware
  timing is still unmeasured. **`gs4` built the same day** (`display-spi.ts`/`nodes.ts`/
  `PropertyPanel.vue`/tests/user-guide doc), including a real odd-width stride bug found and fixed
  before landing. **Verified the same day** by a real `tsc --noEmit` (clean) and `vitest run`
  (`node-display-spi.test.ts` 27/27) against an isolated extraction, per `CLAUDE.md`'s fallback --
  caught 4 real strict-null errors and a `device_commit_files` push that had silently not landed on
  the device (fixed, re-verified on-device). **A real-hardware test flow now exists**
  (`test-flows/display-spi-gs4-cyd-test.flow.json`, CYD's full native 240x320 resolution, the actual
  `MemoryError` case), verified via `verify-flow-file.ts` and a `compile()` dry run (confirms the
  38,400-byte gs4 frame, correct MADCTL/inversion, the corrected expansion function). **Three real,
  unrelated bugs found and fixed on the road to a first real deploy, none of them gs4/viper bugs**:
  (1) board needed a first-time `deploy_runtime.py` bootstrap; (2) the editor's own `mpy-cross` WASM
  Deploy pipeline never passed `-march`, breaking on the first-ever real `@micropython.viper` compile
  (fixed: `-march=xtensawin`); (3) this CYD's specific SPI pins can't sustain the node's 40MHz default
  baudrate -- silently invalid SPI device handle, then a real hard crash (`Guru Meditation Error`,
  boot loop) on the first transaction, root-caused via a standalone step-by-step probe script
  (`test-flows/cyd-display-spi-init-probe.py`) and fixed by pinning the flow's own `baudrate: 27000000`
  (matching every prior CYD script). All three logged: `learnings/hardware-bringup-hil-rig.md`,
  `learnings/editor-build-tooling.md`, `decisions/node-authoring.md`. **Confirmed rendering correctly
  on real CYD hardware, 2026-09-18** -- first with `@micropython.viper` temporarily disabled
  (`GS4_DIAGNOSTIC_PLAIN_PYTHON`, a diagnostic-only flag added mid-incident to rule viper in/out of the
  boot-loop crash above; it wasn't the cause -- see `decisions/node-authoring.md`), confirmed correct,
  then the flag reverted and the same flow redeployed with real viper back on: **also confirmed
  rendering correctly** ("seems to work fine" -- Mike). This is this project's first-ever real-hardware
  execution of `@micropython.viper`-compiled code on Xtensa, and closes out the whole gs4 memory-
  reduction feature end to end: built, statically verified, and now confirmed live on the actual
  hardware it was built for. `test-flows/display-spi-gs4-cyd-animation.flow.json` (added same day)
  drives the same gs4 pipeline continuously via `thingstudio/timer` (1ms interval, i.e. display-bound)
  instead of one manual inject click, as a rough visual/refresh-rate demo -- not a timing measurement
  (no on-device instrumentation), just confirms the loop holds up under continuous redraw. Its first
  version had a real bug of its own (reallocating the gs4 framebuffer every tick fragmented the heap
  into a `MemoryError` within about a second, even after a power cycle) -- fixed by reusing a
  `context`-persisted buffer instead of reallocating per frame, and **confirmed rendering correctly,
  continuously, on real hardware** after the fix (`learnings/hardware-bringup-hil-rig.md`).
  **`gs2`/`mono` (the two remaining decided depths) built the same day** (`display-spi.ts`/`nodes.ts`/
  `PropertyPanel.vue`/user-guide doc/tests) -- a real design/correctness finding surfaced doing this:
  gs4's own bit-packing order (high-to-low within a byte) does NOT generalize to gs2/mono (both
  low-to-high, the opposite of gs4 and, for mono specifically, the opposite of its similarly-named
  `MONO_HLSB` sibling too), confirmed by reading MicroPython's real `extmod/modframebuf.c` per-format
  setpixel/getpixel source directly rather than assumed by analogy -- each format's expansion loop was
  written and independently verified against its own source. Verified by `tsc --noEmit` (clean) and
  `vitest run` (37/37 `node-display-spi.test.ts`, 531/540 full suite, remaining failures confirmed
  pre-existing/environmental). Two new real-hardware test flows written
  (`test-flows/display-spi-gs2-cyd-test.flow.json`, `display-spi-mono-cyd-test.flow.json`, same CYD
  config as gs4's), and **both confirmed working on real CYD hardware, 2026-09-18** -- all three
  indexed depths (`gs4`, `gs2`, `mono`) are now confirmed working on real silicon, not just off-device.
  A TiDAL companion flow (this project's only real odd-width panel) would separately cover the
  stride-fix correctness case on real hardware, not written yet, for any depth.
- **[POST-MVP]** **Preset dropdown for known-working `display_spi` panel configs — new item,
  2026-09-18, Mike's ask.** A picklist of named, known-good presets (e.g. "TiDAL badge", "CYD
  2-USB") that fill in the raw property values, while still allowing a fully manual/roll-your-own
  entry for an unlisted panel. Unblocked as of 2026-09-18 -- the underlying `colorOrder`/
  `invertColors`/`dataLatchOrder`/`rotation` properties now exist (`decisions/node-authoring.md`'s
  same-day entry) -- but the dropdown itself is still not built, and still explicitly deferred past
  MVP.
- **[P4]** **`test-flows/deploy_runtime.py`'s `VENDOR_FILES` list doesn't scale past a handful of display controllers -- new item, 2026-09-17.** **2026-10-07: scoped as "flow dependencies" (Mike's name), `flow-dependencies-scoping.md`; decisions in `decisions/flow-dependencies.md`. Built the same day on the `flow-dependencies` branch (runtime 7.0.0), tested off-device only. Confirmed on hardware the same day: Pico W (MQTT, then library removal), CYD/ESP32 upgraded from 6.0.0 (old root copies gone, MQTT flow). Still owed: a display flow.** That list is pushed unconditionally to every board on every bootstrap, not scoped per-flow (confirmed by reading `deploy_runtime.py` directly, not assumed) -- fine for two display drivers (~8.4KB/~4.9KB source, next to `mqtt_as`'s own ~36KB already there unconditionally), but a real cost on every board's flash regardless of whether that board has a display at all once more controllers are added (`display_spi`/`display_i2c`'s own `controller` property is deliberately open for exactly that growth -- ILI9341/GC9A01/SH1106/etc.). Flagged to Mike mid-session; his call was "proceed with the simpler one and track the scaling" -- build `st7789py`/`ssd1306` the normal unconditional-push way now (done, see "Resolved" below), track this as the point where a selective/opt-in vendor push (only pushing a display driver to a board whose flow actually uses a display node) needs building, before a third or fourth controller lands the same way. Not scoped. **2026-10-06: now a prerequisite for GUI work** -- the Pico constraint in `decisions/gui-layout.md` (flows without a GUI must not pay flash for GUI code, widgets or fonts) depends on it; phase 1 of `gui-layout-widget-system-scoping.md`'s phasing. Priority bump is Mike's call.
- **[POST-MVP]** **Threading / multicore support, possibly an Exec node — new item, 2026-09-08.** Not scoped.

## Redeploy / runtime

- **[P3]** **machine.reset() before each deploy, for a known-clean device state -- raised by Mike, 2026-09-04, not scoped.** +3s deploy time, likely worth it (Mike's own call). Real candidate to supersede the conditional-teardown approach below rather than complement it -- a full reset gets the same clean-slate effect the "a power cycle fixed it" finding already confirmed, without needing to reason about which redeploys are safe to skip teardown for. Not a one-liner: DEPLOY already persists bytecode to flash, but inserting a reset mid-handshake breaks the current single-connection DEPLOY/DEPLOY_ACK exchange -- needs boot-time auto-resume plus host-tooling changes to tolerate the device dropping off during reset. ([detail](outstanding-items/reset-before-deploy.md))
- **[POST-MVP]** **WLAN interface state isn't torn down on redeploy -- stray native WiFi driver noise/activity can outlive the flow that started it.** Raised by Mike 2026-09-04: a flow with no wifi-touching node at all (`inject` -> `debug` only) produced a raw ESP-IDF log line (`E (...) wifi:sta is connecting, cannot set config`) on real hardware. Ruled out the current flow's own generated code (grep-confirmed: only `wifi_status`/`http_request`/`udp_send`/`udp_receive`/mqtt ever emit `import network` or touch `network.WLAN`). Most likely cause: leftover native driver state from an earlier wifi/mqtt flow deployed the same power cycle -- same root cause `redeploy-cleanup-and-network-fault-detection-briefing.md`'s "Problem 2b" already found (ESP-IDF persists STA credentials in NVS, reconnects on `.active(True)` alone, independent of whatever Python code is running), but that briefing's fix (mandatory `wifiConfigId`) addressed the silently-ambiguous-reading half, not this one -- `cancel_running()`'s cleanup registry only ever covered sockets, never the WLAN interface itself. Confirmed 2026-09-04: a power cycle fixed it, ruling out anything flash-persisted by the flow itself. Fix isn't mechanical: unconditionally deactivating WLAN on every redeploy would defeat `wifiSetupStatement()`'s deliberate "stay connected across a quick redeploy of the same wifi flow" behavior -- needs Mike's sign-off on the conditional version (tear down only when the *new* flow has no wifi-touching node). **2026-09-06, Mike's call when prioritizing:** deferred past MVP -- WiFi driver behavior is a minefield across boards (same reasoning as CLAUDE.md's clear-failure-over-per-board-fixes rule), likely better accepted and documented in a troubleshooting section than chased as a fix. ([detail](outstanding-items/wlan-state-not-torn-down-on-redeploy.md))
- **[P5]** **Pin/resource-conflict detection — never built.** Two nodes claiming the same physical pin in different modes get two independently-correct but conflicting `Pin` objects instead of a compile-time error. Confirmed still open as of the 2026-08-14 GPIO/timer batch. Single-flow-only gap, not just the deferred multi-flow version. ([detail](outstanding-items/pin-resource-conflict-detection.md))
- **[RESOLVED 2026-09-24]** **Board-transport auth — `HELLO`'s `authRequired`/`authScheme` built with the WiFi transport.** WiFi sessions use a nonce/HMAC challenge against a password set over USB; serial stays unauthenticated in v1. ([detail](outstanding-items/board-transport-auth.md))
- **[POST-MVP]** **OTA-capable partition table on the ESP32 build — still not done.** Tier 0 item, flagged repeatedly across multiple later briefings as "still not done." Build-config only, one-way door (every field device would need a manual reflash later otherwise), no code dependency on anything else outstanding. **2026-09-06, Mike's call when prioritizing:** deferred past MVP anyway -- no field devices exist yet and only a handful are expected even post-MVP, so the one-way-door cost (manual reflash of a small number of early devices) is cheap enough to accept rather than build this speculatively now. Worth noting: `CLAUDE.md`'s own premature-optimization corollary cites this exact item as the "don't foreclose a near-free future direction" example -- this is a deliberate, informed override of that framing, not an oversight. ([detail](outstanding-items/ota-partition-table.md))
- **[POST-MVP]** **Flash-backed runtime-state persistence (a `variable_get`/`variable_set` value, a calibration constant surviving redeploy) — not built.** Split out 2026-09-06 from the old "Tier 2" item, which bundled three separate things: the flow's own bytecode surviving power loss (**already built**, boot-time flow auto-resume, 2026-09-05 -- that part of the old item's "not started at all" framing was stale), a full live-value-streaming-on-wires UI (Mike's call: not actually asked for -- the real near-term bar is the connection-status-indicator item below, not generic wire streaming), and this -- the flash-backed, node-ID-keyed state store §5 describes. Deferred past MVP: real design thinking needed (scope, storage format, opt-out-on-deploy semantics), connects to `context-model-node-red-style.md`'s still-unscoped context work. ([detail](outstanding-items/tier2-live-streaming-persistence.md))
- **[POST-MVP]** **Stateful nodes / cross-message synchronization (Node-RED-style `join`) — not started, not even scoped.** Flagged 2026-08-13, still open. Distinct from the (now-resolved) flashing-LED `context`/`flow` gap, which did get built. **2026-09-06, Mike's condition when deferring:** only OK as long as context get/set is interrupt-safe. Checked against `interrupt.ts`'s own header while triaging: by design, the hard-IRQ handler only ever signals a `ThreadSafeEvent` (the one non-allocating, hard-IRQ-safe call its vendored README traces) -- every real decision, including any downstream `variable_get`/`variable_set`/`flow.get`/`flow.set` call, runs in the coroutine (soft context) afterward, on the normal cooperatively-scheduled event loop, same as everything else. So today's architecture already satisfies the condition by construction, not by luck -- worth a confirming real-hardware test once this is picked up, but not an open unknown blocking the defer. ([detail](outstanding-items/stateful-nodes-join.md))
- **[POST-MVP]** **Multi-output-port support (was "connection-state gate/router nodes") — general
  mechanism + function-node UI built 2026-09-12; the pass-or-drop status gate built 2026-09-14; a
  dedicated router node deferred to POST-MVP, 2026-09-14 (Mike's call).** Reframed 2026-09-06, Mike's
  call: generalize past the specific two-output status router into real multi-output-port support,
  Node-RED-style -- function-node UI to set output count, codegen for the return-value/`node.send()`
  array convention (`return [msg1, null]` routes to output 1 only; `null` in a slot sends nothing; a
  nested array in a slot sends multiple messages out that one output in sequence;
  https://nodered.org/docs/user-guide/writing-functions#multiple-outputs), and canvas wiring for N
  output ports on a node -- landed 2026-09-12 with three of Mike's own calls (loose tolerance on a
  malformed return shape, live-value streaming deferred, function node grows taller rather than packing
  ports tighter), `decisions/editor-canvas.md`. Already anticipated: `decisions/node-authoring.md`'s
  2026-08-20 entry deliberately caps custom-node output ports at 1 via *codegen validation*, not the
  `.node.json` schema itself, specifically so this "higher-priority multi-output-routing roadmap item"
  wouldn't be compromised -- confirmed directly with Mike at the time. **2026-09-14, Mike's call: a
  dedicated router/switch node deferred to POST-MVP** -- a `function` node's own multiple outputs plus
  an in-code switch already cover the routing need; only this piece remains open. The pass-or-drop
  WiFi-link status gate (the item's other original narrower ask) is built -- see Resolved below.
  ([detail](outstanding-items/connection-state-gate-router-nodes.md))
- **[P5]** **Tier 1 "kitchen sink" gate — not run.** One combined flow wiring every v1 node type together, soak-run for an extended period, per `mvp-validation-plan.md`'s own Tier-level bar. Needs the rest of Tier 1 (I2C sensors, network hardware pass, remaining canvas wiring) to mean anything. ([detail](outstanding-items/tier1-kitchen-sink-gate.md))

- **[POST-MVP]** **Store the flow definition on the device itself, not just the host file system — raised by Mike, never scoped.** Today a flow's source of truth lives only in the editor's saved `.flow.json`; whether/how a device should also carry its own copy (for backup, inspection, or recovery without the original file) is untouched. Distinct from Tier 2's live-value/state persistence above, which is about runtime data, not the flow definition itself.

## UI / editor

- **[POST-MVP]** **Install MicroPython from the editor -- new item, 2026-10-01, from the first newcomer test.**
  Getting MicroPython onto the board took nearly all of the 27-minute run's coaching; everything after it went
  fine. Docs are restructured (`decisions/documentation-process.md`), but the step is still manual. Post-MVP on
  Mike's call: too many variants. A board in BOOTSEL mode reports only its chip, not which board it is (Pico vs Pico W
  vs third-party RP2040 boards need different `.uf2`s). ESP32 builds vary by PSRAM type and USB mode as well as chip.
  Either way the user would still pick their board, and the editor would need to fetch and track firmware versions.
  Revisit only if later newcomer runs still stall here after the docs fix.

- **[P3]** **Custom node format parity with built-ins -- new item, 2026-09-30.** Built-in nodes are
  TypeScript modules that generate Python; custom nodes are a JSON descriptor plus Python. Built-ins may
  later ship as packages in a folder beside the install (`decisions/node-authoring.md`, 2026-09-30), which
  needs the package format to express what built-ins do today. Gaps: event-driven sources (custom sources
  only poll on `intervalMs`); more than one output port; setup shared between instances (two `gpio_out` on
  one pin share a `Pin`); references to config nodes (WiFi, MQTT broker, I2C bus); pin checks against the
  board definition; presets; `NODE_STATUS` reporting; native-code parts (`display_spi`); vendored runtime
  files. The test of each: could a built-in be rewritten as a package with no loss.

- **[P3]** **Deploy the runtime itself from the browser editor, not just compiled flows.** Confirmed untracked
  anywhere until 2026-09-12. Today, `test-flows/deploy_runtime.py` is a standalone `mpremote`-based script pushing
  `device-runtime/src/*.py` onto a board's filesystem -- a precondition for any flow deploy ever working, and
  genuinely different from the existing `DEPLOY` message (which just writes one bytecode file while the
  already-running listener stays untouched; a runtime deploy has to overwrite the listener's own currently-executing
  source). Needs a real design session before it's buildable -- see the detail file for why this isn't a simple reuse
  of the existing wire protocol, and its tie-in to the device-runtime version-bump discipline in `CLAUDE.md`.
  ([detail](outstanding-items/deploy-runtime-from-editor.md))
- **[P2]** **Context model, Node-RED-style, volatile (in-RAM) scope only — `variable_get`/`variable_set` hidden from the canvas 2026-09-06 (same day they were given canvas presence), replacement not scoped yet.** Mike's call, after walking through the actual use case for the two nodes (decoupling a producer and a consumer on independent triggers, sharing a value by name) and judging the current narrow pair -- store-now/fetch-later, no transform -- not worth keeping visible without a real design behind it. Codegen/registry (`variable-get.ts`/`variable-set.ts`) and the function node's `flow.get`/`flow.set` (same underlying `_flow_vars` store) are unchanged and still fully working; only the two dedicated canvas nodes are gone. Target design: node/flow/global scope, a generic node for setting context rather than one narrow pair -- in-memory only for this item. **2026-09-06, split from persistence:** Mike's call -- keep this scoped to volatile storage pre-MVP; a flash-backed/persistent storage backend for the same context model is deliberately a separate, later item (below, POST-MVP). ([detail](outstanding-items/context-model-node-red-style.md))
- **[P2]** **General architectural slot for node connection-status indicators — reframed 2026-09-08 (Mike's call), not just wifi_status/mqtt-specific. Picked as next priority, 2026-09-09. Design settled and implementation landed 2026-09-10; `tsc`/`vitest` clean (Mike).** New `NODE_STATUS` §13 message type, small fixed state enum, clear-on-redeploy, scoped to `wifi_status`/`mqtt_publish`/`mqtt_subscribe` (http_request still excluded, as originally scoped). Full protocol/editor-rendering/codegen layers built, off-device tested, user-guide docs done. **Real-hardware pass found and fixed two genuine bugs: a rendering bug (`ThingstudioNode.vue` missing the `seed` reactivity prop rete-vue-plugin needs to re-render on `area.update()`) and an mqtt-sharing bug (a node piggybacking on an already-connected broker never reported its own status at all -- `mqttEnsureConnectedSnippet` now diffs each calling node's own last-known state against the client's real `isconnected()` on every call, both directions, fixing this and adding the negative/disconnected status Mike separately asked for).** Dots confirmed working on real hardware for `wifi_status` and `mqtt_subscribe`; the mqtt-sharing fix is off-device-verified only so far. Clarified, not a bug: `mqtt_publish`'s dot stays blank until its first real message (it's a sink, no background task runs before then, unlike the other two node types) -- Mike's call, 2026-09-11, leave as-is (it may have been a downstream artifact of the WiFi-flapping bug below, not independently re-tested since that was fixed). WiFi visibly cycling up/down with mqtt nodes in the flow -- root cause and fix (wifi_status defers connection ownership to mqtt_as entirely when mqtt nodes are present, via its own `deferToMqtt` parameter, not an overload of `security`) in `decisions/redeploy-network.md`'s 2026-09-11 entries -- **real-hardware confirmed working** (Mike: "seems to have fixed it"). Still owed overall: the real MicroPython test suite for the device-runtime/src changes, `vitest` re-run against the updated mqtt/wifi codegen, a hardware check of `mqtt_publish`'s connected/disconnected reporting once it has published at least once, and clear-on-redeploy. ([detail](outstanding-items/node-status-indicators.md))
- **[POST-MVP]** **Drag-to-splice — still not built, still needs Mike's own real-browser call.** Reclassified to "should eventually match Node-RED" priority (2026-08-15 addendum, `mvp-feature-priorities.md`), and multiple Rete migration sessions confirmed a working ~90-line poc-rete implementation exists to port — but the trigger mechanism (`nodedragged` vs. `nodetranslated`) is an explicitly unresolved hands-on judgment call only Mike can make in his own browser. `rete-migration-phase4-briefing.md` confirms this is untouched even after the full Rete migration closed out — `editor/src/app/rete/insert-node.ts` was never ported from poc-rete. ([detail](outstanding-items/drag-to-splice.md))
- **[POST-MVP]** **Named/labeled pin mapping — Mike's ask, not scoped.** Define human-readable names for pins once, reuse them in every pin-selection dropdown, instead of remembering "sensor X is on GPIO14" by hand. Related to but distinct from the config-node work already done. Board files' `pins` labels (2026-09-23) are a first, per-board version of this: shown in the property panel, not yet a dropdown. ([detail](outstanding-items/named-labeled-pin-mapping.md))
- **[P3]** **Machine/board-specific node collections — Mike's ask, not scoped.** Node "collections" for board/processor-specific node sets (e.g. Pi Pico PIO nodes), so the palette doesn't show irrelevant nodes for the target board. **2026-09-06, Mike's refinement when prioritizing:** should reuse the existing `group` field (`palette.ts`'s `KindStyle.group`/`custom-node.ts`'s `CustomNodeDescriptor.group`, already built for the UI-cleanup pass) rather than a new parallel "collections" concept -- plus a way to select the target processor/board on the canvas itself, which then filters the palette to only the matching group(s). Directly connects to (may end up merged with) the editor-board-awareness item below. ([detail](outstanding-items/board-specific-node-collections.md))
- **[P5]** **General UI wishlist, partially resolved.** `mikes-questions-and-points.md`'s "# UI" section: collapsible/resizable panes, delete node/wire, a notes/README sheet for documenting a flow. Collapsible panes implemented 2026-09-04 (palette and property panel collapse to a thin rail, compiled-source/console panels are native `<details>` disclosures) as part of a broader UI-cleanup pass that also removed the bare-minimum-era header/notice text and grouped the node palette -- `decisions.md`'s "Editor / canvas" section, `docs/ui-cleanup-and-collapsing-panels-brief.md`. Resizable panes, delete node/wire, and a notes/README sheet remain unbuilt. ([detail](outstanding-items/ui-wishlist-untriaged.md))
- **[P4]** **Resizable console panel — Mike, 2026-10-07, not scoped.** Let the console (sidebar) be widened by
  dragging, remembered per browser, so console messages fit on one line when there's screen room: one-line
  messages are much easier to read. Goes with the terse-messages rule (`CLAUDE.md`, "Console messages: terse")
  and the wishlist's still-unbuilt resizable panes (P5 above).
- **[POST-MVP]** **Editor board-awareness — filter palette / warn on bad pins by target board.** Explicitly "medium-term, not for now" (2026-08-15). Connects to §6's already-flagged v2 pin-conflict gap and the board-specific-node-collections item (**[P3]** above -- note the split: the basic board-select-filters-palette mechanism is wanted sooner, per item 30's own refinement; the deeper "warn on bad pins" validation half stays post-MVP here). **2026-09-23:** the "warn on bad pins" half is built (Board menu + per-board pin checks, `decisions/chip-board-definitions.md`); palette filtering is not. ([detail](outstanding-items/editor-board-awareness.md))
- **[P4]** **Low-memory warning — not scoped.** §13 describes `HELLO` reporting free flash/RAM so the editor can warn before a flow is too big, but only the version-compatibility half of the pre-flight check is wired in. **2026-09-06, Mike's call:** the separate "no stated max-flow-size assumption" item is deleted, folded into this one -- pinning down a node-count/stateful-node-count ceiling is part of building this warning, not a prerequisite tracked on its own. ([detail](outstanding-items/low-memory-warning.md))
- **In-editor node reference (property panel or a separate tab) — raised by Mike, 2026-09-07, not scoped.** A basic per-node summary/reference available inside the editor itself, not only in the external end-user guide. Real content-source implication, not just UI: the node reference text needs one authored source both the editor and the external guide pull from, rather than two hand-maintained copies drifting apart -- see `documentation-scoping.md`'s addendum and `documentation-tech-selection.md` for how this weighed into the doc-tooling pick. ([detail](outstanding-items/in-editor-node-reference.md))


## Hardware / rig

- **[P5]** **CBOR-over-JSON (§13) — the original revisit trigger has technically passed.** The real wire protocol has shipped, so the "revisit once real payload sizes exist" trigger has passed, but no explicit revisit of the size trade-off has happened since. Low priority, worth closing out formally or dropping. **2026-09-06, Mike's call:** review last, once everything else MVP-scoped is complete. ([detail](outstanding-items/cbor-over-json-revisit.md))

## Backend / auth

- **[P1]** **Backend / auth — complete for the moment, 2026-09-08 (Mike's call).** `backend/` now exists: platform (Python/aiohttp/pyserial), the serial<->WebSocket relay, and posture-1's Host-header allowlist are real code, unit-tested against a real `aiohttp` app and a fake serial connection (`backend/test/`) -- first real-hardware pass done 2026-09-08 on one ESP32-C3/CH9102 board (today's DTR/RTS default doesn't reset it, disconnect fails clean -- `backend-auth-overview.md`), and Mike has since installed and run it for real, confirmed working end to end. **No further per-board hardware passes planned** -- with dozens of boards/USB-chip combinations expected in the field, chasing each one is the exact whack-a-mole CLAUDE.md's fault-handling corollary warns against; effort redirects to strengthening general, board-independent failure handling instead. Newly marked MVP-needed by Mike, 2026-08-21. **2026-09-06, Mike's call:** two separate items folded into this one rather than tracked apart -- the cross-platform-requirement item (macOS/Windows/Linux support, serial port naming/permissions, WebSerial/Web Bluetooth differences) and the package-install/distribution story (pip install vs. a frozen PyInstaller-style build vs. something else, undecided in `backend-platform-decision.md` §7) are both part of building the backend, not separate follow-ups. **2026-09-07, Mike's call:** posture-2 auth (the actual app-secured mechanism) split out below as its own, lower-priority item -- not needed to ship the backend under its default posture. Same session: the backend->browser protocol for serving persisted data back (saved custom nodes, flow files/WiFi creds) turned out to be undecided, not just unbuilt -- split out separately below since it doesn't block the minimal build but does block calling the backend done for the trigger that made it MVP-needed. ([detail](outstanding-items/backend-auth-overview.md))
- **[P3]** **Posture-2 auth (app-secured) — not built, split from the backend/auth item, 2026-09-07.** bcrypt-hashed password, hand-rolled signed session cookie, TLS mechanics, and packaging for where the password lives -- decision-complete in `backend-editor-auth-and-protocol.md` §1, zero code. Deferred until the backend is actually bound to a LAN/public interface, not before. **2026-09-08, Mike's call: re-tagged P4 -> P3; still deferred, not picked up this session.** ([detail](outstanding-items/posture-2-auth.md))
- **[P1]** **Backend↔browser persisted-data protocol — decided and built 2026-09-07; editor-side consumer landed 2026-09-08.** How the browser gets saved custom nodes and flow files (WiFi creds included -- they're just flow-JSON properties, not a separate secrets store) back from the backend was undecided, not just unbuilt, when this item was split out. Resolved: HTTP admin API (not a WS control-plane extension) for custom nodes, covered by the same Host-allowlist middleware automatically, plus a new CORS middleware (`cors.py`, reflect-any-Origin). `persisted_store.py`/`admin_api.py` (2026-09-07) landed and tested. **Flow storage's own story moved twice more the same day Mike ran this for real, 2026-09-08:** the editor's `admin-api-client.ts` briefly made flow save/load backend-exclusive too, then a live test surfaced a silent-overwrite bug and a git-trackability complaint (a flow living in `~/.thingstudio` is invisible to git), then a `--flows-dir` CLI fix for the latter was itself reversed within hours on Mike's explicit correction: he wants flows saved via the OS's own native file dialog, full stop, no backend directory to configure at all -- "just like saving a file from any other editing program." **Where this actually landed:** flow save/open go through `flow-file/file-io.ts` (File System Access API) with no backend involvement whatsoever; the backend's `/api/flows` routes and `admin-api-client.ts`'s flow functions stay in the tree, tested, unused. Custom nodes are unaffected throughout -- still backend-owned in `~/.thingstudio`, per Mike's own principle that they're genuinely cross-flow. ([detail](outstanding-items/backend-persisted-data-protocol.md))
- **[P3]** **No editor UI to author or upload a custom node package to the backend -- only to load one already there.** Found 2026-09-08 while wiring the editor's admin-API client: the editor only reads `GET /api/custom-nodes` (auto-loaded since 2026-09-30); a user has to place `<name>.node.json`/`<name>.node.py` directly into the backend's `~/.thingstudio/custom-nodes/` themselves. Fine when editor and backend share a machine, more friction once they don't (the firewalled-backend use case, `posture-2-auth.md`'s 2026-09-08 addendum). Client-side plumbing (`admin-api-client.ts`'s `writeCustomNode`/`deleteCustomNode`) already exists and is tested, unused by any UI. **2026-09-08, Mike's call: deferred, tracked as priority 3.** ([detail](outstanding-items/backend-persisted-data-protocol.md))
- **[P1]** **Editor↔backend wiring — built and verified end-to-end on real hardware, 2026-09-07; admin-API client landed 2026-09-08.** Scoped explicitly to the transport half only in the 2026-09-07 session (Mike's call): `BackendTransport` (WebSocket client for the serial relay) and the Direct/Via-backend connection-mode picker design doc §4 requires -- both landed, sharing a `DeviceTransport` contract with the existing `WebSerialTransport`. Found and fixed two real bugs that session: the backend's serial relay assumed raw binary framing on the wire when the real device listener speaks base64/"F64:"-line-encoded frames (`line_framing.py`), and `_send_status()` could crash on a WS teardown race (guarded now, with a regression test). Mike then confirmed a real "via backend" connect to an ESP32 plus a basic MQTT flow both work. The `fetch`-based admin-API client landed 2026-09-08, and turned out to make "direct" mode's connection-mode branching irrelevant to storage: Mike's own call was that flow/custom-node save-load is backend-*exclusive* now, so "direct" WebSerial's `connModeSelect` option is hidden (not removed) in the UI, since it can no longer save/load anything on its own. 89 backend tests, 365 editor tests, all passing. ([detail](outstanding-items/editor-backend-wiring.md))

- **[P4]** **One start command for backend and frontend — new item, 2026-09-08 (Mike's ask).** Just a single launch command for both processes, for now -- not a bundling/distribution question (that's the separate, already-tracked packaging/distribution sub-point on the backend/auth item above).
- **[MVP]** **Network transport (WiFi, initially) editor/backend↔board, supplementing USB serial — new item, 2026-09-08, supersedes the §10 v2 "full BLE/WiFi transport with pairing/auth" candidate mention.** Promoted to MVP item 6 by `road-to-mvp.md`; scoped 2026-09-24 in `wifi-transport-scoping.md`.
  **Built 2026-09-24, off-device verified, not yet on hardware.** Left: the hardware pass (ESP32 and Pico W,
  including the `os.dupterm` output mirror, which the unix port can't test), the network scan (nice to have), and
  setting the captive portal's AP password from Board settings (`wifi_provision.set_ap_password` still has no caller).
  **2026-09-25, ESP32-C3 hardware pass (Mike): working over WiFi** -- password auth, deploy, NODE_STATUS and plain
  print() output (debug node) all over the network session, so the `os.dupterm` mirror works on real hardware; Board
  settings correctly disabled while on WiFi. Still to check: wrong password, power pull mid-session, Pico W, `.local`
  entry, discovery from a Mac with the permission sorted.
  **2026-09-25, first hardware test (ESP32-C3):** the board side works (`NET_LISTENING`); the Mac backend is blocked
  by macOS Local Network privacy for its framework-build Python (`learnings/backend-security-research.md`). Workaround
  confirmed: start the backend from Apple's Terminal (docs and the error message say so). Packaging (item 7) must ship
  a signed app with `NSLocalNetworkUsageDescription` so macOS prompts normally; if that proves unreliable, the
  fallback is reversing the connection (the board dials the backend -- accepting needs no permission, TN3179). Cross-reference: raises the urgency question on the existing POST-MVP board-transport-auth item -- serial is a physically-local channel, WiFi isn't -- not yet re-prioritized, flagging the connection only.

## Board/processor reference data

- **[POST-MVP]** **A local, maintained folder of board and processor definitions — built 2026-09-23 (MVP item 4).** `editor/src/definitions/` plus `~/.thingstudio/processors/` and `boards/`, with per-pin reserved/avoid reasons. What's left is keeping it up to date as boards are added. ([detail](outstanding-items/board-processor-reference-data.md))

## Docs / process

- **User docs on GitHub Pages -- new item, 2026-09-27 (Mike).** `docs.yml` already deploys to the `gh-pages`
  branch successfully; Pages isn't switched on in the repo settings. Then check links and link it from the
  README, release notes and `install.sh`. ([detail](mvp-remaining-work-briefing.md), item A)

- **MkDocs future -- stay on 1.x, Zensical likely later (2026-09-24).** MkDocs 1.x is unmaintained, 2.0 is an
  incompatible rewrite Material can't use, Material reportedly enters maintenance mode 2026-11-05. No action until
  a build breaks or packaging fixes the toolchain. ([detail](outstanding-items/mkdocs-future.md))

- **Developer section of the user manual: running from source on macOS -- new item, 2026-09-27 (Mike).** When the
  manual gets a developer section, say: run `make run` / `thingstudio-backend` from Apple's **Terminal** on macOS.
  From iTerm (or VS Code's terminal) the dev backend's unsigned venv Python can't reach boards over WiFi ("No
  route to host"), and macOS never lists or prompts for it; Terminal is exempt (TN3179). Confirmed 2026-09-27:
  `make run` connects from Terminal, not from iTerm. Mike's call: Terminal is fine for dev, so no `make` fix (the
  option was building the release's `thingstudio-python` into `.venv`). Released builds are unaffected: they carry
  their own signed executable. `getting-started.md`'s "From source" and `wifi-connection.md` already mention it
  briefly. ([background](learnings/backend-security-research.md))

- **User docs are missing an execution-model explanation.** `mikes-questions-and-points.md`'s "write explaination of
  node flow operation" ask -- `canvas-basics.md`'s Wiring section covers connection mechanics (port types,
  fan-in/fan-out, refused connections) but not the underlying execution model: each source node (`inject`, `timer`,
  `wifi_status`, etc.) drives its own independent async loop, there's no shared "tick," and multi-output fan-out
  (2026-09-12) iterates outputs in order with each output's messages processed before the next output's. Worth a short
  new subsection now that multi-output makes execution order an actual user-facing question. Not scoped as its own
  detail file -- small enough to just write.

- **[POST-MVP]** **Board-to-board messaging ("comms bus") -- new item, 2026-09-26 (Mike).** Several Thingstudio
  boards passing messages, e.g. one for the UI/display, one for sensors, one for a LoRa radio. Discussed, not
  designed: transport-independent `link out`/`link in` nodes carrying a whole `msg` as a CBOR frame (reusing the
  runtime's own cbor/framing), with the wire a property -- UART first (full duplex, either side starts, longer
  wires, every port), I2C target next (`machine.I2CTarget`, MicroPython 1.26+, memory mode as a mailbox; controller
  must poll or a data-ready line is needed; short wires), ESP-NOW later. Open questions for Mike: is I2C itself a
  requirement, distances and board count, which LoRa board. The generic `i2c` node (controller side) was built
  the same day and is separate from this.
- **[POST-MVP]** **Package `device-runtime` as a single flashable image (frozen MicroPython build with the listener/runtime baked in).** Split out 2026-09-06 from the now-deleted Tasmota-style-install-page item: the install-page/doc UI itself is superseded by whatever the backend item ([P1] above) settles on, but the underlying packaging question survives as its own thing -- kept post-MVP. `deployment-and-distribution-notes.md`.
  **2026-10-08:** the frozen-firmware spike is closed with only its desk half run (about 75% less heap when
  frozen; a pushed library can override a frozen one). Board builds and stage measurements deferred, Mike's
  call. Libraries already go as `.mpy`; the saving is over that baseline. Cheaper idea, not built: fonts
  read from flash on demand instead of imported.
  `frozen-firmware-spike-briefing.md`.

- **[P5]** **CI vendor-neutrality — should CI be independent of GitHub specifically?** Mike's raised question (`mikes-questions-and-points.md`, "# CI"). Currently GitHub Actions (`repo-structure-and-conventions.md`). Not revisited. ([detail](outstanding-items/ci-vendor-neutrality.md))

## Already tracked — v2/v3 candidates and open design-doc questions (not this list's job to re-derive)

Design doc §10's own v2 candidate list (roughly in priority order): full BLE/WiFi transport with pairing/auth,
per-device config override on top of v1's now-shipped shared config nodes, a catch/error node, Home Assistant
auto-discovery on the v1 MQTT node, incremental (non-full) redeploy, mDNS discovery, TCP client proactive connection
expiry on top of v1's lazy-expiry version. §10's v3+ list: a self-hosted mini dashboard (needs an on-device HTTP
server — also the "HTTP in" item Mike raised, deliberately not folded into v1's UDP/TCP promotion), multi-device
flows, a companion server for team libraries/fleet deployment. `mvp-feature-priorities.md`'s own "Explicitly still
out of v1" section covers the same ground in more detail and is the fuller source if needed.

## Resolved — closed out of the active backlog

Items below are done and verified (or resolved as a decision); kept here as one-line pointers rather than full
paragraphs in the active sections above, per the same "index, not a copy" principle as this whole file. Full
reasoning stays at each pointer's target, nothing here was deleted.

- **Custom nodes load automatically from `~/.thingstudio/custom-nodes/`** -- asked 2026-09-27, built
  2026-09-30 (off-device tests and a headless-browser check; not yet run by Mike). Broken packages skipped
  and named, first of two same-typed packages wins, **Reload custom nodes** replaces the picker, two example
  packages seeded on first run. `decisions/node-authoring.md`, 2026-09-30.
- **`display_spi`/`display_i2c` nodes (framebuffer-driven display push)** -- built 2026-09-17, closing
  the "SSD1306 display node" ask above. Converged design (Mike's steer, mid-session): "generic" means
  the framebuffer wire contract, not one universal node -- hardware specifics differ enough per display
  that separate node types are right, held to the two bus families (SPI/I2C) rather than one node per
  exact chip. `thingstudio/display_spi` (SPI color TFTs, vendoring `devbis/st7789py_mpy`'s `ST7789`
  driver, `device-runtime/src/vendor/st7789py_mpy/`) and `thingstudio/display_i2c` (I2C mono OLEDs,
  vendoring micropython-lib's `SSD1306_I2C` driver, `device-runtime/src/vendor/ssd1306/`), both
  unmodified vendored code, both MIT, both hash-verified against two independent fetch methods. Each
  node takes one `bytes` input -- an already-rendered `framebuf.FrameBuffer` buffer (RGB565 for
  `display_spi`, MONO_VLSB for `display_i2c`) built upstream -- and pushes it to hardware on every
  message; no drawing primitives (that's the separate POST-MVP templating item above). A `controller`
  property on each leaves room for more chips per bus family later (ILI9341/GC9A01/etc. for SPI,
  SH1106/etc. for I2C) without a breaking property-shape change. Pins/bus/resolution are node
  properties, not defaults -- they genuinely differ board to board. Full canvas wiring (registry, Rete
  classes, palette entries, property panel, flow-file verifier), a vitest suite running each real
  vendored driver through a real CPython asyncio loop (18 tests, all passing -- pymock's `machine.py`
  gained `SPI`/`I2C` mocks and `Pin.off()`/`.on()`, and three new fixture modules,
  `micropython.py`/`ustruct.py`/`framebuf.py`, were added), `docs/third-party-licenses.md` updated, and
  a user-guide page for each. **Untested on real hardware this session** (no board available) --
  `display_spi`'s rotation support in particular (`_set_mem_access_mode()` called a second time,
  overriding the vendored driver's own hardcoded call) is flagged as needing a real-hardware pass before
  relying on non-zero rotation values. The `VENDOR_FILES`-scaling concern this work surfaced is tracked
  separately, not solved here (see the active-backlog entry above). ([detail](decisions/node-authoring.md))
  **Follow-on UI bug found and fixed same session:** growing the hardware palette group to 7 rows (this
  work's two new entries pushed it over) exposed a real layout bug Mike caught live -- the palette sidebar
  ran off the bottom of the page with no scrollbar. Root cause confirmed with a real headless-browser
  before/after check (not just theorized): `#palette-mount` (`editor/index.html`) had no `overflow` rule of
  its own, so once its content grew taller than its flex-stretched box, the excess simply painted past the
  box's edges, unclipped and genuinely unscrollable (`element.scrollTop = <n>` was a no-op, not just a
  hidden-scrollbar cosmetic issue) -- rather than the `min-height: auto` flex gotcha first suspected (ruled
  out empirically: the box's own height was already correctly stretched). Fixed with `overflow-y: auto`
  (plus `min-height: 0` for parity with `#property-panel-mount`/`#sidebar`'s own already-working pattern a
  few lines away in the same file, which is what made the right fix obvious once the missing property was
  spotted). One-line CSS change, verified scrollable both by the headless-browser check and by confirming
  every palette row (including `display spi`/`display i2c`) is reachable by scrolling to the bottom.
  **Second follow-on bug found and fixed same session, 2026-09-17:** writing `test-flows/display-spi-tidal-
  test.flow.json` (Mike's own "draw text and a circle" ask) surfaced a second real bug -- a hand-authored
  `function -> display_spi` edge silently failed to connect on flow-file load, reading as "the function node
  is not connected to the display node." Root cause: `display_spi`/`display_i2c`'s `frame` input is the first
  (and only) `bytes`-typed input this node library has ever had, and the wire-type system's `BytesSocket` was
  identity-only -- `any -> bytes` fell into bucket 3's "refuse, needs a conversion node" rule, exactly the gap
  `wire-type-system-scoping.md`'s own "Former open questions" #4 had anticipated and deliberately deferred
  until a real bytes-typed input existed. Fixed by allowing `any -> bytes` (mirroring the already-accepted
  `any -> bool` self-correction, not a blanket bucket-3 loosening -- `bytes <-> string` stays refused, still a
  real encoding choice), with a new `editor/test/sockets.test.ts` covering the full coercion matrix (no test
  had covered `sockets.ts` before). ([detail](decisions/node-authoring.md))
  **Third and fourth follow-on bugs found and fixed same real-hardware pass, 2026-09-18:** with the wire-type
  and LCD_PWR/LCD_BLEN fixes above in place, the flow deployed and ran but the circle rendered clipped at the
  top with static along the left/bottom edges, in the wrong color (green intended, red shown). Two separate
  real bugs, both in `display_spi`: (1) codegen hardcoded `xstart=0, ystart=0`, bypassing st7789py_mpy's own
  offset table, which needs `52, 40` for TiDAL's 135x240 panel specifically -- fixed by adding real
  `xstart`/`ystart` node properties (default `-1`, auto-resolved via the vendored table, matching
  `cs`/`reset`/`backlight`'s existing "not wired" sentinel convention), with 4 new off-device tests against
  the real driver. (2) `framebuf.RGB565` stores pixels little-endian (MicroPython's own CPU-native behavior,
  confirmed via `micropython/micropython#3536`, an unmerged upstream PR), but the ST7789 wants big-endian
  pixel bytes -- fixed with a byte-swap loop in the flow's `function` node, and flagged as a general gotcha in
  `docs/user-guide/nodes/display-spi.md` for every future user of this node. **Confirmed working on the real TiDAL badge, 2026-09-18** ("redeploy looks fine," Mike) -- all four real-hardware bugs found this session (wire-type gap, LCD_PWR/LCD_BLEN polarity, GRAM offset, RGB565 byte order) fixed and verified together. ([detail](decisions/node-authoring.md))
  **Fifth follow-on, 2026-09-18: real node properties for panel-variant config.** The MADCTL/inversion
  override values the real-hardware CYD bring-up needed (same-day, separate real-hardware session,
  `decisions/node-authoring.md`) were only reachable from one-off scratch scripts, not from a real
  flow -- fixed by adding `colorOrder`/`invertColors`/`dataLatchOrder` node properties (CYD-defaulted,
  `rotation`'s own default also changed to match), computing MADCTL the same way the scratch scripts
  worked it out by hand, and preserving TiDAL's own already-confirmed config with explicit property
  overrides in its flow file so the new defaults don't silently break it. Four new tests, full isolated
  `npm ci`/`tsc --noEmit`/`vitest run` pass (519/521, same 2 pre-existing unrelated failures). The
  separate framebuffer-memory problem this same CYD session surfaced (`MemoryError` on a full RGB565
  frame) is scoped, not solved, as its own item below. ([detail](decisions/node-authoring.md))
- **eswitch/ebutton nodes (Peter Hinch's asyncio drivers)** -- built 2026-09-17. `thingstudio/eswitch`/
  `thingstudio/ebutton`, vendoring his `ESwitch`/`EButton`/`WaitAny`/`Delay_ms` classes verbatim
  (`device-runtime/src/vendor/primitives_events/`) rather than re-deriving debounce/long-press/
  double-click logic. Single output port, `topic` distinguishes which event fired (confirmed with
  Mike rather than extending the compiler's source-node multi-output support). Full canvas wiring
  (registry, Rete classes, palette entries, property panel, flow-file verifier), a vitest suite
  running the real vendored driver through a real CPython asyncio loop (19 tests, all passing), and
  `docs/third-party-licenses.md`/design-doc §11 updated. **Real-hardware pass started same day** on an
  EMF 2022 TiDAL badge (stock MicroPython, ESP32-S3) -- surfaced a real gap before it could bite: most
  of that badge's buttons need the chip's own internal pull-up, which these nodes had no way to
  configure, so a `pull` (none/up/down, default "none", backward-compatible) property was added to
  both nodes same-day. `interrupt` has the identical gap, tracked separately below.
  **`ebutton` real-hardware pass confirmed working, 2026-09-17** (TiDAL badge, Centre/joystick-press
  button, pin 9, `pull: "up"`): `press`, `release`, and `long` all confirmed via the actual console
  output. `double` confirmed too, including the exact behavior this node's own regression test
  (`node-ebutton.test.ts`) exists to prove: a rapid second click reported BOTH `press` and `double`
  back-to-back (2ms apart in the real console timestamps), not `double` alone -- the real-hardware
  proof that the `WaitAny` full-clear fix (`decisions/node-authoring.md`'s original 2026-09-17 entry)
  holds on actual silicon, not just off-device. `eswitch` itself, and every `ebutton` button besides
  Centre, remain real-hardware-unconfirmed -- same driver/`pull` property, likely low-risk, but not
  assumed covered by this one pass. His §5 AADC
  driver deliberately split out as its own follow-up item (above), not bundled into this pass; the
  interrupt-node debounce-removal side effect is also split out as its own item (above), flagged for
  Mike rather than resolved here. ([detail](decisions/node-authoring.md))
- **Pass-or-drop WiFi-link status gate (`thingstudio/wifi_gate`)** -- built 2026-09-14, WiFi-link-only
  scope (Mike's call, asked via AskUserQuestion before implementing). One input, one output: passes
  `msg` through unchanged when the WiFi station link is up, drops it (same mechanism a `function`
  node's own `return None` uses) when it isn't. Checks live link state at message-arrival-time, not a
  value read off `wifi_status`'s own emitted messages -- those only fire on a connection-identity
  change, so a fast-firing source gated off that wire could see stale state. No properties; derives
  WiFi credentials from the flow's own sole `wifi_status` node, same pattern every other network node
  type uses. Full canvas wiring (registry, Rete class, palette entry, property panel, flow-file
  verifier), a vitest suite run against real generated Python (pymock's `network.WLAN.CONNECTED`
  toggle), and a user-guide page. Real-hardware smoke test confirmed 2026-09-14 (deploys and runs
  cleanly, via `test-flows/wifi-gate-test.flow.json`) -- the specific pass-vs-drop behavior on an
  actual link drop/reconnect hasn't been separately confirmed yet. The item's other original ask --
  a dedicated router/switch node -- stays open, deferred to POST-MVP (see the active-backlog entry
  above). ([detail](outstanding-items/connection-state-gate-router-nodes.md))
- **Tasmota-style soft-AP + captive-portal WiFi provisioning** -- built and verified 2026-09-14, same
  day as the scoping session. A flow whose WiFi config is `"unmanaged"` now makes the device open a
  soft AP (`Thingstudio-Setup-XXXX`, WPA2, default password `thingstudio`) plus a catch-all DNS
  responder and a hand-rolled HTTP form on first boot with no stored credential; a saved credential is
  reused on every later boot without reopening the portal. A new per-config `allowReprovisioning`
  field (off by default, warned in its own help text) opts into reopening the portal on a later
  connect failure too -- trusted-networks-only, per Mike's own caveat. Resolved the scoping session's
  own open architectural question (no pre-listener boot-time code existed anywhere in this codebase)
  by adding a new editor-computed, DEPLOY-envelope-level `wifiProvision` marker
  (`computeWifiProvisionMarker()`, `wifi-status.ts`) -- distinct from the flow's own bytecode --
  persisted device-side and read by `listener.py`'s `main()` before `_resume_flow()`. Web server:
  hand-rolled, not the scoping session's own `tinyweb` recommendation -- reversed during
  implementation, matching `cbor.py`'s small-native-implementation precedent for a ~2-route surface;
  flagged explicitly as a reversal, not a silent change. AP password is settable in the persisted-
  state schema (`get_ap_password`/`set_ap_password`) but has no editor-side push mechanism yet --
  schema kept ready for it rather than a dead end, per this file's own no-premature-optimization/
  no-dead-end convention. No `_RUNTIME_VERSION`/`EDITOR_TARGET_VERSION` bump: the new `wifiProvision`
  DEPLOY field and `wifi_provision.py` module are both purely additive -- an old editor omitting the
  field degrades to `self_provision: false` (today's behavior, unchanged), and an old runtime without
  `wifi_provision.py` simply ignores the field, so neither direction can produce a flow the other
  side runs incorrectly. Verified: real MicroPython unix-port suite (19/19 new
  `test_wifi_provision.py` tests, full suite otherwise green), editor `tsc --noEmit` clean, and a
  fresh `npm ci` + vitest run (448/448) in an isolated copy of `editor/`. Not yet done: Mike's own
  hands-on hardware test of the actual captive-portal flow on a real board.
  ([detail](outstanding-items/wifi-provisioning-captive-portal.md))
- **Named credential store for WiFi/MQTT-broker secrets** -- built 2026-09-13, same day as the design
  decisions. WiFi/MQTT-broker config nodes now hold only `credentialName` (+ `security` for WiFi); the real
  secret values live in a new backend-owned `~/.thingstudio/credentials/<type>/<name>.json` store, resolved
  into the in-memory config at flow-load time and filtered back out before a flow saves -- a saved `.flow.json`
  never has a real ssid/password/broker-auth value in it. Supersedes and resolves
  [credential-free-committable-flows.md](outstanding-items/credential-free-committable-flows.md) (moved below,
  same day) -- Option B gives exactly the "valid, mqtt-including flow with zero WiFi/broker info in it" that
  item asked for. The 6 real test-flow files that had plaintext credentials committed were migrated the same
  day. Real backend/editor test suites and a manual browser smoke test still need Mike to run them himself.
  ([detail](outstanding-items/credential-storage-design.md))
- **Credential-free git-committable flows** -- deferred 2026-09-04, resolved 2026-09-13 by the credential-store
  item just above. ([detail](outstanding-items/credential-free-committable-flows.md))
- **Console-click-to-navigate viewport jump** -- fixed and committed 2026-09-13 (`7bf6b53`). `focusNode()`
  (editor-setup.ts) now checks the target node's screen-space bounding box against the container's viewport
  (40px margin) before calling `AreaExtensions.zoomAt()` -- a click on an already-visible node just selects it
  in place; only an off-screen (or edge-hugging) node still triggers a pan/zoom. Deliberately doesn't account
  for the property panel/palette occluding part of the canvas -- left unscoped, revisit if it proves annoying.
  Mike confirmed working after a real dev-server reload (an initial "still always centres" report turned out to
  be a stale/not-actually-running page, not a code bug). ([detail](outstanding-items/console-click-viewport-jump.md))
- **Inject node had one click target doing two incompatible jobs** -- found and fixed 2026-09-13 (`7bf6b53`),
  same session as the viewport-jump fix above. The whole node body either fired a TRIGGER (connected) or opened
  the property panel (not connected), so there was no way to edit a live inject node's properties short of
  disconnecting first (Mike: "Inject should have two clickables, the arrow which triggers an inject message and
  the body which opens the property sheet"). Fixed: the "▶" icon is now its own click target (stops
  propagation before Rete's own node-pick handler, fires directly via the new `fireInjectNode` store ref);
  the rest of the node body always selects/opens the property panel, live or not. Removed the now-unused
  `onNodeClicked` veto hook (editor-setup.ts) this replaces -- it existed only to serve the old, broken
  single-click design. `docs/user-guide/nodes/inject.md` updated to match. Not previously a tracked item --
  Mike caught it hands-on while smoke-testing the viewport-jump fix above.
- **Palette node-family ordering** -- implemented and committed 2026-09-13 (`cba9d80`). Explicit numeric
  `priority` field on `KindStyle` (built-in) and `CustomNodeDescriptor` (custom nodes) replaces
  `PaletteSidebar.vue`'s hardcoded source-then-sink `KINDS` array; `group` unchanged. `tsc`/`vitest` clean,
  Mike's own browser smoke test confirmed. ([detail](outstanding-items/palette-node-family-ordering.md))
- **Multiple panes for one large flow, still one flow** -- implemented and committed 2026-09-13 (`e2359f3`).
  Tabbed, not tiled; cross-pane wires and pane reordering deferred to post-MVP; pane membership kept as a
  separate `panes`/`paneOf` layer in `flow-file.ts`, mirroring that file's own `layout` precedent rather than
  a node property. Panes default-named "Flow 01"/"Flow 02"/etc., renamed via double-click; "+" on the tab
  bar adds a pane, a tab's "X" removes it and deletes its nodes. `tsc`/`vitest` clean, Mike's own browser
  smoke test confirmed. ([detail](outstanding-items/multi-pane-canvas.md))
- **Custom node authoring** — implemented 2026-08-20, all open questions resolved. ([detail](outstanding-items/custom-node-authoring.md))
- **Multiple wires into one node input** — implemented and real-browser verified 2026-09-10 (commit `1e5353e`). Every `nodes.ts` input now passes `multipleConnections: true` (Node-RED-style, Mike's design call) -- the suspected codegen risk was a non-issue (`compile.ts` already fully supported and tested fan-in; `graph-adapter.ts`/`main.ts` had no single-input assumption either). Only real change was canvas-side (`rete-connection-plugin` used to silently evict an input's existing wire on a second connection). ([detail](outstanding-items/multi-connection-node-inputs.md))
- **`wifi_status` node emits complete WiFi status (IP, network info, RSSI)** — implemented and off-device verified 2026-09-09/10 (commit `90b1622`); **real-hardware verified 2026-09-10 (Mike)**. Envelope carries `subnet`/`gateway`/`dns` plus `rssi` (ESP32-only, degrades to `None` elsewhere). Confirmed on real hardware: connect/disconnect report real network values and re-emit correctly, RSSI-only drift does not trigger a spurious re-emit. Root cause of the original ask's UI-visibility half (`debug.ts` only ever printed `payload`) fixed with the new opt-in `fullMessage` property. Nothing left open. ([detail](outstanding-items/wifi-status-completeness.md))
- **Documentation** — scoping, tech selection, design/scaffolding, and content-writing done 2026-09-07; Mike installed `mkdocs`/`mkdocs-material` and ran a real build 2026-09-08, confirmed working. Nothing left open. ([detail](outstanding-items/docs-nothing-written.md))
- **`wifi_status` emit-on-change** — implemented 2026-09-02, tested and confirmed by Mike (real hardware). ([detail](outstanding-items/wifi-status-emit-on-change.md))
- **Single-wifi-owner fix** — landed 2026-09-04, real-hardware redeploy + retest (including `basic-mqtt.flow.json`) confirmed working by Mike. The separate, still-open question of whether `wifi_status`'s one-shot connect needs retry/backoff was deliberately left out of this confirmation -- Mike's call remains to leave it until it's shown to actually cause problems. ([detail](outstanding-items/wifi-single-owner-fix.md))
- **`inject`'s click-only live-fire feature** — implemented 2026-09-02 (`fa3e84e`), real-hardware click → TRIGGER → device round trip confirmed working by Mike, 2026-09-06. ([detail](outstanding-items/inject-click-fire-missing.md))
- **`startup` node on the canvas, and `display_spi` palette editor (MVP item 5 closed)** — 2026-09-24.
  `startup.ts` and its test were committed 2026-09-17 (inside `67d87c7`) without the registry, `nodes.ts`,
  palette or property-panel wiring; now wired, user docs added. `palette` got `PaletteField.vue` swatches, the
  last property with no form field. Unverified on hardware.
  ([detail](outstanding-items/init-node-on-flow-start.md))
- **`inject` doing the job of two separate nodes — resolved 2026-09-06, confirmed by Mike.** The 2026-09-02 click-fire rewrite (`fa3e84e`) already split this structurally: inject now does exactly one job (fire on a real click/TRIGGER, nothing else); the old "fire once automatically at boot" behavior it used to conflate with that was removed with no fallback and pushed out to a separate, not-yet-built `startup` node (see `init-node-on-flow-start.md`, tracked separately). ([detail](outstanding-items/inject-node-review.md))
- **Canvas-presence gaps — fully closed 2026-09-06, `pwm_out` stands, `variable_get`/`variable_set` reopened same day.** All three given real Rete classes, palette entries, and `PropertyPanel.vue` sections -- `variable_get`'s output port retypes with `payloadType`, same mechanism `inject`'s own dynamic output already used. Port-declaration tests added to each type's existing test file; off-device verified (`tsc`/`vitest` clean, 29/329). **Same day, hidden again:** Mike judged `variable_get`/`variable_set` not worth keeping visible without a real design behind them -- see the new UI/editor item below. `pwm_out`'s closure is unaffected. **Only the git commit is still owed.** ([detail](outstanding-items/canvas-presence-gaps.md))
- **`delay` node** — scoped and built 2026-09-06, closing the last unaddressed item from `mikes-questions-and-points.md`'s original node-prioritisation list. `thingstudio/delay` (transform, `delayMs` property, full canvas presence from day one), 7 new tests, verified off-device (`tsc`/`vitest` clean, 29/326). Honest limitation documented in the node's own header: blocks its source's next iteration for the delay duration, same as any slow transform, just made into the whole point of this one. **Only the git commit is still owed.**
- **`http_request`'s WiFi-config migration, canvas presence, and real hardware pass** — WiFi-config migration closed 2026-09-04; canvas presence plus Problem 2a's loud-network-error fix closed 2026-09-05; real hardware pass (ESP32, GET+POST) closed 2026-09-06. **Only the git commit is still owed.** ([detail](outstanding-items/http-request-config-node-gap.md))
- **HTTP in / HTTP response nodes** — implemented 2026-09-08, real-hardware verified by Mike 2026-09-09 (including a real EADDRINUSE-on-redeploy bug and a palette-registration gap, both found via his own hands-on use and fixed same day -- see the detail file). Exact `(method, path)` match only in v1 -- no named path parameters, no request-body parsing -- Mike's own explicit scope cut ("we don't have to implement all of the node-red semantics"), both tracked as deferred, not oversights. Full canvas presence from the start. Nothing left open. ([detail](outstanding-items/http-in-response.md))
- **Gray out the compile/deploy button after a successful deploy, until the flow is edited** — raised 2026-09-04, implemented and real-browser verified by Mike 2026-09-09. Grays out right after a real `DEPLOY_ACK`, re-enables the moment the flow actually changes -- piggybacks on the same two change-signals `refreshPreview()` already listens to (`main.ts`'s own `reteEditor.addPipe`/`propertyVersion` watch), so there's no second, independently-maintained notion of "did the flow change." A failed deploy or a timeout leaves it enabled, matching the 2026-09-06 answer to this item's own open question. `docs/user-guide/flow-lifecycle.md` updated. **Only the git commit is still owed.** ([detail](outstanding-items/gray-deploy-button-until-edit.md))
- **wifi_status-vs-mqtt_as ordering race on ESP32** — confirmed bug 2026-09-04, fix narrows but doesn't eliminate it (hardware-verified 2026-09-05: passes on RP2040, still fails on ESP32). **Resolved as a decision, 2026-09-06: accepted as a documented limitation** (clean, attributed `NODE_ERROR`, not a raw crash) rather than pursued further — generalized into a standing project rule in `CLAUDE.md`'s fault-handling section. ([detail](outstanding-items/wifi-status-mqtt-connect-ordering-race.md))
- **Redeploy cleanup / network fault detection** — implemented 2026-08-20 (cleanup registry replacing GC-timing socket leak, mandatory `wifiConfigId` with `"unmanaged"` opt-out, compile-time check on empty password); real-hardware redeploy-twice pass closed 2026-09-06 (no `EADDRINUSE`); `http_request`/`mqtt-shared.ts` loud-error treatment closed 2026-09-05 (see the `http_request` entry above). Nothing left open. ([detail](outstanding-items/redeploy-cleanup-network-fault-detection.md))
- **Delete node / delete wire** — implemented and verified 2026-09-08 (Mike's real-browser smoke test: both confirmed working, keyboard-only confirmed sufficient, no button wanted). Wire selection is new (`ThingstudioConnection.vue`, click-to-select with the same orange highlight a selected node gets); Delete/Backspace removes whatever's selected -- multi-selected nodes (Cmd/Ctrl-click) plus their connections if any are selected, else the one selected wire -- guarded against firing while a text field has focus. No confirmation/undo, matching "Clear canvas"'s own existing precedent. `docs/user-guide/canvas-basics.md` updated. **Only the git commit is still owed.** ([detail](outstanding-items/delete-node-wire.md))
- **Console-message-to-node attribution** — implemented and verified 2026-09-04 (phase 2: DEBUG-line attribution, click-to-navigate, Mike confirmed on real hardware). ([detail](outstanding-items/console-node-id-mapping.md))
- **Stable node IDs** — implemented and verified 2026-09-04 (a node's own Rete UUID is now its compiler/wire-protocol/flow-file id end to end). Full reasoning: `decisions.md`, "Stable node IDs" entry.
- **§3's RP2040-vs-RP2350 RAM floor — closed 2026-09-06, Mike's call.** No separate action needed -- resolves naturally via the already-tracked RP2350 bring-up item ([P5]), which will produce the comparison data. Not treated as its own open question anymore.
- **"App Platform" question** (backend-served web UI vs. a cross-platform GUI app) — resolved 2026-08-16: thin local Python backend + browser-based web editor. `decisions.md`, "Backend" section.
- **"file ops" node idea** — resolved 2026-08-17: rejected as a node type entirely, reduces to a `function`-node one-liner. `decisions.md`, "Config nodes / Tier 1 scope" section.
- **Recovery button/jumper for a wedged listener** — rejected 2026-09-06, Mike's call: redundant with what already exists/is planned -- `HELLO_REQUEST`, a reset node, and simply wiring a physical button to the processor's own hardware reset pin cover this need without a dedicated runtime-image feature. ([detail](outstanding-items/recovery-button-wedged-listener.md))
- **Serial write-timeout gap (`serial_relay.py`)** — fixed 2026-09-08. `SerialConnection.open()` left pyserial's `write_timeout` at its default (`None`, block forever), the one unbounded I/O call in a module whose own header comment already promised every blocking call was bounded -- a wedged device could hang the executor thread indefinitely on `write()`. Fixed: `_WRITE_TIMEOUT_SECONDS = 5.0`, passed to `serial.Serial()` alongside the existing read timeout; `write()`'s existing `except (serial.SerialException, OSError)` already catches `SerialTimeoutException` (a subclass), so a stuck write now surfaces the same structured `SerialRelayError` every other serial fault produces. 10 new tests, `backend/test/test_serial_relay.py` (first unit tests this module has had at the real-pyserial-mock level -- prior coverage was all at the higher `SerialConnection`-fake level in `test_ws_relay.py`); a negative-control run confirmed the new timeout-assertion test actually fails without the fix, not just passes trivially. Verified in the scratch-venv pattern, 99/99 backend tests passing.

## Flagged as ambiguous — needs a human decision, not guessed here

- **`architecture-review-briefing.md`'s "browser-only, no install" claim (§4).** See
  [detail](outstanding-items/ambiguous-browser-only-claim.md).
- **`mikes-questions-and-points.md` itself is a live, actively-appended file** (most recent entry dated 2026-08-19
  as of the original audit) — treated as a permanent open-items scratchpad, not something to mark resolved or
  archive. Its still-open items are pulled into the relevant sections above; re-check it directly for anything
  newer than this index.
- **`mvp-feature-priorities.md` and `validation/mvp-validation-plan.md` remain the live sources of truth** for
  tier-by-tier status — both are large, actively-maintained tracking documents in their own right, not superseded
  by this index. This file pulls their open items forward but doesn't replace them; check them directly for
  anything this index compressed away.

---

## Files marked fully resolved by the original 2026-08-19 audit (archived 2026-08-22)

19 working-notes briefings whose own success criteria were entirely met got moved into
`docs/working-notes/archive/` 2026-08-22, unchanged otherwise — see that directory for the list. Everything else in
the original inventory was read and classified but left in place — either partially resolved (open items pulled
forward above), still fully active, or one of the three living tracking documents noted under "Flagged as
ambiguous."

- **GPIO pin range hardcoded to 0–39** — **resolved 2026-09-23** by the processor/board definitions
  (`decisions/chip-board-definitions.md`). Still to do: a hardware pass (see
  `outstanding-items/gpio-pin-range-by-chip.md`).
- **Processor/board definitions: follow-ups** — flow file doesn't record its board; Board menu choice isn't
  remembered across reloads; CYD touch/SD/LED pins unverified; CYD on SPI bus 1 at >27 MHz untested.
  `outstanding-items/processor-board-definitions-followups.md`.
- **[DEFERRED]** **Plain Pico still shows WiFi entries in the port menu** (Mike, 2026-09-25 hardware pass, "not that
  fussed"). A board with no WiFi hardware shouldn't be offered WiFi options; the briefing's step 9 expected none.
  Not investigated yet.
- **[DEFERRED]** **Continuous WiFi board discovery** (Mike, 2026-09-25). Backend re-probes every ~5 s while an editor
  is open and not connected over WiFi; keeps a last-seen table keyed by hostname, drops a board after ~3 missed
  rounds; pushes changes to the editor, which rebuilds the WiFi group without losing the selection (a vanished
  selected board shows "(not seen)"). Follows IP changes; enables "last seen" in not-listed help. No board-side
  change, no runtime bump. Today discovery runs only on ⟳ ports / page load (`tcp_relay.discover()`).
- **[P2, raised 2026-09-25]** **Lazy loading, for RAM on small boards** (Mike). Context: an ESP32-C3 couldn't join
  WiFi from an MQTT flow, most likely memory (`learnings/micropython-device-runtime.md`, 2026-09-25); installs are
  now precompiled. Two parts, in order:
  1. **Runtime modules imported only when needed.** `listener.py` imports all nine at every boot (~3,200 lines):
     `wifi_provision` (536 lines) is only for captive-portal flows; `board_settings`/`net_transport` (640) only on
     WiFi boards. Import them on first use instead. This is the RAM win.
  2. **Node libraries pushed with the flow, not at runtime install.** Flows already import `mqtt_as`, `st7789py` etc.
     only when used, so this saves flash and install time rather than RAM, and lets a flow carry exactly what it
     needs. Deploy would push a missing or outdated library (precompiled) before the flow.
  Also: report free ESP-IDF heap in HELLO next to `freeRamBytes`, and add a C3 memory check (MQTT + display flow)
  to the hardware checklist. **Both done 2026-09-25** (runtime 5.1.0, `[memory]` console line; checklist step 10
  in `wifi-transport-built-briefing.md`). Not yet seen on hardware.
  **Mike's call, 2026-09-25:** keep an eye on memory while the remaining MVP nodes go in, and build lazy loading
  then only if needed; otherwise post-MVP. (Why the C3 ran out first despite 400 KB vs the Pico W's 264 KB: the
  C3 runs the whole WiFi stack -- MAC, WPA supplicant, mbedTLS, lwIP buffers -- on its own CPU and RAM, and the
  handshake allocates at join time; the Pico W's CYW43439 radio has its own processor and RAM.)
- **[DEFERRED]** **ESP32-C3 slow, lossy pings over WiFi** (2-324 ms, ~33% loss; Pico W 2-25 ms, none). Probably
  the C3's default modem sleep; not confirmed (`w.config(pm=w.PM_NONE)` then ping). Mike, 2026-09-25: defer unless
  it causes other problems. A fix would switch power saving off during a WiFi session only (`net_transport.py`).
