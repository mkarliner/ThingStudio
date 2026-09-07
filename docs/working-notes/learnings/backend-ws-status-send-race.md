# Learnings — Backend / WS status-send race on teardown

Status: detail file, started 2026-09-07 (editor-backend-wiring session, live-hardware follow-up). See
`learnings.md` for the index and this log's own maintenance rule.

- **A fault-handling gap that only a real teardown race exposes, not a unit test with a single well-behaved
  fake.** `ws_relay.py`'s `_send_status()` — the one place `ConnectionSession` tells the browser about a status
  change — unconditionally did `await self._ws.send_str(...)`. Every existing test drove one WS client through
  one clean sequence of events, so the WebSocket was always still open whenever `_send_status()` ran. Found
  instead by Mike exercising the real backend against a real board while the browser tab from an earlier
  session was still open: that second, unrelated editor connection raced this one's serial read into a real
  "Bad file descriptor" error, and the resulting `_disconnect()`/`cleanup()` teardown call landed on a WebSocket
  that was itself already closing (the browser tab side). `send_str()` on a socket in that state raises
  `ClientConnectionResetError`, uncaught, straight out of `cleanup()` — which the request handler calls from a
  `finally` block, so the exception propagated out of the WS handler entirely: an unhandled server-side
  traceback, exactly the "uncaught exception that crashes the request handler" this module's own header comment
  says never happens.
- **Fix and regression test.** `_send_status()` now wraps its `send_str()` call in
  `try/except (ConnectionResetError, RuntimeError)`, logging a warning and moving on — the same best-effort,
  last-resort-backstop posture `_pump_serial_to_ws()` already applied to its own unexpected errors. New test
  `test_send_status_on_already_closing_ws_does_not_raise` (`backend/test/test_ws_relay.py`) instantiates
  `ConnectionSession` directly against a `FakeWebSocketAlreadyClosing` whose `send_str()` always raises
  `ConnectionResetError` — bypassing the full aiohttp `TestServer`/`TestClient` stack, since reproducing the
  real race through a live HTTP round-trip deterministically isn't practical, and this exercises both call
  sites (`_connect()`'s own initial status send and `cleanup()`'s teardown one) directly. Confirmed the test
  actually catches the regression by reverting the fix in a scratch copy and re-running just that test: it fails
  with the same `ConnectionResetError`, uncaught, as the real incident.
- **The general lesson:** this is the second real bug this same live-testing pass surfaced in the same file
  (see `backend-serial-wire-format.md` for the first, the base64/F64-line wire-format mismatch) — both were
  invisible to a comprehensive-looking unit test suite (80 tests, all green) because unit tests each drive one
  clean, well-behaved scenario per test. A teardown race between two concurrent connections, or a peer that's
  already gone by the time a response is attempted, needs either a real second actor (a real board, a real
  second browser tab) or a deliberately adversarial fake (a WS/serial stand-in that fails on cue) to surface —
  worth treating "first real end-to-end run against real hardware" as its own dedicated verification pass, not
  an optional nice-to-have once unit tests are green, per this project's own fault-handling-over-happy-path
  priority.
