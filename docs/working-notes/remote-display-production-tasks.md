# Remote display — production task list

Status: plan, 2026-11-11. Cut from `docs/working-notes/remote-display-mvp-production-plan-briefing.md`.
These are the remaining implementation and build tasks after the spec, policy and user-guide updates in the
same session.

## Gating rule

No merge to `main` or deploy from a non-Mike machine until every item in **Block release** is done.
Items marked **Can parallel** may land in their own commits before the gate, but the gate stays closed until
all blockers pass.

## Done in the implementation sessions (2026-11-12)

- Items 1-5 below (token move, rate limit, form contract, page-dot/carousel removal, 16.0.0 bump) -- marked
  in place.
- The compiler warning for untested boards/images (the implementation briefing's task 3, second bullet):
  `editor/src/definitions/remote-display-measurements.ts` is the measured-target registry (S3 custom image
  comfortable, C3 stock below floor), `remoteScreenCodegen` warns per target, and the tests iterate the
  registry. The user guide's Hardware notes already describe the behavior.
- 7 (the final SPEC review), except one question for Mike: the spec line-by-line against the code found and
  fixed -- the page's dead pagedots case, the board not closing a dead socket at the miss window (SPEC 7,
  now it does), stale test counts in SPEC 9, a form vector still expecting the old generic err, and the
  user guide's broken "trends" anchor. Vectors added: empty submit, rate-limit 429, no-subprotocol 401.
  Open (an interface call, so Mike's): SPEC 4 lists wire widget kinds "trend", "histogram" and "slider",
  but the wire's actual kinds are "trend" (the one history widget -- its user-guide page is Histogram) and
  "ctl" (the slider's kind; the message type is also ctl, which the spec's 5 already says). Amend SPEC 4 to
  the implementation's list, or rename the wire kind and add a separate histogram kind?
  Everything else checked clean: login and derivations, HMAC+counter frames, definition shape, screen/
  values/pong/takeover/form_ok/form_err, state names, take-over, link policy and deadman, the binding's
  401/1003/1009/1002 paths, and the vectors.

## Done this session (the spec session, 2026-11-11)

- `interfaces/remote-display/SPEC.md` updated: token in `Sec-WebSocket-Protocol`, no page dots/carousel,
  precise `form_ok`/`form_err` contract including empty submit, login-rate-limit note.
- `interfaces/remote-display/vectors/exchanges.json` updated for the new WebSocket subprotocol binding.
- `docs/security-policy.md` §3.8 rewritten from spike to production tier.
- `docs/user-guide/remote-displays.md` refreshed: custom-firmware note, v1 widget set, stock-install warning,
  row/column layout wording.
- `docs/working-notes/remote-display-spike-results.md` recommendation section filled in (MVP).

## Block release (must all be complete)

1. **Token delivery move — done 2026-11-12**
   - Board: `ts_remote/__init__.py` reads the token from `Sec-WebSocket-Protocol: ts-rd-v1-<token>` instead of
     the URL query; wrong/missing/malformed token fails the upgrade with `401` before any WebSocket state is
     established.
   - Page: `page/remote.html` sends the token as the subprotocol header.
   - Update `device-runtime/test/test_ts_http_ws.py` and `test_remote_display.py` vectors.
   - **Parallel with:** login rate limit, form contract, page-dot removal.

2. **Login route rate limit — done 2026-11-12**
   - Board: cap login attempts per client and concurrent login handlers; answer `429` / `503`.
     (10 requests per 60 s window, GET and POST both; the one `_login_loop` task is the handler cap; a put
     past the pending cap is answered `503` on the spot.)
   - **Parallel with:** token delivery move.

3. **Form contract — done 2026-11-12**
   - Board: all-or-nothing validation, all converted values written to `runtime.settings`, then `form_ok` with
     keys list, then one flow event with written values; `form_err` with `failed` map and no writes; empty
     submit allowed.
     (The flow event payload is now `{form, values}` — every failing key is named in `failed`, not just the
     first; the page toasts the empty-submit case distinctly; node doc updated.)
   - Update `device-runtime/test/test_remote_display.py` to cover empty submit and whole-form refusal.
   - **Parallel with:** token delivery move.

4. **Remove page dots / carousel — done 2026-11-12**
   - Compiler/editor: drop `carousel` from the emitted definition; remove `pagedots` widget kind; page
     navigation is board-owned. (A dots cell on a remote screen warns and drops; the panel keeps its own
     pagedots -- a different renderer.)
   - Board/page: remove any pagedot rendering or carousel indexing. (ts_remote derives its next/prev order
     from top-level pages in declaration order; the `page` index message is gone -- nav carries
     next/prev/back/home/page-name.)
   - **Parallel with:** token delivery move.

5. **Runtime/editor version bump — done 2026-11-12, 16.0.0**
   - If the wire shape above is incompatible with old clients, bump `_RUNTIME_VERSION` and
     `EDITOR_TARGET_VERSION` together in the same commit that lands the implementation.
   - The token move is an incompatible change; done as major (16.0.0) with the token move. Items 2-4 land on
     the same unreleased 16.0.0 while the branch is pre-release; if any lands after a release, bump again.

6. **Custom S3 image recorded and tested**
   - Build `firmware/targets/esp32-s3` with runtime 15.1.0+ and remote libraries frozen.
   - Record image SHA, `freeIdfHeapBytes` / `largestIdfHeapBlockBytes` in
     `docs/working-notes/remote-display-spike-results.md`.
   - End-to-end deploy and a browser login from a fresh flash.
   - **Depends on:** token delivery move if the image must match the new wire shape.

7. **Final review of `interfaces/remote-display/SPEC.md` against implementation**
   - Read the spec line-by-line against the code; add or update conformance vectors for any drift.
   - Run the full device-runtime test suite for `test_remote_display.py` and `test_ts_http_ws.py`.

## Can land before release but does not block it

8. **ESP32-C3 custom image measured**
   - Build a C3 custom image with remote libraries frozen, measure `freeIdfHeapBytes` /
     `largestIdfHeapBlockBytes`, and decide whether to offer it.
   - Document the verdict either way.
   - **Depends on:** custom S3 image workflow being known-good.

9. **`ts_http_server` request logging**
   - One terse `REQUEST` line per flow route before release, as noted in the production briefing.
   - Does not change the remote-display wire shape.

## Post-MVP (do not schedule for v1)

- Captive-portal DNS on the board's AP route.
- Custom widget JS faces and the supply-chain review they require.
- Native app / BLE transport.
- Pico W measurement and image.

## Verification commands

`<micropython>` on this machine (built 2026-11-12 from the same tree as the existing `mpy-cross`, so
bytecode versions match): `~/micropython-1.29.0/ports/unix/build-standard/micropython`. A build recipe for a
new machine: `device-runtime/test/README.md`. Custom firmware: `MICROPY_DIR=~/micropython-1.29.0
firmware/build.sh <target>` (esp-idf at `~/esp/esp-idf-5.5.2`).

Before any commit that touches `device-runtime/src`:

```sh
THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/r_b.json \
  THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/r_s.json \
  <micropython> device-runtime/test/test_remote_display.py
THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/r_b.json \
  THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/r_s.json \
  <micropython> device-runtime/test/test_ts_http_ws.py
```

Before any commit that touches `docs/user-guide/`:

```sh
python3 tools/docs_lint.py
```

Before any commit that touches the editor:

```sh
find editor/src editor/test -name "*.js" -type f -delete
(cd editor && npm run build:cli && npm test && ./node_modules/.bin/tsc --noEmit)
```
