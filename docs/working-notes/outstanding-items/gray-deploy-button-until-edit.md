# Gray out the compile/deploy button after a successful deploy, until the flow is edited — Mike's ask, 2026-09-04

Raised by Mike: once a deploy succeeds, the compile/deploy button should go disabled/grayed out and stay that way
until the flow is actually edited again. Right now nothing distinguishes "this flow is already running on the
device, unchanged" from "you have unsaved/uncompiled changes" -- the button always looks equally clickable, so
there's no visual cue for "nothing to redeploy" versus "you should redeploy."

## Why this matters

Directly useful during the kind of hands-on hardware testing this project does constantly (real-hardware WiFi/mqtt
debugging sessions, `basic-mqtt.flow.json`, etc.) -- a grayed-out button after a successful deploy is a quick,
always-visible confirmation that what's on the device matches what's on the canvas, and a re-enabled button is an
equally quick signal "you changed something since the last deploy, this needs a redeploy to take effect." Cheap
UX win, no protocol change needed -- purely editor-side state.

## Shape, not yet scoped in detail

Needs: a "dirty" flag that starts false right after a successful `DEPLOY_ACK`, flips true on any graph mutation
(node add/remove/move, property edit, link add/remove, config node edit) via whatever change-tracking the canvas
already has (Rete's own editor events, or the existing save/dirty-state machinery if `main.ts` already tracks
"unsaved changes" for the save button -- worth checking before building a second, parallel dirty-tracking
mechanism). Button itself: disabled attribute plus the existing grayed-out visual treatment already used elsewhere
in the editor (`PaletteSidebar.vue`/`PropertyPanel.vue`'s collapsed-rail styling, per the 2026-09-04 UI-cleanup
pass) for consistency, not a one-off style.

Open question worth resolving before building: does a *successful compile that then fails to deploy* (DEPLOY_ERROR,
e.g. today's wifi ordering-race bug) count as "clean" (nothing changed, so gray out) or does the button need to
stay active/enabled since the deploy didn't actually take effect on the device? Likely the latter -- "grayed out"
should mean "what's running on the device matches the canvas," which a failed deploy does NOT achieve -- but worth
Mike's explicit confirmation rather than assumed.

## Status

**Implemented and real-browser verified by Mike, 2026-09-09.**

`main.ts`: a `deployedClean` flag, false by default, set true only on a real `DEPLOY_ACK`. Reset to false by
the exact same two signals `refreshPreview()` already listens to (`reteEditor.addPipe`'s
nodecreated/noderemoved/connectioncreated/connectionremoved/cleared, and the `propertyVersion` watch covering
every property-panel edit) -- no second, independently-maintained "did the flow change" mechanism. Also reset
to false on every fresh `Connect` (a different board, or the same board reset/redeployed-to since, may not
actually have this exact flow running -- `setConnectedUi`'s own comment has the reasoning). The button's
`disabled` state is now `!transport.isConnected || deployedClean`, set from one function
(`updateDeployButtonEnabled()`) instead of being written directly from three different call sites.

Answers this file's own open question exactly as already resolved 2026-09-06: a `DEPLOY_ERROR` or a timeout
does NOT set `deployedClean` -- only the real success path does -- so a failed deploy leaves the button
enabled for an immediate retry.

`docs/user-guide/flow-lifecycle.md` updated. Off-device verified (`tsc`/`vitest`/`vite build` clean, 386/386)
-- `main.ts` has no existing test harness to extend (same "whole canvas layer" gap `delete-node-wire.md`
already notes).
