# Remote display — implementation briefing

Status: **superseded, 2026-11-12** -- the software tasks below (1-4) are done and live-verified; the remaining
hardware checkpoints and the structural WiFi-deploy problem are handed off by
`remote-display-live-verification-briefing.md`.

(Original handoff, 2026-11-11: the spec, security policy and user-guide updates for MVP are committed
(`8da70d46`). This brief hands off the remaining implementation and build work.)

## What this session builds

Turn `docs/working-notes/remote-display-production-tasks.md` into working code, tests, and a recorded custom
image. Do not reopen the design decisions recorded in `docs/working-notes/decisions/remote-display.md`; if the
code contradicts them, flag it.

## Read first

1. `docs/working-notes/remote-display-production-tasks.md` — the ranked task list this brief expands on.
2. `docs/working-notes/decisions/remote-display.md` — the decisions that must not be reopened.
3. `interfaces/remote-display/SPEC.md` — the wire contract to implement.
4. `docs/security-policy.md` §3.8 — the boundary this work must satisfy.
5. `docs/working-notes/learnings/remote-display-spike.md` — traps from the spike.
6. `docs/working-notes/remote-display-spike-results.md` — the S3/C3 figures and the recommendation.

## The work, in order

### 1. Board-side wire changes (block release)

- Move the login token from the URL query `?t=<token>` to the WebSocket handshake subprotocol
  `Sec-WebSocket-Protocol: ts-rd-v1-<token>`. Wrong, missing or malformed token fails the upgrade with `401`
  before any WebSocket state is established.
- Add a rate limit to `GET/POST <prefix>login` before the `TSAUTH1` work: cap attempts per client and the number
  of concurrent login handlers. Answer `429` / `503`.
- Implement the precise form contract: whole-form validation, all-or-nothing write to `runtime.settings`,
  `form_ok` with keys list, one flow event with written values, `form_err` with `failed` map, empty submit
  allowed.
- Remove page dots and the carousel concept: drop `carousel` from the emitted definition, remove `pagedots`
  handling, page navigation stays board-owned.
- Update `device-runtime/test/test_remote_display.py` and `test_ts_http_ws.py` for all of the above.

### 2. Page-side changes (block release)

- Send the token as `Sec-WebSocket-Protocol` instead of appending `?t=`.
- Remove pagedot rendering and carousel navigation.
- Handle `form_ok`/`form_err` and the empty-submit case.
- Regenerate `ts_remote/page_data.py` with `tools/build_remote_page.py`.

### 3. Compiler/editor changes (block release)

- Stop emitting `carousel` and `pagedots` in the remote display definition.
- Add the compiler warning for untested boards/images when a remote screen is used.
- Keep the row/column flex model; `gui_panel` is already removed as a grouping concept.

### 4. Version bump (block release)

The token move is an incompatible wire change. Bump `_RUNTIME_VERSION`
(`device-runtime/src/listener.py`) and its mirrored `EDITOR_TARGET_VERSION`
(`editor/src/app/main.ts`) together in the same commit that lands the implementation.

### 5. Custom S3 image (block release)

- Build `firmware/targets/esp32-s3` with runtime 15.1.0+ and remote libraries frozen.
- Record image SHA and heap figures in `docs/working-notes/remote-display-spike-results.md`.
- End-to-end deploy and phone login from a fresh flash.

### 6. C3 custom image measurement (can parallel)

Measure and decide whether an ESP32-C3 custom image reaches enough headroom. Document the verdict either way.

### 7. Final review (block release)

Read `interfaces/remote-display/SPEC.md` line-by-line against the code; add or update conformance vectors for
any drift.

## Environment

- Branch: `remote-display-spike`. Do not merge to `main` until every **block release** item is done.
- After every editor change: `(cd editor && npm run build:cli)`.
- Editor verification:
  ```sh
  find editor/src editor/test -name "*.js" -type f -delete
  (cd editor && npm test && ./node_modules/.bin/tsc --noEmit)
  ```
- Device tests (MicroPython unix port):
  ```sh
  THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/r_b.json \
    THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/r_s.json \
    <micropython> device-runtime/test/test_remote_display.py
  THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/r_b.json \
    THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/r_s.json \
    <micropython> device-runtime/test/test_ts_http_ws.py
  ```
- Custom firmware build:
  ```sh
  python3 tools/firmware_targets.py check
  MICROPY_DIR=~/micropython firmware/build.sh esp32-s3
  ```
- Hardware: Freenove ESP32-S3 4.0" over WiFi transport; deploys use `test-flows/device_cli.py ... --host`.
  Large USB-CDC writes are dropped on this board, so runtime installs need UART.

## Done when

- All block-release items pass.
- `python3 tools/docs_lint.py` passes if any user-guide file changed.
- `find editor/src editor/test -name "*.js" -type f -delete` and editor tests pass if any editor code changed.
- The full device-runtime remote-display test suite passes.
- A custom S3 image is built, flashed, and a phone logs in and drives the screen.
- This brief is updated or replaced with a merge/handoff note.
