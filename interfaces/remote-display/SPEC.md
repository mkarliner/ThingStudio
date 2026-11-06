# Remote display page <-> board messages — draft specification

Status: **draft (spike, 2026-11-06)**. Written from what the spike's implementation actually sends, not what
a production version might: `device-runtime/src/vendor/thingstudio_remote/ts_remote/__init__.py` (board side)
and `page/remote.html` (the phone page). Every claim here is exercised by
`device-runtime/test/test_remote_display.py` and `test_ts_http_ws.py` on the MicroPython unix port; the
hardware checkpoints in `remote-display-spike-results.md` confirm the same messages over real radios.
Produced under Mike's standing permission for the spec itself (`remote-display-scoping.md`, position 6).

Principles this follows (`decisions/remote-display.md`): **P2** — the page is the first client, not the only
one, so this document is transport-neutral; the WebSocket binding is one section and nothing else depends on
HTTP. Widget faces are data (P1): the page renders built-in kinds only, an unknown kind degrades to a labelled
placeholder with the raw value, and no ship-any-JS face exists in v1.

## 1. Vocabulary

| Thing | Meaning |
|---|---|
| board | The device whose flow renders through a `RemoteSurface`. |
| page | The phone's document, served by the board (the flow's first and default viewer). |
| viewer | One authenticated page connection. **One at a time per display**: a new login's socket takes over. |
| display | A `RemoteSurface` name ("phone"). One display per board in the spike; the shapes below carry a display field for a second one later. |
| definition | The screens tree the page renders: versioned JSON, shipped in pieces (§4). |
| `wid` | A widget id, unique across the definition (and, today, across the flow's GUI). |

## 2. Login: `TSAUTH1` re-used over HTTP

The board's existing transport key (`board_settings.py` — salt, iterations, the derived key stored, the
password never stored) is the credential; the password itself never crosses the wire. Login is two plain HTTP
requests on the same origin as the page (no cookies, no secure context, no `crypto.subtle`):

1. `GET <prefix>login` → `200` with body
   `TSAUTH1 <hostname> <nonce-hex> <salt-hex> <iterations>` — the wire protocol's own challenge line.
   A board with no password set answers `503` with a message telling the user to set one (fail closed).
2. The page derives `key = sha256^iterations(salt + password)` locally (hand-written SHA-256, RFC 4231-tested),
   then `POST <prefix>login` with body `TSAUTH1 <hex(HMAC-SHA256(key, nonce))>` (uppercase hex, RFC 2104 over
   the nonce bytes). The board verifies with `board_settings.verify` (the same derivation) and answers:
   `200` `{"v": 1, "display": ..., "token": <hex>}` or `401` "refused".

Both sides then derive, from the never-sent values:
- `session_key = HMAC-SHA256(key, nonce + " remote display input v1")`
- `token       = HMAC-SHA256(session_key, "open session v1")`  — presented as `?t=<hex>` on the WebSocket.

The newest successful login's token is the only one the socket accepts (`_token_ok`); an older viewer keeps
its socket until a new viewer connects, then is told why (§6 take-over). An eavesdropper sees the nonce and
the login HMAC but cannot derive key or session key; the wire's own threat model (§3.3 of the security
policy) already treats eavesdropping as out of scope for the spike — the spike reports, not fixes.

## 3. Input frames: HMAC + counter

Everything page → board travels as one **text frame**: `<json>\n<hexhmac(session_key, json-bytes)>`.
`<json>` is `{"c": <counter int>, "m": {<actual message>}}`. A newline cannot occur unescaped inside a JSON
body, so the frame splits unambiguously at the last `\n`.

Rules (all named in `_check`, all tested):
- The HMAC must match, compared without stopping at the first differing byte. A wrong or missing signature
  closes the socket with close code 1008.
- `c` must be exactly `previous + 1`; the first message of a session is `c = 1`. A replayed frame (same `c`)
  fails, as does any skip ahead. A violation closes with 1008.
- `m` must be an object whose `type` the board recognises (§5); anything else gets one unsigned
  `{"type": "err", "what": ...}` reply, naming what, and the connection stays up.

Board → page frames have **no per-frame integrity** (working item 10's scope decision: value traffic, not
control; the direction that drives hardware is the signed one). The spike reports whether that holds.

## 4. Definition: versioned, sendable in pieces

At session start the board sends the definition as consecutive `screen_def` messages:

```
{"type": "screen_def", "display": <name>, "i": <int piece index, 0-based>, "n": <int total>, "part": <str JSON slice>}
```

`i` runs `0..n-1`, in order; concatenating the `part` strings in `i` order yields one JSON document:
`{"v": <int, = 1>, "display": ..., "carousel": [page names], "minIntervalMs": <int>,
  "pages": [{"name", "parent"?, "tree": <layout tree>}...],
  "modals": [{"name", "priority", "timeoutMs", "tree"}...]}`.

The layout tree is
`{"kind": "row"|"column", "children": [...], "gap"?: int ≥ 0, "padding"?: int ≥ 0, "align"?: start|center|end|stretch,
  "justify"?: start|center|end|space-between, "grow"?: number ≥ 0, "flex"?: true, "alignSelf"?, "card"?: true}`
with leaves `{"wid", "kind", "config", ...also-flex-props}`. Widget kinds the spike page renders are the
built-ins (`label readout bar trend led button`, `pagedots`) plus the spike-only input kinds (`number text
submit ctl`). An unknown kind renders on the page as a labelled placeholder carrying the raw value (P1) — the
board accepts it at build time rather than refusing the flow.

The page waits for all `n` parts, parses, and only then builds; `screen`/`values` messages that arrive before
the definition assembles are buffered (no ordering contract between the session's sender and the GUI's
renderer task).

## 5. The messages

### Board → page (unsigned text frames, one JSON each)

| Message | When | Body |
|---|---|---|
| `screen_def` | session start (§4) | a piece of the definition |
| `screen` | page or modal changed (first push after that, and reconnects) | `{"display", "page", "modal"?: name or null, "modalPayload"?, "queued"?: int, "values": {wid: [value, state]}}` |
| `values` | dirty widgets on the visible page, coalesced to `minIntervalMs` | `{"display", "values": {wid: [value, state]}}` |
| `pong` | reply to the page's `ping` | `{"type": "pong", "echo": <the page's `at`>, "board": <board ticks>}` |
| `takeover` | the viewer is replaced | `{"type": "takeover", "reason": "another viewer has logged in"}` then close 4000 |
| `form_ok` / `form_err` | after a form submit | `{"type":"form_ok","form","keys":[...]}` or `{"type":"form_err","form","failed": {key: msg}}` |
| `err` | bad message | `{"type": "err", "what": <one-line reason>}` (the connection stays up) |

`state` is one of the GUI's state names: `unknown known stale pressed pending`.

### Page → board (signed frames, §3)

| Message | What the board does |
|---|---|
| `{"type":"hi","v":1}` | version negotiation; a `v` other than the board's is answered `err` ("unsupported version") and the session ends |
| `{"type":"tap","wid","phase":"down"\|"up"}` | the same press/release path a touch panel tap takes (`GUI.button_press`): momentary fires on release, a toggle goes unknown/pending/confirmed, navigate moves the surface |
| `{"type":"nav","cmd":"next"\|"prev"\|"back"\|"home"\|<page>}` | navigation, board-owned (`GUI.navigate`) |
| `{"type":"page","n":<carousel index>}` | jump to the n-th top-level page |
| `{"type":"form","form":<name>,"values":{key: value}}` | the settings form: validated (all convert or the whole form is refused with no write), then written to `runtime.settings` per key, then the field widgets are updated. A mid-write fault is answered `form_err` naming the key; nothing rolls back (§7) |
| `{"type":"ctl","wid","value":<number in [lo,hi]>}` | continuous input; `runtime`-visible only through the flow's `await remote.control()` |
| `{"type":"ping","at":<page ms>}` | answered `pong` with `echo: at` — the page's latency measure |

### 5.1 Fields and forms, concretely

A field is a leaf `{"wid", "kind": "number"|"text", "config": {"label", "key", "form", "default"?}}`. Its
value comes from `runtime.settings.get(key, default)` at build and from `values` messages afterwards; an
*editing* field keeps the page's keystrokes local. One submit widget
`{"kind": "submit", "config": {"form": <name>, "label"}}` collects every field with the same `form` value and
sends them in one message — a settings form submits as one act, per the scoping note.

## 6. One viewer, take-over
The board accepts one authenticated viewer per remote display; the second viewer's login owns the socket.
On a second socket connect, the old one is sent `takeover` (reason text the page shows), then closed with
**WebSocket close code 4000**; the page drops its token and returns to the login state. A departed viewer
never locks its owner out: the newest login's token always opens the next socket. This is per-route auth —
the shared `ts_http_server` never sees a credential; the `_token_ok` pre-check runs before any upgrade.

## 7. Link status (working item 11)

The board pings every 1000 ms and refreshes liveness on *any* inbound frame; **after ~3.2 s of nothing** the
link counts as lost — a phone leaving WiFi is often never seen as a close. What "lost" means is the flow's
policy, set per display:

- `stale` (default): nothing further happens on the board; the page shows stale values and its own banner
  (nothing arriving for 4 s page-side).
- `safe`: the flow is told, once per drop and once per return (`await remote.link_change()` → `"down"` /
  `"up"`), and a **deadman** arms while `ctl` input flows: no fresh input for `deadman_ms` fires a second
  drop with no network state change — a drag that stopped, or a phone that vanished mid-drag, goes safe.
  Input arriving re-arms "up".

The board closes its side of a dead socket after the miss window; the page reconnects with the still-valid
token. Console: one terse line per transition (`REMOTE_LINK down (no input for 400 ms)`).

## 8. The WebSocket binding (only this section is transport-specific)

- Path: `GET <prefix>ws?t=<token>` on the same origin; upgrade per RFC 6455 §1.3 (`Sec-WebSocket-Accept`).
  No upgrade header → `401`; token wrong or login expired → `401` before any upgrade.
- Client frames are masked; server frames are not. Text for JSON; binary is refused cleanly (close 1003).
- **Fragments (continuation) are refused with close 1003** — a partial message is never parsed. Reserved
  bits and oversized control frames: close 1002.
- Client frames larger than **2048 bytes** are refused with close 1009 (the heap is what the cap protects).
- Peer pings are answered with an unmasked pong carrying the same body, and are also delivered to the
  protocol layer as `("ping", payload)` (liveness refresh); peer close is echoed with its code, then the
  socket closes. A handler returning normally also closes the socket with one close frame.
- Heartbeat: every PING_MS (1000), a `ping` frame with body `hb`; pongs and any other frame refresh liveness.

## 9. Conformance

- Implementation: `ts_remote/__init__.py` (`_check`, `_dispatch`, `_evaluate`, `_token_ok`, `_answer_login`,
  `_session`), `test_remote_display.py` (11 tests, unix port).
- Transport: `test_ts_http_ws.py` (7 tests: handshake accept value computed independently, masked frames,
  echo, ping/pong, close echo, fragmentation/cap/401 refusals, queue+static routes alongside).
- Page crypto: `editor/test/remote-page-crypto.test.ts` (RFC 4231 vectors, iteration chain, session derivation).
- Vectors: `vectors/exchanges.json` — the message exchanges above as data, for a later runner the way the
  wire protocol's `vectors/exchanges.json` is replayed today.
- What the spike has NOT proven (and the results note records): real-radio behaviour, both phone platforms,
  and the memory/latency numbers per board.

## 10. Versioning

`v` fields are the protocol version (1 today). The definition's `v` and the page's `hi` are both checked; a
mismatch is answered `err` and the session ends. Any future change to field shapes bumps `v` and the runtime
version together — same discipline as the wire protocol.
