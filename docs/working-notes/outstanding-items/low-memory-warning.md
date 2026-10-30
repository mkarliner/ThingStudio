# Low-memory warning — not scoped
> **2026-10-30 sweep:** Built and wired: `lowMemoryWarningBeforeDeploy`/`lowFlowMemoryWarning` in
  `editor/src/app/memory-advice.ts` wired into `main.ts`'s pre-deploy path; it warns from HELLO
  figures, not a stated flow-size ceiling. Closed in `outstanding-items/resolved.md` (2026-10-30
  sweep).


§13 describes `HELLO` reporting free flash/RAM so the editor can warn before a flow is too big, but only the version-compatibility half of the pre-flight check is wired in. Would also need the max-flow-size ceiling item resolved.
