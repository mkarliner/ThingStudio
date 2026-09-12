# Briefing: connection-status indicator built, hardware-verified, three real bugs found and fixed — next-session candidates

For the next chat. Read `CLAUDE.md` in full, as always, plus `docs/working-notes/mikes-questions-and-points.md`.

**Check `git log` before assuming anything below is committed.** As of this writing the tip is `aaa9023` ("Close
out multi-connection-node-inputs as real-browser verified"), and **nothing from this session is committed** —
`git status --short` shows 34 modified files plus one new untracked one (`test-flows/wifistatus.flow.json`, not
created by this session, looks like Mike's own test flow). Per this project's standing rule, every edit this
session was made directly on Mike's own filesystem via the device bridge, but git add/commit was never run from
the sandbox — that's Mike's to do. Read the diff before committing; it's a real, substantial change, not a small
patch.

**`vitest` cannot run in this cloud sandbox this session** — `Error: Cannot find native binding...
Cannot find module '@rolldown/binding-wasm32-wasi'`, confirmed by trying it directly. `tsc --noEmit` runs fine.
Every claim below about test *behavior* (not just compilation) was verified by hand-building the equivalent Python
snippet from the real codegen output (via `tsx` + the vendored `pymock` fixtures) and running it directly with
`python3`, or by inspecting real `compile()` output — not by running the actual test suite. **Running the real
`vitest` suite is the single most important thing to do at the start of the next session**, before trusting any of
this is actually green.

## Where this came from

Picked as next priority 2026-09-09 (previous briefing), design settled the same day (four decisions in
`decisions/editor-canvas.md`'s 2026-09-10 entry: dedicated `NODE_STATUS` §13 message type, small fixed
`{nodeId, state, text?}` shape, every node's status cleared on every redeploy, scope limited to
`wifi_status`/`mqtt_publish`/`mqtt_subscribe`). Built and landed 2026-09-10, then put through a real-hardware pass
across two sessions (2026-09-10/11) that found and fixed three genuine bugs — this briefing picks up right after
the last of those was confirmed fixed on real hardware.

## What this session actually did

1. **Full feature landed**: protocol layer (`messages.ts`/`codec.ts`/`messages.py`, `NODE_STATUS` type byte 11),
   editor rendering layer (`nodes.ts`'s `status`/`statusText` fields on all 17 node classes,
   `ThingstudioNode.vue`'s dot+text status line, `main.ts`'s `handleNodeStatus()`/`clearNodeStatuses()`), codegen
   layer (`wifi-status.ts`/`mqtt-shared.ts` calling `runtime.report_status()`). `_RUNTIME_VERSION`/
   `EDITOR_TARGET_VERSION` bumped `0.1.0` -> `1.0.0` (major bump, per CLAUDE.md's version-bump-discipline rule --
   `decideDeploy()` blocks Deploy on a major mismatch, so an old-runtime board gets refused rather than silently
   breaking).

2. **Bug #1 (rendering): dots never appeared on real hardware at all, despite the wire protocol round-tripping
   correctly.** Root cause: `rete-vue-plugin` passes a fresh `seed` prop into `ThingstudioNode.vue` on every
   `area.update()` call specifically so consumers have something genuinely reactive to depend on (`data` itself is
   `markRaw`'d, so mutating `data.status` in place gives Vue's `statusLine` computed nothing to track) --
   `ThingstudioNode.vue` never declared or read that prop. Confirmed via a `[Vue warn]: Extraneous non-props
   attributes (seed)` console warning Mike happened to hit. Fixed by declaring `seed?: number` and reading
   `void props.seed` inside `statusLine`'s computed, matching `poc-rete`'s own original (proven) pattern -- that
   spike's own header literally documented this exact gotcha, which got missed on the first port. Confirmed
   working on real hardware for `wifi_status` and `mqtt_subscribe`.

3. **Bug #2 (mqtt sharing): a node piggybacking on an already-connected broker never reported its own status at
   all.** `mqttEnsureConnectedSnippet()`'s connect-retry block only runs for whichever node's call happens to be
   first to see the broker-shared `connected` flag still `False` -- every other node sharing that broker always
   found it already connected and reported nothing. Fixed: every call now checks the client's own real
   `isconnected()` and diffs it against a new per-CALLING-node (not per-broker) last-known-state var, reporting
   `connected`/`disconnected` on any actual change regardless of which path got there -- this also delivered
   Mike's separate ask that both positive AND negative status show for mqtt nodes (previously only
   `connected`/`error`, no `disconnected`). Verified via a hand-built two-node-sharing-a-broker repro (connect,
   drop, reconnect) and the real `compile()` output.

4. **Bug #3 (WiFi flapping, the bigger one): WiFi visibly cycling up/down on real hardware, no actual signal
   problem, once mqtt nodes were in the flow.** Root cause: `wifi_status` and the vendored `mqtt_as` (backs
   `mqtt_publish`/`mqtt_subscribe`) are two independent owners of the same physical `STA_IF` -- the 2026-09-04 fix
   unified WHERE credentials come from but never touched WHO drives connect/reconnect. `mqtt_as`'s own background
   `_keep_connected()` watchdog polls `isconnected()` roughly every second forever and proactively forces a
   disconnect+reconnect on its own if it perceives the link as down. Fixed at compile time: `wifi_status` now
   passes a genuinely separate `deferToMqtt` parameter into `wifiSetupStatement()` (NOT an overload of
   `security: "unmanaged"` -- a first cut did that and Mike explicitly pushed back on it as confusing for a future
   maintainer to read) whenever `ctx.findNodesOfType()` finds an mqtt node in the flow, skipping `wifi_status`'s
   own redundant `.connect()` call entirely and leaving `mqtt_as` as sole owner. The generated Python itself now
   carries an explanatory comment. Also fixed the same way in `http-request.ts`/`udp-send.ts`/`udp-receive.ts`/
   `http-in.ts` (all share the same `"wifi-sta"` `mergeSetup` dedup key as `wifi_status` -- without updating them
   too, whichever one happened to compile first, order-dependent, could have silently won that dedup race with the
   old un-deferred `.connect()` call). **Confirmed fixed on real hardware** -- Mike's words, "seems to have fixed
   it." Full writeup: `decisions/redeploy-network.md`'s three 2026-09-11 entries (original fix, the
   `deferToMqtt`-not-`security` revision, and the hardware confirmation).

5. **One item deliberately left as-is, not a bug**: `mqtt_publish`'s status dot stays blank until its first real
   message passes through it. It's a sink -- `compile.ts` never gives sink nodes their own background task, only
   sources get a spawned coroutine, so there's no code path for `mqtt_publish` to run (and therefore report
   status) before its first real invocation. Asked Mike whether to add an eager-connect-at-deploy bootstrap task
   (new mechanism, matches Node-RED convention, but opens a broker connection even if the node never publishes)
   or leave it lazy. **His call: leave it as-is.** Documented in `mqtt-publish.md` and the item's own outstanding-
   items file.

6. **Everything off-device verified**: `tsc --noEmit` clean after every edit (run directly, this works fine in
   the sandbox); behavior verified via hand-built Python repros and real `compile()` output run through `pymock`
   (since `vitest` itself can't run here this session -- see the warning at the top). New/updated tests:
   `node-mqtt-publish.test.ts` (report-status tests, one updated to assert the CORRECTED two-report behavior
   rather than the original bug it used to assert as if correct), `node-wifi-status.test.ts` (seven new tests:
   `deferToMqtt` for both mqtt node types, unaffected when neither is present, the mqtt-deferral comment appears/
   doesn't, and a dedicated test proving a user's own `"unmanaged"` choice never gets the mqtt-deferral comment).
   Docs updated throughout: `decisions.md`/`decisions/redeploy-network.md`/`decisions/editor-canvas.md`,
   `outstanding-items.md` and its `node-status-indicators.md` detail file (both kept current after every finding,
   not batched), `docs/user-guide/canvas-basics.md`'s new "Node status" section, per-node doc pointers.

## Open threads carried forward, not fully closed this session

- **Run the real `vitest` suite.** Top priority for session start -- see the warning at the top of this doc.
  Everything claimed as "clean"/"passing" above is off-device-verified by hand, not by the actual test runner.
- **The real MicroPython test suite for the `device-runtime/src` changes** -- Mike's own explicit call
  (2026-09-10, "skip") to go straight to the hardware pass instead. Deferred, not dropped -- worth circling back
  to before this item is called fully done, per CLAUDE.md's device-runtime test-suite rule.
- **`mqtt_publish`'s own connected/disconnected reporting, real-hardware check once it's actually published at
  least once** -- the underlying bug (#2 above) is hardware-unverified for `mqtt_publish` specifically (bug #2's
  hardware confirmation so far only covers `wifi_status`/`mqtt_subscribe`'s rendering; the mqtt-sharing fix itself
  is off-device-verified only).
- **Clear-on-redeploy** -- one of the four original design decisions (every node's status clears on every
  redeploy), implemented (`clearNodeStatuses()` in `main.ts`), never explicitly exercised on real hardware.
- **"`mqtt_publish` doesn't connect until it's been selected"** -- Mike's own report, tentatively guessed as a
  possible downstream artifact of the WiFi-flapping bug (#4) rather than a separate issue, but never
  independently re-tested since that fix landed. Worth a quick real-hardware check; if it recurs, it's a real,
  separate bug to chase (clarify with Mike exactly what "selected" means first -- the node itself, or a
  manual-trigger button feeding it -- and what evidence he's using, dot vs. console lines, before guessing).
- Everything else in `outstanding-items.md` untouched this session, all still open.

## Suggested next-session candidates

Discussed with Mike directly at the end of this session; he asked for this written up rather than picked live.
In rough priority order per `outstanding-items.md`'s own P-tags:

1. **Multi-output-port support** (P2, `outstanding-items/connection-state-gate-router-nodes.md`) -- **recommended
   starting point.** Already has a real design direction from a prior session, not just a raised idea:
   function-node UI to set output count, codegen for the return-value/`node.send()` array convention
   (`return [msg1, null]` routes to output 1 only; Node-RED's own documented convention), canvas wiring for N
   output ports. Subsumes/unblocks two smaller backlog items (the WiFi/MQTT-status pass-or-drop gate, the
   two-output status router) rather than competing with them. Ready to build now, no separate scoping session
   needed first.
2. **TCP send / TCP listen-receive** (P3, `outstanding-items/tcp-send-listen-receive.md`) -- real Tier-1 gap
   (only UDP landed of the four originally-scoped node types). Bigger scope than #1: TCP send needs a
   lazy-expiry connection cache, TCP listen-receive needs a callback-to-coroutine bridge design. Worth splitting
   the scoping pass from the build if picked.
3. **Context model, Node-RED-style** (P2 but unscoped, `outstanding-items/context-model-node-red-style.md`) --
   `variable_get`/`variable_set` were pulled off the canvas 2026-09-06 pending a real design (node/flow/global
   scope, a generic set-context node rather than the old narrow pair). Starting point here is a scoping
   conversation with Mike, not straight implementation.

Other open P2/P3 items not picked for this shortlist but still live: credential-free git-committable flows
(P2, needs a secrets-injection mechanism, unscoped), filter/event-compression node (P3, explicitly deferred by
Mike until eswitch/ebutton land), I2C/SPI sensor nodes (P3, gated on hardware in hand), pin/resource-conflict
detection (P5).

## Success criteria (whichever item gets picked)

- Real code, real tests, real canvas wiring where applicable -- matching this session's and every prior
  session's bar.
- Off-device verified before calling anything done -- and this session's own experience is a reminder to
  actually try running `vitest` at the start of the next session rather than assuming the sandbox's rolldown
  issue is permanent; if it's still broken, fall back to the hand-built-Python-repro approach this session used,
  but say so explicitly rather than silently treating "off-device verified" claims as equivalent to a real test
  run.
- `outstanding-items.md`, the item's own detail file, and `decisions.md`/the relevant `decisions/*.md` file all
  updated in the same session, dated, honest about what's still open -- not batched for later.
- Any real limitation or design trade-off documented in the code's own header comment, not just in the docs --
  this project's established convention.

## Not in scope for this chat

- RP2350 wiring/bring-up continuation -- parked on Mike's own timeline.
- I2C/SPI sensor nodes -- gated on hardware in hand.
- MQTTS/TLS -- deferred, Mike's explicit call.
- Backend/auth, most UI/editor items, docs/process items -- separately tracked, not flagged as next.

## Git

Same standing rule as every prior session: git writes (`add`/`commit`) go to Mike as exact commands to run
himself, never executed from the sandbox. Read-only git commands (`status`/`log`/`diff`) are fine to run
directly. This session's entire diff (34 modified files) is still sitting uncommitted on Mike's own machine --
worth committing (in sensible, separate commits -- the rendering fix, the mqtt-sharing fix, and the WiFi-ownership
fix are three genuinely separate bugs with three separate stories, not one grab-bag commit) before starting
anything new, so a future `git log`/`git blame` can actually distinguish them.
