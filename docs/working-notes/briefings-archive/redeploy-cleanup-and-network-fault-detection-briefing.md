# Briefing: redeploy resource cleanup + loud network-fault detection

For the next chat. Read `CLAUDE.md` in full, as always.

**Check `git log` before assuming anything below is committed.** This
briefing itself, and the fixes it documents finding the need for
(`node-udp-receive.test.ts`'s READY-handshake fix, the design-doc
addendum, the `mikes-questions-and-points.md` node-numbering entry), come
out of a real hands-on hardware pass following
`config-node-and-palette-implementation-briefing.md` — confirm what
actually landed rather than assuming this doc's own account of "current
state" is still accurate.

## Where this came from

`config-node-and-palette-implementation-briefing.md` shipped the
config-node subsystem and palette-wired `wifi_status`/`udp_send`/
`udp_receive` in the previous session; `npm test` came back clean (251/251,
after one flaky-test fix — a guessed 300ms warm-up delay in
`node-udp-receive.test.ts` replaced with a real READY handshake from the
Python subprocess, see that file's own header). This briefing exists
because Mike's own real-hardware pass — the actual bar
`config-node-and-palette-implementation-briefing.md` set as "the real
proof, not the tests" — surfaced two genuine bugs and one real feature
gap that a green test suite couldn't have caught, all in one short
session:

1. Redeploying `udp-echo-tester.flow.json` twice in a row, back to back,
   fails the first time with an `OSError` matching `EADDRINUSE`, then
   succeeds on the second attempt with no other change.
2. `wifi_status`'s debug output showed `payload=True` (connected) despite
   Mike never having set up a WiFi config node at all — the flow itself
   never told the device to connect to anything.
3. The `thingstudio/config/wifi` config type has no way to declare an
   intentionally-open (no-password) network — Mike's own question,
   "I presume it assumes WPA."

A fourth thing surfaced the same session — live console output only ever
showing a raw numeric node ID (`NODE_ERROR node=4`), no way to map that
back to a canvas node without reading the flow file's JSON by hand — is
**already logged** as a priority-bug entry in
`docs/working-notes/mikes-questions-and-points.md` ("Bugs -- priority"
section, dated 2026-08-19). Not this briefing's job; don't duplicate it
here, don't fold it into this scope.

Read, in this order, before writing any code:

1. `docs/working-notes/config-node-and-palette-implementation-briefing.md`
   in full — the data model, the `wifiConfigId`-optional judgment call
   (§"Per-node-type codegen changes"), and the success bar this session's
   hardware pass was actually checking against.
2. `editor/src/node-library/wifi-status.ts` — `resolveWifiCredentials()`
   and `wifiSetupStatement()`, shared by `wifi-status.ts`/`http-request.ts`/
   `udp-send.ts`/`udp-receive.ts`. Its own header already documents the
   "optional, not mandatory" call as a real judgment call, not an
   oversight — this briefing's Problem 2 is that call getting tested
   against reality and needing a second look, not a bug in how it was
   built.
3. `editor/src/node-library/udp-send.ts` / `udp-receive.ts` — the actual
   socket setup/dedup shape (`statements` keyed by e.g. `"udp-send-sock"`/
   `"udp-receive-<port>"`, module-level, shared across nodes referencing
   the same resource) that Problem 1's fix has to work *with*, not around.
4. `device-runtime/src/listener.py`'s `_handle_deploy` and
   `device-runtime/src/runtime.py`'s `cancel_running()`/`spawn()` — the
   actual redeploy path, and Problem 1's root cause.
5. `CLAUDE.md`'s "Engineering priority: fault handling over happy-path
   behavior" section — the directive Mike is invoking by name for Problem
   2 ("barf on undefined network details"). Already this project's stated
   priority; this briefing is that priority applied to a gap it hadn't
   been checked against yet, not a new principle.
6. `docs/working-notes/fault-isolation-briefing.md` — same shape of
   problem (device-side fault handling), useful precedent for how that
   work was scoped and validated (real hardware, dated Results entries,
   off-device tests first where possible).

## Problem 1: redeploy doesn't release resources — real, reproduced, root-caused

**Symptom, Mike's own words:** "doing a compile/deploy gives an
eaddress in use. the next time I do it it works." Confirmed by reading
the actual code, not guessed at.

### Root cause

`_handle_deploy` (`listener.py`):

```python
await runtime.cancel_running()   # cancels old tasks, sleeps 10ms
gc.collect()                     # <- runs while the old module is STILL in sys.modules
before_ram = gc.mem_free()
try:
    with open(_FLOW_PATH, "wb") as f:
        f.write(msg["bytecode"])
    ...
    if "_flow" in sys.modules:
        del sys.modules["_flow"]
    import _flow                 # <- re-runs module-level setup, including sock.bind()
```

`cancel_running()` (`runtime.py`) only calls `.cancel()` on the old
flow's tracked tasks — it never explicitly closes anything those tasks
were holding. A network node's socket (`udp-receive.ts`'s
`_udp_recv_sock_<port>`, `udp-send.ts`'s `_udp_send_sock`) is a
**module-level** global in the old `_flow` module, not something owned
by the cancelled task's own stack frame, so cancelling the task doesn't
touch it. The only thing that ever releases it is the old module object
itself getting garbage-collected — and the one `gc.collect()` call in
this path runs *before* `del sys.modules["_flow"]`, i.e. while the old
module (and its socket) is still referenced, so it can't reclaim
anything. There's no second collection pass between `del` and the new
`import`. Whether the port is actually free by the time the new module
tries to bind it comes down to incidental reference-drop/GC timing —
which is exactly why it's flaky: fails once, then works, because enough
real time (and, this project's own event-loop scheduling) passes between
two manual deploy clicks for the old socket to finally get collected on
its own.

This is real for any *OS-level resource* a redeployed flow's module-level
setup code claims — currently just sockets (the only resource type in the
v1 node set that needs an explicit `.close()` at all; GPIO pin claims are
a different, already-documented gap, "no resource-conflict checking,"
not a leak in this sense). Whatever fix lands here should generalize to
future resource-owning node types (TCP listen sockets, anything else
that opens a file descriptor), not be UDP-specific.

### Why this isn't a quick GC-reordering patch

Moving `gc.collect()` to run *after* `del sys.modules["_flow"]` (and
maybe calling it twice) would probably reduce how often this reproduces,
but it's still relying on incidental collection behavior for something
that needs to be deterministic — exactly the "works by luck" shape
`CLAUDE.md`'s fault-handling priority argues against building on
purpose. Recommended instead:

### Recommended fix: explicit cleanup registry, symmetric with the existing setup dedup

`udp-send.ts`/`udp-receive.ts`'s socket setup is already deduped by a
string key (`mergeSetup`'s "first node's code wins" pattern — same
mechanism `wifi-status.ts`'s `"wifi-sta"` key uses). The natural fix is a
symmetric mechanism on the cleanup side, keyed the same way:

- **`runtime.py`**: a small `_cleanups: dict` (or list of `(key,
  callable)`) plus `register_cleanup(key, fn)`. `cancel_running()` calls
  every registered cleanup — each wrapped in its own try/except so one
  resource's failure to close cleanly can't block the others from
  running or crash the redeploy itself, same "never let one failure kill
  the whole path" convention `_report_error`/`_send_message_safe`
  already follow in `listener.py` — then clears the registry. Recommend
  dedup-by-key here too (only the first registration for a given key
  sticks), matching `mergeSetup`'s own "first node's code wins"
  precedent, so two nodes sharing one socket don't register (and
  double-close) it twice.
- **`udp-send.ts`/`udp-receive.ts`**: the generated setup statement gains
  one line — `runtime.register_cleanup(<same key>, lambda: <sockVar>.close())`
  — self-registering, right where the socket is created. **No
  `NodeDefinition`/`compile.ts` contract change needed** — this is
  entirely inside the Python snippet each node's `statements` already
  emit, the same way `wifiSetupStatement()`'s dedup key is just a string
  both call sites happen to agree on.
- Cleanups should run **after** `cancel_running()`'s existing
  `asyncio.sleep_ms(10)` grace period, not before — closing a socket
  out from under a task that's still mid-`recvfrom()`/`sendto()` on it
  (before cancellation has actually propagated) risks a confusing
  exception inside the task being torn down, instead of a clean
  `CancelledError`. `cancel_running()` becomes the one place fully
  responsible for teardown, matching what its name already implies.
- With this in place, `_handle_deploy`'s existing `gc.collect()` ordering
  doesn't need to change at all — it's only there for the RAM-reporting
  numbers in `DEPLOY_ACK`, not for correctness, once cleanup is explicit
  rather than GC-timing-dependent.

**Judgment call, not resolved here**: whether `register_cleanup` belongs
on `runtime.py` (device-runtime-only, no wire-protocol change, no
compiler awareness of "resources" as a concept) versus surfacing
resource ownership as a first-class thing in the compiler/codegen model
(`NodeDefinition` gaining an optional `cleanup` hook, `compile.ts`
threading it through). Recommend the `runtime.py`-only version above —
smaller, no compiler contract change, and the self-registering-statement
approach already fits inside the existing `statements`/dedup shape
without a new abstraction. Reconsider only if a future resource type
can't express its cleanup as "one line inside the setup statement's own
code" (e.g. something needing async teardown) — cross that bridge if it
comes up, don't build for it speculatively (`CLAUDE.md`'s "no premature
optimization" call).

### Validation

- **Real hardware, the actual reproduction**: deploy a flow with
  `udp_receive` (or `udp_send`) bound to a fixed port, redeploy the exact
  same flow immediately, confirm no `EADDRINUSE`/OSError — repeated
  enough times in a row to be confident it's fixed, not just less flaky
  (POC-A's own 50-consecutive-redeploy stress run is the precedent for
  "how many," §15.1). Dated Results entry once verified, matching this
  project's standing convention — `mvp-validation-plan.md` if this
  counts as Tier 0/1 validation, or this briefing's own follow-up note if
  not; check which before picking.
- **Off-device first**: `device-runtime/test/test_runtime.py` already
  exists and is the natural home for `register_cleanup`/`cancel_running`
  unit tests — verify cleanups fire on `cancel_running()`, verify
  dedup-by-key (register the same key twice, confirm only one close
  call), verify one cleanup raising doesn't prevent the others from
  running. Real hardware is still required for the actual `EADDRINUSE`
  reproduction (socket/OS behavior, not something the unix-port build
  can fully stand in for) but the registry mechanism itself is plain
  Python logic, testable off-device first per this project's own
  standing convention.

## Problem 2: "barf on undefined network details" — extending fault-handling to network completeness

Mike's own framing, tying directly to `CLAUDE.md`'s existing fault-
handling-over-happy-path priority. Two distinct gaps, both real,
surfaced by the same hardware pass:

### 2a. A network op failing gives an opaque, unattributable error

The actual console output Mike hit:

```
NODE_ERROR node=4 type=OSError msg=-202
```

`udp_send` already validates `host` is non-empty at compile time
(`throw new CompileError('udp_send requires a non-empty "host"')`) — so
this wasn't an empty field. It's the harder case: a value that's
*present* but wrong (a template placeholder never replaced, a typo, an
address unreachable from wherever the device actually ended up
connected — see 2b), which no amount of "is this field populated"
validation catches, and which MicroPython's own error surface doesn't
make easy to diagnose on its own — `OSError: -202` isn't a documented
errno and isn't self-explanatory (confirmed against MicroPython/ESP32
forum threads: the same numeric code shows up for at least two unrelated
root causes elsewhere — a stale static-IP config and socket resource
exhaustion — so the number alone doesn't diagnose anything reliably).

**Recommended fix, mechanical, no new architecture**: catch `OSError` at
each network node's own call site (`udp-send.ts`'s `sendto` retry loop,
`udp-receive.ts`'s `recvfrom` retry loop, `http-request.ts`'s request
call, `mqtt-shared.ts`'s connect) and re-raise with the operation's own
context folded into the message — target host:port, what was being
attempted — before it reaches `runtime.py`'s existing `NodeError`/
`_guarded()` machinery. That machinery already reports node ID +
exception type + message accurately (§5, already built, already
tested); the fix is making sure the **message** itself carries enough
to diagnose without opening the generated source, not building new
reporting infrastructure. Small, per-node-type, same shape of change
across `udp-send.ts`/`udp-receive.ts`/`http-request.ts`/
`mqtt-shared.ts` — a mechanical batch, not a redesign.

### 2b. A "connected" reading that isn't attributable to this flow at all

`wifi_status` showed `payload=True` with no WiFi config node set up
anywhere in the flow. Not a bug in what was built — `wifi-status.ts`'s
own header already documents "no `wifiConfigId` → interface brought up,
no connect call, rides on whatever's already there" as a deliberate,
flagged judgment call — but real-world testing shows that call producing
exactly the silently-ambiguous behavior the fault-handling priority
warns against: the device was very likely riding on WiFi credentials
cached in its own flash from earlier bring-up/testing (ESP-IDF persists
the last successful station config in NVS and reconnects on
`.active(True)` alone), meaning `payload=True` reflected the *chip's*
history, not anything *this flow* declared. If that cached network
happens not to be reachable from wherever `udp_send`'s target host
actually lives, that's also a very plausible contributor to 2a's
failure — two symptoms, one underlying cause.

**Worth Mike's explicit sign-off, not a default to reinterpret
silently** — same standing this project already gives real behavior
reversals (see `config-node-and-palette-implementation-briefing.md`'s
own "whether wifiConfigId is mandatory... is a real behavior decision,
not a default to sleepwalk into"). Two options, not a mandate:

- **Option A (cheap, no runtime behavior change)**: leave `wifiConfigId`
  optional as-is; fix the property panel's own copy so leaving it empty
  reads as "ride on whatever the device already has, this flow isn't
  declaring a network" rather than looking like an oversight. Doesn't
  stop the ambiguity, just labels it honestly.
- **Option B (matches "barf on undefined" literally)**: a network node
  with no `wifiConfigId` becomes a compile-time `CompileError` **unless**
  something in the flow explicitly opts out of a managed connection —
  i.e. the current "empty string means implicit ride-along" behavior
  stops being the unlabeled default and becomes something a flow author
  has to state on purpose. The WiFi config type's new `security` field
  (Problem 3, below) gives a clean, non-hacky place to express that
  explicit intent without a separate mechanism.

Recommend **Option B** as the one that actually matches what Mike asked
for here, but flag plainly that it reverses a documented judgment call
from the immediately-prior session — implement it as a deliberate,
acknowledged change, not a silent reinterpretation, and update
`wifi-status.ts`'s own header (and the config-node briefing's "Worth
flagging explicitly" section, retroactively, so the history stays
honest) when it lands.

## Problem 3: WiFi config type has no way to declare an open network

Mike: "wifi properties does not have a security field, so I presume it
assumes wpa. we should be able to have other choices." Checked against
the real MicroPython API before writing this, not assumed:

- `WLAN.connect(ssid, key)` has **no explicit security/authmode
  parameter for station mode** — the driver auto-negotiates whatever the
  AP advertises. WPA/WPA2/WPA3-Personal are all handled transparently by
  the same `connect(ssid, password)` call already generated today; there
  is no version-selector dropdown to build because the underlying API
  genuinely doesn't take one. (`config()`'s `security`/`key` parameters
  are documented for **AP mode** — hosting a network — not station mode,
  a different use case this project doesn't need here.)
- An **open (no-password) network already works today**, mechanically:
  `wifiSetupStatement()` already calls `.connect(ssid, "")` when password
  is empty, which MicroPython's station driver treats as "no security."
  This isn't a missing capability, it's a missing **affordance** — nothing
  in the property panel tells a flow author that leaving password blank
  is a valid, intentional choice rather than an incomplete field.
- **WPA2-Enterprise (802.1X — identity/username, sometimes client
  certs) is genuinely not supported by MicroPython's stock ESP32 port**
  — confirmed via multiple long-standing, still-open upstream issues
  (not a "just needs wiring up" gap):
  [No support for ESP32 WPA2 Enterprise WiFi](https://github.com/micropython/micropython/issues/16681),
  [ESP32 WPA2 Enterprise · Issue #8819](https://github.com/micropython/micropython/issues/8819),
  [ESP32: WPA2-Enterprise support · Issue #5705](https://github.com/micropython/micropython/issues/5705).
  Treat as explicitly out of scope pending upstream support, not a
  deferred TODO this project can just build later — there's no clean
  workaround short of custom firmware.

**Recommended change**: add `security: 'password' | 'open'` (default
`'password'`) to the `thingstudio/config/wifi` config type — one more
field on the existing `ConfigRefField` widget, same generic
label+field-list pattern the config-node briefing already established,
no new component. This isn't about implementing different auth
protocols (the API doesn't need that); it's about making "intentionally
open" a **distinguishable, explicit state** instead of indistinguishable
from "forgot to fill in the password" — which is also exactly the hook
Problem 2b's Option B needs: a config with `security: 'password'` and an
empty/missing password should be a loud `CompileError` (a real mistake,
almost certainly), while `security: 'open'` explicitly says "this is
correct, there is no password."

**Not recommended**: a WPA/WPA2/WPA3 version-selector (the driver
already picks the right one against the AP; there's nothing for a
flow author to choose) or WEP support (deprecated, insecure, not worth
the surface even where a port technically still exposes it).

## Success criteria

- Redeploying a flow with a bound UDP socket (`udp_receive` on a fixed
  port, or any future resource-owning node type) twice in a row, back to
  back, on real hardware, no longer raises `EADDRINUSE`/`OSError` on the
  first attempt — verified by actually reproducing Mike's own repro
  steps and confirming it's fixed, not just "looks right in the diff."
- A network op failing on real hardware reports enough in `NODE_ERROR`'s
  message to diagnose without opening generated source or guessing at an
  undocumented errno — target host:port and the attempted operation, at
  minimum.
- `thingstudio/config/wifi` has a `security` field distinguishing
  intentionally-open from password-protected, and an empty password on a
  `'password'`-security config is a loud compile-time error, not a
  silent no-op connect.
- Whichever of Problem 2b's Option A/B Mike picks is actually
  implemented (not left as "recommended" in this doc forever) and
  `wifi-status.ts`'s header comment is updated to match, honestly
  reflecting whichever way it landed.
- `./node_modules/.bin/tsc --noEmit` clean (direct binary, check for
  stray compiled `.js` first, per `CLAUDE.md`), `device-runtime`'s
  off-device tests green, a real hardware pass confirming Problem 1's
  fix and re-testing `udp-echo-tester.flow.json` end to end (this is the
  same flow file the previous session's success bar was built around —
  worth closing the loop on the actual thing that surfaced all three
  problems here).

## Stop conditions

- The cleanup-registry approach for Problem 1 turns out not to compose
  with some future resource type's teardown needs (e.g. genuinely async
  cleanup) — stop and reconsider rather than forcing it through the
  same-shape mechanism designed around synchronous `.close()` calls.
- Problem 2b's Option B (mandatory network declaration) turns out to
  break some currently-valid flow shape not anticipated here (e.g. a
  flow that deliberately has no network nodes at all reaching this check
  by accident) — verify the check is scoped to network-node types
  specifically, not applied broadly, before landing it.
- Any existing test suite needs modifying (standing condition every
  prior session in this repo has used).

## Not in scope for this chat

- The node-numbering/console-legibility bug — already logged separately
  in `mikes-questions-and-points.md`, not this briefing's job.
- `http_request`/`mqtt_publish`/`mqtt_subscribe` getting the config-node
  treatment — still the explicitly-flagged follow-up from the previous
  session, unrelated to what this briefing covers (though 2a's "loud
  network errors" fix should probably touch `http-request.ts`/
  `mqtt-shared.ts` too while in the area — judgment call for whoever
  picks this up, not mandated here).
- WPA2-Enterprise support — genuinely blocked upstream, see Problem 3.
- Pin/peripheral resource-conflict detection (two flows claiming the
  same GPIO) — a different, already-documented gap
  (`node-definition-model.md`), not the same class of bug as Problem 1's
  socket leak (that's "never cleaned up," this is "no conflict check at
  all"), don't conflate them.
- Per-device WiFi config override — still v2, `thingstudio-design-doc.md`
  §6/§10, unrelated to the `security` field addition here.

## Git

Same standing rule as every other session: git writes (`add`/`commit`)
go to Mike as exact commands to run himself in a real Terminal, not run
from the sandbox (`CLAUDE.md`, confirmed `.git/*.lock` corruption bug).
Read-only git commands are fine.
