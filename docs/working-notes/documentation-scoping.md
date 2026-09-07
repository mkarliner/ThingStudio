# Working note: documentation — scoping pass (activity 1 of 3)

Status: decision-complete, 2026-09-07. Per Mike's 2026-09-06 split of the
`docs-nothing-written.md` item into three separate activities — (1)
scoping, (2) design (structure/format), (3) tech selection (generator/
hosting) — this note is only activity 1. It answers "what needs
documenting, for which audience(s)," and deliberately does not touch
heading structure, prose style, or what tool renders/hosts the result.
Whoever picks up (2) or (3) should start from this file, not re-derive
the inventory below.

## What this session read

`mikes-questions-and-points.md`'s original ask ("# Documentation" — basic
user docs, a developer guide, "anything else?"), `docs/user-guide/
custom-nodes.md` (the one piece of end-user documentation that already
exists), `README.md`, `docs/thingstudio-design-doc.md` §§1–2 (vision,
target audience), the editor's actual UI surface (`editor/index.html`,
`main.ts`'s Connect/Deploy/Check-status handlers, `PaletteSidebar.vue`/
`palette.ts`), the node registry (`editor/src/node-library/registry.ts`,
16 registered types as of this writing) and palette (`palette.ts`'s
`KIND_STYLE`, 14 of those 16 canvas-wired today — `variable_get`/
`variable_set` are registry-only, deliberately hidden per
`context-model-node-red-style.md`), and `test-flows/README.md` for the
kind of gotcha that's currently only recorded in a working-notes file. **Re-verify the
16/14 counts against `registry.ts`/`palette.ts` directly before writing
anything that states them** — this is a fast-moving number, stale the
day either file changes again.

## Audiences

Three distinct audiences want documentation from this project. Only one
of them is this effort's job.

1. **End-user flow builder — the primary audience, and the gap that
   actually motivated this item.** Design doc §2's own target-audience
   framing: "home-automation tinkerers and IoT/automation professionals
   already comfortable with flow-based tools, MQTT, and JSON" — the same
   demographic Node-RED serves, not a beginner/education audience.
   **Nothing written for this audience exists today.** This is where
   effort belongs.
2. **Node/extension author.** Already served, and served well:
   `docs/user-guide/custom-nodes.md` is complete, example-driven, and
   explicitly designed to stand alone (it was validated by handing it —
   and nothing else — to a separate session and asking it to build a
   real node type from a brief; see `custom-node-authoring-scoping.md`).
   Nothing new needed here beyond linking to it from wherever the
   end-user guide's node-authoring pointer belongs.
3. **Contributor / future session (human or Claude) picking up the
   codebase.** Already served by `CLAUDE.md` plus `docs/working-notes/`
   (`decisions.md`, `learnings.md`, `outstanding-items.md`, the design
   doc itself). **Explicitly out of scope for this "documentation" item**
   — `CLAUDE.md`'s own "Human-facing documentation: concise, not
   exhaustive" section already draws this line: working-notes-style docs
   exist to carry a full reasoning trail, in their own established style,
   and that's a different job than a short, plain end-user guide.
   Duplicating contributor material into the new guide would be scope
   creep against a line the project has already drawn.

Bottom line: **this item is "write the missing end-user guide."** The
developer-guide half of Mike's original ask is already done
(`custom-nodes.md`); no separate "developer guide" deliverable remains.

## Content inventory — what the end-user guide needs to cover

Grouped by what a flow builder actually does, in roughly the order
they'd hit it. This is content scope, not a table of contents — section
order, splitting into multiple pages vs. one, and naming are activity
2's job.

**Getting started**
- Running the editor locally (`cd editor && npm install && npm run dev`)
  and the browser requirement (Chrome/Edge — WebSerial isn't available in
  Safari or older Firefox).
- One-time per-board bootstrap before any flow can deploy:
  `test-flows/deploy_runtime.py`, and the real gotcha already on record
  in `test-flows/README.md` — watching first boot needs a *passive*
  serial connection; `mpremote repl`/Thonny's Shell both send Ctrl-C on
  connect, which looks identical to "never boots."
- Connecting: the Connect button, the WebSerial port picker, what the
  "unverified" version-compatibility warning means and when it's normal
  (a board with no prior HELLO — e.g. never reset since power-up).

**Canvas basics**
- Palette: built-in node groups (general / hardware / network), custom
  nodes' own "custom nodes" group, drag-to-canvas.
- Wiring: port types (`int`, `number`, `bool`, `string`, `bytes`, `any`)
  and what a type mismatch looks like.
- Property panel: per-node configuration, shown on selection.
- Config nodes: the `wifi` and `mqtt-broker` config types, referenced by
  ID rather than duplicated per node — and the one real rule a user needs
  up front: a flow needs exactly one `wifi_status` node if it uses any
  other network node type (that node is the flow's sole WiFi-credential
  source). This is a real, easy-to-hit mistake today, not a nice-to-know.
- Clear canvas, node/wire selection, current UI limitations worth being
  upfront about rather than letting someone discover them (no per-node
  delete yet — "Clear canvas" wipes everything; no resizable panes beyond
  the collapsible rail).

**Flow lifecycle**
- Save flow / Open flow, the flow name field (saved in the file, sent
  with every deploy so a connected board's identity is visible), and one
  plain-language line on why flow files are git-friendly (`nodes`/
  `edges`/`layout`/`configs` kept separate) — useful to know, not
  necessary to understand in depth.
- Deploy: Compile → Deploy, what a successful vs. failed deploy looks
  like, Check status (re-request HELLO without resetting or redeploying),
  Disconnect.

**Debugging and troubleshooting**
- The device console panel and the compiled-source preview panel.
- Reading a `NODE_ERROR` line — CLAUDE.md's own convention (name the
  operation and its host:port) means every network node's errors follow
  one shape; worth teaching once rather than per-node.
- The one accepted, documented platform limitation worth surfacing
  proactively rather than letting a user hit it cold: the WiFi/MQTT
  connect-ordering race is fixed on RP2040 but still narrows-not-
  eliminates on ESP32 (`CLAUDE.md`'s fault-handling corollary) — framed
  as "here's what a real error looks like and why," not buried.

**Node reference**
- One entry per canvas-wired node type (14 today — re-verify against
  `palette.ts` at write time): what it does, its properties, and any
  real behavioral gotcha already on record. Most of this content already
  exists, scattered — it needs pulling together and rewriting in the
  project's plain end-user register, not re-deriving from scratch:
  - `inject` — click-only fire (as of the 2026-09-02 rewrite; no
    fire-at-boot behavior — that's a separate, unbuilt `startup` node).
  - `udp_send`'s `timeout` / `udp_receive`'s `poll interval` — both
    answered, real, load-bearing properties (`outstanding-items.md`'s
    "Network / config nodes" section has the full answer if the guide
    wants the short version).
  - `wifi_status` — emits only on status change, is the flow's sole
    WiFi-credential source (see "Canvas basics" above).
  - `mqtt_publish`/`mqtt_subscribe` — each references its own
    `mqtt-broker` config; no publish-after-subscribe-confirmed ordering
    guarantee yet (`mqtt-pubsub-boot-race.md` — worth a one-line caveat,
    not necessarily a full callout, since it's still unconfirmed).
  - Every node's own header comment in `editor/src/node-library/*.ts` is
    the primary source for real limitations, per CLAUDE.md's "document
    in the code's own header comment" convention — the guide should pull
    from there, not re-litigate.
- A pointer out to `docs/user-guide/custom-nodes.md` for anything not a
  built-in node, matching the linked "Working with..." pattern CLAUDE.md's
  interim style reference (Node-RED's Concepts page) already calls for —
  not duplicated inline.

## Addendum, 2026-09-07: in-editor node reference (Mike's own idea)

Raised in conversation after the scoping pass above: node summaries
should be available directly in the editor -- either in the property
panel itself, or in a separate tab -- so a basic reference exists without
leaving the tool at all, not only in the external end-user guide.

This changes one real thing: the "Node reference" content above needs a
**single authored source**, not two independently-maintained copies that
will drift. Two plausible shapes for that source, not chosen here:

- A `summary`/property-level description field added to each node's
  `NodeDefinition` (`registry.ts`) or its palette metadata, rendered
  directly in `PropertyPanel.vue` (or a new panel tab). The external
  guide's node-reference section would then pull from the same field
  rather than hand-duplicating prose.
- A per-node markdown snippet (matching `custom-nodes.md`'s own
  per-example style) as the single canonical text, rendered both in a new
  editor panel and included verbatim into the external guide at build
  time.

Which shape, and the property-panel-vs-tab UI question, is a design call
(activity 2, or a small scoped piece of its own) -- not decided here. But
it changes one thing this file should flag for activity 3: **whichever
doc-authoring tool gets picked should be able to consume content that
also lives in (or alongside) `editor/src/node-library/*.ts`, not require
its own separate, disconnected content tree.** A tool that fights this by
insisting on its own isolated docs directory with no easy way to share
text with the editor source works against Mike's own idea rather than
supporting it -- see `documentation-tech-selection.md` for how this
weighed into that choice.

**Not yet its own tracked build task.** The in-editor half (a new
property-panel section or tab) is real UI work, distinct from writing the
guide itself, and needs Mike's own priority tag like anything else raised
in conversation rather than assumed into scope. Logged in
`outstanding-items.md`'s "UI / editor" section.

## Explicitly out of scope for the end-user guide

- **Anything not built yet.** TCP send/listen-receive, I2C/SPI sensor
  nodes, drag-to-splice, board-specific node collections, the remote-access
  backend, board-transport auth, named/labeled pin mapping — none of these
  exist today. Per CLAUDE.md's "concise, not exhaustive" rule, a
  roadmap/wishlist belongs in `README.md`'s "Not built yet" section and
  `outstanding-items.md`, not in a guide teaching someone to use what's
  actually there. Document what exists; let the README's existing
  roadmap section carry "what's coming."
- **Contributor-facing material** — repo conventions, decision logs,
  working-notes style, `CLAUDE.md` itself. Already served, per
  "Audiences" above.
- **Structure, format, prose style, and generator/hosting choice** —
  activities 2 and 3, deliberately not decided here. (CLAUDE.md's own
  interim style reference — Node-RED's Concepts page, short sentences,
  3-4 sentence paragraphs, no flourish — already applies once activity 2
  starts; restating it isn't this file's job.)

## Open questions for whoever does activity 2 (design)

- **One guide or two?** `custom-nodes.md` already stands alone for node
  authors. The end-user guide could be a single document (getting
  started through node reference) or split (e.g. a short "quick start"
  plus a longer node reference used as lookup) — a real design call, not
  a scoping one, since it depends on the node reference's actual length
  once written.
- **Node reference: one page or one-file-per-node?** 14 node types today,
  growing. `custom-nodes.md`'s own single-file-is-complete-on-its-own bar
  is worth weighing against a Node-RED-style "one doc per node" split —
  again, activity 2's call.

## What this session did not do

- Did not write any end-user guide content — this file is the scope, not
  the guide.
- Did not choose a structure, a format, or a documentation tool/generator.
- Did not re-audit every node's header comment for content that would
  go directly into a node-reference entry — flagged as the inventory
  source above, not pre-extracted.
