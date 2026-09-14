# Decisions — Config nodes / Tier 1 scope

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

- **2026-08-17 — Tier 1 item 5 resolved: interrupt/pin-change (replacing
  `gpio_in`), filter/event-compression, and four UDP/TCP nodes pulled into
  v1.** ADC and file ops rejected as node types entirely (both reduce to
  a `function`-node one-liner or an already-tracked need elsewhere); mDNS
  deferred to v2 (MicroPython support unconfirmed across targets); HTTP-in
  (on-device server) stays deferred per §6's existing dashboard reasoning.
  `tier1-node-candidates-prioritization-briefing.md`.
- **2026-08-21 — `boolean`/`arithmetic`/`comparator` node types removed
  entirely, same reasoning as ADC/file ops above.** Mike's call, checked
  rather than rubber-stamped: the one real counter-argument (a dedicated
  node could carry narrower, statically-checked port types than
  `function`'s necessarily-`any` ports) didn't hold for the code as
  shipped — none of the three declared a `ports` field, so they had zero
  type-safety benefit in practice, and all three were single-input
  transforms against a configured constant, so `function` was already a
  strict functional superset. Never wired onto the canvas. Not a one-way
  door — nothing deployed references these types, cheap to re-add later
  if canvas wiring + real typed ports is ever actually built for them.
  `thingstudio-design-doc.md` §6 addendum, `registry.ts`.
- **2026-08-18 — Config nodes: build Node-RED's per-flow, referenced-by-ID
  pattern, not the design doc's original per-device-override vision.**
  Direct override from Mike ("entering ssid credentials multiple times is
  not acceptable even for an MVP") — smaller, fixes the actual pain,
  per-device override stays a v2 layer on top.
  `config-node-and-palette-implementation-briefing.md`.
- **2026-08-18 — A config reference (`wifiConfigId`) stays optional, not
  mandatory**, for the four non-MQTT network node types — smaller behavior
  change, keeps a config-less flow compiling exactly as before. Same
  note.
- **2026-08-21 — `mqtt_publish`/`mqtt_subscribe` migrated to `wifiConfigId`
  (closing the last flagged config-node follow-up besides `http_request`)
  and given real canvas presence for the first time in the same change.**
  A referenced config with `security: "unmanaged"` is rejected as a
  `CompileError` for these two specifically, diverging from
  `wifi_status`/`udp_send`/`udp_receive` — `mqtt_as` always drives its own
  connect/reconnect loop and needs real credentials to do so, so there's
  no "ride on an externally-managed connection" mode to map `"unmanaged"`
  onto. `mqtt-shared.ts`, `mqtt-publish.ts`, `mqtt-subscribe.ts`,
  `thingstudio-design-doc.md` §6 addendum.
- **2026-08-21 — Second config type, `thingstudio/config/mqtt-broker`
  (`broker`, `port`, `username`, `password`), for `mqtt_publish`/
  `mqtt_subscribe`'s broker connection — Mike's own same-day follow-up
  request.** `brokerConfigId` is mandatory from day one, no
  optional-then-later-reversed cycle the way `wifiConfigId`'s own
  mandatory-ness was (the immediately preceding entry) — there's no
  sensible default broker to fall back to the way an already-connected
  WiFi interface is a sensible "ride on it" fallback. Kept as a SECOND,
  independent config reference rather than folded into
  `thingstudio/config/wifi` — the WiFi network and the MQTT broker are
  authenticated to with two genuinely different credential pairs
  (`mqtt_as`'s `ssid`/`wifi_pw` vs. its `user`/`password` config keys).
  `username`/`password` are optional (no forced-non-empty check the way
  the WiFi config's password gets) — an unauthenticated broker is a
  normal, common setup, not a likely-forgotten-credential case. MQTTS
  (TLS) explicitly deferred without reserving a field for it — checked
  against `CLAUDE.md`'s one-way-door principle first: a config's
  properties are a plain JSON blob, so this isn't a one-way door, unlike
  `HELLO`'s reserved auth fields. `config-types.ts`, `mqtt-shared.ts`,
  `outstanding-items.md`.
- **2026-09-13 — WiFi/MQTT-broker config nodes stop holding real secret
  values at all; the actual ssid/password/broker/username/password bundle
  moves into a new, backend-owned, name-keyed credential store
  (`~/.thingstudio/credentials/<type>/<name>.json`), referenced from the
  config node by a `credentialName` string ("Option B," the whole bundle
  externalized, over "Option A," a partial secrets-only externalization).**
  Picked back up from Mike's own fresh ask ("Save credentials to
  persistence store in .thingstudio, not in flow"), resolving the
  deferred `credential-free-committable-flows.md` item the same way.
  Three further decisions confirmed the same day: renaming/deleting a
  saved credential is out of scope for v1 (no flow-file migration story);
  a credential's value is shared by every config referencing it by name,
  by design; resolution happens once, at flow-load time, keeping
  `resolveConfig()`/`compile.ts` fully synchronous. A resolved credential
  is merged into the same in-memory `properties` object `resolveConfig()`
  reads, but `extractConfigsSnapshot()` filters that object back down to
  only the field names `config-types.ts` still declares (now just
  `credentialName`/`security`) before a flow saves, so a real secret never
  round-trips into the committed `.flow.json`. `persisted_store.py`,
  `admin_api.py`, `credential-types.ts`, `CredentialRefField.vue`,
  `config-types.ts`, `main.ts`, `docs/working-notes/outstanding-items/
  credential-storage-design.md`.
