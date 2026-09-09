# Briefing: next session is a connection-status-indicator build, preceded by a
# quick mikes-questions triage

For the next chat. Read `CLAUDE.md` in full, as always, plus `docs/working-notes/mikes-questions-and-points.md`
(it's been appended to again since the last triage -- see below).

**This session's work is already committed — confirm with your own `git status`/`git log` before trusting that,
not this file.** As of this writing, tip is `bc965c4` ("Close out http_in/http_response and deploy-button items as
real-hardware verified; pick connection-status indicator as next priority"), with `49faf43` (Mike's own commit,
two new `mikes-questions-and-points.md` lines) landed just before it. Working tree is clean except for this
briefing file itself.

## Where this came from

`http_in`/`http_response` and the compile/deploy-button dirty-tracking feature were both built, off-device
verified, and then real-hardware/real-browser confirmed by Mike this session -- two real bugs found and fixed
along the way (an EADDRINUSE-on-redeploy bug and a palette-registration gap; both are in the `http_in` detail file
below). Both items are fully closed, nothing left open. Asked what's next, Mike picked the **general architectural
slot for node connection-status indicators** (`outstanding-items/node-status-indicators.md`) -- not eswitch/ebutton,
which was my own first (wrong) read of his answer, corrected same session.

Separately, and not yet acted on: Mike appended two new lines to `mikes-questions-and-points.md`'s "Bugs --
priority" section (commit `49faf43`, his own, not mine):

- "Can't connect two wires to a node input"
- "wifi status node should emit complete wifi status include ip address"

Neither is folded into `outstanding-items.md` yet -- this file's own "Flagged as ambiguous" section already covers
`mikes-questions-and-points.md` generically ("re-check it directly for anything newer than this index"), so no
index edit was owed for these two lines specifically, but the actual triage (a real `outstanding-items.md` entry,
priority-tagged by Mike) hasn't happened. Doing that first is cheap and worth doing before the status-indicator
build, in case it reprioritizes anything or turns out to be a five-minute fix that unblocks testing the
status-indicator work itself (see below -- multi-input wiring may matter for how a status fan-in is tested).

## Two things found by a quick read, to save next session's first few minutes

Not built, not scoped further than this -- just enough digging to make next session's triage conversation with
Mike faster.

**"Can't connect two wires to a node input"** is very likely explained by Rete's own default, not a Thingstudio
bug: `rete.common.js`'s `Input` constructor takes `(socket, label, multipleConnections)` and defaults
`multipleConnections` to `false` (`Output`'s equivalent constructor defaults it to `true` -- asymmetric on
purpose in Rete itself). Every `this.addInput(...)` call in `editor/src/app/rete/nodes.ts` (`msg`, `signal`,
`duty`, function-node dynamic inputs, etc.) omits that third argument, so every input on every node type is
single-connection-only today, uniformly. Turning it on is mechanically simple (pass `true`, or thread a per-port
flag through `portSocket`/`NodeDefinition.ports` if only some inputs should allow it) -- the real question for
Mike is a design one: does *every* input become multi-connection (Node-RED's own default -- any number of wires
into one input, messages just arrive whenever each one fires), or does this want to be opt-in per port/node type?
Node-RED's own semantics are the obvious default to match, but worth confirming rather than assuming, especially
since `compile.ts`'s codegen for a source's downstream chain and a sink's own handler weren't written with "this
input might fire from two unrelated upstream sources" in mind -- worth a quick check of whether anything assumes
single-provenance before flipping the flag broadly.

**"wifi status node should emit complete wifi status include ip address"** -- the `ip` address is already there:
`wifi-status.ts`'s `buildMsg` already computes `_wifi_ip = _wifi_sta.ifconfig()[0]` and includes it in the emitted
envelope (`msg = {'payload': _wifi_connected, 'topic': '', 'ip': _wifi_ip}`), and has since the emit-on-change work
landed. So either this is asking for something not yet visible anywhere in the UI (the property panel / debug
console may only surface `payload`, not the rest of the envelope -- worth checking what a user actually sees today
before assuming this is a codegen gap), or "complete" means more than just the IP -- `ifconfig()` actually returns
a 4-tuple (`ip, subnet, gateway, dns`), and RSSI is available via `_wifi_sta.status('rssi')` on ESP32 but isn't a
portable MicroPython API across boards (worth flagging against `CLAUDE.md`'s own whack-a-mole corollary if Mike
wants it -- same "don't chase every board's idiosyncrasies" reasoning that already applies elsewhere in this
file). Cheapest first move is probably just asking Mike what he actually wants to see and where, rather than
guessing at scope.

## The connection-status-indicator item itself

`outstanding-items/node-status-indicators.md` is the starting doc -- Mike's original 2026-09-02 ask, reframed
2026-09-08 as a general per-node-type mechanism rather than two special-cased nodes. Today, status is visible only
via generated console output (`NODE_ERROR`/`DEBUG` lines), nothing on the canvas itself. Concrete points already
on record there, worth re-reading in full before designing anything:

- Needs a real design for how a running device reports per-node state back to the *editor* live, distinct from
  the existing console-only reporting (`console-node-id-mapping.md` is the existing node-id attribution mechanism
  console errors already use -- likely the right foundation to build on rather than a second, parallel id scheme).
- `http_request` is explicitly excluded -- not a persistent connection, nothing to show.
- `wifi_status` and MQTT (`mqtt_publish`/`mqtt_subscribe`) are the concrete first consumers.
- This is also named as the near-term bar for the old "Tier 2 live value streaming" item's UI half
  (`tier2-live-streaming-persistence.md`), per Mike's 2026-09-06 call splitting that item in two -- worth reading
  that split rationale before scoping, so this doesn't accidentally re-absorb the data-persistence half Mike
  deliberately separated out.

Not scoped beyond that -- this is a genuine design task before it's an implementation task. First real step next
session is probably walking `node-status-indicators.md` and `tier2-live-streaming-persistence.md` with Mike
together, the same way past design-call items have started (config-node work, the backend/auth split), rather than
guessing at wire-protocol shape unprompted.

## Suggested next-session order

1. **Fold `mikes-questions-and-points.md`'s two new lines into `outstanding-items.md`, with Mike, priority-tagged.**
   Cheap, and the multi-input question in particular may be worth resolving before or alongside the status-indicator
   work if a status fan-in ends up wanting multiple upstream sources feeding one display.
2. **Design conversation for the connection-status indicator**, grounded in `node-status-indicators.md` and
   `tier2-live-streaming-persistence.md` -- what does the wire protocol/transport look like for a device to push
   live per-node state to the editor, and what does the canvas render. This is the actual next-priority pick.
3. **Build whatever the design conversation settles on**, same bar as every prior session (below).

If the design conversation itself eats most of the session, that's fine -- a real, Mike-approved design IS the
legitimate deliverable for a task like this, same exception documentation-scoping work was already given.

## Not in scope for this chat (deliberately, or just not reached)

- The P4 backlog items explicitly deferred during `http_in`'s own scope cut this session (named-path-parameter
  matching, request-body parsing into `msg.payload`, a per-node `Content-Type` property on `http_response`) --
  tracked in `outstanding-items/http-in-response.md`, not reopened here.
- eswitch/ebutton nodes and the Peter Hinch ADC-monitoring driver -- still `[P4]`, real item, just not this
  session's pick (see the mis-pick-and-correction note in the previous commit's message if the history looks odd).
- Any further per-board hardware verification -- CLAUDE.md's whack-a-mole corollary still stands from the prior
  backend/failure-handling session, unaffected by anything this session touched.

## Success criteria (whichever item gets touched)

Same bar as every prior session -- see `next-session-picks-briefing-2026-09-07.md` for the full text. In short:
real code/tests/canvas wiring (a genuine design document is the one accepted exception, and only for a task whose
actual deliverable is the design itself, as above); off-device verified in an isolated extracted copy before
calling anything done; `outstanding-items.md` plus the item's own detail file updated in the same session, dated;
real limitations documented in the code's own header comments, not just the docs.

## Git

Only this briefing file needs committing right now -- everything else from this session is already in (`bc965c4`,
`49faf43`, and the four commits before them). Standard reminder: git writes go to Mike as commands to run himself
in a real Terminal, never executed from the sandbox; if a git command hangs or errors oddly, `rm -f
.git/index.lock` in a real Terminal is still the first thing to try.
