# Decisions — Board-transport auth (perimeter 2)

Status: detail file, split out of `decisions.md` on 2026-09-06 to keep that index quick to read — content below is unchanged from what previously lived inline there under this same heading. See `decisions.md` for the index, the log's scope boundary, and its maintenance rule.

- **2026-08-16 — HMAC-SHA256 + a persisted monotonic counter, not a
  random-nonce challenge–response.** The ESP32-C3's hardware RNG is not a
  true RNG unless WiFi/BT is enabled, and v1 is USB-only with no radio
  bring-up — a nonce would be pseudo-random. A counter defeats replay
  without needing any entropy on-device. `transport-auth-design.md`.
- **2026-08-16 — Real v1 commitment is just two `HELLO` fields**
  (`authRequired`, `authScheme`), even shipping `authRequired: false`.
  Everything else about the codec is additive and cheap to add later —
  the one real one-way door is capability *advertisement*, not encoding.
  **Still not implemented** — see `outstanding-items.md`. Same note.
- **2026-08-16 — No keypair auth for v1.** Costs a firmware rebuild for a
  native module (or unmeasured, likely-slow pure-Python verification) to
  defend against a threat (backend compromise) v1 doesn't yet meaningfully
  face. Reserved as a future `authScheme` value, not a protocol revision.
  Same note.
