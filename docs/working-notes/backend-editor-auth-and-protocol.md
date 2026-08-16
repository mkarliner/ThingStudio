# Working note: editor↔backend perimeter (perimeter 1) and the WebSocket wire shape

Status: decided, 2026-08-16 (design, then confirmed in conversation same
session — both open questions below resolved as proposed). Answers the two pieces
`transport-auth-design.md` explicitly scoped out ("the backend's own
account/session auth (perimeter 1)... out of scope here") and
`backend-platform-decision.md` deliberately left open (the WebSocket wire
protocol's exact shape). Both follow from `rete-migration-decision.md`'s
"Security: two perimeters, not one" section, which named the two postures
this note operationalizes but didn't design the mechanism. Checked against
current documentation and real-world precedent this session rather than
assumed. No code written; nothing here is implemented.

---

## 1. Perimeter 1: the two postures, made concrete

`rete-migration-decision.md` already named two deployment postures and
recommended defaulting to the cheaper one. This note designs the actual
mechanism for both, since "network-secured" and "app-secured" were policy
names, not implementations.

### Posture 1 (default): network-secured, no account system

Backend bound to `127.0.0.1`; remote access, if any, comes from a VPN or
SSH tunnel the user sets up themselves. No password, no session, no TLS —
the original recommendation stands. **What it does still need, corrected
this session:**

**The load-bearing defense is Host-header validation, not Origin.**
`rete-migration-decision.md`'s original phrasing ("`Origin`/`Host`
validation against DNS rebinding") read the two as roughly equal
safeguards; checked against current write-ups of the attack this session
and they aren't. DNS rebinding works by getting a browser to resolve an
attacker-controlled hostname to `127.0.0.1` *after* an initial same-origin
check passes, so a page from `evil.example` can then have the browser's
JS address `ws://127.0.0.1:<port>` — and **same-origin policy does not
cover WebSocket connections from page JS the way it covers `fetch`/XHR**,
so there's no browser-level barrier stopping that connection attempt at
all. The `Host` header on that rebound request still reads
`evil.example:<port>`, not `localhost` — the browser can't forge it — so
**a server that rejects any request whose `Host` isn't on an explicit
allowlist (`localhost`, `127.0.0.1`, `[::1]`, plus whatever address
posture 2 is actually configured to bind to) blocks the rebinding attack
outright.** `Origin` header checking is real but secondary — worth doing
as defense-in-depth against a different, narrower class of cross-site
issue, not the thing that stops DNS rebinding specifically.

**This isn't a hypothetical risk being imported for thoroughness.** The
same attack class has hit tools structurally similar to this one — a
locally-bound WebSocket/HTTP server meant to be reached only by its own
UI, reachable instead from any page the user's browser happens to visit.
A 2026 MCP `rust-sdk` advisory (`GHSA-89vp-x53w-74fx`) documents exactly
this against a Streamable HTTP MCP server transport, and separate 2026
research ("ClawJacked") documents the same pattern against local AI-agent
WebSocket relays. This project's backend is the same shape: a local
process, reachable over WebSocket, doing something consequential (pushing
bytecode to hardware) if it's driven. Worth taking as seriously as it's
been taken elsewhere, not assumed away because "it's just localhost."

**Required for posture 1, concretely:** every request (HTTP and the
WebSocket upgrade) checked against a `Host` allowlist before it's handled
at all. Cheap — one middleware, no dependency needed.

### Posture 2 (explicit opt-in): app-secured

Backend bound to a LAN or public interface. `rete-migration-decision.md`
already called for this to refuse to start without auth configured, fail
closed rather than warn-and-continue — CLAUDE.md's fault-handling
priority applied to a security default, restated here as the concrete
requirement it implies: **the backend process should not bind to a
non-loopback address at all unless a password has been configured**, not
bind-then-warn.

**Mechanism: Node-RED's `adminAuth` is the precedent, checked this
session rather than recalled.** Node-RED stores a `bcrypt`-hashed password
(generated via its own `hash-pw` command) in `settings.js`, checks it
against a login submission, and issues a session token with a configurable
expiry (`sessionExpiryTime`). Thingstudio's version, scaled down to match
what a single-shared-secret v1 actually needs (per `transport-auth-design.md`'s
own board-perimeter precedent — one shared secret, not a multi-user
system): a single `bcrypt`-hashed password in the backend's config, a
`POST /login` that checks it and sets an `HttpOnly`, `Secure` (once TLS is
in the picture), signed session cookie, and a server-side expiry check on
every subsequent request. No per-user accounts, no permissions model —
Node-RED's multi-user/permissions system is more than a single-operator
local tool needs for v1, and it's additive later if a real multi-user case
ever arises, same reasoning `transport-auth-design.md` used for deferring
per-device key rotation.

**Why a cookie, not a bearer token, and why that matters for the WebSocket
half specifically:** the browser's native `WebSocket` constructor cannot
set custom headers (no `Authorization: Bearer …` on a WS handshake from
page JS) — this is a real API limitation, not a design preference. A
cookie-based session works without that problem: browsers attach cookies
to the WS upgrade request automatically for same-origin connections, so
the same session that authenticates the HTTP login also authenticates the
WebSocket, with no token-in-URL query-string workaround needed (worth
avoiding on its own merits — URL query strings leak into logs and
`Referer` headers, a real property to not carry forward here).

**TLS**: still needed for posture 2 per the original recommendation
(directly, or via a documented reverse-proxy posture) — a password sent
over plain HTTP/WS on a LAN is a credential leak waiting to happen.
Mechanics (self-signed vs. real cert, reverse-proxy documentation) not
designed in this note.

### Dependency choice: hand-rolled session, not `aiohttp-session`

Checked this session: `aiohttp-session` has had no new PyPI release in
roughly the past 12 months — the same "release hiatus" signal
`backend-platform-decision.md` already flagged for `pyserial`, but read
with more caution here rather than the same benefit-of-the-doubt, because
this is security-sensitive code, not a stable narrow-surface I/O library.
**Recommended: don't take the dependency.** What's actually needed —
`bcrypt` for password hashing (well-established, standard, worth using
directly rather than reimplementing) plus a signed, expiring cookie — is
small enough to implement directly against the standard library (`hmac`,
`secrets`, `time`) without meaningfully more code than wiring up and
auditing an external session library, and it avoids a supply-chain
dependency for the one piece of this backend where a subtle bug has real
consequences. **Flagged as a recommendation, not a unilateral call** —
worth Mike's confirmation the same way `pyserial-asyncio`'s rejection was,
since "hand-roll the crypto-adjacent bit" is a real trade-off (more code
this project owns and must get right) against "depend on a possibly-thin
library."

---

## 2. WebSocket wire shape: one endpoint, multiplexed by frame type

**Binary frames: §13's CBOR-framed device-protocol bytes, passed through
verbatim.** The backend doesn't decode them — it already has message
boundaries for free from §13's own 2-byte length-prefix framing, so it can
split and forward without understanding CBOR content at all. This is
genuinely "thin": no CBOR encoder/decoder needed on the backend side,
`editor/src/protocol/codec.ts`'s existing logic keeps working unmodified
against the relayed bytes, and `device-runtime/src/messages.py` needs no
awareness a backend exists at all.

**Text frames: JSON, backend control-plane messages with no device
counterpart** — list available serial ports, select/connect to one,
report connection status, and (later, if a fleet/multi-device story is
ever built) which device a given browser tab is currently addressing.
These have no equivalent in §13 because they're backend-local concerns
(which USB port, is the backend even connected to anything yet), not
device protocol.

Browsers' native WebSocket API already distinguishes text vs. binary
frames natively (`event.data` is a `string` or a `Blob`/`ArrayBuffer`
depending on frame type), so this multiplexing costs nothing beyond a
type check on both ends — no envelope-wrapping-an-envelope needed.

**No design doc change implied**, same reasoning `backend-platform-decision.md`
gave for the language/framework choice: §13 specifies the editor↔device
wire format, which this passes through unchanged; the WS multiplexing
scheme is backend-implementation detail sitting above it, the same way
§13 doesn't describe USB's own physical framing either. Flagged for
confirmation rather than assumed, since it's a new layer even if it
doesn't change an existing one.

---

## 3. What this deliberately does not decide

- **TLS mechanics for posture 2** — self-signed vs. real certificate,
  reverse-proxy-documented posture vs. built-in. Flagged, not designed.
- **Packaging/config format** for where the posture-2 password actually
  lives (a config file, an environment variable, a first-run prompt) —
  `deployment-and-distribution-notes.md`'s stale-premise pass is the more
  natural place for this, not decided here.
- **Multi-device/fleet addressing** on the control-plane channel — the
  control-plane message shape above assumes one backend, one device for
  now, matching every other part of this project's current v1 scope
  (§6's "single flow per device," §10's phasing).
- **Rate limiting.** One of the DNS-rebinding write-ups checked this
  session flags uniform rate limiting (including from loopback) as a
  real hardening measure; not scoped here, worth a mention in whatever
  note eventually covers hardening beyond the one-way-door minimum.

---

## 4. Former open questions — resolved 2026-08-16

1. ~~Hand-rolled session vs. `aiohttp-session`.~~ **Resolved: hand-rolled.**
   `bcrypt` plus a stdlib-`hmac`-signed, expiring cookie; no session-library
   dependency taken on.
2. ~~Single shared password (posture 2), no per-user accounts.~~
   **Resolved: confirmed.** Mirrors `transport-auth-design.md`'s
   board-perimeter shared-secret model; a real multi-user/permissions
   story stays deferred until an actual case for it shows up.
