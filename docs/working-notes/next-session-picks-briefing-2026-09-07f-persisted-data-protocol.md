# Briefing: backend↔browser persisted-data protocol decided and built (HTTP admin API);
# editor<->backend wiring is now the clear blocker for exercising any of it — pick that up next

For the next chat. Read `CLAUDE.md` in full, as always.

**Nothing from this session is committed yet — confirm with your own `git status`/`git log` before trusting
that, not this file.** As of this writing, tip is `4005fd5` ("Add minimal backend: serial<->WebSocket relay,
posture-1 Host allowlist") and `git status --short` shows this session's work as modified/untracked. If
`.git/index.lock` is present, `rm -f .git/index.lock` in a real Terminal clears it, same recurring issue as
every prior session. The exact `git add`/`git commit` commands are below in "For Mike."

## Where this came from

Picked up from the prior briefing's #1 candidate (backend↔browser persisted-data protocol, `[P1]`,
`outstanding-items/backend-persisted-data-protocol.md`) — Mike's own explicit next-session pick, confirmed via
a clarifying question at the start of this chat. Mid-session, Mike also flagged that "posture-1" (this project's
deployment-posture terminology, `backend-editor-auth-and-protocol.md`) isn't the same axis as the `[P1]`-`[P5]`
*priority* tags in `outstanding-items.md` — worth restating for whoever picks this up next, since both axes use
the digit "1" and it's an easy mix-up to read into a sentence that wasn't making it.

## What this session did

**1. Resolved the outstanding item's own fork — HTTP admin API, not a WS control-plane extension.** Confirmed
with Mike directly (a real architecture choice with auth consequences, the outstanding-item doc's own framing
for why it needed his call rather than a unilateral one). Reasoning: `ws_relay.py`'s `ConnectionSession` is
scoped to "at most one open serial port per socket" — a poor fit for data that should be reachable with no
serial connection open at all (browsing saved flows with no device plugged in). New HTTP routes are covered
automatically by the existing `host_allowlist_middleware`, since `app.py` installs it at the `Application`
level, not per-route — no new auth wiring needed, confirmed by a test that hits the real `create_app()`.

**2. `~/.thingstudio`'s internal layout — the other thing left undecided (`local-persistence-scoping.md`) — is
now resolved too**, as a direct consequence of #1: flat `flows/<name>.flow.json` and
`custom-nodes/<name>.node.json`+`<name>.node.py` (verbatim two-file packages, same format
`custom-node-authoring-scoping.md` already established for the editor's own picker-based loader).

**3. Real code, not scaffolding — two new backend modules, wired into the existing app:**

- `backend/src/thingstudio_backend/persisted_store.py` — owns `~/.thingstudio`. Atomic writes
  (temp-file-then-`os.replace`, so a crash mid-write can't corrupt a previously-good file), strict name
  validation (`^[A-Za-z0-9_-]{1,100}$`, rejects path traversal before any filesystem call), lazy directory
  creation (nothing created until first write), and every failure raises a `NODE_ERROR`-prefixed
  `PersistedStoreError` (a `PersistedStoreNotFoundError` subclass for "doesn't exist" specifically) — same
  structured-error convention `serial_relay.py`/`ws_relay.py` already use. Deliberately thin: validates flow-file
  writes are valid JSON (catches obvious corruption) but never parses the schema — that stays editor-side
  (`flow-file.ts`'s `parseFlowFile`), matching the "never decodes CBOR either" posture `ws_relay.py` already
  set. A custom node's `.node.py` is stored/returned as plain text and **never executed** anywhere in the
  backend, matching `custom-node-authoring-scoping.md` Decision 5 — there's a regression-guard test for this
  specifically.
- `backend/src/thingstudio_backend/admin_api.py` — the HTTP routes: `GET/PUT/DELETE /api/flows/{name}`,
  `GET /api/flows`, `GET/PUT/DELETE /api/custom-nodes/{name}`, `GET /api/custom-nodes`. Every
  `PersistedStoreError` becomes a `{"error": "NODE_ERROR: ..."}` JSON response (404 for not-found, 400 for
  everything else — bad name, invalid JSON, malformed request body) rather than a bare 500.
- `app.py`/`__main__.py` updated: routes wired in via `create_app`'s new `data_dir` parameter (defaults to
  `~/.thingstudio`), a new `--data-dir` CLI flag, and registered before the static-asset catch-all (aiohttp
  matches resources in registration order).

**41 new tests** (`test_persisted_store.py`, `test_admin_api.py`), **66 total, all passing** — verified in a
scratch venv built in the device-bridge shell's own home directory (outside the live-mounted repo entirely, same
shared-mount/cross-platform-binary reasoning `CLAUDE.md` already gives for npm, extended here on the same logic
since `aiohttp` ships compiled wheels). **Not yet run by Mike on his own machine** — same open item the minimal
backend build already had.

**4. Docs updated in the same change**, not batched for later (per `CLAUDE.md`'s decisions/learnings-log
convention): `outstanding-items.md`, `outstanding-items/backend-persisted-data-protocol.md` (marked
decided+built, full "what shipped" section added), `outstanding-items/backend-auth-overview.md` (its own
original MVP-needed trigger is now closed at the code level), `local-persistence-scoping.md` (addendum
resolving "internal layout"), `mvp-feature-priorities.md` Tier 3, `decisions.md` + `decisions/backend.md` (new
dated entry). No new third-party dependencies — nothing to add to `docs/third-party-licenses.md`.

## Not in scope for this chat (deliberately)

- **Editor-side consumer of any of this.** Zero browser code calls `/api/flows` or `/api/custom-nodes` yet —
  this session is backend-only, matching how the minimal build itself was scoped.
- **Posture-2 auth** — `[P4]`, unaffected, still not needed for either the relay or the new admin routes (both
  covered by posture-1's allowlist automatically).
- **Real-hardware verification of the serial layer** — unrelated to this session's work, still open from before.
- **On-disk format versioning for custom node packages** — flagged, not decided (flow files already have
  `formatVersion`; custom node descriptors don't have an equivalent field yet).
- **Editor<->backend wiring** (the WS transport client + connection-mode picker, surfaced but not picked up
  in the prior session) — see below, now the more clearly-blocking gap.

## Suggested next-session candidates

1. **Editor<->backend wiring** — now the clearer #1 pick than it was last time. Two backend surfaces exist and
   are tested (the WS relay, and now the admin API) and **nothing in the browser can reach either one**. This
   is what actually turns "the backend runs" into "a user can do something with it." Scoping question for
   whoever picks this up: does it cover just the WS transport client + connection-mode picker (last session's
   framing), or also a `fetch`-based client for the new admin API (flow save/load and custom-node load/save
   through the backend, replacing/supplementing the File System Access picker) — worth deciding explicitly
   rather than assumed, since the two are separable pieces of editor work even though they share the same
   "editor has zero backend-client code at all" starting point.
2. **Posture-2 auth** (`[P4]`) or a smaller, unrelated backlog item (WiFi functor/singleton, threading/
   multicore, a `[P2]` item like multi-output-port support) if a change of pace is wanted instead.
3. **Real-hardware pass on the serial layer** (DTR/RTS per board, actual disconnect timing) — needs a real
   board, not a sandbox; worth picking up whenever Mike has hardware time set aside specifically.

## For Mike, in a real Terminal

Nothing from this session is committed. Suggested commands (draft only — confirm the exact file list against
your own `git status` first, since this file's list may drift from what's actually staged by the time you run
it):

    cd ~/Src/ThingStudio
    rm -f .git/index.lock

    git add backend/src/thingstudio_backend/persisted_store.py \
      backend/src/thingstudio_backend/admin_api.py \
      backend/src/thingstudio_backend/app.py \
      backend/src/thingstudio_backend/__main__.py \
      backend/src/thingstudio_backend.egg-info/SOURCES.txt \
      backend/test/test_persisted_store.py \
      backend/test/test_admin_api.py \
      docs/working-notes/decisions.md \
      docs/working-notes/decisions/backend.md \
      docs/working-notes/local-persistence-scoping.md \
      docs/working-notes/mvp-feature-priorities.md \
      docs/working-notes/outstanding-items.md \
      docs/working-notes/outstanding-items/backend-auth-overview.md \
      docs/working-notes/outstanding-items/backend-persisted-data-protocol.md \
      docs/working-notes/next-session-picks-briefing-2026-09-07f-persisted-data-protocol.md

    git commit -m "Add backend persisted-data HTTP admin API (flows, custom node packages)"

    git status --short

Separately, if you want to exercise the new routes by hand before the next session: `cd backend &&
.venv/bin/thingstudio-backend` (or recreate the venv per earlier sessions' commands), then:

    curl -X PUT http://127.0.0.1:8765/api/flows/test -d '{"formatVersion":1,"flowName":"x","nodes":[],"edges":[],"layout":{},"configs":[]}'
    curl http://127.0.0.1:8765/api/flows
    curl http://127.0.0.1:8765/api/flows/test

The editor itself still won't talk to any of this yet (see "Suggested next-session candidates" #1 above).

## Success criteria (whichever item gets picked)

Same bar as every prior session — see `next-session-picks-briefing-2026-09-07.md` for the full text.

## Git

Nothing from this session is committed — see "For Mike" above for the exact commands. If a future git command
hangs or errors oddly, the usual suspect is still `.git/index.lock`; `rm -f .git/index.lock` in a real Terminal
clears it, same as every prior session.
