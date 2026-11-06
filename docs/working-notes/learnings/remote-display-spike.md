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
