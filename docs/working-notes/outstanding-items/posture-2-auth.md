# Posture-2 auth (app-secured) — not built, split from the backend/auth item, 2026-09-07

**[P4].** Split from `backend-auth-overview.md` on Mike's call: this is real work, but lower priority than getting
the backend itself (platform, relay, posture-1 Host-header allowlist) built and shipped under its default,
no-account posture. Not needed until the backend is actually bound to a LAN or public interface.

Design is decision-complete in `backend-editor-auth-and-protocol.md` §1 "Posture 2 (explicit opt-in):
app-secured" — zero code written against it:

- Single `bcrypt`-hashed password in the backend's config; `POST /login` checks it and sets an `HttpOnly`,
  `Secure` (once TLS is in the picture), signed session cookie — cookie, not bearer token, because the browser's
  native `WebSocket` constructor can't set custom headers on the handshake.
- Hand-rolled session (stdlib `hmac`/`secrets`/`time`), not the `aiohttp-session` dependency — flagged in the
  design note as a recommendation needing confirmation, not a unilateral call, since it's security-sensitive
  code.
- **Fail closed**, per CLAUDE.md's fault-handling priority: the backend must not bind to a non-loopback address
  at all unless a password is configured — not bind-then-warn.

**Also not decided anywhere yet** (per `backend-editor-auth-and-protocol.md` §3 and `backend-platform-decision.md`
§7), and part of this item's scope once picked up:

- TLS mechanics for posture 2 — self-signed vs. real cert, or a documented reverse-proxy posture.
- Packaging/config format for where the posture-2 password actually lives (config file, env var, first-run
  prompt) — flagged as more naturally `deployment-and-distribution-notes.md`'s scope, which itself still needs a
  pass to update its stale pure-browser-era premise.
- Rate limiting (including from loopback) — named in the design note's own DNS-rebinding research as a real
  hardening measure, not scoped there.
