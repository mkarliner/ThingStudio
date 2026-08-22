# MQTTS (MQTT over TLS) — not built, deferred on Mike's explicit call (2026-08-21)

Not built, deferred on Mike's own explicit call (2026-08-21). The vendored `mqtt_as`'s own `config` dict already has
`ssl`/`ssl_params` keys (`device-runtime/src/vendor/mqtt_as/__init__.py`) that neither `mqtt-shared.ts` nor
`thingstudio/config/mqtt-broker` (`config-types.ts`) touches.

Nothing reserved for it either — checked against `CLAUDE.md`'s "don't paint into an architectural dead end"
principle first, not skipped by default: a config's `properties` is a plain JSON blob, so adding a `tls`/`ssl`
field to the broker config later needs no migration of already-saved flow files, unlike a real one-way-door case
(e.g. `HELLO`'s reserved `authRequired`/`authScheme` fields). `decisions.md`.
