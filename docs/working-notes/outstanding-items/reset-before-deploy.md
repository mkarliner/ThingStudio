# machine.reset() before each deploy, for a known-clean device state — raised by Mike, 2026-09-04

Raised in the same session as the wifi_status-vs-mqtt_as ordering race (`wifi-status-mqtt-connect-ordering-race.md`):
should the runtime do a hard reset before running each newly-deployed flow, so every deploy starts from a known
clean state instead of whatever the previous flow left behind? Mike's own estimate: +3 seconds to deploy time,
which he considers likely worth it.

## Why this is a good idea, not just a nice-to-have

Directly relevant to an already-open, already-confirmed bug: **`wlan-state-not-torn-down-on-redeploy.md`** found
that a flow with no wifi-touching node at all still produced stray `wifi:sta is connecting, cannot set config`
noise on real hardware, traced to leftover native WiFi driver state from an earlier deploy the same power cycle --
and confirmed that **a power cycle fixed it**. A `machine.reset()` (ESP32's `esp_restart()` — a real chip reset,
not `machine.soft_reset()`'s VM-only restart) reinitializes the WiFi peripheral the same way a power cycle does,
so it plausibly gets the exact same clean-slate effect that was already confirmed to work, without needing the
conditional "only tear down WLAN when the new flow has no wifi node" logic that item's own fix was blocked on
(Mike's sign-off, never given) -- a full reset just makes the whole "what survived from the last flow" question
moot every time, unconditionally, rather than needing to reason about which cases are safe to skip.

## What's NOT a one-liner here (checked before proposing an implementation)

Looked at how `DEPLOY` actually works today (`device-runtime/src/listener.py`'s `_handle_deploy`): it already
writes bytecode to flash (`/_flow.mpy`) and static data (`/_flow_static.bin`) *before* running it -- so the
persistence half of this is already in place, that part isn't new work. But `_handle_deploy` currently does
`cancel_running()` then a live in-process `import _flow` -- no reboot at all -- and then sends `DEPLOY_ACK` back
over the same still-alive serial connection, all within one async handler.

Inserting `machine.reset()` there doesn't work as a one-line addition: a hard reset kills the current process (and
the serial connection handling it) immediately, so:

1. `DEPLOY_ACK` can't be sent from inside `_handle_deploy` after the reset -- the process issuing it is gone.
2. Something has to run at BOOT time, after the reset, to notice `/_flow.mpy` exists and import it (`_handle_deploy`
   does this today, but only because it's already running when DEPLOY arrives -- after a reset, nothing has
   received a DEPLOY message, the board just needs to know to auto-resume from flash unconditionally on every
   boot, not just after a DEPLOY).
3. `DEPLOY_ACK` (or whatever confirms "the new flow is now actually running") would have to be sent from that
   boot-time path instead, once the device comes back up and re-establishes its serial listener -- a real change
   to when/where that acknowledgment happens, not just where the reset call goes.
4. The host-side deploy tooling (`test-flows/deploy_flow.py`, and whatever the real editor-side deploy client does)
   currently assumes a continuous connection across the DEPLOY/DEPLOY_ACK exchange -- it would need to tolerate
   the device dropping off the serial port entirely for the reset+reboot window, then coming back, rather than
   just waiting on the same connection.

None of this is a good reason not to do it -- it's a good idea -- but it's a real protocol-shape change (touching
design doc §13's DEPLOY/DEPLOY_ACK semantics, boot-time behavior, and host-side tooling), not a quick patch. Worth
scoping properly (does DEPLOY_ACK's meaning change to "confirmed running after reset," does boot-time auto-resume
need to be gated at all vs. unconditional, how the host tooling detects and waits out the reset window) before
starting, same as `wlan-state-not-torn-down-on-redeploy.md` was left for Mike's sign-off rather than guessed at.

## Status

**Discussed, 2026-09-04. Not scoped, not started.** Real candidate to supersede (not just complement)
`wlan-state-not-torn-down-on-redeploy.md`'s conditional-teardown approach -- worth deciding between them rather
than building both. Needs a scoping pass on the DEPLOY protocol/boot-sequence questions above before implementation
starts.


## Related but distinct, added 2026-09-05: HELLO_REQUEST

A different, narrower need surfaced during the RP2040 hardware pass (no reset button on the
Pico W): getting the *editor* back to a known state against an *already-running* device, with
no reset at all -- not the "get a clean device state before running a newly-deployed flow"
problem this file is about. Solved separately and much more simply: a new `HELLO_REQUEST`
message (editor -> device) that just re-sends the device's current HELLO, no side effects,
no reboot. Does NOT touch any of the open questions above (DEPLOY_ACK semantics, boot-time
auto-resume, host tooling tolerating a connection drop) and doesn't reduce the need to solve
them -- if `machine.reset()`-before-deploy is built later, HELLO_REQUEST doesn't replace it or
make it easier, it just means the editor already has an independent way to check in on a
device's state that doesn't depend on that work landing first. See `decisions.md`'s
2026-09-05 entry.


## Update, 2026-09-05: point 2's prerequisite is now built (unrelated trigger)

A separate real-hardware finding the same day -- RP2040 WiFi state getting stuck (oscillating
`wifi_status` True/False under invalid-then-corrected credentials) and only clearing on a power
cycle, never a redeploy -- led Mike to independently propose a flow-triggerable reset node for
recovery. Looking into that surfaced the same gap this file's point 2 already named: nothing ran
at boot to auto-resume a previously-DEPLOYed flow, so *any* reset (a redeploy-time
`machine.reset()` per this file's idea, or a flow-triggered reset node, or a plain power cycle)
lost the running flow entirely until a human noticed and manually redeployed. Mike's own words:
"not persisting flows to survive reset or power cycle is pretty fundamental. fix it."

Built: `listener.py`'s `main()` now calls a new `_resume_flow()` before `run_forever()` starts --
checks `_FLOW_PATH` for a persisted flow and `import`s it exactly the way `_handle_deploy` already
does, degrading to a logged, non-fatal no-op if the file is absent (never deployed) or corrupt
(never allowed to block boot). Verified against a real MicroPython unix-port build + real
mpy-cross-compiled flows, not just `py_compile`: `device-runtime/test/test_listener_integration.py`'s
`test_boot_time_flow_auto_resume` deploys a flow to one listener process, kills it, starts a brand
new one against the same on-disk flow file with **no second DEPLOY sent**, and confirms the flow
runs again; `test_boot_time_resume_survives_corrupt_persisted_flow` confirms a garbage flow file
doesn't stop the listener reaching `LISTENER_READY` or sending its boot HELLO.

This closes point 2 above (something now runs at boot to auto-resume from flash, unconditionally,
not just after a DEPLOY) but does **not** by itself close this file's own idea -- points 1, 3, and
4 (DEPLOY_ACK's meaning/timing across a reset, and host-side tooling tolerating the device
dropping off the serial port for a reset+reboot window) are still real, still unscoped, still
Mike's call. What's changed is that the "auto-resume" half of the prerequisite work is done and
tested, not hypothetical -- a future `machine.reset()`-before-deploy implementation can build on
`_resume_flow()` directly rather than needing to invent it from scratch. It also means a flow-
triggered reset node (Mike's 2026-09-05 proposal, prompted by the RP2040 stuck-WiFi finding) is
now viable in a way it wasn't a day earlier: a reset no longer loses the running flow.

Side effect worth flagging, found while verifying this: `_send_hello()`'s `runtimeBuild` field
(2026-09-05's earlier belt-and-braces marker, `decisions.md`) was being sent as an explicit CBOR
`None` on any board without a `_runtime_build.txt` marker file -- `cbor.py` has no null/undefined
support at all, so this raised inside `cbor.encode` and, swallowed by `_send_message_safe`, would
have silently broken HELLO entirely on exactly those boards. Fixed at the source
(`messages.encode_message_body` now drops any `None`-valued key before encoding, matching the
read side's existing "missing key or explicit None both mean not provided" contract) rather than
patched around at the one call site -- caught only because this session built the actual
MicroPython unix-port + mpy-cross toolchain and ran `device-runtime/test/test_protocol.py` for
real, rather than relying on `py_compile` alone. See `learnings.md`'s 2026-09-05 entry.
