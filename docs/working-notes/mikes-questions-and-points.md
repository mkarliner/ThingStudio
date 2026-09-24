
the following points and questions are for discussion around the scope of the MVP or the next prototype...

[Annotations in brackets below, added 2026-08-20 with Mike's explicit go-ahead: a pointer to where an item has already been captured elsewhere (decisions.md, outstanding-items.md, the design doc), so status is visible at a glance without cross-referencing separately.]

[2026-09-07, Mike's explicit go-ahead: fully-resolved or superseded items are now removed outright rather than just annotated, to keep this scratchpad short. Nothing is actually lost — every removed item's full history and resolution still lives in outstanding-items.md's "Resolved" section, decisions.md, or the design doc, exactly where its annotation pointed before removal; git history has this file's own prior wording if it's ever needed.]

[2026-09-13, big pass: everything implemented, or already tracked with its own home in outstanding-items.md/decisions.md, removed outright per the same go-ahead above — not just the freshly-resolved items, but the whole backlog of already-triaged bullets that were only being kept here as a duplicate, plus the two items that got scoped and given real outstanding-items.md entries during this same pass (console-click-viewport-jump.md, deploy-runtime-from-editor.md). Nothing remains below as of this pass — every item that was here now has a home elsewhere. Leaving this file in place, empty of bullets, as the standing place new points/questions get added going forward.]


[2026-09-17: "## Nodes" section removed -- Button/Switch built as `thingstudio/eswitch`/`thingstudio/ebutton`
(outstanding-items.md's "Resolved" section, `decisions/node-authoring.md`); AADC split into its own
outstanding-items.md follow-up item; i2c folded into the existing `i2c-spi-sensor-nodes.md` item. Nothing lost --
same removal convention as this file's own 2026-09-07/2026-09-13 passes above.]

- generic policy for presets for nodes that are complex to set up, like display drivers, but also board configs / pin mappings
- processor detection/selection mechanism for viper 
- nodes for processors with native usb (serial, hid, mass storage, hostmode?) - post mvp
- only load the nodes a flow uses onto the board
- custom nodes (there really isn't such a thing) should appear on the pallet. and should be stored in ~/.thingstudio
- all .thingstudio contents should be under some kind of change control
- AADC node
- Clear (canvas) should only clear the currently visible flow
- the startup node should provide a reason in its payload, like wake from deep sleep

[2026-09-23: top-bar reorder and "remove 'via backend'" items removed -- done, see
`decisions/editor-canvas.md`'s 2026-09-23 entry.]
[2026-09-23: boot-loop removal and pause-to-prompt items removed -- built, see
`decisions/board-recovery-and-commands.md`.]
