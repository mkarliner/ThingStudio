
the following points and questions are for discussion around the scope of the MVP or the next prototype...

[Annotations in brackets below, added 2026-08-20 with Mike's explicit go-ahead: a pointer to where an item has already been captured elsewhere (decisions.md, outstanding-items.md, the design doc), so status is visible at a glance without cross-referencing separately.]

[2026-09-07, Mike's explicit go-ahead: fully-resolved or superseded items are now removed outright rather than just annotated, to keep this scratchpad short. Nothing is actually lost — every removed item's full history and resolution still lives in outstanding-items.md's "Resolved" section, decisions.md, or the design doc, exactly where its annotation pointed before removal; git history has this file's own prior wording if it's ever needed.]

[2026-09-13, big pass: everything implemented, or already tracked with its own home in outstanding-items.md/decisions.md, removed outright per the same go-ahead above — not just the freshly-resolved items, but the whole backlog of already-triaged bullets that were only being kept here as a duplicate. What's left below is genuinely not tracked anywhere else yet.]

# Bugs -- priority
- when selecting a node id in the console, the canvas makes that node the center. This turns out to be annoying. Remove that.
  [raised again 2026-09-13 — this exact pan/zoom-to-node behavior was built and confirmed working by Mike on
  2026-09-04 (outstanding-items/console-node-id-mapping.md), so this is a fresh complaint about already-shipped,
  already-signed-off behavior, not a stale leftover. Needs Mike to say what's actually bugging him about it
  (the auto-pan/zoom itself? losing current view context? something else?) before it can be scoped.]

# UI
- deploy runtome from editor
  [untracked anywhere, confirmed by grep 2026-09-12 — deploy_runtime.py is a standalone manual script
  today, no browser-UI path. Needs its own outstanding-items file if still wanted, and a priority.
  multi-output-landed-mikes-questions-triage-briefing.md]
