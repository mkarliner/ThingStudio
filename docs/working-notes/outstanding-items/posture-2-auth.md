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


## Addendum, 2026-09-08 -- real motivating use case for a non-loopback bind

Raised by Mike while scoping the admin-API fetch client: he wants to run the backend on a
machine in a firewalled environment near the actual IoT devices, and edit/debug from a
separate dev machine. Checked with him directly which of the two postures this needs --
confirmed **for now** it's the cheap one, not this item: an SSH/VPN tunnel from the dev
machine into the firewalled box's loopback interface (`ssh -L 8765:localhost:8765 ...` or
equivalent), so the backend keeps binding to loopback exactly as `__main__.py` already
requires, and the Host header the backend sees still reads as loopback -- no code change
needed anywhere for that shape, and it's exactly the "network-secured / localhost-behind-a-
VPN" default posture design doc §9 already names. `cors.py`'s reflect-any-Origin default
(2026-09-08, backend-persisted-data-protocol.md) was chosen with this in mind: it doesn't care
what origin the editor is served from or how it's tunneled to the backend.

**Explicitly flagged as wanted eventually, not forgotten:** the *other* shape -- the backend
binding directly to a non-loopback interface on the firewalled machine (e.g. a Tailscale/VPN
interface IP) so no separate tunnel step is needed at all -- is what this item actually covers,
and Mike still wants it, just not urgently. Whoever picks this up next should read this
addendum for the concrete real-world driver rather than working from the abstract "not needed
until bound to a LAN or public interface" framing above alone.


## Addendum, 2026-09-08 -- re-tagged P4 -> P3

Mike's call while triaging next-session work: this item moves from **[P4]** to **[P3]** in `outstanding-items.md`. Still deferred -- not picked up this session, not needed until the backend binds to something other than loopback -- just re-ranked relative to other open items.
