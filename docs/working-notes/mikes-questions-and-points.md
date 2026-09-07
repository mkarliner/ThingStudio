
the following points and questions are for discussion around the scope of the MVP or the next prototype...

[Annotations in brackets below, added 2026-08-20 with Mike's explicit go-ahead: a pointer to where an item has already been captured elsewhere (decisions.md, outstanding-items.md, the design doc), so status is visible at a glance without cross-referencing separately. Nothing of Mike's own text below is changed or removed — this file stays the live scratchpad it's always been; an annotated item isn't "resolved" in the sense this file avoids, just pointed at its current disposition.]

# Bugs -- priority
- 2026-08-19: live console output (debug prints, NODE_ERROR) only ever shows a raw numeric node id ("DEBUG node=2 payload=True", "NODE_ERROR node=4 ...") with no way to tell which canvas node that is without opening the flow file's JSON and reading `nodes`/`edges` by hand. Caught during a real hands-on pass on hardware (config-node-and-palette-implementation-briefing.md's follow-up testing) -- Mike had to ask "how am I supposed to know which node 2 is?" The editor already tracks a node-id <-> canvas-node mapping internally (graph-adapter.ts's `reteIdByNodeId`/`nodeIdByReteId`) for other reasons, so resolving console output through it (or just showing each node's id on the canvas itself) should be a small, contained fix, not a redesign. Flagged as priority rather than fixed in the moment, per Mike's own call, to keep that session's testing pass moving.
  [tracked, not yet fixed — outstanding-items.md, "UI / editor" section]
- 2026-09-02: `inject` still has properties of repeat delay -- expected the click-only live-fire refactor (reported finished in a prior session's handoff brief) to have replaced this with pure click-to-fire, but it never actually landed in the repo. Verified 2026-09-02: no trace in `git log`/`git stash`/`git reflog`. "manual" today just means "fire once, automatically, at flow startup," not "fire on click."
  [implemented 2026-09-02, not yet verified by Mike on real hardware — outstanding-items.md, "UI / editor" section]
- 2026-09-02: wifi status, mqtt nodes should have an indicator of status (on the canvas itself, not just console output).
  [tracked, not scoped — outstanding-items.md, "UI / editor" section]
- 2026-09-02: wifi status should only emit a message on change of status. Confirmed: `wifi-status.ts` currently emits unconditionally every poll, no change-detection at all.
  [implemented 2026-09-02, not yet verified (npm test/build/hardware retest all still owed) — outstanding-items.md, "Network / config nodes" section]

# Platforms
We need to support the following platforms for the editor/backend:
- MacOS
- Windows
- Linux
[tracked, not yet verified per-OS — outstanding-items.md, "Backend / auth" section (added 2026-08-20)]

# Working docs
- Create folder of board and processor definitions so that you don't have to retrieve and parse them from websites
- Include notes of which pins are advisable to be used / not used
- Keep this up to date as we add to the list of supported boards and processors
[tracked, not scoped — outstanding-items.md, "Board/processor reference data" section (added 2026-08-20); connects to "Port mapping" and "machine specific node collections" below]

# Security 
- do we need a password for access to the board transport? I'm aware of how insecure iot devices are. I think we should at least basic security for the board from day 1
  [partially decided, not implemented — decisions.md, "Board-transport auth (perimeter 2)" section: HMAC-SHA256 + persisted counter chosen for v1.1+; the one v1 hedge (HELLO's authRequired/authScheme fields) is still unbuilt, see outstanding-items.md "Redeploy / runtime" section]

# Wifi management
Investigate using Functor/Singletons for the Wifi config and any other global config objects : see https://github.com/peterhinch/micropython-samples/blob/master/functor_singleton/README.md

# Nodes - to be prioritised
[whole list triaged — decisions.md, "Config nodes / Tier 1 scope" section, 2026-08-17 entry, plus tier1-node-candidates-prioritization-briefing.md; per-item disposition below]
   - Interrupt / pin change
     [done — interrupt.ts, replaces gpio_in]
   - delay, gets a messages and relays it after an interval
     [built 2026-09-06 — editor/src/node-library/delay.ts, transform node, full canvas presence, 7 tests, off-device verified; outstanding-items.md "Resolved" section]
   - average/smooth low pass filter for eg: adc readings.
     [same node as "filter / event compression" below — outstanding-items.md "Network / config nodes" section]
   - ADC - review, , from peter hinche's collection 
   - gpio in -  read on message, again, may have polling option.
     [done — interrupt.ts replaces gpio_in, same as "Interrupt / pin change" above]
   - debounce
     [done — built into the interrupt node's cooldown algorithm, decisions.md]
   - http in/out
     [http_request (out) built but registry-only, not wired onto the canvas — outstanding-items.md "Network / config nodes". http-in (on-device server) deliberately deferred — decisions.md]
   - filter / event compression
     [tracked, not built — outstanding-items.md "Network / config nodes"]
   - udp / tcp
     [udp_send/udp_receive built and on canvas (this session hardened them further — redeploy-cleanup-and-network-fault-detection-briefing.md). tcp_send/tcp_listen_receive not built — outstanding-items.md "Network / config nodes"]
   - mdns
     [decided: deferred to v2, MicroPython support unconfirmed across targets — decisions.md]
   - file ops
     [decided: rejected as a node type, reduces to a function-node one-liner — decisions.md; outstanding-items.md's "Coverage note" section]
   - i2c actual operation - what happens with stuck devices?
     [tracked, unresolved fault-handling question — outstanding-items.md "Network / config nodes"]
   - init node triggered by start of flow?
     [tracked, never discussed — outstanding-items.md "UI / editor" section]
   - Button and Switch from peter hinche's collection
# Store flows on micro as well as file system.
[tracked, not scoped — outstanding-items.md "Redeploy / runtime" section]

# UDP send has a timeout property - why?

# UDP receive has a poll internval property - why?
[answered 2026-09-06 — outstanding-items.md "Network / config nodes" section: udp_send's timeout bounds the
sendto() EAGAIN-retry loop (a rare but real full-send-buffer case), per CLAUDE.md's bound-every-network-call rule;
udp_receive's pollMs is the actual polling cadence of a non-blocking-socket workaround for a real MicroPython
asyncio gap (no datagram-await primitive on any port, micropython/micropython#13382) — a genuine trade-off knob,
not cosmetic, though its 20ms default is still unvalidated against real back-to-back hardware traffic.]

# machine specific node collections and defs
   - we should have node 'collections' for nodes that naturally are a set , specifially board/processor specific ones like pi pio
   [tracked, not scoped — outstanding-items.md "UI / editor" section and "Board/processor reference data" section]

# To review
- 2026-08-17: Mike wants to review the `inject` node fairly soon — suspicion it's actually doing the job of two separate nodes (something to dig into, not yet diagnosed).
  [tracked, not yet diagnosed — outstanding-items.md "UI / editor" section]

# Port mapping
I shouldn't have to remember what sensor is connector to a given gpio or other port. I want to be able to define names for pins which I can refer to in pin selection drop downs.
[tracked, not scoped — outstanding-items.md "UI / editor" section ("Named/labeled pin mapping") and "Board/processor reference data" section]

# Documentation
- Basic user docs
- Developer guide (how to make new node types)
- Anything else ?
[tracked, nothing written — outstanding-items.md "Docs / process" section]


# CI
- should we use a CI that's independent of Github (add to claud a note about vendor neutral where possible)
[tracked, not revisited — outstanding-items.md "Docs / process" section ("CI vendor-neutrality")]

# App Platform
node-red has a backend serving up the editor web pages, not a cross platform, GUI app as Electron or Tauri give you. Which do we want? A back end could be written in Python which might ease the pain of cross platform issues.
[resolved 2026-08-16 — decisions.md "Backend" section, first entry: thin local Python backend + browser-based web editor, explicitly not Electron/Tauri. Zero code written yet — outstanding-items.md "Backend / auth" section]

# UI
- collapsible, resizable panes
- nodes in general should able to show status (like node red mqtt), specifically wifi, mqtt http 
- delete node and wire
- notes / README sheet for documenting flow
[tracked, untriaged — outstanding-items.md "UI / editor" section ("General UI wishlist")]
- custom nodes should be persistent across session, needs a manage pallette system, plus a convention on where to store them.

