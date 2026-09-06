# Redeploy cleanup / network fault detection (implemented 2026-08-20, hardware pass still owed)

`redeploy-cleanup-and-network-fault-detection-briefing.md` — **implemented 2026-08-20**, all three sub-items:

1. `runtime.py` gained an explicit `register_cleanup`/`cancel_running` cleanup registry, closed over by
   `udp-send.ts`/`udp-receive.ts`'s own setup statements, replacing the GC-timing-dependent redeploy socket leak.
2. `wifiConfigId` is now mandatory for `wifi_status`/`udp_send`/`udp_receive` (Mike's own Option B call), with a new
   `"unmanaged"` config `security` state as the explicit opt-out (see "WiFi provisioning / captive portal" for why
   that state exists).
3. `thingstudio/config/wifi` gained a `security: "password" | "open" | "unmanaged"` field, with an empty password on
   `"password"`-security now a compile-time `CompileError`.

`device-runtime`'s off-device tests (11/11, including 4 new ones) pass against a freshly-built real MicroPython
unix-port binary; the editor suite (262/262 across 29 files, up from 251) passes via `tsc --noEmit` + `vitest run`.

**Update, 2026-09-05/06: `http_request`/`mqtt-shared.ts` DID get the Problem 2a loud-error treatment** (closed
2026-09-05, hardware-confirmed 2026-09-06 on ESP32 -- both the `http_request` hardware pass and the wifi-ordering-
race retest surfaced a real network failure as a clean, attributed `NODE_ERROR`, not just off-device). The claim
below that this was still open is stale; only the redeploy-specific test remains.

**Closed 2026-09-06: real-hardware pass done.** `udp-echo-tester.flow.json` redeployed twice back-to-back with
no power cycle -- clean `DEPLOY_ACK` both times, heartbeat/echo loop resumed normally, no `EADDRINUSE` or any
other bind error. Full detail: `mvp-validation-plan.md`'s 2026-09-06 Results entry. Nothing left open on this
item.
