# Working note: transport authentication — what v1 must reserve

Status: design note, 2026-08-16. Follows directly from
`rete-migration-decision.md`'s Decision 2 (thin local backend, remote
access a first-class use case) and answers Mike's standing question in
`mikes-questions-and-points.md`: *"do we need a password for access to the
board transport? I'm aware of how insecure iot devices are. I think we
should at least basic security for the board from day 1."*

**Scope, per Mike's steer: reserve the wire format, recommend the minimum
v1 mechanism.** This note deliberately does not design v2 WiFi pairing,
key rotation, or the backend's own account system. It answers one
question — *what must v1 commit to now so that adding real auth later
doesn't strand devices already in the field* — and recommends the
smallest thing that satisfies "basic security day 1."

No code was written. Nothing here is implemented.

---

## 1. Why this became urgent

§9's answer to board security is currently: *"USB serial in v1 has
physical access as its natural gate."* That was sound while the person
clicking Deploy was necessarily the person standing next to the board.

`rete-migration-decision.md` Decision 2 removed that premise. The
architecture is now a backend that runs wherever the devices are, driven
from a browser somewhere else. **The physical gate now protects the
cable, not the deploy path.** A USB-connected device is exposed to
whoever can reach the backend.

So board-runtime auth stops being defence in depth behind a strong
perimeter and becomes the only perimeter left if the backend is
compromised or misconfigured. §9 needs revising regardless of what this
note recommends.

Two perimeters, kept distinct throughout (see
`rete-migration-decision.md` §"Security: two perimeters" for the first):

1. **Editor ↔ backend** — a listening socket. Node-RED's `adminAuth`
   problem. Out of scope here.
2. **Backend/editor ↔ board** — §13 over serial today, WiFi/BLE later.
   **This note.**

---

## 2. Correction: what the one-way door actually is

The initial argument for doing this now — made in
`rete-migration-decision.md` and in conversation — was that §13's wire
format is expensive to change once built and hardware-validated. **Having
read the codecs, that argument is substantially wrong and is worth
retracting explicitly rather than quietly leaning on.**

`editor/src/protocol/codec.ts`'s validators (`validateHello`,
`validateDeploy`, …) pluck named keys via `expectString`/`expectBytes`/
`requirePresent`. There is no check that rejects *extra* keys.
`device-runtime/src/messages.py` follows the same shape. So:

- **Adding optional fields later is cheap.** An old decoder receiving a
  DEPLOY with an added `auth` map ignores it and succeeds.
- **Adding message types later is cheap too.** An unknown type byte
  raises `MessageDecodeError`, which both sides already treat as
  *recoverable* by design (`errors.ts`, and listener.py's hardening
  requirement that no single bad exchange kills the loop). It degrades to
  a logged error, not a hang.

**The real one-way door is not encoding. It is capability advertisement,
and it lives in `HELLO`.**

If v1 ships devices whose `HELLO` says nothing about auth, then when auth
arrives in v1.1 an editor has **no way to distinguish "this device
predates auth" from "this device requires auth and an attacker stripped
the requirement."** That is a textbook downgrade attack, and it is
unfixable retroactively — every device already in the field would need a
manual USB reflash to become distinguishable.

That is the same structural argument as Tier 0's OTA partition-table
hedge (`mvp-feature-priorities.md`: *"the partition layout is a one-way
door … cheap insurance against a future stranding cost"*), and it is the
only part of this problem with that property.

**Consequence: the required v1 commitment is far smaller than first
argued — two fields in `HELLO`.** Everything else can genuinely wait.

---

## 3. Hardware constraints, verified

Checked 2026-08-16 against primary documentation rather than recalled.
These constrain the mechanism choice materially.

**`hashlib.sha256` is available and adequate.** MicroPython's docs list
SHA256 as *"the current generation, modern hashing algorithm… suitable
for cryptographically-secure purposes. Included in the MicroPython core
and any board is recommended to provide this."* HMAC-SHA256 is therefore
reachable on-device with no native module and no firmware rebuild.
(`hmac` itself is a micropython-lib pure-Python module, ~40 lines over
`hashlib` — vendorable the same way `mqtt_as` already is, or trivially
hand-rolled.)

**Asymmetric crypto is not practically available.** MicroPython's builtin
`cryptolib` is AES only. Ed25519/ECDSA verification would need either a
pure-Python implementation (slow enough on a 160MHz single-core RISC-V to
be a real UX cost — *unmeasured, see §7*) or a C-native module, which per
design doc §7 means a firmware rebuild and is the one extensibility case
§7 itself flags as genuinely hard.

**The finding that actually shapes the design — the ESP32-C3's RNG is not
a true RNG under v1's operating conditions.** Espressif's own ESP-IDF
documentation is explicit:

> The hardware RNG produces true random numbers so long as one or more of
> the following conditions are met: RF subsystem is enabled, i.e. Wi-Fi or
> Bluetooth are enabled … **If none of the above conditions are true, the
> output of the RNG should be considered as pseudo-random only.**

and:

> after the application starts executing, then normally only pseudo-random
> numbers are available until Wi-Fi or Bluetooth are initialized

**v1 is USB-only with no WiFi bring-up (§10).** So a v1 device generating
a challenge nonce via `os.urandom()` would be generating it from a
pseudo-random source. The documented escape hatch,
`bootloader_random_enable()`, is a C API in `bootloader_support` — not
exposed to MicroPython, so not reachable from a pure-Python runtime.

Fairness on this point: ESP-IDF also notes the always-on secondary
entropy source (an asynchronous 8MHz oscillator) *"was sufficient to pass
the Dieharder random number test suite without the main entropy source
enabled"* — but immediately adds that true randomness is only
*guaranteed* with the main source enabled. "Probably fine, not
guaranteed" is not a basis for a security primitive when an alternative
avoids the question entirely.

---

## 4. Recommended v1 mechanism

**HMAC-SHA256 over a shared secret, with a monotonic counter instead of a
random nonce.**

The counter is the point. A challenge–response scheme needs the verifier
(the device) to produce an unpredictable challenge — which is exactly
what §3 says a USB-only ESP32-C3 cannot reliably do. A monotonically
increasing counter defeats replay without requiring *any* entropy
on-device:

- The device persists `lastAcceptedCounter` in **§5's flash-backed
  per-node state store, which already exists as a design commitment** —
  no new persistence machinery.
- Every authenticated message carries a counter strictly greater than the
  last accepted one.
- The device rejects anything at or below it.
- The MAC covers the counter along with the message body, so the counter
  can't be tampered with independently.

This gives authenticated, replay-resistant deploys using only
`hashlib.sha256` and one persisted integer. No RNG, no asymmetric crypto,
no native module, no firmware rebuild.

**Honest limitations, stated rather than discovered later:**

- A shared secret means the backend holds a credential that can deploy to
  the board. Compromise the backend, compromise the board. This is a real
  weakening versus asymmetric keys and is the main thing v2 should fix.
- A counter has no notion of time, so it cannot expire a captured-but-
  unused message — only reorder-protect it. Acceptable here; a captured
  valid DEPLOY is only useful once, and only until the next legitimate
  deploy bumps the counter past it.
- Counter state is lost on reflash, resetting the replay window. Since a
  reflash also rewrites the secret, this is consistent rather than a hole.
- **It is not confidentiality.** HMAC authenticates; it does not encrypt.
  Flow bytecode crosses the wire in the clear. For USB that is
  uninteresting; for v2 WiFi it is not, and TLS or equivalent belongs in
  that design, not this one.

### Why not a keypair for v1

Mike raised public/private key auth as an option. It is the better
long-term answer and v2 should go there. For v1 it costs a firmware
rebuild for a native module (or an unmeasured and likely-poor pure-Python
verification time), to defend against a threat — backend compromise —
that a v1 running on the user's own machine or LAN does not yet
meaningfully face. The reservation in §5 below is deliberately designed so
that moving to keypairs later is a `authScheme` string change, not a
protocol revision.

---

## 5. The minimum v1 reservation

**Required — the one-way door. Two fields on `HELLO`:**

| Field | Type | Meaning |
|---|---|---|
| `authRequired` | bool | whether this device will reject unauthenticated mutating messages |
| `authScheme` | string | `"none"` for v1-without-auth; `"hmac-sha256-ctr"` for the §4 mechanism; extensible to `"ed25519"` later |

These must ship in v1's `HELLO` **even if v1 ships `authRequired: false`
and `authScheme: "none"`**, because their *absence* is what can't be
distinguished from tampering later. Adding them costs two lines in
`messages.ts`, `codec.ts`, `messages.py`, and `listener.py`, plus a
`version.matrix.test.ts`-style case. That is the whole mandatory ask.

`version.ts`'s `decideDeploy` is the natural place for the policy, since
it already implements the soft-on-absence/hard-on-mismatch shape this
needs. Note the existing `HELLO` delivery gap applies here too and gets
worse: `main.ts`'s header documents that a device already running when
Connect fires sends no fresh `HELLO`. An auth scheme that depends on
`HELLO` to advertise itself makes the already-flagged `HELLO_REQUEST`
message (currently deferred) close to mandatory.

**Recommended but not load-bearing — reserve type bytes.** `MessageType`
currently uses 1–8 with 0 reserved. Reserve **9–15 for authentication**
in the table's comment now. Costs nothing, prevents a collision when two
future features both reach for 9.

**Not required now — the `auth` field itself.** Per §2, an optional
`auth: { scheme, counter, mac }` map on `DEPLOY`/`STATE_WRITE` can be
added later without breaking existing decoders. Design it when it is
built. Sketch, so the shape isn't re-derived: MAC computed over the
canonical CBOR encoding of the message body *with the `auth` map's `mac`
field absent*, concatenated with the counter — the usual construction, and
worth writing the canonicalization rule down explicitly when built, since
"hash the encoding" is where these schemes normally go wrong.

---

## 6. What this deliberately does not decide

- The backend's own account/session auth (perimeter 1).
- v2 WiFi/BLE pairing and provisioning — §9's existing deferral stands.
- Confidentiality/TLS on any link.
- How the shared secret is provisioned onto a board in the first place.
  For v1 the honest answer is "at flash time, alongside the runtime
  image," which is adequate while flashing requires physical access —
  and is the piece most likely to need rethinking first.
- Key rotation.

---

## 7. Unverified — needs a hardware pass before implementation

Flagged rather than assumed, matching this project's standing pattern
that off-device reasoning does not substitute for a board:

1. **HMAC-SHA256 cost per DEPLOY on the ESP32-C3.** Should be
   milliseconds over a few KB of bytecode, but POC-A's discipline was to
   measure, not assume — and deploy latency is a headline number (§1,
   99ms).
2. **Whether `hashlib.sha256` is actually compiled into the MicroPython
   build in use**, rather than merely recommended by the docs. One-line
   check on the real board.
3. **Pure-Python Ed25519 verification time**, if the keypair option is
   ever revisited for v1. Currently an assumption ("likely too slow"),
   not a measurement.
4. **Whether flash-backed counter writes per deploy pose a wear
   concern.** Almost certainly not at human deploy rates, but it is a
   write on every deploy to a store §5 has not built yet.

---

## 8. Design doc changes this implies

Not made in this session — flagged for whoever picks it up:

- **§4** — "browser-based … no install" no longer describes the intended
  architecture (`rete-migration-decision.md` Decision 2).
- **§9** — the "physical access as its natural gate" reasoning is
  invalidated by remote backend access. This is the substantive one.
- **§13** — "Deliberately not fixed yet: authentication/pairing handshake
  fields" becomes partially fixed: `HELLO` advertises capability in v1,
  the rest stays deferred.
- **§10/Tier 0** — the `HELLO` auth fields belong on Tier 0's list as a
  one-way-door hedge, sitting directly alongside the OTA partition-table
  item, for the same reason and with the same justification.
