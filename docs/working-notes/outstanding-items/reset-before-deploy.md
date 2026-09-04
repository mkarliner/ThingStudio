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
