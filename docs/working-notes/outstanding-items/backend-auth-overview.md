# Backend / auth — the whole thin-backend architecture is design-only, now marked MVP-needed

**Newly marked MVP-needed by Mike, 2026-08-21 — was previously unprioritized against the tier list.** Trigger:
custom node packages need to persist across app runs in a real `~/.thingstudio` local-state folder, and that's a
backend-owned capability by the architecture's own logic (design doc §4 — under the backend model, filesystem
access is the backend's, not the File System Access API's), not something a pure browser app can do reliably
cross-platform. Full reasoning: `local-persistence-scoping.md`. **Not yet resolved: whether this reprioritizes the
backend ahead of the sequencing override** (the custom-node-docs validation session, then RP2350 bring-up) —
flagged in that note, needs Mike's own resequencing call, not assumed here. `mvp-feature-priorities.md` still
doesn't list the backend in its tier structure at all; that gap is now itself part of what "MVP-needed" means and
is worth closing when the backend is actually picked up.

Worth flagging as a group, not just individually — there is currently no `backend/` (or equivalent) directory
anywhere in this repo. Every piece of `rete-migration-decision.md`'s Decision 2 (a thin local Python backend,
Node-RED's own model, enabling remote access) exists only as design notes; zero code has been written against any
of them yet.

- **`backend-platform-decision.md`** — decision-complete (Python, `aiohttp`, plain `pyserial` wrapped in
  `asyncio.to_thread`), zero code.
- **`backend-editor-auth-and-protocol.md`** — decision-complete (Host-header allowlisting for posture 1, hand-rolled
  `bcrypt`+signed-cookie session for posture 2, one WebSocket endpoint multiplexed by frame type), zero code.
- **`transport-auth-design.md`**'s board-perimeter half is covered under `board-transport-auth.md` (the `HELLO`
  fields).
- Neither backend note's own "what this doesn't decide" list has been picked up either: TLS mechanics for posture
  2, packaging/config format for where the posture-2 password lives, rate limiting.

Whoever picks this up should treat it as one coherent, currently-unstarted body of work, not three independent
small tasks.
