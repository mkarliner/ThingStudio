
the following points and questions are for discussion around the scope of the MVP or the next prototype...

[Annotations in brackets below, added 2026-08-20 with Mike's explicit go-ahead: a pointer to where an item has already been captured elsewhere (decisions.md, outstanding-items.md, the design doc), so status is visible at a glance without cross-referencing separately.]

[2026-09-07, Mike's explicit go-ahead: fully-resolved or superseded items are now removed outright rather than just annotated, to keep this scratchpad short. Nothing is actually lost — every removed item's full history and resolution still lives in outstanding-items.md's "Resolved" section, decisions.md, or the design doc, exactly where its annotation pointed before removal; git history has this file's own prior wording if it's ever needed.]

# Bugs -- priority
- 2026-09-02: wifi status, mqtt nodes should have an indicator of status (on the canvas itself, not just console output).
  [tracked, not scoped — outstanding-items.md, "UI / editor" section]
- Favicon for editor
- Node input and output - define a consistent policy for msg/payload ext and include in claude.md
- write explaination of node flow operation to include in user docs
- Clicking on the inject node action opens the property sheet. It should only open on a real select.
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

# Nodes - to be prioritised
[whole list triaged — decisions.md, "Config nodes / Tier 1 scope" section, 2026-08-17 entry, plus tier1-node-candidates-prioritization-briefing.md; per-item disposition below]
   - filter / event compression
     [tracked, not built — outstanding-items.md "Network / config nodes"; also covers the average/smooth low-pass-filter ask that used to be listed separately here, same node] see peter hinche's collection
   - udp / tcp
     [udp_send/udp_receive built and on canvas. tcp_send/tcp_listen_receive not built — outstanding-items.md "Network / config nodes"] see async udp implementation
   - i2c actual operation - what happens with stuck devices?
     [tracked, unresolved fault-handling question — outstanding-items.md "Network / config nodes"]
   - init node triggered by start of flow?
     [tracked, never discussed — outstanding-items.md "UI / editor" section]
# Store flows on micro as well as file system.
[tracked, not scoped — outstanding-items.md "Redeploy / runtime" section]

# machine specific node collections and defs
   - we should have node 'collections' for nodes that naturally are a set , specifially board/processor specific ones like pi pio
   [tracked, not scoped — outstanding-items.md "UI / editor" section and "Board/processor reference data" section]

# Port mapping
I shouldn't have to remember what sensor is connector to a given gpio or other port. I want to be able to define names for pins which I can refer to in pin selection drop downs.
[tracked, not scoped — outstanding-items.md "UI / editor" section ("Named/labeled pin mapping") and "Board/processor reference data" section]

# Documentation
- Basic user docs
- Developer guide (how to make new node types)
- Anything else ?
[developer guide done — docs/user-guide/custom-nodes.md. End-user "basic user docs" guide: scoped, tooling decided (MkDocs + Material theme, GitHub Pages), and structure designed + project scaffolded (mkdocs.yml, GH Actions workflow, placeholder pages) — only the actual guide/node-reference content remains unwritten. outstanding-items.md "Docs / process" section; docs/working-notes/documentation-scoping.md; docs/working-notes/documentation-tech-selection.md; docs/working-notes/documentation-design.md]

# UI
- resizable panes
- arrange to menu to better reflect workflow connect/open/sav...
- Allow multiple panes (still one flow)
- delete node and wire
- notes / README sheet for documenting flow
[collapsible panes done 2026-09-04; resizable panes, delete node/wire, and the notes/README sheet remain tracked, untriaged — outstanding-items.md "UI / editor" section ("General UI wishlist")]
- custom nodes should be persistent across session, needs a manage pallette system, plus a convention on where to store them.
  [tracked, not scoped — outstanding-items.md "Backend / auth" section; local-persistence-scoping.md already scopes this as backend-owned, via a ~/.thingstudio local-state folder, zero code yet]
- favicon
- deploy runtome from editor
