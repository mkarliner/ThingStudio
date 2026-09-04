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

**Raised, 2026-09-04. Not scoped in detail, not started.**
