# Backend↔browser persisted-data protocol — decided and built, 2026-09-07

**Picked up next session as expected, 2026-09-07.** Raised by Mike while scoping the minimal
backend build: how does the browser actually get saved custom nodes, WiFi credentials, etc. back from the
backend? Checked against every doc that touches persistence and none of them answered it at the time — a
genuine design gap, not a documented-but-unbuilt item like the rest of `backend-auth-overview.md`. That gap is
now closed: shape confirmed with Mike (HTTP admin API, not a WS control-plane extension — see "Two shapes,
neither decided" below, now decided), and real code landed in the same session — `persisted_store.py`
(`~/.thingstudio` ownership: layout, atomic writes, name validation) and `admin_api.py` (the HTTP routes),
41 new tests (`backend/test/test_persisted_store.py`, `backend/test/test_admin_api.py`), all passing. **Not yet
run by Mike on his own machine** — same "sandbox verifies in a scratch venv, Mike verifies for real" pattern the
minimal build itself is still waiting on (`backend-auth-overview.md`).

## What's decided, and what isn't

- **Custom node packages** — `local-persistence-scoping.md` decided *when* (wait for the backend, don't build a
  browser-only stopgap) and *that* it's the backend's job (`~/.thingstudio`), but its own "what this note
  deliberately does not decide" section explicitly excludes "`~/.thingstudio`'s internal layout" — no spec for
  how the browser asks the backend what custom nodes exist or fetches one's contents.
- **WiFi credentials aren't a separate case.** They're not a secrets store — a WiFi config node's `ssid`/
  `password` are plain properties inside the flow JSON (`config-node-and-palette-implementation-briefing.md`:
  `thingstudio/config/wifi`). So "how does the browser get saved WiFi creds back" is really "how does the
  browser get a saved flow file back" — the same open question, not a second one. Worth naming as a side effect
  of that design choice, not a decision anyone revisited: flow files are deliberately git-committable plain JSON
  (§6), so a saved WiFi password sits in plaintext in whatever the flow file is. No encryption-at-rest or
  secrets-handling discussion exists anywhere for this.
- **§4's only relevant sentence:** "under the backend model this becomes the backend's own filesystem access
  rather than the File System Access API specifically." That's the entire spec — it says the backend owns the
  file, not how the browser reads or writes it through the backend.
- **What *is* designed for browser↔backend traffic is narrower than either need.**
  `backend-editor-auth-and-protocol.md` §2's WebSocket control-plane channel only names port-list/connect/status
  messages — nothing about flow load/save or custom-node listing exists in that message set today.

## Two shapes — decided 2026-09-07: HTTP admin API

- A small REST-ish HTTP API on the backend for flow and custom-node CRUD — Node-RED's own `/flows`/`/nodes`
  admin API is the direct precedent, and this project already leans on Node-RED's model elsewhere (`adminAuth`,
  "thin backend"). **Chosen.**
- Extending the existing WS control-plane JSON channel with more message types instead of adding a second
  protocol surface. Rejected: `ws_relay.py`'s `ConnectionSession` is scoped to "at most one open serial port per
  socket" — persisted data (saved flows, custom node packages) needs to be reachable with no serial connection
  open at all, which that object doesn't model.

**Auth consequence flagged here, resolved by how it's wired, not by new code:** an HTTP admin API needs the same
Host-allowlist treatment as the WS upgrade — `backend-editor-auth-and-protocol.md` only designed that for the one
WS endpoint. `app.py`'s `host_allowlist_middleware` is installed at the `Application` level (not per-route), so
every route including the new `/api/flows`/`/api/custom-nodes` ones is covered automatically —
`test_admin_api.py`'s last test confirms this directly against the real `create_app()`, not just against the
routes in isolation. Posture-2 session-cookie auth, once built, will cover these routes the same automatic way.

## Why this doesn't block the minimal-backend build, but does block calling it "done"

The minimal build (platform + serial↔WS relay + posture-1 Host allowlist, `backend-auth-overview.md`) doesn't
need this to exist — it has no flow-file or custom-node traffic in scope. But `local-persistence-scoping.md` is
the note that made the backend MVP-needed in the first place (custom node packages need to persist), and this
protocol is the missing link between "the backend can own `~/.thingstudio`" and "a user's saved custom nodes
actually come back." Worth being explicit that the minimal build doesn't satisfy that original trigger by
itself — this item is what would.


## What shipped, 2026-09-07

`~/.thingstudio` layout (this note's own "not decided" list, and `local-persistence-scoping.md`'s "internal
layout" gap, both now answered by `persisted_store.py`):

```
~/.thingstudio/
  flows/<name>.flow.json          -- one file per saved flow, opaque JSON text
  custom-nodes/<name>.node.json   -- descriptor half of a package
  custom-nodes/<name>.node.py     -- implementation half, same base name
```

Deliberately flat (no subdirectories/nesting yet — design doc §6's "fleet of devices as a directory of flow
files" isn't built here), and deliberately opaque: the backend validates a flow file is *valid JSON* before
writing it (catches obviously-corrupt writes) but never parses its schema — `formatVersion`/`nodes`/`edges`/
`configs` validation stays editor-side (`flow-file.ts`'s `parseFlowFile`), matching the "thin backend, never
decodes CBOR either" posture `ws_relay.py` already established. A custom node's `.node.py` is stored and
returned as plain text and **never executed anywhere in the backend** — `custom-node-authoring-scoping.md`
Decision 5's constraint, extended to this, the one other place besides the editor that now touches these files
(`test_persisted_store.py::test_custom_node_implementation_is_never_executed` is a regression guard for this
specifically).

Routes (`admin_api.py`), all under the existing Host-allowlist:

- `GET/PUT/DELETE /api/flows/{name}`, `GET /api/flows`
- `GET/PUT/DELETE /api/custom-nodes/{name}`, `GET /api/custom-nodes`

Fault handling: every write is temp-file-then-`os.replace` (atomic — a crash or disk-full mid-write can't leave
a truncated file), name validation rejects path traversal before any filesystem call (`^[A-Za-z0-9_-]{1,100}$`,
checked against both the raw route segment and after aiohttp's own URL-decoding), and every store failure
becomes a structured `{"error": "NODE_ERROR: ..."}` JSON response (404 for "doesn't exist", 400 for a bad name/
invalid JSON/malformed request body) rather than a bare 500 — same posture as `ws_relay.py`'s status messages.

**Not decided or built here, named explicitly rather than silently skipped:**

- On-disk format versioning for custom node packages (flow files already carry `formatVersion`; custom node
  descriptors don't have an equivalent yet — `local-persistence-scoping.md` already flagged this as unresolved,
  still unresolved).
- ~~Any editor-side consumer of these routes at all — this is backend-only. The editor still has zero WebSocket
  client code (`backend-auth-overview.md`'s finding #4) and equally zero `fetch`-based admin-API client code;
  nothing in the browser calls any of this yet.~~ **Resolved 2026-09-08.** The WS client landed 2026-09-07
  (`editor-backend-wiring.md`); the fetch-based admin-API client landed this session
  (`editor/src/flow-file/admin-api-client.ts`) and, per Mike's own explicit call, storage is now
  backend-*exclusive* -- main.ts's Save/Open/Delete flow and PaletteSidebar.vue's "Load custom node..." picker
  go through here, not file-io.ts/custom-node-io.ts's File System Access pickers (those two modules are
  unchanged and unused, kept for the same "hidden, not deleted" reason WebSerial "direct" mode is). This also
  needed CORS support that didn't exist before -- see `cors.py` (reflect-any-Origin, confirmed with Mike) and
  its own header for the security reasoning; `decisions/backend.md` has the short version.
- Concurrent-write safety across multiple backend processes/tabs — out of scope, matching this project's existing
  single-operator-local-tool assumption everywhere else (transport-auth-design.md's shared-secret model, etc.).
- Nested/project-directory flow storage (design doc §6's fleet-of-devices framing) — flat names only for v1;
  not a one-way door, flat names are a subset of nested names.

**New, named 2026-09-08 (found while wiring the editor-side client):** there's no editor UI to *author or upload*
a custom node package to the backend, only to load one that's already there (`PaletteSidebar.vue`'s picker is
read-only against `GET /api/custom-nodes`). A user has to place `<name>.node.json`/`<name>.node.py` directly into
the backend's `~/.thingstudio/custom-nodes/` themselves -- fine when the backend is on the same machine
(copy the files in), materially more friction once it isn't (Mike's own stated firewalled-backend-plus-remote-
editor use case, `posture-2-auth.md`'s 2026-09-08 addendum): no drag-and-drop from the editor, `scp`/manual file
placement on whatever machine the backend runs on instead. The client-side plumbing already exists and is tested
(`admin-api-client.ts`'s `writeCustomNode`/`deleteCustomNode`, unused by any UI yet) -- what's missing is
entirely an editor authoring/upload flow, not backend work.
