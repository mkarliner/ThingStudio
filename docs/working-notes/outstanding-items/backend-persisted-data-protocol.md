# Backend↔browser persisted-data protocol — undecided, not just unbuilt, 2026-09-07

**Not part of this session's minimal-backend build; expected next session.** Raised by Mike while scoping the
minimal build: how does the browser actually get saved custom nodes, WiFi credentials, etc. back from the
backend? Checked against every doc that touches persistence and none of them answer it — this is a genuine
design gap, not a documented-but-unbuilt item like the rest of `backend-auth-overview.md`.

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

## Two shapes, neither decided

- A small REST-ish HTTP API on the backend for flow and custom-node CRUD — Node-RED's own `/flows`/`/nodes`
  admin API is the direct precedent, and this project already leans on Node-RED's model elsewhere (`adminAuth`,
  "thin backend").
- Extending the existing WS control-plane JSON channel with more message types instead of adding a second
  protocol surface.

**This choice has auth consequences the current design doesn't cover**, since it doesn't know this surface
exists yet: an HTTP admin API needs the same Host-allowlist (and, once built, posture-2 session-cookie)
treatment as the WS upgrade — `backend-editor-auth-and-protocol.md` only designed that for the one WS endpoint.

## Why this doesn't block the minimal-backend build, but does block calling it "done"

The minimal build (platform + serial↔WS relay + posture-1 Host allowlist, `backend-auth-overview.md`) doesn't
need this to exist — it has no flow-file or custom-node traffic in scope. But `local-persistence-scoping.md` is
the note that made the backend MVP-needed in the first place (custom node packages need to persist), and this
protocol is the missing link between "the backend can own `~/.thingstudio`" and "a user's saved custom nodes
actually come back." Worth being explicit that the minimal build doesn't satisfy that original trigger by
itself — this item is what would.
