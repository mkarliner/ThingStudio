# Briefing: minimal backend built (relay + posture-1 allowlist), persisted-data protocol
# and editor<->backend wiring both still open — pick one next

For the next chat. Read `CLAUDE.md` in full, as always.

**Nothing from this session is committed yet — confirm with your own `git status`/`git log` before trusting
that, not this file.** As of this writing, tip is still `8c0ed0c` ("Rename handoff briefing to flag Backend/auth
as the next task") and `git status --short` shows this session's work as modified/untracked. `.git/index.lock`
is present again right now, same recurring issue as every prior session — `rm -f .git/index.lock` in a real
Terminal clears it. The exact `git add`/`git commit` commands (with a drafted message) were already handed to
Mike mid-session; they just haven't been run yet. Re-paste on request rather than assumed still wanted verbatim.

## Where this came from

Picked up from the prior briefing's #1 candidate (Backend/auth, [P1], design-complete). Mike's own direction
mid-session, in sequence:

1. Asked for the build steps summarized before starting (`backend-platform-decision.md` +
   `backend-editor-auth-and-protocol.md` as the starting reading, per the prior briefing).
2. Corrected the plan: posture-1's Host-header allowlist is the minimal default, not a stand-in for real auth —
   posture-2's actual mechanism is separately lower-priority. Confirmed as "priority 4 as per outstanding items."
3. Asked how the backend gives the browser persisted data back (saved custom nodes, WiFi creds) — surfaced a
   real design gap, not just an unbuilt item.
4. Said: write up that gap, then "just go for the minimal backend, probably implement persistent data in next
   session."
5. After the minimal build passed on Mike's own machine, asked whether running the backend now also runs the
   editor — surfaced a second, separate gap (below).

## What this session did

**1. Two items split out of the single `[P1]` "Backend / auth" outstanding item, each now its own tracked
file:**

- **`posture-2-auth.md`, `[P4]`.** The actual app-secured mechanism (bcrypt password, hand-rolled signed session
  cookie, TLS, packaging for where the password lives) — real work, decision-complete in
  `backend-editor-auth-and-protocol.md` §1, but not needed to ship the backend under its default, no-account
  posture. Mike's explicit priority call.
- **`backend-persisted-data-protocol.md`, `[P1]`.** How the browser actually gets saved custom nodes and flow
  files (WiFi creds included — they're just flow-JSON properties on a config node, not a separate secrets store)
  back from the backend has no spec anywhere. Checked every doc that touches persistence
  (`local-persistence-scoping.md`, §4's addendum, `backend-editor-auth-and-protocol.md`'s WS control-plane
  message list) and none of them answer it — genuinely undecided, not just unbuilt. Two candidate shapes named,
  neither chosen: a small REST-ish HTTP admin API (Node-RED's own `/flows`/`/nodes` precedent) vs. extending the
  existing WS control-plane JSON channel. Flagged that whichever shape wins needs the same Host-allowlist (and
  eventually posture-2) treatment the WS endpoint already got, since the current auth note doesn't know this
  surface exists.

**2. The minimal backend itself — real code, not scaffolding, in a new `backend/` directory:**

- `framing.py` — Python port of `editor/src/protocol/framing.ts`'s `FrameDecoder`, reconstructing §13's frame
  boundaries from the raw serial byte stream (still never decodes CBOR — that stays client-side per
  `rete-migration-decision.md` Decision 2). Unit-tested with a Python port of
  `editor/test/framing.adversarial.test.ts`'s adversarial cases.
- `middleware.py` — posture-1's Host-header allowlist, the DNS-rebinding defense
  `backend-editor-auth-and-protocol.md` §1 designed. Tested against a real `aiohttp` app/client, including the
  actual rebinding shape.
- `serial_relay.py` — plain `pyserial` wrapped in `asyncio.to_thread` (per `backend-platform-decision.md` §4,
  not the dead-upstream `pyserial-asyncio`), time-bounded reads, structured `NODE_ERROR`-style failures on
  disconnect. DTR/RTS exposed as explicit optional parameters, left untouched by default — the correct per-board
  default is **not** decided here; still needs a real hands-on hardware check per §5.
- `ws_relay.py` — the one WS endpoint from `backend-editor-auth-and-protocol.md` §2, multiplexed by frame type:
  binary relayed verbatim, text = control-plane JSON (`list_ports`/`connect`/`disconnect`/`status`).
- `app.py`/`__main__.py` — fails closed on bind address: refuses anything but loopback, since posture-2 auth
  doesn't exist yet (not bind-then-warn).

25 tests, all passing. Verified for real in scratch venvs outside the live-mounted repo (never in `backend/`
itself from the sandbox, same shared-mount reasoning as the npm restriction) against both Python 3.10.12 and
3.14.0rc2 — Mike's system Python turned out to be 3.9.6 (already past upstream end-of-life, 2025-10), so
`requires-python = ">=3.10"` in `backend/pyproject.toml` is his own explicit call to build against a newer
interpreter rather than pin `aiohttp` back to an older, 3.9-compatible release. He confirmed all 25 pass on his
own machine with `python3.14`.

**3. `docs/third-party-licenses.md` updated in the same change** — new "Backend" section: `aiohttp` 3.14.3,
`pyserial` 3.5, `pytest` 9.1.1, `pytest-asyncio` 1.4.0, versions/licenses pulled from real installed package
metadata, not recalled. `outstanding-items.md` and `mvp-feature-priorities.md`'s Tier 3 bullet updated to match;
`backend-auth-overview.md` rewritten to describe what actually exists now rather than "design-only, zero code,"
and a stale claim in it (that the backend wasn't in `mvp-feature-priorities.md`'s tier list at all) corrected —
it already was, added 2026-08-21, this session's addition is just a note on top.

**4. Real finding, not in the original scoping: the backend and the editor aren't wired to each other at all.**
Mike asked whether running the backend now also runs/serves the editor. Checked directly rather than assumed:
`grep -rl "WebSocket" editor/src` returns nothing — the editor has zero WebSocket client code anywhere. `§4`'s
addendum calls for an explicit "direct" (WebSerial) vs. "via backend" connection-mode choice in the editor, but
that choice, and the WS client it needs, doesn't exist. Separately, `editor/dist/` doesn't exist either (`npm
run build` has never been run), so the backend's `--static-dir` flag has nothing real to point at yet. **Not
tracked as its own outstanding item this session** — surfaced and named here rather than formalized, on Mike's
own call to just get the wrap-up written rather than decide its tracking shape right now.

## Not in scope for this chat (deliberately)

- **Persisted-data protocol implementation** — the shape question (HTTP admin API vs. extended WS messages) is
  explicitly deferred to next session, per Mike's own framing mid-session.
- **Posture-2 auth** — `[P4]`, real work, not needed to ship the minimal backend.
- **Editor<->backend wiring** (WS transport client, connection-mode picker, pointing `--static-dir` at a real
  build) — surfaced this session (see above), not picked up or formally tracked yet.
- **Real-hardware verification** of the serial layer (DTR/RTS per board, actual disconnect timing) —
  needs a real board, not a sandbox.
- **WiFi functor/singleton** and **Threading/multicore** — still untriaged from before this session, unaffected.

## Suggested next-session candidates

1. **Backend<->browser persisted-data protocol** — already `[P1]`, already has its own detail file
   (`outstanding-items/backend-persisted-data-protocol.md`), and is what actually closes the loop on why the
   backend got marked MVP-needed (custom node persistence). Mike's own stated expectation for "next session."
2. **Editor<->backend wiring** — the WS transport client + connection-mode picker. Newly surfaced, not yet
   formally scoped or tracked as its own item; worth naming as a real prerequisite for exercising *anything*
   through the backend end-to-end, persisted-data protocol or not — right now the backend runs but nothing can
   talk to it. Could reasonably be done together with #1 (they touch the same wire) or picked separately.
3. **Posture-2 auth** ([P4]) or a smaller, unrelated backlog item (WiFi functor/singleton,
   Threading/multicore, or a [P2] item like multi-output-port support) if a change of pace is wanted instead.

## For Mike, in a real Terminal

Nothing from this session is committed. The commands (drafted mid-session, repeated here since git status still
shows them pending):

    cd ~/Src/ThingStudio
    rm -f .git/index.lock

    git add backend/ \
      docs/third-party-licenses.md \
      docs/working-notes/mvp-feature-priorities.md \
      docs/working-notes/outstanding-items.md \
      docs/working-notes/outstanding-items/backend-auth-overview.md \
      docs/working-notes/outstanding-items/backend-persisted-data-protocol.md \
      docs/working-notes/outstanding-items/posture-2-auth.md \
      docs/working-notes/next-session-picks-briefing-2026-09-07e-backend-minimal-build.md

    git commit -m "Add minimal backend: serial<->WebSocket relay, posture-1 Host allowlist"

    git status --short

(Use the fuller drafted commit message from mid-session if you want the longer body — either is fine, this is
just the minimum to not lose the one-liner.)

Separately, if you want to actually exercise the backend by hand before the next session: `cd backend &&
.venv/bin/thingstudio-backend` (or recreate the venv per the earlier commands), then connect a WS client to
`ws://127.0.0.1:8765/ws` and send `{"type": "list_ports"}` — that's everything currently wired end-to-end. The
editor itself won't talk to it yet (see finding #4 above).

## Success criteria (whichever item gets picked)

Same bar as every prior session — see `next-session-picks-briefing-2026-09-07.md` for the full text.

## Git

Nothing from this session is committed — see "For Mike" above for the exact commands. If a future git command
hangs or errors oddly, the usual suspect is still `.git/index.lock`; `rm -f .git/index.lock` in a real Terminal
clears it, same as every prior session.
