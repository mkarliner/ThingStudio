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

**Still owed, needs Mike + real hardware:** the actual real-hardware pass this briefing's own success criteria
require — redeploying `udp-echo-tester.flow.json` twice back-to-back with no `EADDRINUSE`, and confirming a real
network failure's `NODE_ERROR` message is actually diagnosable on-device, not just in the generated source.
`http_request`/`mqtt-shared.ts` did NOT get the Problem 2a loud-error treatment (briefing flagged this as a judgment
call, not mandated) — still open, see the network-hardware and loud-error items.
