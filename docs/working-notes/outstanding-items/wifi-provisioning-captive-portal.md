# Tasmota-style soft-AP + captive-portal WiFi fallback — raised by Mike 2026-08-20, no design/scope yet

Raised by Mike 2026-08-20, no design or scope exists anywhere yet. When the device can't connect to its configured
network, it would fall back to hosting its own AP with a captive portal, letting a user scan for and pick a real
network (and presumably persist the result, likely via ESP-IDF's own NVS station-config caching — the same
mechanism that turned out to be the root cause of the redeploy-cleanup WiFi reconnect bug).

**Mike's own note: he believes there's existing MicroPython code for this already** — worth checking before building
from scratch (a common pattern with several published implementations, e.g. search "MicroPython captive portal
WiFiManager"); not verified or evaluated yet, just recorded so whoever scopes this doesn't start from zero.

**Refined, 2026-09-04** (same session as the single-wifi-owner fix, `wifi-single-owner-fix.md`): Mike confirmed
the intent behind an "unnamed"/blank-ssid WiFi config is specifically this — asking the microcontroller to scan
at runtime and present real networks in a dropdown to pick from, rather than compiling a specific ssid/password
into the flow at all. This is the same feature as the soft-AP/captive-portal fallback above, not a separate one —
just confirms the concrete UX (scan → dropdown) that was previously just "let a user scan for and pick a real
network." Still no design/scope beyond this.

Directly relevant to `redeploy-cleanup-and-network-fault-detection-briefing.md`'s Problem 2b (`wifi-status.ts`'s
header, `decisions.md`'s "Redeploy / network fault handling" section): making `wifiConfigId` mandatory for
`wifi_status`/`udp_send`/`udp_receive` would have foreclosed this direction outright if there were no way for a
flow to say "something else manages this connection." The new `security: "unmanaged"` state on
`thingstudio/config/wifi` exists specifically to keep this door open — a flow that wants to ride on a
captive-portal-provisioned connection references an `"unmanaged"` config rather than omitting `wifiConfigId` (which
is now a compile error). That state is built; the actual captive-portal/soft-AP provisioning mechanism itself (a
device-runtime boot-time subsystem, most likely, not a flow/node concept at all) is not — needs its own dedicated
scoping session before any implementation starts, same as custom node authoring was before it was scoped.

**Scoping session, 2026-09-14 (this file's own "needs its own dedicated scoping session" note, above,
acted on).** Design only -- no code this session, Mike's own explicit call. Confirmed with Mike before
writing this up:

*Trigger condition.* Baseline is first-run only: a flow's `thingstudio/config/wifi` config set to
`"unmanaged"` (§6 of the design doc) is the flow author's declared intent that the device should
self-provision via captive portal, and the device only enters soft-AP/portal mode when it has no
on-device-provisioned credential stored yet. A later connect failure does NOT reopen the portal by
default. A separate, new boolean field on the same config (off by default, name TBD -- e.g.
`allowReprovisioning`) opts into re-entering the portal on a later connect failure too, not just
first-run -- kept as its own field rather than folded into `security`, same reasoning
`wifi-status.ts`'s `deferToMqtt` was kept separate from `security` (flow-author-declared intent vs. a
second, independently-toggled choice). **Mike's explicit caveat, carried into the docs/property-panel
copy once built, not just this file:** that fallback flag is only safe to enable on a trusted/physically
-controlled network. Re-opening an unauthenticated AP + captive portal any time WiFi drops is itself an
attack surface -- anyone in radio range during the drop can connect to the portal and redirect the
device's WiFi target. This needs a loud warning next to the checkbox, not a quiet default-off setting
that's easy to flip without reading. Worth a line in design doc §9 once this is built, not just here.

*Config semantics.* `"unmanaged"` stays a single value covering both "the built-in captive-portal
subsystem owns this" and any other externally-managed case -- not split into a new value. The
fallback boolean above is what actually distinguishes device-side self-provisioning from a flow that
merely rides on some other already-established connection with no provisioning story at all.

*Credential persistence.* A dedicated on-device flash file this feature owns, not ESP-IDF's NVS
auto-reconnect cache -- that NVS mechanism is the confirmed root cause of the redeploy-cleanup WiFi
reconnect bug this project already hit once (`decisions/redeploy-network.md`). Explicit read/write of
a known file, connect from that on every boot, is consistent with this project's fault-handling-over-
happy-path priority (CLAUDE.md) the same way the rest of this WiFi code already is -- no implicit
platform-cache behavior to reason about later.

**Where this actually lives, architecturally -- the real open question underneath all of the above:**
there is currently NO boot-time subsystem in this codebase at all. `device-runtime/src` has no
`boot.py`/`main.py` entry point; `listener.py` (the §13 protocol listener) is the earliest code that
runs today, and WiFi is otherwise a pure per-flow, generated-code concern (`wifiSetupStatement()` in
`wifi-status.ts`, invoked from the deployed flow's own compiled source -- confirmed by reading that
file's header and `resolveWifiCredentials()`/`resolveFlowWifiCredentials()` in full). This feature is
the first thing in the project that needs code to run BEFORE the listener starts and BEFORE any
deployed flow's code runs at all -- checking for a stored credential, deciding portal-vs-connect,
doing the provisioning dance, THEN handing off to the existing boot sequence. That hand-off point (and
what currently owns "the existing boot sequence" today -- `test-flows/deploy_runtime.py`'s own push
list is the closest thing to an answer, not investigated further this session) needs its own look
before implementation starts, not just the WiFi-specific pieces above.

**Web server library -- researched per Mike's ask, not hand-rolled, matching this project's
prefer-an-existing-permissively-licensed-library-over-reinventing-one stance (§12, and the `mqtt_as`/
`ThreadSafeEvent` vendoring precedent in `third-party-licenses.md`):**

- [`tinyweb`](https://github.com/belyalov/tinyweb) -- MIT, MicroPython/`uasyncio`-native (not a
  CPython-compatible abstraction layer), explicitly sized for 64K/96K-RAM devices, has
  `read_parse_form_data()` and static-file serving built in -- everything this feature's one-page
  form needs. No confirmed-recent commit activity found this session (88 commits total, dates not
  checked) -- worth a maintenance-currency check before vendoring, not just taking the fit at face
  value.
- [Microdot](https://github.com/miguelgrinberg/microdot) -- MIT, actively maintained (release 2.6.2,
  2026-05-12, 407 commits), runs on both CPython and MicroPython. More general-purpose (auth/forms/
  CSRF/WebSocket on its roadmap) than this one-page use case needs, and the CPython-compatibility
  layer is overhead this feature has no use for -- but the maintenance signal is stronger than
  `tinyweb`'s.
- Neither includes a captive-portal DNS component -- every real implementation found
  ([p-doyle/Micropython-DNSServer-Captive-Portal](https://github.com/p-doyle/Micropython-DNSServer-Captive-Portal),
  [george-hawkins/micropython-wifi-setup](https://github.com/george-hawkins/micropython-wifi-setup))
  hand-rolls a small catch-all DNS responder (answer every query with the AP's own IP) alongside
  whichever web server they use -- consistent with this project's own `cbor.py`-over-dependency
  precedent for something this small (tens of lines, not worth a vendored dependency). Two gotchas
  confirmed from `george-hawkins`'s write-up, worth carrying into the real implementation: redirect
  URLs must be absolute (a relative "/" redirect shows the probe hostname, not this device's, in the
  OS's own captive-portal UI) and devices with a fixed external DNS server (e.g. `8.8.8.8` hardcoded)
  can't be caught by DNS spoofing at all under MicroPython as of that write-up -- a documented
  limitation to carry forward, not a gap to chase per CLAUDE.md's board-idiosyncrasy corollary.

**Recommendation, Mike's call to confirm before anything is vendored:** `tinyweb`, for the
MicroPython-native fit and RAM headroom this feature genuinely needs on ESP32-C3 -- but flagging
Microdot's stronger maintenance signal rather than picking silently, same as any other
new-dependency decision this project treats as worth a flag-and-approve step.

**Not yet answered, blocking real implementation (not just this feature's own design):** the
boot-sequence question above -- where pre-listener code actually lives and how it hands off -- needs
its own resolution, most likely alongside whatever currently decides what `deploy_runtime.py` pushes
and what actually runs at power-on. Suggest that as its own short scoping thread next, before writing
any code for this feature specifically.

**AP password, 2026-09-14 (Mike's ask, same session): the portal's own soft-AP is secured (WPA2), not
open -- settable, with a simple default.** Not yet a fully open AP the way most of the researched
examples default to -- a password gates who can even reach the portal during the provisioning window,
tightening (not replacing) the trusted-networks-only caveat above for the opt-in reprovisioning-fallback
case in particular. WPA2-PSK requires 8+ characters, so the default needs to clear that bar while
staying genuinely simple/memorable -- **proposed default: `thingstudio` (11 chars), Mike's call to
confirm or pick something else.**

**Where this setting actually lives -- same architectural question the "Where this actually lives"
section above already flagged, not a separate one:** this can't be a `config-types.ts`/flow-config
field the way `security`/`allowReprovisioning` are. The portal has to be reachable on a genuinely
virgin device -- zero flows ever deployed, nothing compiled yet -- so anything it needs (including
this password) has to be available before any flow's compiled config could supply it. Natural fit:
a build-time default baked into the runtime image itself (design doc §5's "runtime ships once, flashed
like firmware" model), overridable by writing a new value into the same dedicated flash file the
learned WiFi credential itself will live in (this file's "Credential persistence" decision above) --
so "settable" means "the editor can push a replacement later," not "authored per-flow." The actual
push mechanism (a new admin/protocol message vs. something simpler) isn't scoped -- folds into the
same pre-listener boot-sequence work already called out as the next open thread, not solved here.

## Built, 2026-09-14 (same day as the scoping session above)

Implemented end to end: `device-runtime/src/wifi_provision.py` (new module, ~515 lines), a matching
`wifiProvision` field threaded through the DEPLOY message on both sides (`messages.ts`/`codec.ts` and
`messages.py`), and the editor-side compute/wiring (`wifi-status.ts`'s `computeWifiProvisionMarker()`,
called from `main.ts`; the new `allowReprovisioning` checkbox field in `config-types.ts`, rendered by
`ConfigRefField.vue`).

**The boot-sequence question is resolved.** `listener.py` *is* `main.py` on-device
(`test-flows/deploy_runtime.py`'s own bootstrap script installs it as such) -- MicroPython's own boot
convention runs it directly at power-on, so no separate `boot.py` was needed. `main()`'s existing
synchronous boot sequence, before `_resume_flow()`, is the hook: `provision_if_needed()` runs there,
gated on the new `wifiProvision` marker the current DEPLOY persisted (`/_flow_wifi_provision.json`,
removed rather than left stale when a later DEPLOY doesn't set it -- a flow that stops being
"unmanaged" must not carry forward a previous flow's provisioning intent).

**Why a DEPLOY-envelope marker, not something read out of the compiled flow itself:** the generated
code for an "unmanaged" WiFi config (`wifiSetupStatement()`) is `.active(True)` with no `.connect()` --
identical whether "unmanaged" means "this feature should self-provision" or the older meaning ("some
other, unbuilt mechanism manages this"). The boot-time subsystem runs before any flow code and has no
way to inspect compile-time-only information, so the marker is computed editor-side from the graph
(`computeWifiProvisionMarker()`, takes a plain `GraphData`-shaped object rather than a `CodegenContext`
specifically so `compile.ts` stays free of node-type-specific imports) and sent alongside the bytecode,
not derived from it on-device.

**Web server: hand-rolled, not `tinyweb`.** This session's own earlier recommendation (above) is
reversed on reflection during implementation -- the real surface is one GET (serve the form) and one
POST (read it back), small enough that hand-rolling matches this project's established
small-native-implementation-over-uncertain-dependency preference (`cbor.py`'s precedent, cited
approvingly in `third-party-licenses.md`) better than vendoring does. Flagged here as an explicit
reversal, not a silent change; nothing was vendored, so `third-party-licenses.md` needed no update.
The DNS catch-all responder was always going to be hand-rolled either way -- no library researched
covers it.

**AP password:** shipped with the confirmed default (`thingstudio`, 11 chars, clears WPA2-PSK's 8-char
minimum). `get_ap_password()`/`set_ap_password()` exist and the persisted-state file has a slot for an
override, but no editor-to-device push mechanism is wired up yet -- deliberately deferred (folds into
future pre-listener boot-sequence work), not a dead end: the schema doesn't need a breaking migration
to support it later, per CLAUDE.md's no-premature-optimization-but-no-dead-ends rule.

**Version bump: none.** Evaluated per CLAUDE.md's device-runtime version-bump-discipline rule (this
touches files `deploy_runtime.py` pushes, so it's in scope for that rule). Both new surfaces are
additive/optional in both directions: an old editor that never sends `wifiProvision` degrades to
`self_provision: false` on a new runtime (today's pre-feature behavior, unchanged); a new editor's
`wifiProvision` field is simply unread by an old runtime with no `wifi_provision.py` module, and that
runtime's flow codegen for `"unmanaged"` is byte-for-byte what it already was. Neither side can produce
a flow the other side runs incorrectly, so this doesn't meet `decideDeploy`'s actual bar for a `major`
bump (the only level it enforces) -- consistent with the established convention for `flowName`/
`deployId`, the other additive DEPLOY-envelope fields.

**Verification:**
- Real MicroPython unix-port suite: new `device-runtime/test/test_wifi_provision.py`, 19/19 passing
  (DNS reply building, form parsing/HTML escaping, credential persistence round-trips,
  `provision_if_needed()` orchestration via a monkeypatched fake `network`/`WLAN`). `test_protocol.py`
  fixed for the new `wifiProvision` field and back to 22/22.
- Editor: `tsc --noEmit` clean (no stray compiled `.js` found first). A fresh `npm ci` + `vitest run`
  in an isolated copy of `editor/` (not the shared mount, per CLAUDE.md's npm/build restriction):
  448/448 passing, including the new `protocol.roundtrip.test.ts` cases and
  `node-wifi-status.test.ts`'s new `computeWifiProvisionMarker` block.
- **Not yet done:** Mike's own hands-on test of the actual captive-portal flow against a real board --
  everything above is unit/protocol-level, nothing exercised the real soft-AP/DNS/HTTP stack on
  hardware.

**Unrelated finding surfaced while verifying, not caused by this work:** two pre-existing
`test_listener_integration.py` failures (`test_hello_sent_on_boot`,
`test_hello_request_resends_hello_no_side_effects`) reproduce identically against unmodified `HEAD`
code in this same sandbox build -- most likely a MicroPython build/environment mismatch specific to
this freshly-built unix-port binary, not a regression from this session. Worth a look next time
someone's already in that test file, not blocking here.

Docs updated in the same change (CLAUDE.md's UX-documentation rule): `docs/user-guide/nodes/wifi-status.md`'s
"unmanaged" paragraph now describes the real captive-portal flow and the reprovisioning-fallback
warning; `docs/thingstudio-design-doc.md` §9 got the one-line pointer this file's own scoping section
above said it would need once built.
