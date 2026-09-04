# `http_request`'s WiFi-config migration (closed 2026-09-04); canvas presence still open

`config-node-and-palette-implementation-briefing.md` landed the config-node subsystem and wired
`wifi_status`/`udp_send`/`udp_receive` onto the canvas sharing one `thingstudio/config/wifi` object; `http_request`
is still registry-only, duplicating raw credentials per instance. Explicitly flagged as a follow-up in that
briefing's own success-criteria section, not a silent scope cut.

**`mqtt_publish`/`mqtt_subscribe` closed this same gap 2026-08-21** — both migrated to `wifiConfigId` (via
`mqtt-shared.ts`'s `parseMqttBrokerProps`, reusing `wifi-status.ts`'s `resolveWifiCredentials()`) and given real
canvas presence for the first time (see the canvas-presence-gaps item). One deliberate divergence from the other
three migrated kinds: a referenced WiFi config with `security: "unmanaged"` is a `CompileError` here, not a
supported state — `mqtt_as` always drives its own connect/reconnect loop and needs real credentials to do so.

**Same day, on Mike's own follow-up request: a second, independent config type,
`thingstudio/config/mqtt-broker`**, holding `broker`/`port` and (new) broker-level `username`/`password` auth
(`config-types.ts`) — referenced via a new `brokerConfigId` property, mandatory from day one (no
"unmanaged"-equivalent opt-out; there's no sensible default broker to fall back to). `broker`/`port` are no longer
raw properties on either node. `username`/`password` here are `mqtt_as`'s own broker-level auth fields
(`config['user']`/`config['password']`), distinct from the WiFi config's own `ssid`/`password` — two independent
credential pairs authenticating to two different things, resolved via two separate `ConfigRefField` instances in
the property panel.

MQTTS (TLS) explicitly deferred, not built as part of this — see the mqtts-tls-deferred item. `decisions.md`.

**WiFi-config half closed 2026-09-04**, as a side effect of the single-wifi-owner fix
(`outstanding-items/wifi-single-owner-fix.md`): `http_request` no longer reads raw `ssid`/`password` off its own
properties, and the `"open"`-security compatibility shim is gone. It didn't get its own `wifiConfigId` the way
`mqtt_publish`/`mqtt_subscribe` originally did, though — by the time this node was migrated, those two (and
`udp_send`/`udp_receive`) had ALSO lost their own `wifiConfigId` in favor of deriving from the flow's one
`wifi_status` node, so `http_request` went straight to that same flow-wide derivation
(`resolveFlowWifiCredentials()`, `wifi-status.ts`) rather than gaining a per-node config reference just to lose it
again immediately.

**Still open: canvas presence.** No `ports`, no Rete node class, no palette entry, no `PropertyPanel.vue` section —
wire it onto the canvas following `mqtt-publish.ts`'s own worked example (`ports`/Rete class/palette entry/panel
section), matching every other now-canvas-wired network node type. Validation once that's done: a local HTTP test
server reachable from real ESP32 hardware — GET and POST, confirming response body/status land in `msg` correctly,
and that it actually derives WiFi credentials from the flow's `wifi_status` node on real hardware, not just
off-device. Dated Results entry in `mvp-validation-plan.md`.
