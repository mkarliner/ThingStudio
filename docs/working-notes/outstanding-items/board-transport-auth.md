# Board-transport auth — the one required piece is still unbuilt

`transport-auth-design.md` (2026-08-16) recommends HMAC-SHA256 + persisted counter for v1.1+, but names exactly one
thing as a real, cheap, one-way-door hedge for v1 itself: two new fields on `HELLO` (`authRequired: bool`,
`authScheme: string`), even shipping `authRequired: false`/`authScheme: "none"` — so a future device with real auth
can be told apart from an old one an attacker stripped auth from. `mvp-feature-priorities.md`'s Tier 0 list picked
this up 2026-08-16 as a committed item; no commit implementing it has landed. Cheap (two lines per side in
`messages.ts`/`codec.ts`/`messages.py` plus a version-matrix test case) and still open.

**Resolved 2026-09-24** with the WiFi transport (`wifi-transport-scoping.md`): `HELLO` now carries
`authRequired`/`authScheme` (plus `hostname`, `hasWifi`, `networkAddress`), runtime 3.0.0. `authRequired` is true
once a board password is set; the scheme is `hmac-sha256-nonce` for WiFi sessions. Serial stays unauthenticated.

