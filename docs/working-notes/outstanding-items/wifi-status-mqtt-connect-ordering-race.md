# CONFIRMED BUG, 2026-09-04: wifi_status's WiFi connect can fire after mqtt's own precheck, defeating it

Mike hit this on real hardware testing `basic-mqtt.flow.json` with intentionally invalid ssid/password:

```
[compiled -- 2195 bytes of bytecode]
E (574845) wifi:sta is connecting, cannot set config
DEPLOY_ERR OSError('Wifi Internal State Error',) (before_ram=114064)
```

## Root cause (confirmed by reading the compiler, not just theorized)

`compile.ts` collects every node's module-scope setup statements into one `Map<string, string>`, in whatever order
`sources.forEach` happens to visit nodes -- which is exactly `graphData.nodes`' own array order, i.e. whatever
order the flow file happens to list nodes in. There is no phase/priority concept: "WiFi setup" is not guaranteed to
run before any other network node's setup, it just usually does, by accident of typical node-authoring order.

`basic-mqtt.flow.json`'s actual node order is `inject, mqtt_publish, mqtt_subscribe, debug, wifi_status, debug`.
Because `mqtt_publish` hangs off `inject` (the first source processed) and `mqtt_subscribe` is itself a source
processed before `wifi_status`, **both mqtt nodes' setup code -- including `mqttWifiPrecheckStatement()`, whose
entire job is "wait out any in-flight WiFi connect before mqtt_as's own connect runs" -- lands in the compiled
output BEFORE `wifi_status`'s own `_wifi_sta.connect(ssid, pw)` statement.**

Actual boot sequence for this flow, in order:

1. `mqtt-wifi-connect-precheck` runs. Nothing is in flight yet (nothing has called `.connect()` at all) -- it's
   checking against a device that hasn't started connecting, so it passes through as a pure no-op.
2. `mqtt-client-<broker>-<port>` constructs the `MQTTClient` object (no actual connect call here, just building the
   config dict).
3. `wifi-sta` (from `wifi_status`'s own `wifiSetupStatement()`) finally runs -- **this is the first real
   `.connect()` call**, kicking off a real association attempt.
4. The event loop starts; very shortly after, `mqtt_subscribe`'s/`mqtt_publish`'s coroutine calls
   `mqttEnsureConnectedSnippet()`'s `await client.connect()`, which internally runs `mqtt_as`'s own
   `wifi_connect()` -- issuing a SECOND, independent `.connect()` call on the same physical interface.

If step 3's connect hasn't settled (succeeded or definitively failed) by the time step 4 fires, ESP-IDF refuses
the second config-set: `"sta is connecting, cannot set config"`. Invalid credentials make this far more likely
(a bad password/auth failure can leave the driver "connecting" for longer than a normal fast success/reject), but
nothing about the mechanism is specific to invalid credentials -- it's a real ordering race that could in principle
surface with valid credentials too, under different timing (a slow-to-associate AP, RF interference, etc.).

**Update, 2026-09-04, same session: reproduces with VALID ssid/password too.** Mike retested with real, correct
credentials -- same failure, `OSError: Wifi Internal State Error`. So this isn't "invalid credentials make the race
more likely," it's a real, reliably-hitting timing race on this hardware regardless of whether the credentials are
right -- basic-mqtt.flow.json does not currently deploy successfully at all. This raises the priority: not a rare
edge case to defer, but the default state of the one mqtt test flow this project has.

## Why this wasn't caught before

`mqttWifiPrecheckStatement()`/`mqttEnsureConnectedSnippet()` (`mqtt-shared.ts`, 2026-08-21/2026-09-02) were built
and validated against the **mqtt-vs-mqtt** race (two mqtt nodes sharing one broker client both trying to connect)
-- `mqtt-shared.ts`'s own header is explicit that the real-hardware repro used a flow with no `wifi_status` node at
all. The **wifi_status-vs-mqtt_as cross-node** case was always a documented but *unverified* assumption ("an
accepted v1 duplication, not a conflict... every wrapper proxies to the same one physical station interface" --
that argument is about credential *consistency*, not about *timing safety*). This is the first real-hardware
evidence that the assumption doesn't hold: today's single-wifi-owner fix (`wifi-single-owner-fix.md`) made
`wifi_status` a mandatory, always-present part of any mqtt flow's compiled output, which makes this specific
ordering race come up on every mqtt flow that also has a `wifi_status` node -- not a rare edge case.

## What a real fix looks like (not started, needs sign-off before implementing)

Not a longer timeout -- the precheck protects nothing if it runs before the thing it's supposed to be waiting for.
A durable fix needs the compiler to guarantee WiFi bring-up (`wifi_status`'s own connect) is emitted before any
other network node's setup statements, regardless of the flow file's own node order. Candidate shapes, not
evaluated yet:

- A real ordering/phase concept in `compile.ts`'s setup-statement collection (e.g. a `phase`/`priority` field
  alongside each statement's `key`, with WiFi bring-up always sorted first) -- a real change to the
  `{key, code}` statement contract every node type's codegen already returns.
- Process `wifi_status` nodes first, unconditionally, before the general `sources.forEach` loop -- narrower, less
  invasive, but a special case rather than a general mechanism (and wouldn't generalize to a future second
  interface's own node needing the same guarantee relative to whichever nodes use IT).
- Have the precheck logic re-run (or run for the first time) lazily, right before `mqtt_as.connect()` is actually
  awaited in the coroutine, instead of once at module scope -- closer to "actually wait immediately before the
  thing that needs it," rather than "wait once, early, and hope."

## Fix implemented, 2026-09-04 (same session) -- NOT yet hardware-verified

Went with the third candidate above: rather than adding an ordering/phase system to `compile.ts`, the WiFi-reconnect
wait (formerly `mqttWifiPrecheckStatement()`, a module-scope statement) is now `mqttWifiPrecheckSnippet()`, inlined
directly into `mqttEnsureConnectedSnippet()`'s own generated code (`mqtt-shared.ts`), immediately before the actual
`await client.connect()` call, inside the existing double-checked lock. This sidesteps the ordering question
entirely rather than solving it: by the time ANY coroutine runs (including this one), every module-scope statement
from every node type -- including `wifi_status`'s own connect -- has already executed, in whatever order. There is
no longer a "which statement comes first" question to get wrong, because the wait now runs at coroutine-time, not
module-scope-time.

One real behavior change this required: the wait loop's sleeps changed from blocking `time.sleep_ms()` to
`await asyncio.sleep_ms()`, since this code now runs inside a coroutine with a live event loop (a blocking sleep
here would stall every other coroutine in the flow for up to ~10s while it waits, which was never a problem when
this ran at module scope before the event loop even started).

Changed: `mqtt-shared.ts` (`mqttWifiPrecheckStatement`/`MQTT_WIFI_PRECHECK_KEY` removed, replaced by
`mqttWifiPrecheckSnippet()` inlined into `mqttEnsureConnectedSnippet()`), `mqtt-publish.ts`/`mqtt-subscribe.ts`
(no longer contribute the precheck as a separate statement; dropped the now-unused `import time`). Off-device
tests (`node-mqtt-publish.test.ts`, `node-mqtt-subscribe.test.ts`) updated where they referenced the old function
by name/position in comments -- no test asserted on the precheck's exact statement content or position, so no
test logic needed to change, only stale comments.

## Status

**Confirmed bug, 2026-09-04 (Mike, real hardware). Reproduces with both invalid AND valid credentials -- not an
edge case, basic-mqtt.flow.json did not deploy successfully at all.** Fix implemented same day (above) but **NOT
yet run through `tsc`/`vitest`, and NOT yet redeployed to real hardware** -- per CLAUDE.md, code/test/build commands
against the live-mounted repo are never run from the agent sandbox; Mike needs to run the verify commands and the
real-hardware retest himself before this can be marked actually fixed. This remains the qualifying condition for
the still-outstanding redeploy/retest note in `wifi-single-owner-fix.md` and the "second hardware pass" already
called for in `network-hardware-pass-status.md`.

**Also needs testing on RP2040, not just ESP32 (Mike, 2026-09-04).** Important, specific gap worth flagging: the
wait loop inside `mqttWifiPrecheckSnippet()` is deliberately gated to `sys.platform == "esp32"` -- inherited
unchanged from the original 2026-08-21 fix, which targeted an ESP-IDF-specific driver behavior
(`network.STAT_CONNECTING` not confirmed present on every port). On RP2040, that whole wait loop is a no-op --
only the harmless, unconditional `_sta.active(True)` line runs. `mqtt_as` still hardcodes
`network.WLAN(network.STA_IF)` on every port including RP2040, so the underlying cross-node duplication (this
node vs. wifi_status, both able to call `.connect()` on the same interface) exists there too -- whether RP2040's
WiFi driver (cyw43, not ESP-IDF) has the same "reject a second connect while one is in flight" failure mode, or
degrades some other way, or not at all, is simply unknown until it's actually tested there. Not scoped or
started.
