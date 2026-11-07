# MicroPython gotchas found while building the remote display spike

Surprising platform behaviours and the fixes, all found against the unix-port build
(the one machine's `device-runtime/test` build records the exact commit). Compiled from the 2026-11-06
spike session; keep adding in the same change as any new one.

## `binascii.b2a_base64` returns bytes; a lost string concat inside a broad except hid it

`_ws_accept()` built `b'StringPrefix' + binascii.b2a_base64(d).strip()` (bytes) + '...', a TypeError, but the
server's `_handle()` wraps everything in `except Exception: pass` — RFC 6455 handshakes answered
Connection-reset with no log. Fix: `.decode()` at the source + never leave a broad except silent in
network servers without a debug print path in the harness (kept a small loud-wrapper in the debugging
session; the lesson: when a network handler swallows exceptions, its FIRST test failure looks like a
timeout in the *caller*, not an error in the server. Diagnostic moves: run the handler as a keeper script
that prints each step; the test file pipe-loses the traceback otherwise).

## `bytes.split()` needs its own kind: a str needle does not convert

`bs.split(" ")` raises `TypeError: can't convert 'str' object to bytes implicitly` — the failure that
surfaced as the board refusing every login. Board-side protocol code split on str because it read
`response_line.split(" ")` in `board_settings.verify`; the module fed it bytes. Fix:

```python
line = (parts[0] + b" " + parts[1]).decode() if len(parts) >= 2 else ""
board_settings.verify(want, line)
```

Rule from this: look up any protocol helper's *expected type* before wiring a bytes side — in protocol code
the individual splits are 50/50. The wire protocol's own formatting lives in strings and keeps them there.

## MicroPython floats have no `is_integer()`

Converting "31.5" through `float(raw)` then `value.is_integer()` raises AttributeError in the unix build;
CPython fine. Fix inside code that runs in both worlds:

```python
if value == int(value):
    value = int(value)
```

(subject to range checks around the int conversion — `int(float)` truncates, never raises here).

## Pre-checks on the socket's query string: accept with or without the leading '?'

The listener's `_handle` splits `path?query` — `query` already has no "?" when handed to the route's pre
check; the pages all send `?t=<token>`; when the query lands in `_token_ok` it must strip the `?` anyway.
Small tolerance, but it beat waiting on a "wrong token" mystery.

## MicroPython `asyncio.run` and leftover tasks; the test-file illusion

A session's writer task blocked in `_evt.wait()` is never cancelled when `asyncio.run(main())` returns;
the unix build left these tasks pending. Leftover event-waiting tasks don't show errors but the test
file can *appear* to hang: the actual problem, seen in a shorter run, was output buffering — piped
micropython writes flushed at process end, so the last test looked stuck. Do not debug through a pipe;
redirect to a file (`... python ... > out.txt 2>&1`) before believing a hang.

## The pymock fixture is a byte-identical mirror of the vendored library

`editor/test/{ts-wifi,ts-mqtt,ts-ble,node-http-in}.test.ts` each assert
`readFileSync(fixtures/pymock/<lib>.py).equals(readFileSync(device-runtime/.../<lib>.py))` — the editor's CPython
test run executes the fixture, so it must be a copy, not a reimplementation. Editing the vendored server means
`cp` into `editor/test/fixtures/pymock/` in the same change; the failure mode first looks like an unrelated
"fixture is different" test failure, not the edit's business.

## Response timeouts are measured in seconds and are floats

`http_in`'s `responseTimeoutMs` 250 arrives on the route as `timeoutS: 0.25`; an `int()` on it truncates to
0 and the 500 arrives instantly. Route timeouts stay `float(...)`; nothing in this codebase ever justified
whole seconds. (The editor test that caught it: `node-http-in.test.ts` "times out with a 500".)

## MicroPython's WASM mpy-cross and deep package dirs from dep_compile.mjs

Nested packages compile (board file `ts_remote/page_data.py`); `dep_compile.mjs` used to `mkdir` only one
level, so the second write failed ENOENT — the HIL helper got a `mkdirSync(dirname(path), recursive)`. If
the editor's own dependency sender ever wrote the same shape, the same little bug would hide there too —
checked the editor deploy path when touching package installs (editor/src/protocol/transfer.ts).

## MicroPython's `writer.close()` does not release the socket — `await wait_closed()`

Found on the C3, 2026-11-07, after the phone page "worked, then stopped answering". `_handle()`'s
`finally: writer.close()` returns without error but the connection stays open: a client that reads the whole
body then waits for EOF times out. The socket is only released when `await writer.wait_closed()` completes.
On ESP32 (`CONFIG_LWIP_MAX_SOCKETS` = 10) that turns into a hard cliff: **requests 1-10 answer, request 11
onwards is reset**, for as long as the leaked sockets take to age out. A minimal unix-port repro showed it
plainly — `close()` alone: no EOF; `close()` + `wait_closed()`: clean EOF.

Same trap on the listening socket: `Server._stop()` closing without awaiting left the port bound, so the next
`Server(port).ensure()` failed `OSError(98)` (the new test caught it). Both now go through one `_close_writer()`
helper; `Server.stop()` is the async form and `_stop()` (runtime cleanup, sync by contract) hands it to the loop.

Two testing lessons: a test that reads only the body cannot see this (it passes on CPython, which closes on
`close()`), so assert the EOF; and a queue route whose request body is longer than `Content-Length` now gets an
RST on close that can swallow the answer — declare the body length correctly in test clients.

## The TSAUTH1 salt travels as hex and is hashed as bytes

The page derived the login key with `utf8(salt + pw)` where `salt` was the **hex string** from the challenge.
`board_settings.apply()` derives over the raw 16 salt bytes (`derive_key(salt, password)`), so the keys could
never match: every login answered 401. The wire form is hex (`TSAUTH1 <host> <nonce hex> <salt hex> <iters>`),
the key derivation is bytes — decode before hashing:

```js
var nonce = unhex(parts[2]), salt = unhex(parts[3]), iters = parseInt(parts[4], 10);
var k = catOne(salt, utf8(pw));
```

Proved against a live board by running the page's own `<script id="crypto">` under Node (`vm.runInThisContext`)
and comparing page-style (401) with bytes-style (200 + token + `screen_def` frames).

## `mount()`'s optional route settings ride in the route dict, not as keywords

`ts_remote.start()` called `mount(route, queue=q, timeoutS=..., body_limit=...)`; `Server.mount()`'s whole
signature is `(route, queue=None, static=None, ws=None, pre=None)` and it reads `route["timeoutS"]` /
`route["body_limit"]`. The board answered `NODE_ERROR TypeError: unexpected keyword argument 'timeoutS'` and
the display never started. Every existing test drove `Remote`'s parts directly and none called `start()`, so
the spike's own suite was green. The regression test now calls `start()` against a real `Server` and asserts
the mounted table — the cheapest way to keep an "assembly" method honest.

## On a native-USB board (S3) the console drops large writes, so HELLO never arrives

Freenove ESP32-S3 (PSRAM), custom image, 2026-11-07: `device_cli hello` timed out, yet the board was healthy.
Small replies always arrived (`LISTENER_IGNORED`, `LISTENER_ERR …`, EXEC output), large ones never did — the
~1.3 KB `HELLO` came back as a 448-byte fragment with no `F64:` prefix, a 1500-character `print` produced
nothing, and several prints in a row lost their newlines. That is a short USB-CDC write with no flow control,
on the board's output side only (host→device writes and small replies are fine).

What works instead: the board's own WiFi transport (`net_transport`, TCP 7462, TSAUTH1 handshake, then the
same `F64:` lines both ways). `HELLO` over TCP arrived complete every time. Requires a board password
(`SET_BOARD_SETTINGS`), without which the port never opens.

Related trap on the same board: `STOP_TO_PROMPT` carries the `overUsb` guard, so it is refused over the WiFi
transport — and on a native-USB-only board the REPL that the stopped listener leaves behind is on UART0, not
reachable through the CDC. Stopping the listener over USB therefore needs a UART bridge or a second port;
there is no way back to the prompt through native USB alone.

## `gc.mem_free()` can look healthy while the board can no longer move a packet

The C3's failure ("associated, RSSI -52, zero traffic in either direction, `400 Bad Request` from the page")
had 66 KB of MicroPython heap free the whole time. The figure that names it is the system heap behind WiFi and
lwIP: `HELLO`'s `freeIdfHeapBytes` went 30,200 at boot → **1,312 free, largest block 448**, on a board whose
main region has 116,496. With no 4 KB block available the stack can neither send nor receive, and the server's
5 s header read times out (the `400`).

I could not reproduce the collapse from ordinary load (42 requests, parallel fetches, abandoned preconnects,
a stalled reader, 200 refused WebSocket retries all left ~29 KB), so the trigger stays unidentified — record
`freeIdfHeapBytes` and `largestIdfHeapBlockBytes` from `HELLO` as the memory checkpoint, never `gc.mem_free()`
alone, and restart the board when the largest block is in the hundreds of bytes.

## The page's frame envelope is `{"c":n,"m":{...}}` — flat messages decode as `None`

The first working phone session (Freenove S3, 2026-11-07) had a page that rendered and ticked but whose
buttons did nothing. `send()` built `{"c":n,"type":"tap",...}`; `ts_remote._check()` takes the counter from
`"c"` and returns `data.get("m")`, so dispatch received `None` and answered `{"type":"err","what":"message is
not an object"}` — silently, because the page has no handler for `err` frames. The board-side tests signed the
wrapped form (they call `_check` themselves), and the page had never been exercised against it, so both halves
were "tested" and the contract between them was not.

The editor test now runs the page's own `send()` under Node and asserts the envelope and signature the board
expects; replaying "the page's exact bytes" from a separate script is what found it (`{"c":2,"m":{...}}` →
`BOOP None` on the console). Same shape as the `mount()` gap: a test that rebuilds the client's logic instead
of running it proves the logic, not the integration.

Also cosmetic but user-visible: `applyAll()` applied `st-unknown` (opacity .45) to any widget with no value,
so a momentary button with static text looked disabled. Anything with fixed text skips that state; a controlled
toggle keeps it, because "state unknown" is meaningful there.
