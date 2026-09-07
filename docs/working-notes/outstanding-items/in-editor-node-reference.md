# In-editor node reference (property panel or a separate tab)

Raised by Mike, 2026-09-07, in the same conversation that picked up the documentation scoping pass. A basic
node-summary reference should be available directly in the editor — either surfaced in the property panel itself
when a node is selected, or as a separate tab/panel a user can open regardless of selection — so someone doesn't
have to leave the tool and go to the external end-user guide to remember what a node's properties do.

Not scoped in detail. Two open design questions, neither resolved: (1) property panel vs. a separate tab — a
different UI shape with different trade-offs (contextual but only visible per-node, vs. always-available but not
tied to the current selection); (2) where the reference text itself is authored — see
`docs/working-notes/documentation-scoping.md`'s 2026-09-07 addendum, which argues this needs a single content
source shared with the external guide's own node-reference section, not two independently hand-maintained copies.
`docs/working-notes/documentation-tech-selection.md` weighs that requirement into the doc-tooling choice.

Real UI work once scoped (a new `PropertyPanel.vue` section, or a new panel + `main.ts` wiring), not just a
documentation task — tracked separately from the documentation item itself for that reason.
