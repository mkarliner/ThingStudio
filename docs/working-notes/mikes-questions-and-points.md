
the following points and questions are for discussion around the scope of the MVP or the next prototype...

# Bugs -- priority
- 2026-08-19: live console output (debug prints, NODE_ERROR) only ever shows a raw numeric node id ("DEBUG node=2 payload=True", "NODE_ERROR node=4 ...") with no way to tell which canvas node that is without opening the flow file's JSON and reading `nodes`/`edges` by hand. Caught during a real hands-on pass on hardware (config-node-and-palette-implementation-briefing.md's follow-up testing) -- Mike had to ask "how am I supposed to know which node 2 is?" The editor already tracks a node-id <-> canvas-node mapping internally (graph-adapter.ts's `reteIdByNodeId`/`nodeIdByReteId`) for other reasons, so resolving console output through it (or just showing each node's id on the canvas itself) should be a small, contained fix, not a redesign. Flagged as priority rather than fixed in the moment, per Mike's own call, to keep that session's testing pass moving.

# Security 
- do we need a password for access to the board transport? I'm aware of how insecure iot devices are. I think we should at least basic security for the board from day 1

# Nodes - to be prioritised
   - Interrupt / pin change
   - ADC
   - debounce
   - http in/out
   - filter / event compression
   - udp / tcp
   - mdns
   - file ops
   - i2c actual operation - what happens with stuck devices?
   - init node triggered by start of flow?

# machine specific node collections and defs
   - we should have node 'collections' for nodes that naturally are a set , specifially board/processor specific ones like pi pio

# To review
- 2026-08-17: Mike wants to review the `inject` node fairly soon — suspicion it's actually doing the job of two separate nodes (something to dig into, not yet diagnosed).

# Port mapping
I shouldn't have to remember what sensor is connector to a given gpio or other port. I want to be able to define names for pins which I can refer to in pin selection drop downs.

# Documentation
- Basic user docs
- Developer guide (how to make new node types)
- Anything else ?


# CI
- should we use a CI that's independent of Github (add to claud a note about vendor neutral where possible)

# App Platform
node-red has a backend serving up the editor web pages, not a cross platform, GUI app as Electron or Tauri give you. Which do we want? A back end could be written in Python which might ease the pain of cross platform issues.

# UI
- collapsible, resizable panes
- delete node and wire
- notes / README sheet for documenting flow

