# MQTT real-hardware validation + network follow-ups (in progress)

Mike's own direct request, takes priority over the sequencing below. Doesn't remove or reorder the rp2350 item — just goes first.

Scope: real-hardware validation of the MQTT WiFi-precheck fix and full MQTT functional pass (pub/sub, broker auth, qos 1,
retain, outage recovery — none run on real hardware yet), plus `http_request`'s still-open config-node/canvas migration
and hardware pass, plus extending Problem 2a's loud-network-error fix to `http_request`/`mqtt-shared.ts`.

Full brief: `mqtt-hardware-validation-and-network-followups-briefing.md`.
## Update, 2026-09-02: first real-hardware attempt hit silent failure

Mike ran `basicmqtt.flow.json` (a minimal inject->publish / subscribe->debug loopback) against real hardware. No output, no error. Two candidate causes found, not yet isolated: `inject-click-fire-missing.md` (the click-trigger feature this test relied on isn't actually in the repo) and `mqtt-pubsub-boot-race.md` (a suspected publish-vs-subscribe wire-ordering race at boot). Full dated entry: `validation/mvp-validation-plan.md`'s Tier 1 network section, 2026-09-02 Results. Neither the WiFi-precheck fix nor the qos1/retain/outage-recovery functional pass this item calls for has been reached yet -- blocked on getting a basic pub/sub roundtrip working first.


## Update, 2026-09-02 (later the same day): click-fire works, hit a new WiFi state error

With inject's click-fire feature implemented and the runtime redeployed, `basicmqtt.flow.json` got further: clicking inject fired the chain (confirmed via the console), but `mqtt_subscribe` (its own always-on source, connects at boot automatically, no click needed) raised `NODE_ERROR ... OSError: Wifi Internal State Error` -- on a freshly power-cycled board, ruling out the "previous deploy left WiFi in a weird state" theory.

Root cause (reasoned, not confirmed by hardware tracing): `mqttWifiPrecheckStatement()`'s existing wait loop only waits out an *in-flight connect* (`STAT_CONNECTING`) -- on a genuinely fresh boot, status right after `.active(True)` is idle, not connecting, so that loop adds no real delay at all. The likely actual issue is a known ESP32/MicroPython quirk: `.active(True)` returning doesn't guarantee the WiFi driver has finished coming up internally, and calling `.connect()` immediately after can be rejected as a state error.

Fixed in `mqtt-shared.ts`'s `mqttWifiPrecheckStatement()`: poll `.active()` until it actually reports `True` (rather than trusting the call that requested it), plus a short fixed settle delay, before the pre-existing in-flight-connect wait. Editor-side codegen change only -- no device-runtime files touched, so this needs a flow re-deploy (not a runtime re-deploy) to test.

**Tested, partially effective**: first deploy after a power cycle still hit the same `Wifi Internal State Error` once; a second deploy (no power cycle) then succeeded immediately -- exactly the shape of a transient, not-yet-fully-settled driver condition rather than a persistent failure. Rather than chase a longer settle delay, added a bounded retry around the `.connect()` call itself (`mqttEnsureConnectedSnippet()`, up to 3 attempts with a 500ms pause, still inside the same lock): a transient first-attempt failure now self-heals within the same deploy instead of needing a manual redeploy; a genuinely persistent failure (bad password, unreachable broker) still surfaces as a NODE_ERROR since the final attempt's exception is re-raised. **Not yet verified against real hardware.**

## Update, 2026-09-04: basic-mqtt roundtrip confirmed working on real hardware

Mike confirmed `basic-mqtt.flow.json` works end-to-end on real hardware -- inject click ->
publish -> subscribe -> debug all functioning. Some edge cases flagged as deferred, not yet
itemized in detail (follow up to get specifics recorded here once known). This resolves the
2026-09-02 silent-failure update above; both candidate causes named there (inject click-fire
missing, the suspected pubsub boot race) are apparently no longer blocking, though neither
was confirmed root-caused in isolation -- worth noting if either resurfaces.

**Caveat, same day:** immediately after this confirmation, Mike found a real WiFi-config-
selection bug (two network nodes in one flow could reference disagreeing WiFi configs -- see
`outstanding-items/wifi-single-owner-fix.md`) and a fix for it landed the same session,
changing the WiFi-resolution codepath every network node type goes through, including
`mqtt_publish`/`mqtt_subscribe`. **`basic-mqtt.flow.json` has NOT been re-tested against real
hardware since that fix landed.** The flow file itself needed only a trivial edit (its two
mqtt nodes' now-inert `wifiConfigId` properties removed; it already had its own `wifi_status`
node providing WiFi credentials, so no structural change was needed) and passes off-device
tests, but a real redeploy + retest is still owed before trusting this combination on a board.

Still not reached: the WiFi-precheck-under-stale-NVS-credentials repro, qos 1, retain, and
outage-recovery from this item's original scope -- none of today's testing exercised those
specifically.

## Update, 2026-09-04 (later the same day): the redeploy+retest above happened, found a confirmed bug, now fixed but unverified

Mike did retest `basic-mqtt.flow.json` after the single-wifi-owner fix, first with invalid ssid/password (compile
succeeded, real-hardware deploy failed: `OSError: Wifi Internal State Error`), then with valid credentials (same
failure). Root-caused to a real ordering bug, not a credentials or timeout problem: `compile.ts` emits every node's
module-scope setup statements in the flow file's own arbitrary node array order, and in `basic-mqtt.flow.json` that
happens to put both mqtt nodes' setup (including the WiFi-reconnect-race precheck from the 2026-09-02 updates above)
*before* `wifi_status`'s own connect call -- so the precheck ran, found nothing in flight yet, passed through as a
no-op, and only then did the real connect race happen moments later. Full root cause and fix:
`outstanding-items/wifi-status-mqtt-connect-ordering-race.md`.

Fixed the same day by moving the precheck's wait logic out of module scope entirely, into
`mqttEnsureConnectedSnippet()` (`mqtt-shared.ts`) immediately before the actual `client.connect()` call -- this runs
strictly after every module-scope statement from every node type has already executed, regardless of node order, so
there's no ordering question left to get wrong. **Not yet run through `tsc`/`vitest`, and not yet redeployed to real
hardware** -- both still owed, on ESP32 (where this was found) and RP2040 (never tested at all, and the precheck's
wait loop is ESP32-gated, so it currently provides zero protection on RP2040 even after this fix).

This is now the single most important unresolved thing this item is tracking: **`basic-mqtt.flow.json` has not
successfully completed a real-hardware deploy since the single-wifi-owner fix landed.** Everything else in this
item's original scope (qos 1, retain, outage recovery, the stale-NVS-credentials repro) is still blocked behind
getting a clean deploy confirmed again.

## Update, 2026-09-05: RP2040 leg passes, ESP32 leg still fails; http_request given canvas presence + loud errors

Both outstanding legs of Problem 1 (`wifi-race-fix-verification-and-network-followups-briefing.md`) were run this
day. **RP2040: pass** — invalid credentials did not reproduce ESP32's `OSError: Wifi Internal State Error`; full
detail, plus a separate unrelated finding (stuck `wifi_status` oscillation, only clears on a power cycle), in
`validation/mvp-validation-plan.md`'s 2026-09-05 RP2040 Results entry. **ESP32: retested, still fails** — same
`OSError: Wifi Internal State Error` crash, now surfacing as a clean, attributed `NODE_ERROR` rather than a raw
crash (see the loud-error work below). Confirms the 2026-09-04 fix narrows the race rather than eliminating it.
Full root cause and status: `wifi-status-mqtt-connect-ordering-race.md`. This is the item's own stop condition
(`wifi-race-fix-verification-and-network-followups-briefing.md`, Problem 1 item 4) — re-open the design rather
than tune bounds/timeouts; candidate shapes are listed in the detail file, none evaluated yet. **Mike's call, not
decided here.**

Same session: `http_request` given real canvas presence (`ports`/Rete class/palette entry/panel section, following
`mqtt-publish.ts`'s worked example — `http-request-config-node-gap.md`, `canvas-presence-gaps.md`) and Problem 2a's
loud-network-error fix extended to it plus `mqtt-shared.ts`/`mqtt-publish.ts`/`mqtt-subscribe.ts` (an OSError from a
connect/publish/subscribe/request call now folds in the operation's own host:port before it reaches `NODE_ERROR` —
exactly what turned the ESP32 finding above from a raw crash into an attributed error). Both left uncommitted at
end of session.

## Update, 2026-09-06: uncommitted 2026-09-05 work verified clean off-device

Verified the 2026-09-05 http_request-canvas + loud-error changes above, from an isolated extraction of `editor/`
(`.verify-tmp/editor-src.tar.gz` → the cloud session's own workspace, per CLAUDE.md's npm/build-from-sandbox rule —
never run against the live-mounted repo): stray-`.js` check clean, `tsc --noEmit` clean, full `vitest` suite green
(28 files, 319 tests, including `node-http-request.test.ts`'s new canvas-presence and Problem 2a tests). **Still
owed: Mike's own real-terminal verify pass (belt-and-braces, matching every prior session's convention), the
actual commit, and `http_request`'s real-hardware GET/POST pass** (`network-hardware-pass-status.md`) — nothing
here has touched real hardware. The ESP32 ordering-race stop condition above is unaddressed and still needs Mike's
design call before any further code changes to it.

## Update, 2026-09-05: RP2040 leg passes, ESP32 leg still fails; http_request given canvas presence + loud errors

Both outstanding legs of Problem 1 (`wifi-race-fix-verification-and-network-followups-briefing.md`) were run this
day. **RP2040: pass** — invalid credentials did not reproduce ESP32's `OSError: Wifi Internal State Error`; full
detail, plus a separate unrelated finding (stuck `wifi_status` oscillation, only clears on a power cycle), in
`validation/mvp-validation-plan.md`'s 2026-09-05 RP2040 Results entry. **ESP32: retested, still fails** — same
`OSError: Wifi Internal State Error` crash, now surfacing as a clean, attributed `NODE_ERROR` rather than a raw
crash (see the loud-error work below). Confirms the 2026-09-04 fix narrows the race rather than eliminating it.
Full root cause and status: `wifi-status-mqtt-connect-ordering-race.md`. This is the item's own stop condition
(`wifi-race-fix-verification-and-network-followups-briefing.md`, Problem 1 item 4) — re-open the design rather
than tune bounds/timeouts; candidate shapes are listed in the detail file, none evaluated yet. **Mike's call, not
decided here.**

Same session: `http_request` given real canvas presence (`ports`/Rete class/palette entry/panel section, following
`mqtt-publish.ts`'s worked example — `http-request-config-node-gap.md`, `canvas-presence-gaps.md`) and Problem 2a's
loud-network-error fix extended to it plus `mqtt-shared.ts`/`mqtt-publish.ts`/`mqtt-subscribe.ts` (an OSError from a
connect/publish/subscribe/request call now folds in the operation's own host:port before it reaches `NODE_ERROR` —
exactly what turned the ESP32 finding above from a raw crash into an attributed error). Both left uncommitted at
end of session.

## Update, 2026-09-06: uncommitted 2026-09-05 work verified clean off-device

Verified the 2026-09-05 http_request-canvas + loud-error changes above, from an isolated extraction of `editor/`
(`.verify-tmp/editor-src.tar.gz` → the cloud session's own workspace, per CLAUDE.md's npm/build-from-sandbox rule —
never run against the live-mounted repo): stray-`.js` check clean, `tsc --noEmit` clean, full `vitest` suite green
(28 files, 319 tests, including `node-http-request.test.ts`'s new canvas-presence and Problem 2a tests). **Still
owed: Mike's own real-terminal verify pass (belt-and-braces, matching every prior session's convention), the
actual commit, and `http_request`'s real-hardware GET/POST pass** (`network-hardware-pass-status.md`) — nothing
here has touched real hardware. The ESP32 ordering-race stop condition above is unaddressed and still needs Mike's
design call before any further code changes to it.
