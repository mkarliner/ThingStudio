# Backend / auth — minimal build (platform + relay + posture-1) landed 2026-09-07

**Newly marked MVP-needed by Mike, 2026-08-21.** Trigger: custom node packages need to persist across app runs
in a real `~/.thingstudio` local-state folder, and that's a backend-owned capability by the architecture's own
logic (design doc §4 — under the backend model, filesystem access is the backend's, not the File System Access
API's), not something a pure browser app can do reliably cross-platform. Full reasoning:
`local-persistence-scoping.md`. **Not yet resolved: whether this reprioritizes the backend ahead of the
sequencing override** (the custom-node-docs validation session, then RP2350 bring-up) — flagged in that note,
needs Mike's own resequencing call, not assumed here. **Correction, 2026-09-07:** the tier-list gap this
paragraph used to flag ("`mvp-feature-priorities.md` doesn't list the backend at all") was already closed the
same day this item was created — that file's Tier 3 has carried a "MVP-needed" backend bullet since 2026-08-21;
that bullet now also notes this session's minimal-build progress.

**2026-09-07, scope split from posture-2 auth (Mike's call):** this item covers the backend itself — platform,
the serial↔WebSocket relay, and posture 1's Host-header allowlist (the default, no-account posture). Posture 2's
actual auth mechanism (bcrypt password, signed session cookie, TLS, and where the password lives) is real work
but lower priority and not needed to ship the backend under its default posture — split out to its own item,
[`posture-2-auth.md`](posture-2-auth.md) **[P4]**. Same session, a second split: the backend↔browser protocol
for actually serving persisted data back (saved custom nodes, flow files/WiFi creds) turned out to be
*undecided*, not just unbuilt — split to [`backend-persisted-data-protocol.md`](backend-persisted-data-protocol.md)
**[P1]**, expected next session. This item's own original MVP-needed trigger (`~/.thingstudio` persistence) isn't
actually satisfied until that companion item lands — worth being explicit that the minimal build below doesn't
close the loop on its own.

## What exists now (2026-09-07)

`backend/` — real code, not design notes:

- `backend/src/thingstudio_backend/framing.py` — Python port of `editor/src/protocol/framing.ts`'s
  `FrameDecoder`, reconstructing §13 frame boundaries from the raw serial byte stream (the backend still never
  decodes CBOR). Unit-tested with a Python port of `editor/test/framing.adversarial.test.ts`'s adversarial
  cases (truncated frames, split reads, bad length headers) — `backend/test/test_framing.py`.
- `backend/src/thingstudio_backend/middleware.py` — posture-1's Host-header allowlist, the whole of this
  backend's default security surface. `backend/test/test_middleware.py` exercises it against a real `aiohttp`
  app/client, including the DNS-rebinding shape it exists to block.
- `backend/src/thingstudio_backend/serial_relay.py` — `pyserial` wrapped in `asyncio.to_thread`
  (`backend-platform-decision.md` §4), time-bounded reads, structured `NODE_ERROR`-style failures on
  disconnect. DTR/RTS handling is exposed as explicit optional parameters, left untouched by default — the
  *correct* per-board default is **not decided here**, still needs the real-hardware check §5 calls for.
- `backend/src/thingstudio_backend/ws_relay.py` — the one WS endpoint from
  `backend-editor-auth-and-protocol.md` §2, multiplexed by frame type (binary = relayed protocol frames, text =
  control-plane JSON: `list_ports`/`connect`/`disconnect`/`status`). `backend/test/test_ws_relay.py` exercises
  it end-to-end against a fake serial connection (no hardware needed for this layer's own logic).
- `backend/src/thingstudio_backend/app.py` / `__main__.py` — app factory and CLI entrypoint. **Fails closed on
  bind address**: refuses to start on anything but loopback, since posture-2 auth doesn't exist yet — not
  bind-then-warn.
- `backend/pyproject.toml` — `aiohttp`, `pyserial` as real dependencies; `pytest`/`pytest-asyncio` as test-only
  ones. Tracked in `docs/third-party-licenses.md`'s new "Backend" section.

25 tests, all passing, verified in a scratch venv outside the live-mounted repo (never in `backend/` itself from
the sandbox — same shared-mount/cross-platform-binary reasoning as the npm restriction, `CLAUDE.md`). Run against
both Python 3.10.12 and 3.14.0rc2 (Mike's system Python is 3.9.6, already past upstream end-of-life as of
2025-10; `requires-python = ">=3.10"` in `backend/pyproject.toml` reflects that, not an arbitrary pin — Mike's
own call, 2026-09-07, to build against a newer interpreter rather than pin `aiohttp` back to a 3.9-compatible
version). **Not yet verified:** real hardware (a real board's DTR/RTS behavior, real disconnect timing), and
Mike hasn't yet run `pip install`/started the server himself.

- **`backend-platform-decision.md`** — decision-complete (Python, `aiohttp`, plain `pyserial` wrapped in
  `asyncio.to_thread`), now implemented above.
- **`backend-editor-auth-and-protocol.md`** — decision-complete for what's in scope here: Host-header allowlisting
  for posture 1, one WebSocket endpoint multiplexed by frame type. Now implemented above. (Posture 2's own
  mechanism is `posture-2-auth.md`'s scope, not this item's.)
- **`transport-auth-design.md`**'s board-perimeter half is covered under `board-transport-auth.md` (the `HELLO`
  fields) — a separate, still-`[POST-MVP]` item.

## What's still open

- A real-hardware pass (DTR/RTS per board, actual unplug/disconnect behavior).
- Mike installing and running it for real (`pip install -e backend[.test]`, per `docs/third-party-licenses.md`'s
  new entry — the sandbox only ever verified this in a throwaway venv, never the shared mount).
- Static asset serving is wired (`app.py`'s `static_dir` param) but nothing points it at a real built `editor/`
  output yet — not exercised.
- Cross-platform behavior (macOS/Windows/Linux port naming, WebSerial/Web Bluetooth differences) and the
  package-install/distribution story (`backend-platform-decision.md` §7) — both folded into this item per
  Mike's 2026-09-06 call, neither touched by the minimal build above.
- The two split-out items: posture-2 auth (`[P4]`) and the persisted-data protocol (`[P1]`, expected next
  session — see that file for why it's the one that actually closes this item's original MVP-needed trigger).
