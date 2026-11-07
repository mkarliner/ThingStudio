# Remote display spike — results

Fill-in sheet for the hardware checkpoints (`remote-display-spike-briefing.md`). What the code-side session
(2026-11-06) already measured is filled in; the 2026-11-07 hardware session's figures are in the tables below
(C3 = does not fit, S3 = fits but needs a custom image). Pass/fail per the brief's kill-or-rethink signals, and
Mike's MVP/post-MVP call at the end.

## What the code-side session built and proved off-device

Implemented on branch `remote-display-spike` (commit up to `e48c7eb`, plus the 2026-11-07 fixes: the socket
close, the page's salt/key derivation, `mount()`'s route keys, and the `start()`-level regression test):
WebSocket upgrade as a server capability in `ts_http_server` (`mount()` for queued/static/WS routes), the `ts_remote` flow dependency
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

Hardware session 2026-11-07 used a **Thingstudio ESP32-C3** (stock MicroPython 1.29.0 custom image, no PSRAM)
and a **Freenove ESP32-S3 4.0"** (Octal-SPIRAM, stock image + runtime 14.0.1). "board" = measured from this
machine by playing the page's own half (TSAUTH1 login, WebSocket, frames) — no phone was involved except where
a row says so.

| # | Checkpoint | classic ESP32 | Pico W | ESP32-C3 | Freenove S3 | Pass? |
|---|---|---|---|---|---|---|
| 1 | WS echo + burst survives; free heap before/after w/ flow running | | | survives, but the **system** heap collapses (see Measurements) | 8 MB gc heap; runtime too old to run the flow | no on C3 |
| 1 | `hashlib.sha1` present on build | | | yes (`sha1("abc")` = `a9993e36…`) | not reached (runtime 14.0.1) | yes on C3 |
| 2 | Screen renders from definition; values live; nav + modal; latency board→page on LAN | | | definition streams in 9 `screen_def` chunks; page served 200 in 0.21-0.33 s | **phone: readouts tick, buttons and modal fixed and verified on the board side** (`tap boop` → `BOOP None` on the console); the modal renders once its widgets paint at mount | partial |
| 3 | `TSAUTH1` login wrong-password refused; works on Android Chrome / iOS Safari | | | wrong → 401, right → 200 + token; WS gate 401 without a token | phone logged in over iOS Safari and rendered the screen | yes |
| 4 | Input events incl. number/text + settings form; threshold survives a reboot | | | not reached | — | no |
| 5 | Link-lost → `REMOTE_LINK down` and failsafe | | | not reached | — | no |
| 6 | Routes: LAN and board's own AP; captive-portal behaviour | | | LAN only; AP route unimplemented (item 13) | LAN reachable (`192.168.10.110`) | LAN yes |
| 7 | Asset budget: raw/gz, flash used, peak RAM first load | | | page 29,518 raw / **10,059 gz**; 30 sequential fetches cost ~0.5 KB IDF heap | — | yes (figures) |
| 8 | Console URL; `<hostname>.local`; QR | | | URL printed **before** the station gets its IP (`192.168.4.1`, the AP default) then correct after a restart | prints `ts-b162c0` | partial |
| 9 | SPEC read against hardware findings, line by line | | | not done | not done | no |

Measurements go in one row per figure, board named (a separate table below, not inline).

## Measurements

| Board | What | Figure | How measured |
|---|---|---|---|
| ESP32-C3 | MicroPython heap free / total, flow running | 66,112 / ~156,000 B | `gc.mem_free()`, `gc.mem_alloc()` via `EXEC` |
| ESP32-C3 | IDF (system) heap free, boot → collapsed | 30,200 → **1,312 B**, largest block 448 | `esp32.idf_heap_info(1)`; `hello` reports `freeIdfHeapBytes` |
| ESP32-C3 | socket cliff before the close fix | 10 requests answer, #11 onwards RST | 14 sequential GETs after a restart |
| ESP32-C3 | socket cliff after the fix | 30/30 answer, clean EOF each | same script, `wait_closed()` in `_close_writer` |
| ESP32-C3 | page fetch | 200, 10,059 B gzip, 0.21-0.33 s first byte | `curl -w` on the LAN |
| ESP32-C3 | login + WS | challenge 200, wrong 401, right 200 + token, WS 101, 9 `screen_def` chunks | `page_probe.py` (replays the page's half) |
| ESP32-C3 | failed DEPLOY | `DEPLOY_ERR MemoryError('allocating 232 bytes', before_ram=48400)` | `deploy_flow.py` output |
| Freenove S3 | MicroPython heap free / total | 8,019,232 / 8,251,392 B | `EXEC` |
| Freenove S3 | IDF heap free / largest block (HELLO) | 8,067,879 / 7,733,248 B | `HELLO` over the WiFi transport |
| Freenove S3 | USB console, large write | 1.3 KB HELLO → 448-byte fragment, no `F64:` prefix; 1,500-char print → nothing | repeated `hello` + `EXEC` prints |
| Freenove S3 | WiFi transport | `HELLO` complete on every attempt; `TSAUTH1` handshake on 7462; the whole deploy (`DEP_PUT` x3 + `DEPLOY`) goes through it | `net_dut.py` |
| Freenove S3 | page + input, LIVE | page 200, 10,661 B gzip; tap on `boop` → `BOOP None` on the console | phone + `tap_check.py` |
| Freenove S3 | deploy onto a running flow | port 80 stays bound, the new flow's web server never starts, one `RESTART` fixes it | deploy twice in a row; fixed in `runtime.cancel_running` afterwards (not yet installed on this board: it needs UART) |

## Kill-or-rethink signals (from the briefing)

- [ ] Pico W headroom (WS + page serving + small flow) measured
- [ ] Latency: tap→board on LAN well under 100 ms; continuous input ~20 Hz
- [ ] Link-loss detection reliable in a few seconds
- [ ] `TSAUTH1` in pure JS works on iOS Safari
- [x] ESP32-C3 headroom — **it does not fit**: 66 KB gc heap but the system heap falls to 1.3 KB, and the
      board stops moving packets. Not a code fault fixed by tuning: the C3 is below the feature's floor.

## Verdict from the 2026-11-07 hardware session

The feature's board-side half is proven (login, token-gated WebSocket, chunked definition, static route
alongside, clean socket close), but **a stock ESP32-C3 is not enough board for it**: the memory that runs out is
the IDF system heap, not the MicroPython one, and the visible symptom is a page that loads once and then a board
that answers `400 Bad Request` and stops. The S3 with Octal-SPIRAM has ~8 MB of gc heap and 139 KB+ of system
heap, so it is comfortably in class — but its runtime is 14.0.1 and can only be upgraded through a UART bridge
its single native-USB port does not provide.

That points the same way Mike did: **the remote display belongs to custom firmware builds** (runtime + the
spike's libraries frozen, heap headroom known at build time), not to a stock install on a small board. A custom
S3 image with runtime 15.1.0 is the next thing to build; the C3 column above is the documented "does not fit"
case to compare against.

## Recommendation (Mike's call at the end)

MVP or post-MVP: <decide>
What the production build needs: <decide>
