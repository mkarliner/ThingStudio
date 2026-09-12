# `wifi_status`/mqtt nodes should show connection status on the canvas

Mike's ask, 2026-09-02: a visual indicator (not just generated console output) on `wifi_status`, `mqtt_publish`, `mqtt_subscribe` -- and probably any other network node -- showing current connection state directly on the canvas node itself. Not scoped -- needs a design for how a running device reports per-node state back to the editor in a way the canvas can render live, distinct from the existing NODE_ERROR/DEBUG console-only reporting (`console-node-id-mapping.md`). Likely connects to Tier 2's live-value-streaming work (`tier2-live-streaming-persistence.md`) -- a status indicator is a specific, simple case of the same "device pushes live state back to the editor" capability.

**Design settled and implementation mostly landed, 2026-09-10 (Mike's four design calls, recorded in full in
`decisions/editor-canvas.md`'s 2026-09-10 entry): new dedicated `NODE_STATUS` §13 message type (type byte 11), a
small fixed `{nodeId, state, text?}` shape, every status cleared on every redeploy, scoped to `wifi_status`/
`mqtt_publish`/`mqtt_subscribe` only (`http_request` still excluded, as originally scoped).**

What's built: full protocol layer (`messages.py`/`runtime.py`'s `report_status()`/`listener.py`'s
`_handle_node_status`, `_RUNTIME_VERSION` bumped to `1.0.0`; `messages.ts`/`codec.ts`'s encode/decode, round-trip
test fixtures on both sides); the editor rendering layer (`nodes.ts`'s `status`/`statusText` fields on every node
class, `ThingstudioNode.vue`'s dot+text status line ported from poc-rete's original concept, `main.ts`'s
`handleNodeStatus()`/`clearNodeStatuses()` wiring, the latter called at the same point `clearNodeHighlights()`
already resets error attribution on every Deploy click); the codegen layer (`wifi-status.ts`'s `buildMsg` calls
`runtime.report_status()` alongside its existing emit-on-change message; `mqtt-shared.ts`'s
`mqttEnsureConnectedSnippet()` reports `connected` on a fresh connect and `error` if the retry budget is exhausted,
keyed to the calling node's own id even when nodes share one broker client). New tests at the protocol-roundtrip,
wifi-status-codegen, and mqtt-publish-codegen layers; generated Python verified directly against real `python3`
(pymock fixtures) since `vitest` can't run in this environment.

**`tsc`/`vitest` run by Mike, 2026-09-10: clean.** One real bug surfaced and fixed along the way: three test files
(`node-wifi-status.test.ts`'s `runSnippet`/`runSnippetTwice`, `node-mqtt-subscribe.test.ts`'s `runOneMessage`,
`node-mqtt-publish.test.ts`'s "two chains racing to connect" test) built raw Python snippets directly from
`codegenSource`/`codegenSink` output rather than going through the full `compile()` pipeline, so they never picked
up the `import runtime` line `compile.ts` normally adds automatically -- fixed by adding it to each harness.
Separately, a genuinely-confusing test failure (`node-mqtt-publish.test.ts`'s new "two mqtt_publish nodes... each
report status under their OWN node id" test saw 2 status lines, not the expected 1) turned out not to be a real
double-connect bug at all: that test's graph also carries the mandatory `wifi_status` node, which reports its OWN
connection status independently (this file's own report_status wiring) -- the test's line-count filter wasn't
scoped past it. Fixed by filtering to the two mqtt node ids specifically. A follow-up audit of every other
network-node test file (udp-send/udp-receive/http-request/http-in/mqtt-subscribe) found no other assertion at risk
of the same "extra wifi_status NODE_STATUS line" issue -- every other output check in those files is a substring
match, not an exact/count-based one.

`docs/user-guide/` content for the new visual status indicators is done -- see `canvas-basics.md`'s "Node status"
section and the wifi-status/mqtt-publish/mqtt-subscribe node doc pointers.

**Still owed:** the real MicroPython test suite for the `device-runtime/src` changes (`ast.parse` syntax-checked
only so far, not the real behavioral suite CLAUDE.md requires) and a real-hardware pass. Nothing in
mqtt-subscribe.ts's own codegen needed a separate change -- it shares `mqttEnsureConnectedSnippet()` with
mqtt-publish.ts, so both got the same fix from one shared-function edit.

**2026-09-10, Mike's call: skipping the MicroPython suite for now, going straight to the real-hardware pass** --
deferred as a parallel/later check rather than a hard blocker, same spirit as other items in this file where an
off-device static check (here, `ast.parse`) stands in until the real gate runs. Worth circling back to before this
item is called fully done, per CLAUDE.md's own device-runtime test-suite rule -- not dropped, just reordered.

**2026-09-10, real-hardware pass: bug found and fixed, dots now confirmed on `wifi_status` and `mqtt_subscribe`.**
First hardware test showed no dots at all despite the wire protocol round-tripping correctly end to end (device
console printed `NODE_STATUS node=... state=connected ...` and the editor's decoded `[NODE_STATUS] {...}` log line
both appeared). Diagnosed via `document.querySelectorAll('.ts-status')` in devtools returning an empty array --
proving the `.ts-status` elements were never created in the DOM at all (not a CSS positioning/clipping issue).
Root cause, surfaced by a `[Vue warn]: Extraneous non-props attributes (seed)` console warning Mike happened to
hit: `rete-vue-plugin` passes a fresh `seed` prop into `ThingstudioNode.vue` on every `area.update("node", id)`
call -- the exact mechanism poc-rete's own original status-line design relied on and explicitly declared
(`seed?: number` in its own `defineProps`) -- but this session's port of the feature never declared or read it.
Because `data` is `markRaw`'d by rete-vue-plugin, mutating `data.status`/`data.statusText` in place gives Vue's
`statusLine` computed nothing to track, so it silently never re-evaluated past its initial (always-null) value.
An incorrect assumption made earlier in this same build-out -- that `data.highlighted`'s existing success proved
this trick was unnecessary -- turned out to be wrong; that comment in `ThingstudioNode.vue`'s header has been
corrected in place. Fixed by declaring `seed?: number` in `ThingstudioNode.vue`'s `defineProps` and reading
`void props.seed` inside `statusLine`'s computed, matching poc-rete's proven pattern exactly. `tsc --noEmit`
clean; Mike confirmed dots now appear correctly for both `wifi_status` and `mqtt_subscribe` on real hardware.
`mqtt_publish` (including the shared-broker per-node-id independence case) and clear-on-redeploy still want a
real-hardware check before this item is fully done. The temporary diagnostic logging added to `main.ts`'s
`handleNodeStatus()` while narrowing this down has been removed now that the real cause is confirmed.

**2026-09-10, second real bug found on the same hardware pass: `mqtt_publish` never reported at all when sharing a broker
with an already-connected node (e.g. flow `wifi_status -> mqtt_publish` alongside an `mqtt_subscribe` on the same
broker).** Root cause: the first cut of this feature's mqtt reporting only called `runtime.report_status(nodeId,
'connected')` from inside `mqttEnsureConnectedSnippet()`'s connect-retry block (mqtt-shared.ts) -- but that block only
ever runs for whichever node's call happens to be the FIRST to observe the shared, broker-keyed `_mqtt_connected_*`
flag still `False`. Every other node sharing that broker always finds it already connected and takes the fast path,
which did nothing at all -- so it silently never got its own "connected" report. Mike also flagged, same session, that
mqtt nodes should show negative (disconnected) status too, not just connected/error -- `wifi_status` already did this
(it re-polls and diffs every cycle), mqtt never did.

Fixed both in one pass rather than two: `mqttEnsureConnectedSnippet()` now, after the (still-untouched) connect-retry
block, unconditionally checks the client's own real `${clientVar}.isconnected()` and diffs it against a new
per-CALLING-node (not per-broker) module var (`mqttLastStateVar()`, initialized via a new
`mqttNodeStatusSetupStatement(nodeId)` each mqtt_publish/mqtt_subscribe node now also contributes to its own
`statements`), reporting `'connected'`/`'disconnected'` only on an actual change. This runs on every call regardless
of whether that call performed the real `.connect()` or found the broker already connected via another node, so
every node sharing a broker now gets its own accurate, independent status -- both directions, ground-truth-driven
(mqtt_as's own `_keep_connected()` background task is left untouched as the actual reconnection driver; this is
purely an observer layer on top of it, per this file's own header notes in mqtt-shared.ts). Verified with a hand-built
Python reproduction (two fake nodes sharing one broker, simulated connect/drop/reconnect cycle) and with the real
`compile()` output run through `pymock`'s `mqtt_as` fixture -- both confirm two mqtt_publish nodes sharing a broker
each report their own `connected` line. `node-mqtt-publish.test.ts`'s "two mqtt_publish nodes... each report status
under their OWN node id" test previously asserted the OLD (buggy) 1-report behavior as if it were correct -- updated
to assert the fixed 2-report behavior, with the old assumption's story kept in the test's own comment for context.
`tsc --noEmit` clean; `vitest` re-run still owed from Mike (this file's own report_status test was written but not yet
re-run against the new codegen shape -- flagging rather than assuming green).

Real-hardware re-check of `mqtt_publish` (including the shared-broker case) and of the new disconnected-status path
(e.g. killing the broker mid-flow) still outstanding -- this fix is off-device-verified only so far, same caveat as
everything else in this file pending Mike's hardware pass.

**2026-09-11, clarified rather than a bug: `mqtt_publish`'s dot stays blank until the first message actually passes
through it.** Root cause is architectural, not a regression from the status fix above: `mqtt_publish` is a sink, and
compile.ts's model never gives sink nodes their own background task -- a sink's generated function only ever runs
via `await <fn>(msg)` from inside whatever source's coroutine reaches it (compile.ts's `emit()`/`getSink()`).
`mqttEnsureConnectedSnippet()` sits at the top of that same function body, so there's no code path for it to run
(and therefore no status to report) before the node's first real invocation -- unlike `wifi_status`/`mqtt_subscribe`,
which are sources with their own spawned loop that starts polling immediately at flow start, independent of any
inbound message. Asked Mike whether to give `mqtt_publish` an eager bootstrap task (new mechanism, matching
Node-RED's usual "status shows at deploy" convention, but opens a broker connection even if the node never actually
publishes) or leave it lazy (connects only once there's something to send). **Mike's call: leave it as-is** -- not a
bug, documented in `docs/user-guide/nodes/mqtt-publish.md`.

**2026-09-11, third real-hardware finding, same status-indicator visibility effect: WiFi visibly cycling up/down
with mqtt nodes in the flow, no real signal problem.** Mike's own diagnosis, confirmed against the code: `wifi_status`
and `mqtt_as` (vendored, backs `mqtt_publish`/`mqtt_subscribe`) are two independent owners of the same physical
`STA_IF` -- the 2026-09-04 fix unified WHERE credentials come from, but never touched WHO actually drives
connect/reconnect. `mqtt_as`'s own background `_keep_connected()` watchdog runs forever once connected and will
proactively force a `.disconnect()`+reconnect on its own if it perceives the link as down. Full writeup and the fix
(compile-time: `wifi_status` now passes `security: "unmanaged"` into its own setup statement whenever the flow has
an mqtt node, deferring the actual `.connect()` entirely to `mqtt_as`) is in `decisions/redeploy-network.md`'s
2026-09-11 entry, not duplicated here -- this is a general redeploy/network-hardening concern, not specific to the
status-indicator feature itself, even though the status dots are what made it visible. `tsc --noEmit` clean; three
new `node-wifi-status.test.ts` tests added; off-device-verified only so far via direct codegen inspection and a full
`compile()` run through `pymock`. Whether this actually stops the ONGOING flapping (versus only removing a startup
race) is unconfirmed -- real-hardware re-test still owed, and if it doesn't fully resolve it, `mqtt_as`'s own
`_keep_connected()` watchdog is the next thing to look at.

Also noted, same message: the earlier "`mqtt_publish` doesn't connect until it's been selected" report may be a
downstream artifact of this same WiFi flapping (an in-flight reconnect cycle interrupting `mqtt_publish`'s own
connect attempt) rather than a separate bug -- not yet investigated on its own; revisit after the WiFi fix above is
confirmed or ruled out.

**2026-09-11, same day: revised the WiFi/mqtt fix above per Mike's own maintainability push-back.** The first cut
piggybacked on `security: "unmanaged"`, which Mike flagged as confusing -- no way for a future reader (him) to tell
"the flow author chose unmanaged" from "the compiler decided to defer because an mqtt node exists." Reworked into a
genuinely separate `wifiSetupStatement()` parameter (`deferToMqtt`), its own `flowHasMqttNodes(ctx)` helper, and an
explanatory comment in the generated Python itself. Also found and closed a real ordering gap while doing this:
`http-request.ts`/`udp-send.ts`/`udp-receive.ts`/`http-in.ts` share the same `"wifi-sta"` setup-statement dedup key
as `wifi_status` -- without updating them too, whichever of them happened to compile first (graph-order-dependent)
could have silently won the dedup race with an un-deferred `.connect()` call. Full writeup in
`decisions/redeploy-network.md`'s second 2026-09-11 entry. `tsc --noEmit` clean; still off-device-verified only.

**2026-09-11, real-hardware confirmed: the WiFi flapping fix worked.** Mike: "seems to have fixed it." The
`deferToMqtt`/`flowHasMqttNodes()` design (`decisions/redeploy-network.md`'s 2026-09-11 entries) is now
hardware-verified, not just off-device. The "`mqtt_publish` doesn't connect until selected" report from the same
day, tentatively guessed as a possible downstream artifact of the flapping, was not independently re-tested -- left
open rather than assumed fixed; revisit only if it comes up again.
