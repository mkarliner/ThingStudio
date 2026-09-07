# Working note: local persistence (`~/.thingstudio`) — scoping, not implementation

Status: decision, 2026-08-21. Raised by Mike in conversation, not from
`mikes-questions-and-points.md`: custom node packages need to survive across
app runs, "probably a `~/.thingstudio` folder to hold other persistent
information." This note resolves *who owns that folder and when*, not its
internal layout — no code changes this session.

## Grounding: two things already on record that pull against each other

`custom-node-authoring-scoping.md` Decision 4 built custom node loading as
session-scoped only, and named persistence as deferred future work with two
candidate mechanisms, without picking between them: "remembering File System
Access handles, or a real project-directory scan once the backend...
exists."

Design doc §4 already has an opinion on the second half of that either/or.
Flow-file persistence today goes through the File System Access API only
because there's no backend yet; §4's 2026-08-16 addendum states plainly that
"under the backend model this becomes the backend's own filesystem access
rather than the File System Access API specifically." The backend
(`backend-platform-decision.md`: Python, `aiohttp`, plain `pyserial`) is
decision-complete but has zero code (`outstanding-items.md`, "Backend /
auth"). So Thingstudio today is a pure browser app with no process that can
own a real, fixed filesystem path.

That's the actual obstacle a literal `~/.thingstudio` hits: a browser can't
silently read or write a fixed home-relative path. It can only get directory
access via a picker the user drives themselves
(`showOpenFilePicker`/`showDirectoryPicker`), and persisting that grant
across app restarts without re-prompting only works reliably in Chrome/Edge
— Safari/Firefox fall back to manual export/import today for flow files,
and per-OS/per-browser consistency is already an open, unverified item
(`outstanding-items.md`, "Backend / auth," the cross-platform requirement
Mike added 2026-08-20). A `~/.thingstudio` directory is a backend-shaped
feature by the architecture's own logic, not a today-shaped one.

## Decision 1: wait for the backend, don't build a browser-only stopgap

Confirmed with Mike 2026-08-21. Custom nodes stay exactly as
`custom-node-authoring-scoping.md` left them — session-scoped, reloaded by
hand each session — until the backend exists to own `~/.thingstudio`
directly. Considered and rejected: a Chrome/Edge-only File System Access
stopgap (throwaway the moment the backend lands, and inconsistent with the
cross-platform requirement in the interim) and an IndexedDB-only invisible
cache (avoids the browser inconsistency but produces a `~/.thingstudio` in
name only — nothing a user could actually find, inspect, or back up, which
is the point of asking for a real folder in the first place). Once the
backend exists, this is a small addition on top of it — `pathlib.Path.home()
/ ".thingstudio"`, created on first use — not a redesign; nothing about
today's custom-node package format assumes session-only loading in a way
that would need to change.

## Decision 2: scope as the general local-state directory, not custom-nodes-only

Mike's own framing named "other persistent information" alongside custom
nodes, so this is scoped as the app's general local-state home going
forward — custom node packages as the first consumer, with room for
whatever else needs a local, non-flow-file home later (candidates, not
decided: a recent-files list, cached editor settings, posture-2 session
material once `backend-editor-auth-and-protocol.md` is built). **Worth
flagging: this scope reading came from Mike's original phrasing, not a
reconfirmed answer** — the follow-up exchange settled the timing question
(wait for backend) explicitly but didn't re-confirm scope separately. Cheap
to narrow back down when the backend is actually built if that turns out to
be overscoped; nothing here commits to a directory layout.

## Newly marked MVP-needed, 2026-08-21 — the actual scope change this note carries

**Mike's explicit call: this work is needed for MVP, not deferred past it.**
That's a bigger fact than it looks — `outstanding-items.md`'s "Backend /
auth" section describes the entire backend as "one coherent, currently
unstarted body of work," and it doesn't appear anywhere in
`mvp-feature-priorities.md`'s tier list at all (that file's Tier 3 "File
save/load" bullet still describes the pre-backend, pure-File-System-Access-API
framing §4 superseded 2026-08-16 — stale, not yet corrected). Marking
`~/.thingstudio` MVP-needed means, by direct dependency, marking *building
the backend* MVP-needed — this note surfaces that consequence rather than
letting "add a persistence folder" quietly imply "stand up the whole thin
backend" without it being visible anywhere.

**Not resolved here, and worth Mike's own explicit call rather than assumed:**
whether this reprioritizes the backend ahead of what
`outstanding-items.md`'s sequencing override currently has queued (the
narrow custom-node-docs validation session, then RP2350 bring-up). Recording
the MVP mark here and in `mvp-feature-priorities.md`/`outstanding-items.md`
below; not silently reordering the queue on this note's own authority.

## What this note deliberately does not decide

- `~/.thingstudio`'s internal layout (subfolders per kind of state,
  filenames, whether custom node packages get copied in verbatim as
  `<name>.node.json`/`<name>.node.py` or repackaged some other way).
- File format versioning / forward-compatibility for whatever gets stored —
  a real question once this is actually built (this project's own "don't
  paint into a dead end" principle applies directly: a stored-custom-node
  format that can't evolve without breaking every already-saved package
  would be exactly the kind of one-way door `CLAUDE.md` asks to check for
  explicitly, not skip).
- Whether `~/.thingstudio` ever holds anything sensitive (posture-2 session
  material is the one candidate use named above) — if it does, that's a
  `backend-editor-auth-and-protocol.md`-adjacent question (file permissions,
  whether it needs encryption at rest) for whoever actually scopes that
  content, not decided by naming it as a candidate here.
- Whether the backend's arrival should reorder the current sequencing
  override — see above.


## Addendum, 2026-09-07: internal layout now decided

`backend-persisted-data-protocol.md` answers the question this note's own "what this note deliberately does not
decide" list left open, once the persisted-data protocol's shape (HTTP admin API) was itself confirmed with
Mike the same session. `persisted_store.py`: flat `~/.thingstudio/flows/<name>.flow.json` and
`~/.thingstudio/custom-nodes/<name>.node.json`+`<name>.node.py` (verbatim copies, matching
`custom-node-authoring-scoping.md`'s existing two-file package format exactly, not repackaged). Still not
decided: on-disk format versioning for custom node packages specifically (flow files already have
`formatVersion`) -- see that file's own "not decided or built here" list.