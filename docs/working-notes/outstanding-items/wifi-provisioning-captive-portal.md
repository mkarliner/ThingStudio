# Tasmota-style soft-AP + captive-portal WiFi fallback — raised by Mike 2026-08-20, no design/scope yet

Raised by Mike 2026-08-20, no design or scope exists anywhere yet. When the device can't connect to its configured
network, it would fall back to hosting its own AP with a captive portal, letting a user scan for and pick a real
network (and presumably persist the result, likely via ESP-IDF's own NVS station-config caching — the same
mechanism that turned out to be the root cause of the redeploy-cleanup WiFi reconnect bug).

**Mike's own note: he believes there's existing MicroPython code for this already** — worth checking before building
from scratch (a common pattern with several published implementations, e.g. search "MicroPython captive portal
WiFiManager"); not verified or evaluated yet, just recorded so whoever scopes this doesn't start from zero.

Directly relevant to `redeploy-cleanup-and-network-fault-detection-briefing.md`'s Problem 2b (`wifi-status.ts`'s
header, `decisions.md`'s "Redeploy / network fault handling" section): making `wifiConfigId` mandatory for
`wifi_status`/`udp_send`/`udp_receive` would have foreclosed this direction outright if there were no way for a
flow to say "something else manages this connection." The new `security: "unmanaged"` state on
`thingstudio/config/wifi` exists specifically to keep this door open — a flow that wants to ride on a
captive-portal-provisioned connection references an `"unmanaged"` config rather than omitting `wifiConfigId` (which
is now a compile error). That state is built; the actual captive-portal/soft-AP provisioning mechanism itself (a
device-runtime boot-time subsystem, most likely, not a flow/node concept at all) is not — needs its own dedicated
scoping session before any implementation starts, same as custom node authoring was before it was scoped.
