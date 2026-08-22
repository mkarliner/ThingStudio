# `http_request` never got the config-node treatment

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

Recommended fix for `http_request` itself: migrate to `resolveWifiCredentials()`/`wifiConfigId` (dropping the
`"open"`-security compatibility shim its header documents, once a real config is required), then wire it onto the
canvas — `ports`, Rete node class, palette entry, `PropertyPanel.vue` section — following `mqtt-publish.ts`'s own
recent worked example. Validation: a local HTTP test server reachable from real ESP32 hardware — GET and POST,
confirming response body/status land in `msg` correctly. Dated Results entry in `mvp-validation-plan.md`.
