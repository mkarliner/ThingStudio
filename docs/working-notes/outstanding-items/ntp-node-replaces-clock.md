# `ntp` node replaces `clock`

Status: open, 2026-10-10. Raised by Mike during the user-docs style review (`docs-style-review.md`).

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
