# Briefing: editor↔backend WS transport client + connection-mode picker built;
# admin-API fetch client is the clear next piece, and a real backend<->hardware
# round-trip has never been attempted

For the next chat. Read `CLAUDE.md` in full, as always.

**Nothing from this session is committed yet — confirm with your own `git status`/`git log` before trusting
that, not this file.** As of this writing, tip is `9b55984` ("Add backend persisted-data HTTP admin API...") and
`git status --short` shows this session's work as modified/untracked. **`.git/index.lock` is present again** (a
`git status`/`git diff` run from this session's own device-bridge shell left it behind, same recurring issue as
every prior session) — `rm -f .git/index.lock` in a real Terminal clears it. The exact `git add`/`git commit`
commands are below in "For Mike." **Note:** `docs/working-notes/mikes-questions-and-points.md` is also showing
as modified in `git status` — that's Mike's own edit (a new GPIO/ADC-config-nodes-as-singletons bullet), not
this session's work; it's deliberately left out of the `git add` list below, not forgotten.

## Where this came from

Picked up from the prior briefing's #1 candidate (editor↔backend wiring,
`outstanding-items/backend-persisted-data-protocol.md`'s own "suggested next-session candidates" #1) — Mike's
explicit pick, confirmed via a clarifying question at the start of this chat.

## What this session did

**1. Scoping calls, both confirmed with Mike before writing code.** First: this session covers the WS transport
client + connection-mode picker only, not a `fetch`-based admin-API client (flow/custom-node save-load) — the
two were separable and Mike picked the more foundational half. Second: default connection mode is "via
backend," but "direct" WebSerial stays available rather than being retired — checked against real use cases
(needs no backend process at all; stays a working fallback if the backend is what's broken) rather than dropped
on the grounds that "backend is where new investment goes."

**2. Real code:**

- `editor/src/protocol/backend-transport.ts` (new) — `BackendTransport`, a WebSocket client for the backend's
  `/ws` relay. `open(wsUrl)` / `listPorts()` / `connectPort(port, baudRate)` / `send()` / `disconnect()`, decoding
  incoming binary WS messages via the same `ProtocolStreamDecoder` `WebSerialTransport` already uses. Handles a
  new "debug" control-message type (see the backend fix below). WebSocket construction is injectable
  (`wsFactory`, unused by `main.ts`) purely so `editor/test/backend-transport.test.ts` (new, 12 tests) can drive
  it against an in-memory fake with no real network needed.
- `editor/src/protocol/transport.ts` — new `DeviceTransport` interface (`isConnected`/`disconnect()`/`send()`),
  implemented by both transports, so `main.ts`'s Deploy/Check status/Disconnect/inject-click-to-fire logic is
  written once regardless of mode.
- `editor/src/app/main.ts` / `editor/index.html` — `connModeSelect` (Direct/Via backend, defaulting to backend),
  `backendUrlInput`, `backendPortSelect`, a "⟳ ports" refresh button. `transport` is now a `let DeviceTransport`,
  reassigned to a fresh instance of the right kind each successful Connect. Port listing is never automatic (no
  auto-probe on load or mode switch) — same "explicit choice, not auto-detection" reasoning design doc §4 states
  for the mode choice itself, applied here too.
- **A real, previously-latent bug found and fixed in the backend, in the same session:** `ws_relay.py` (built
  2026-08-16/2026-09-07) assumed §13's raw binary frame layout rides the *serial* wire directly. It doesn't — the
  real device listener (`device-runtime/src/listener.py`) only ever speaks base64-encoded, `"F64:"`-prefixed text
  lines there, matching what `editor/src/protocol/transport.ts`'s `WebSerialTransport` already does for the
  direct path — a real hardware workaround (POC-D's `read(n)` hang), not a style choice. Neither side's own
  previously-"all passing" tests could have caught this (each was internally consistent with a different wrong
  assumption). Fixed: new `backend/src/thingstudio_backend/line_framing.py` (Python port of `transport.ts`'s
  base64/line codec), `ws_relay.py` updated to use it, `test_ws_relay.py` updated to match the real contract, new
  `test_line_framing.py` (13 tests). Full incident:
  `docs/working-notes/learnings/backend-serial-wire-format.md` — worth reading before touching this boundary
  again; the general lesson (two independently-tested components can silently disagree on a shared contract
  neither side's own tests exercise) is worth carrying forward, not just this one instance of it.

**3. Verification.** Backend: 80 tests passing (66 previous + 14 new), scratch venv outside the live mount, same
pattern every prior backend session used. Editor: `tsc --noEmit` clean, `vitest run` 341 passing (329 previous +
12 new) — verified by extracting `editor/` into the cloud session's own workspace via `.verify-tmp/` (the
established staging point, not new) and running `npm ci`/`tsc`/`vitest` fresh there, never against the live
mount directly, per `CLAUDE.md`. **Not verified: anything against a real backend process or real hardware** —
named explicitly below, not glossed over.

**4. Docs updated in the same change:** `outstanding-items.md`,
`outstanding-items/editor-backend-wiring.md` (new — full detail), `decisions.md` + `decisions/backend.md` (two
new dated entries), `learnings.md` + `learnings/backend-serial-wire-format.md` (new), `mvp-feature-priorities.md`
Tier 3, `backend-editor-auth-and-protocol.md` §2 (correction note on the real wire format), and
`docs/user-guide/getting-started.md`'s "Requirements"/"Connecting" sections (CLAUDE.md's "user-facing UX changes
update user docs in the same change" rule — the default connection mode changed, so the getting-started flow
had to change with it). No new third-party dependencies.

## Not in scope for this chat (deliberately)

- **Admin-API `fetch` client** (flow/custom-node save-load via `/api/flows`/`/api/custom-nodes`, either
  connection mode) — flagged as the natural next piece in the prior briefing, not touched here; the File System
  Access picker (`flow-file/file-io.ts`) is still what save/load actually goes through regardless of mode.
- **Any real end-to-end run** — editor (either mode) → a real running `thingstudio-backend` process → a real
  board. Everything above is verified by unit test against fakes on both the editor and backend sides
  individually; the two have never actually talked to each other for real, and neither has talked to real
  hardware through this new path.
- **Posture-2 auth**, **the backend's own real-hardware pass** (DTR/RTS, disconnect timing) — both unrelated,
  unaffected, still open from before.

## Suggested next-session candidates

1. **A real end-to-end round-trip: editor (via backend) → running backend → real board.** This is the natural
   and arguably overdue checkpoint — everything built across the last three sessions (minimal backend, persisted-
   data protocol, this session's wiring) has been unit-tested in isolation and never actually run together. Needs
   Mike's own machine and a board at the same time; would very plausibly surface more gaps the same way this
   session's own wire-format bug only surfaced once two independently-built sides had to actually agree.
2. **Admin-API `fetch` client** — the other half of "editor has backend-client code at all," now the clearer
   remaining gap on the persisted-data side specifically (flow save/load, custom-node load/save through the
   backend, replacing/supplementing the File System Access picker).
3. **Posture-2 auth** (`[P4]`) or a smaller, unrelated backlog item, if a change of pace is wanted instead.

## For Mike, in a real Terminal

Nothing from this session is committed. Suggested commands (draft only — confirm the exact file list against
your own `git status` first; `mikes-questions-and-points.md`'s own edit is deliberately excluded, it's yours,
not this session's):

    cd ~/Src/ThingStudio
    rm -f .git/index.lock

    git add backend/src/thingstudio_backend/ws_relay.py \
      backend/src/thingstudio_backend/line_framing.py \
      backend/test/test_ws_relay.py \
      backend/test/test_line_framing.py \
      docs/user-guide/getting-started.md \
      docs/working-notes/backend-editor-auth-and-protocol.md \
      docs/working-notes/decisions.md \
      docs/working-notes/decisions/backend.md \
      docs/working-notes/learnings.md \
      docs/working-notes/learnings/backend-serial-wire-format.md \
      docs/working-notes/mvp-feature-priorities.md \
      docs/working-notes/outstanding-items.md \
      docs/working-notes/outstanding-items/editor-backend-wiring.md \
      editor/index.html \
      editor/src/app/main.ts \
      editor/src/protocol/transport.ts \
      editor/src/protocol/backend-transport.ts \
      editor/test/backend-transport.test.ts \
      docs/working-notes/next-session-picks-briefing-2026-09-07g-editor-backend-wiring.md

    git commit -m "Wire editor to the backend: WS transport client, connection-mode picker, fix backend serial wire-format bug"

    git status --short

Separately, if you want to try this by hand before the next session: start the backend (`cd backend && pip
install -e . && thingstudio-backend`), open the editor with a real board plugged in, leave the mode picker on
"Via backend," click "⟳ ports," pick the board, Connect. This is exactly the real end-to-end round-trip
candidate #1 above names as never having been attempted — if you get to it first, whatever you find is exactly
the kind of thing worth a `learnings.md` entry (or, if it's a wire-format-level surprise, straight into
`outstanding-items/editor-backend-wiring.md`'s own "what's still open" list).

## Success criteria (whichever item gets picked)

Same bar as every prior session — see `next-session-picks-briefing-2026-09-07.md` for the full text.

## Git

Nothing from this session is committed — see "For Mike" above for the exact commands. `.git/index.lock` is
present again as of this writing; `rm -f .git/index.lock` in a real Terminal clears it, same as every prior
session.
