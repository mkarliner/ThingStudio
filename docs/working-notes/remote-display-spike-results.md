# Remote display spike — results

Fill-in sheet for the hardware checkpoints (`remote-display-spike-briefing.md`). What the code-side session
(2026-11-06) already measured is filled in; everything needing real boards/phones is a blank row for the
test session. Pass/fail per the brief's kill-or-rethink signals, and Mike's MVP/post-MVP call at the end.

## What the code-side session built and proved off-device

Implemented on branch `remote-display-spike` (commit up to <fill>): WebSocket upgrade as a server
capability in `ts_http_server` (`mount()` for queued/static/WS routes), the `ts_remote` flow dependency
(login over `TSAUTH1`, session with HMAC+counter input frames, def chunking, values bridge, link policy
stale/safe with deadman, take-over), the phone page (hand-written SHA-256/HMAC, flexbox mirror of
`layout.ts`), the spike flow (`test-flows/remote-display-spike.py`), SPEC draft under
`interfaces/remote-display/`, and unix-port tests:

- `test_ts_http_ws.py` — 7/7 (handshake accept independent, echo, peer ping, close echo, fragmentation
  →1003, >2048 →1009, wrong token →401, non-upgrade →401, queue+static routes alongside).
- `test_remote_display.py` — 11/11 (login 503/401/200 + token derivation; `_token_ok`; definition
  validation names each bad shape, unknown kinds accepted (P1); input frames: correct/replay/altered/
  jump/unsigned; tap/nav/page dispatch; screen+values through the real `RemoteSurface`; form →
  `runtime.settings`; ctl → control queue; deadman + link on/off events once each; ping echo; take-over
  with takeover message + close 4000).
- `editor/test/remote-page-crypto.test.ts` — 4/4 (RFC 4231 vectors, message-shape boundaries, key chain,
  session derivation vs Node's crypto; page_data.py freshness).
- Page assets: 28.7 KB raw → 9.7 KB gzip, embedded as `ts_remote/page_data.py` (mpy ~9.8 KB flash).

Items the code resolves (from the scoping note's 10-15): **10** signed+counted input frames exists and
refuses replay/altered/jump; **11** heartbeat-then-policy: implemented (`PONG misses` / deadman), close
after the miss window; **12** page served gzip as-is (`Content-Encoding: gzip`, no board decompression);
**13** captive DNS — NOT implemented (needs a UDP DNS responder; hardware session decides); **15**
definition is transport-neutral JSON already (bindings: HTTP/WS only in §8 of the SPEC).

## Checkpoint table (fill per board)

| # | Checkpoint | classic ESP32 | Pico W | ESP32-C3 | C5? | Pass? |
|---|---|---|---|---|---|---|
| 1 | WS echo + burst survives; free heap before/after w/ flow running | | | | | |
| 1 | `hashlib.sha1` present on build (the unix port tests print `SKIP` without it; the board must say yes) | | | | | |
| 2 | Screen renders from definition; values live; nav + modal; latency board→page on LAN | | | | | |
| 3 | `TSAUTH1` login wrong-password refused; works on Android Chrome / iOS Safari | | | | | |
| 4 | Input events incl. number/text + settings form; threshold survives a reboot | | | | | |
| 5 | Link-lost → `REMOTE_LINK down` and failsafe: measured phone-leave→safe | | | | | |
| 6 | Routes: LAN and board's own AP; Pico W STA+AP quirks; captive-portal behaviour Android/iOS | | | | | |
| 7 | Asset budget: raw/gz, flash used, peak RAM first load, time to first paint | | | | | |
| 8 | Console URL; `<hostname>.local` (mDNS, both phones); QR decided — ask Mike first | | | | | |
| 9 | SPEC read against hardware findings, line by line | | | | | |

Measurements go in one row per figure, board named (a separate table below, not inline).

## Measurements

<one row per figure: board, what, the number, how measured>

## Kill-or-rethink signals (from the briefing)

- [ ] Pico W headroom (WS + page serving + small flow) measured
- [ ] Latency: tap→board on LAN well under 100 ms; continuous input ~20 Hz
- [ ] Link-loss detection reliable in a few seconds
- [ ] `TSAUTH1` in pure JS works on iOS Safari

## Recommendation (Mike's call at the end)

MVP or post-MVP: <decide>
What the production build needs: <decide>
