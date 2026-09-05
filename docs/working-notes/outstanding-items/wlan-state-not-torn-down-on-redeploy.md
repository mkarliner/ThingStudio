# WLAN interface state isn't torn down on redeploy -- stray native WiFi driver noise/activity can outlive the flow that started it

Raised by Mike, 2026-09-04: a real hardware test deploying `inject` -> `debug` only (no `wifi_status`/`http_request`/
`udp_send`/`udp_receive`/mqtt node anywhere in the flow) still produced a console line reading

```
E (1494015) wifi:sta is connecting, cannot set config
```

-- a raw ESP-IDF native log line, not a MicroPython `print()`.

## Ruled out: the current flow's generated code

Checked every codegen path that can emit `import network` or touch `network.WLAN(...)`:
`wifi-status.ts`, `http-request.ts`, `udp-send.ts`, `udp-receive.ts` (and mqtt's shared wifi helper, which reuses
`wifi-status.ts`'s `wifiSetupStatement()`) are the *only* places that ever add the `"import network"` setup
statement (`compile.ts`'s `mergeSetup`/`imports` set starts as just `{"import runtime"}`, nothing more, unless a
node's own codegen adds to it). None of those node types were present in the flow that produced this log line, so
the compiled `_flow.mpy` for that deploy contained zero WiFi-touching code. Confirmed by grep across the whole
node-library, not inferred.

## Likely actual cause: leftover native driver state from an earlier deploy, same power cycle

The log line's own `E (1494015) ...` prefix is ESP-IDF's boot-relative uptime (~25 minutes since power-on/hard
reset), not time since this deploy -- consistent with the board having had a WiFi/mqtt-using flow deployed earlier
in the same session, redeployed straight to inject+debug afterward with no power-cycle in between.

This is the same underlying mechanism `redeploy-cleanup-and-network-fault-detection-briefing.md`'s "Problem 2b"
already found and partly addressed: ESP-IDF persists the last successful STA config in its own NVS flash and
reconnects on `.active(True)` alone, independent of whatever Python code is currently running. That briefing's fix
(`wifiConfigId` now mandatory, `"unmanaged"` as the explicit opt-out -- `redeploy-cleanup-network-fault-detection.md`)
addressed the *silently-ambiguous-connected-reading* half of that root cause. It didn't address this half: `runtime.py`'s
`cancel_running()` (called on every redeploy, `listener.py`'s `_handle_deploy`) cancels asyncio tasks and runs the
`register_cleanup()` registry -- but that registry was only ever built out for sockets (`udp_send.ts`/`udp_receive.ts`,
same briefing, item 1). Nothing tears down the WLAN interface itself. A wifi-using flow's still-connecting (or
auto-reconnecting, per ESP-IDF's own internal retry behavior) radio state can keep running natively in the
background across a redeploy, orphaned from whichever flow is deployed afterward -- surfacing as log noise (this
report) at minimum, and potentially interfering with a *later* flow's own network use at worst (an unrelated wifi
node deployed after this one could end up racing, or riding on, a connection attempt it never initiated).

**Confirmed by Mike, 2026-09-04: a power cycle fixed it.** That rules out anything persisted to flash by the flow
itself (a redeploy alone doesn't clear it, a hard power-cycle does) and confirms the leftover-native-driver-state
diagnosis above -- this is in-RAM/radio state carried across redeploys within one power-on session, not anything
`_flow.mpy`/NVS-persisted that a fresh deploy of a clean flow should have to account for on its own.

## Why this isn't a mechanical fix

`wifiSetupStatement()`'s `if not _wifi_sta.isconnected(): _wifi_sta.connect(...)` guard exists on purpose, to let a
wifi-using flow redeploy quickly without dropping and re-establishing the connection every time. Unconditionally
forcing `_wifi_sta.active(False)` in `cancel_running()` on every redeploy would defeat that. The real fix is
conditional -- something like: tear the WLAN interface down on redeploy only when the *newly deployed* flow itself
has no wifi-touching node, leaving it alone when the new flow does. That's a real behavior decision (same standing
as the `wifiConfigId`-mandatory call in the briefing above), not a mechanical one -- needs Mike's sign-off before
building, not a silent default.

## Not investigated yet

- Whether this is purely cosmetic (stray log line, no functional impact on the currently-deployed flow) or can
  actually disrupt a *subsequent* wifi-using flow's own connection attempt -- no hardware experiment run either way.
- Whether `_wifi_sta.disconnect()` alone (vs. `.active(False)`) is sufficient to fix it without a full power-cycle, or
  leaves the same NVS-cached-credential auto-reconnect behavior Problem 2b already documented -- unverified, since
  the confirmation above only tested the power-cycle workaround, not any in-software teardown.

## Addendum, 2026-09-05: same class of bug, new platform, new trigger path (RP2040/cyw43)

While verifying the wifi_status-vs-mqtt_as ordering-race fix on real RP2040/Pico W hardware
(`wifi-race-fix-verification-and-network-followups-briefing.md`'s Problem 1), a related but
distinct symptom turned up: deploying `basic-mqtt.flow.json` with deliberately invalid WiFi
credentials did not crash (unlike ESP32's `OSError: Wifi Internal State Error` -- a genuine pass
for the ordering-race fix specifically, cyw43 doesn't share ESP-IDF's failure mode), but
`wifi_status`'s published value oscillated True/False repeatedly instead of settling on False.
Correcting the credentials and redeploying did **not** clear the oscillation -- only a full power
cycle did.

Same underlying shape as this file's own ESP32 finding above (leftover native WiFi driver/radio
state surviving a redeploy, cleared only by a power cycle, not by any amount of redeploying), via
a different chip's WiFi stack (cyw43, not ESP-IDF) and a different trigger path (invalid-then-
corrected credentials causing an oscillating reconnect loop, rather than a wifi-touching flow's
state simply outliving a redeploy into a non-wifi flow). Not investigated further this session --
no root-cause dig into cyw43's own connection-state machine, no attempt at an in-software fix.
Worth treating as the same open question this file already poses (`## Why this isn't a mechanical
fix` above), now confirmed cross-platform: both known instances only ever clear via a power cycle,
never a redeploy, which is part of why boot-time flow auto-resume was built the same day
(`decisions.md`'s 2026-09-05 entries) -- a reset stops being destructive to the running flow, which
makes "just reset it" (a power cycle, or a future flow-triggered reset node, Mike's own proposal
prompted directly by this finding) a much more viable recovery path than it was before, whether or
not the underlying WLAN-teardown-on-redeploy question above ever gets a real fix.

Still needs, not done this session: a real hardware experiment on RP2040 confirming whether
`.disconnect()` alone (short of a full reset) clears it, and whether this is purely cosmetic
(the oscillating value itself) or can actually disrupt a subsequent flow's own connection attempt
-- same two open questions this file's own "Not investigated yet" section already lists for the
ESP32 case, now also open for RP2040.
