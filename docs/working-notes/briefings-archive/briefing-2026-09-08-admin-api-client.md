# Briefing: admin-API fetch client landed; storage is backend-exclusive now;
# remote/firewalled-backend access confirmed as a real near-term use case

For the next chat. Read `CLAUDE.md` in full, as always.

**This session's work is not committed yet — see "For Mike" below, including the usual
`.git/index.lock` clearing.** As of this writing, `git status --short` shows every file this
session touched as modified/untracked on top of tip `0c6c12b` (the previous session's own
briefing commit). `docs/working-notes/mikes-questions-and-points.md` also shows modified —
that's Mike's own edit, not this session's, deliberately left out of the `git add` list below,
same as every prior session's own note about that file.

## Where this came from

Direct continuation of the previous session (briefing `...h-editor-backend-verified.md`).
That briefing's #1 suggested next step — "Admin-API `fetch` client... now the clearest
remaining gap on 'editor has backend-client code at all'" — is what Mike picked, by name
("1"), at the start of this chat.

## Scoping calls, confirmed with Mike before/during the work

Three real forks came up, each checked rather than assumed:

1. **Storage is backend-exclusive, not connection-mode-gated.** Asked whether admin-API
   save/load should be tied to `connModeSelect`, independent of it, or replace vs. sit
   alongside the File System Access picker. Mike's answer: independent of connection mode, and
   *all* file-system ops go through the backend now (flows, custom nodes, WiFi creds,
   preferences) — replacing the picker, not supplementing it. Consequence, also Mike's own
   call: WebSerial "direct" mode's `connModeSelect` option should be **hidden until there's a
   valid use case**, since it can no longer save/load anything on its own. Hidden via the
   native `hidden` attribute on `<option id="connModeOptionDirect">`, not removed — same
   git-reversible posture this codebase already takes with `app/nodes.ts` and
   `variable_get`/`variable_set`.

2. **CORS policy for the new fetch client.** The backend had zero CORS support — needed
   because the editor's origin (Vite dev server, or any origin the built editor is served
   from) generally differs from the backend's. Asked reflect-any-Origin vs. an explicit
   `--allowed-origin` allowlist mirroring `--allowed-host`. Mike chose reflect-any-Origin.
   Reasoning worth keeping in mind next time this comes up: it doesn't lower the actual
   security bar, since the WS relay already does zero Origin checking and `__main__.py`
   already refuses to bind anywhere but loopback until posture-2 auth exists — the marginal
   risk is "another page in the same loopback-reachable browser can also hit the admin API,"
   a risk category already fully accepted for the WS relay today.

3. **Remote/firewalled backend — raised by Mike mid-session, not something I'd scoped for.**
   He wants to run the backend on a machine in a firewalled environment near real IoT devices
   and edit/debug from a separate dev machine. Two shapes exist: (a) backend stays
   loopback-only, reached through an SSH/VPN tunnel — no code change needed, exactly design
   doc §9's already-named "network-secured / localhost-behind-a-VPN" default posture; (b) the
   backend binds directly to a non-loopback interface (e.g. a Tailscale IP) — currently
   hard-refused by `__main__.py`'s fail-closed loopback check (posture-2 auth doesn't exist
   yet). Mike's answer: (a) for now, (b) explicitly wanted eventually, don't forget it —
   logged as a dated addendum in `outstanding-items/posture-2-auth.md` with the concrete
   real-world driver, specifically so a future session doesn't have to work from the abstract
   "not needed until bound to a LAN/public interface" framing alone.

## What shipped

- **`editor/src/flow-file/admin-api-client.ts`** (new) — the fetch-based client:
  `backendHttpBaseUrl()` (ws://→http://, strips the WS relay's own `/ws` path — the admin API
  and WS relay share one host:port, so this is a scheme swap, not a second URL field),
  `slugifyFlowName()` (a flow's display name, e.g. "My Cool Flow", isn't a valid backend
  storage key on its own — `persisted_store.py`'s `_NAME_RE` only allows letters/digits/`_`/`-`
  — so Save derives a slug for the storage key while the file's own `flowName` field, restored
  on Open, keeps whatever the user actually typed), and full CRUD wrappers for both
  `/api/flows` and `/api/custom-nodes` (`AdminApiError` on any failure, surfacing the backend's
  own `NODE_ERROR`-prefixed message verbatim rather than re-wording it). `writeCustomNode`/
  `deleteCustomNode` are built for parity with `admin_api.py`'s full route table but have no UI
  caller yet — see "What's still open" below.
- **`backend/src/thingstudio_backend/cors.py`** (new) — `cors_middleware`: reflects the
  request's Origin on every response (including error bodies — an admin-API error the editor
  can't read because the browser blocked it as a failed CORS check would be strictly worse
  than the error itself) and answers CORS preflight `OPTIONS` directly, since `admin_api.py`
  registers no `OPTIONS` route for the browser's preflight to hit. Installed as the outermost
  `Application`-level middleware (`app.py`), wrapping `host_allowlist_middleware`.
- **`editor/src/app/main.ts`** — Save/Open/Delete flow now go entirely through
  `admin-api-client.ts`: a new `flowSelect`/`btnRefreshFlows` pair (same explicit-refresh
  pattern `backendPortSelect`/`btnRefreshPorts` already established — never auto-probed on
  load), `btnSaveFlow` slugifies the flow name and `PUT`s it, `btnOpenFlow`/`btnDeleteFlow` act
  on whatever's selected. `file-io.ts` is no longer imported here at all (kept in the tree,
  unused, for the same reason WebSerial "direct" mode is). A new `currentBackendWsUrl()`
  helper replaces three separate inline `backendUrlInput` reads.
- **`editor/src/app/rete/store.ts`** — new `backendWsUrl` ref, mirrored from `backendUrlInput`
  by `main.ts` on every edit, so `PaletteSidebar.vue` (which never reaches into the DOM
  directly, per this codebase's own convention) can read the current backend location without
  main.ts passing it as a prop through a one-time `createApp().mount()` call.
- **`editor/src/app/rete/PaletteSidebar.vue`** — "Load custom node..." is now backend-list-
  driven: click fetches `GET /api/custom-nodes`, renders the names as an expanding set of
  palette-row-styled buttons (no native OS picker equivalent for "choose one of these
  backend-known names"), clicking one reads and registers it. `custom-node-io.ts`'s file-pair
  picker is no longer imported here, same "hidden, not deleted" treatment.
- **`editor/index.html`** — `flowSelect`/`btnRefreshFlows`/`btnDeleteFlow` added to the
  toolbar; `connModeOptionDirect` gets `hidden`.
- **Docs updated in the same changes, not batched:** `decisions.md` + `decisions/backend.md`
  (three new dated entries: storage backend-exclusive, CORS reflect-Origin, tunnel-not-bind for
  remote access); `outstanding-items.md`'s two line items for this same update;
  `outstanding-items/backend-persisted-data-protocol.md` (its own "not decided or built here"
  list updated, plus a new item — see below); `outstanding-items/editor-backend-wiring.md`;
  `outstanding-items/posture-2-auth.md` (the dated addendum from scoping call 3 above);
  `mvp-feature-priorities.md`'s Tier 3 backend bullets. User-facing docs updated per
  `CLAUDE.md`'s own rule (impacts the user experience): `docs/user-guide/flow-lifecycle.md`,
  `getting-started.md`, `custom-nodes.md` all rewritten for backend-exclusive storage — kept to
  this project's established concise/plain style, not exhaustive.

## A real gap found and named, not silently skipped

**No editor UI to author or upload a custom node package to the backend** — only to load one
already there. A user has to place `<name>.node.json`/`<name>.node.py` directly into the
backend's `~/.thingstudio/custom-nodes/` themselves. Fine when editor and backend share a
machine; materially more friction once they don't (exactly Mike's own stated firewalled-backend
use case from scoping call 3) — no drag-and-drop from the editor, manual file placement /
`scp` on whatever machine the backend runs on instead. The client-side plumbing already exists
(`writeCustomNode`/`deleteCustomNode`, tested, unused by any UI) — what's missing is entirely
an editor authoring/upload flow. Named in
`outstanding-items/backend-persisted-data-protocol.md`.

## Verification

- **Backend**: 89 tests passing (81 previous + 7 new `test_cors.py` + 1 new CORS-coverage test
  in `test_admin_api.py`), scratch venv outside the live mount (same pattern every prior
  backend session used). Confirmed the new CORS tests actually catch a regression: neutered
  `cors_middleware` down to a bare pass-through in the scratch copy, reran `test_cors.py` (5 of
  7 failed as expected), restored the real implementation, reran the full suite (89/89 again).
- **Editor**: `tsc --noEmit` clean, `vitest run` — 365 tests passing (341 previous + 24 new in
  `admin-api-client.test.ts`), `npm run build` also clean (this session's changes touch a
  `.vue` SFC, which plain `tsc` doesn't type-check at all — no `vue-tsc` in this project — so a
  real Vite build was run as the actual check that `PaletteSidebar.vue`'s edits compile).
  Extracted to a scratch location outside the live mount, per `CLAUDE.md`'s npm-isolation rule
  — this session used `device_bash`'s own `/tmp` (outside `~/mnt/`, never shared with Mike's
  Mac), not the cloud-container workspace prior sessions used; same isolation guarantee either
  way, noted here in case that distinction matters to a future session.
- **Not run by Mike on real hardware or a real backend process this session** — this session
  was entirely sandbox-side (code + scratch-venv/scratch-workspace tests). The CORS/remote-
  backend reasoning above is design-level, not yet exercised against a real cross-origin
  `npm run dev` + backend pair, or a real SSH-tunneled remote backend.

## Suggested next-session candidates

1. **Mike runs this for real** — `npm run dev` + `thingstudio-backend`, confirm Save/Open/
   Delete flow and Load custom node actually work against a live backend, and ideally the
   cross-origin case specifically (editor on Vite's port, backend on 8765) since that's the
   whole reason CORS support was added and it's never been exercised against a real browser.
   Natural first move for the next session, mirroring how every backend/editor-wiring session
   this project has run has needed its own live-hardware/live-process pass before being called
   done.
2. **A custom-node authoring/upload UI** — closes the gap named above. Client-side plumbing
   (`writeCustomNode`) already exists; this is editor UI work (a form or a "save this package"
   action) plus deciding where it lives (PaletteSidebar.vue alongside the loader, or its own
   panel).
3. **Posture-2 auth** (`[P4]`) or the non-loopback-bind item from scoping call 3
   (`posture-2-auth.md`'s 2026-09-08 addendum) — Mike flagged the latter as wanted eventually,
   not urgently.
4. **The backend's own dedicated real-hardware pass** (DTR/RTS-per-board, disconnect timing) —
   still open, unaffected by this session, unchanged from every prior briefing's framing.

## For Mike, in a real Terminal

    cd ~/Src/ThingStudio
    rm -f .git/index.lock

    git add backend/src/thingstudio_backend/app.py \
            backend/src/thingstudio_backend/cors.py \
            backend/test/test_admin_api.py \
            backend/test/test_cors.py \
            editor/index.html \
            editor/src/app/main.ts \
            editor/src/app/rete/PaletteSidebar.vue \
            editor/src/app/rete/store.ts \
            editor/src/flow-file/admin-api-client.ts \
            editor/test/admin-api-client.test.ts \
            docs/user-guide/custom-nodes.md \
            docs/user-guide/flow-lifecycle.md \
            docs/user-guide/getting-started.md \
            docs/working-notes/decisions.md \
            docs/working-notes/decisions/backend.md \
            docs/working-notes/mvp-feature-priorities.md \
            docs/working-notes/outstanding-items.md \
            docs/working-notes/outstanding-items/backend-persisted-data-protocol.md \
            docs/working-notes/outstanding-items/editor-backend-wiring.md \
            docs/working-notes/outstanding-items/posture-2-auth.md \
            docs/working-notes/next-session-picks-briefing-2026-09-08-admin-api-client.md

    git commit -m "Add editor admin-API fetch client + backend CORS support: storage is backend-exclusive now"

    git status --short

(`docs/working-notes/mikes-questions-and-points.md` deliberately left out — your own edit, not
this session's.)

## Success criteria (whichever item gets picked)

Same bar as every prior session — see `next-session-picks-briefing-2026-09-07.md` for the full
text.

## Git

Not committed yet this session — see "For Mike" above. If a future git command hangs or errors
oddly, the usual suspect is still `.git/index.lock`; `rm -f .git/index.lock` in a real Terminal
clears it, same as every prior session (it reappeared again during this very session, from this
session's own read-only `git status` call).
