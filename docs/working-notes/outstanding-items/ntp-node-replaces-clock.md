# `ntp` node replaces `clock`

Status: built 2026-10-14, off-device only; owes a hardware check (see "Built" at the end). Raised by Mike during the
user-docs style review (`docs-style-review.md`).

## Problem

`clock` (General) does three jobs: syncs the board's time over NTP, applies a UTC offset and UK/EU daylight saving,
and formats text for a display (12-hour, seconds, blinking colon). Mike: "it this is what it does, its wrongly
designed. It's then a gui node not a general. there should be a strict division, ntp node and text display with a 7
seg option."

It also fails silently: `clock` doesn't join WiFi (it only checks `isconnected()`; WiFi is brought up by the callers
of `wifiSetupStatement`: wifi_status, wifi_gate, mqtt publish/subscribe, http request, http in, udp send/receive). A
flow with a clock and no such node compiles, deploys, and shows `--` for ever. A FAQ entry covers this for now.

## Decided (Mike, 2026-10-10)

- New `ntp` node (Network) syncs the board's clock and has an output **format** option: unix time, and a few
  variations on date and time text.
- Remove `clock` outright. Nothing released depends on it.
- Display stays with the display: 7-segment is a font choice on a gui label (the `seg7` fonts already exist).

## Still to decide

- Where the UTC offset and daylight saving live: on `ntp` (board clock runs local; a DST change can show up to an
  hour late, at the next sync) or applied when formatting.
- Exact format list, and whether `ntp` sends on sync only, or also on an input trigger (a timer for a ticking
  display).
- Blinking colon: drop, or a gui label option.
- A compile error or warning when the flow has nothing that joins WiFi ("ntp node needs WiFi: add a wifi status
  node"), per CLAUDE.md's fault-handling rule.

## Touches

`editor/src/node-library/clock.ts` (remove), registry, `docs/user-guide/nodes/clock.md` (replace with `ntp.md`),
nav, `faq.md`'s clock entry, `nodes-catalog.md` (generated), `ai-authoring.md`, test flow
`gui-headliner-sensor-freenove-s3-4in.flow.json`. Codegen change: evaluate the runtime version bump rule.

## Settled (Mike, 2026-10-14)

- UTC offset and UK/EU summer time are properties of the `ntp` node.
- `ntp` sends on each input once synced, and once after every successful sync.
- Formats: unix, `time` (14:05), `time_seconds`, `time_12h` (2:05 pm), `date` (Wed 14 Oct), `date_iso`, `iso`
  (with the offset). Mike: "all of these as separate properties". Built as both readings of that: a `format`
  property picks `payload`, and every message also carries all seven as named fields. Confirm with Mike.
- No blinking colon. A flow with an `ntp` and no WiFi config doesn't compile.

## Built (2026-10-14)

- `editor/src/node-library/ntp.ts`: two-faced (sink input asks for the time; event-source output sends it). Joins
  WiFi itself through the flow's WiFi config (`resolveFlowWifiCredentials`, as `udp_send`), so the old "shows `--`
  for ever" case is now a compile error. Status dot: waiting for WiFi / synced / NTP from <server> failed; the first
  failure in a run also goes to the console. Sync rules as `clock`: 2 s WiFi poll, 30 s retry, hourly.
- Implementation call, not Mike's: the RTC stays on UTC and the offset/DST are applied per message, rather than
  setting the RTC to local time. Same settings on the node, but the summer hour changes on time (not at the next
  hourly sync) and `unix` stays true UTC. Offered to Mike as "board clock runs local"; flag if he wants that.
- Not on the descriptor yet: hand-written class, palette row and panel block, like the rest of the network family,
  because the generic panel can't show the flow's WiFi field (`node-descriptor-unification.md`). Migrate with them.
- `clock` removed: node, class, palette row, panel block, `PROPERTY_NOTES`, test, docs page. The seven-segment font
  notes moved to `nodes/gui.md`. Headliner flow (`gui-headliner-sensor-freenove-s3-4in`) now uses two `ntp` nodes
  (time and date) off the one timer. Each syncs on its own: two NTP requests an hour.
- Tests: `node-ntp.test.ts` (15: formats, DST edges, offsets, sync/retry/hourly, poke, no ntptime, compile, no-WiFi
  error), all in CPython with pymock; the helpers also run on the MicroPython unix port. Full suite 87 files / 1063
  tests, `tsc`, `vite build`, `mkdocs build --strict`, `build_llms_txt.py --check` pass. No `device-runtime/src`
  change, so no runtime version bump.
- Owed: hardware check on a board (sync, summer time, the headliner's clock page, a flow with only `ntp` joining
  WiFi, and one with MQTT so `wifiSetupStatement`'s defer-to-mqtt path is exercised).
- Possible follow-up: share one sync per server across `ntp` nodes, so time + date costs one request.
