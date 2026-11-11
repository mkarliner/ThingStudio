# Remote display — MVP production plan briefing

Status: handoff, 2026-11-10. The design decisions are made and recorded. The next session's job is to turn
those decisions into updated specs, policy, docs, and a concrete work list.

## What this session decided

All eight agenda items from `docs/working-notes/remote-display-design-decisions-briefing.md` are resolved and
recorded in `docs/working-notes/decisions/remote-display.md`:

1. **MVP** — ship remote displays; supported path is custom firmware, stock installs allowed with a compiler
   warning.
2. **Capability parity** — same widgets/settings behavior, not pixel-for-pixel.
3. **Authoring vocabulary** — keep the row/column flex model; drag-and-drop places into constraint containers.
4. **Panels/cards** — `gui_panel` is removed; grouping becomes row/column styling. One canonical GUI definition
   serves hardware and remote renderers.
5. **Board class/images** — include remote libraries in custom images; S3 is the measured target; C3 custom image
   to be measured; untested boards are caveat emptor.
6. **Editor surface** — v1 widgets: label, readout, bar, led/light, button, number, text, submit, slider, trend,
   histogram. Page dots removed; page chrome deferred until required.
7. **Security tier** — move token from `?t=<hex>` URL to `Sec-WebSocket-Protocol` header; rate-limit login;
   upgrade `docs/security-policy.md` §3.8 from spike to production tier.
8. **Forms** — whole-form validation, all-or-nothing write, `form_ok` with keys, flow event with values, empty
   submit allowed.

## Read first

1. `docs/working-notes/decisions/remote-display.md` — the decisions above.
2. `interfaces/remote-display/SPEC.md` — needs edits for token delivery, form contract, and page-dot removal.
3. `docs/security-policy.md` §3.8 — needs rewrite from spike status to production tier.
4. `docs/working-notes/remote-display-spike-results.md` — needs the recommendation section filled in.
5. `docs/user-guide/remote-displays.md` — needs page-dot removal and the stock-install warning.
6. `interfaces/remote-display/vectors/exchanges.json` — update if the wire vectors change.

## Outputs expected from the next session

1. **Updated `interfaces/remote-display/SPEC.md`**:
   - Login returns token; WebSocket upgrade uses `Sec-WebSocket-Protocol: ts-rd-v1-<token>` instead of `?t=`.
   - Wrong/missing token fails upgrade with 401.
   - Remove page dots from the definition and message tables.
   - Define `form_ok`/`form_err` contract precisely, including empty-submit behavior.
   - Add login-route rate-limit note (per-route policy, not part of the message contract).
2. **Updated `docs/security-policy.md` §3.8**: rewrite from "spike" to "production tier" once the token move
   and rate-limiting are described in the SPEC. Keep the boundary table honest: the phone page is a zone and a
   code source; widget faces remain post-MVP.
3. **Filled-in recommendation section in `docs/working-notes/remote-display-spike-results.md`**:
   - MVP or post-MVP: MVP.
   - What the production build needs: custom S3 image recorded; C3 custom image measured; token move; login
     rate limit; SPEC/policy updates; user-guide refresh.
4. **Updated user guide**: remove page-dot references, add stock-install warning, reflect v1 widget set and
   removed `gui_panel` guidance.
5. **Production task list**: a ranked list of implementation work, including which items can land in parallel
   and which block release.

## Open items NOT decided (carry forward)

- **Captive-portal DNS on the AP route** (`docs/working-notes/outstanding-items/remote-display-spike-followups.md`):
  remains post-MVP.
- **Custom widget JS faces**: post-MVP per P1.
- **Native app / BLE transport**: post-MVP per P2.
- **Pico W measurement**: out of scope for v1, track as a follow-up.
- **`ts_http_server` request logging**: production task; add one terse REQUEST line per flow route before release.

## Environment (commands that work and don't)

- Branch: `remote-display-spike`, tip `f2e43da4`. Main is 116 commits ahead and on production; do not merge until
  the production tier closes.
- After every pull or editor change: `(cd editor && npm run build:cli)`. The dist bundle is stale otherwise;
  "unknown node type gui_number" errors are a stale bundle, not a bug.
- Editor verification: delete stray `.js` first, then test:

  ```sh
  find editor/src editor/test -name "*.js" -type f -delete
  (cd editor && npm test && ./node_modules/.bin/tsc --noEmit)
  ```

- Docs lint before any user-guide commit:

  ```sh
  python3 tools/docs_lint.py
  ```

- Device tests (run whenever `device-runtime/src` changes in a way that could execute):

  ```sh
  THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/r_b.json \
    THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/r_s.json \
    <micropython> device-runtime/test/test_remote_display.py
  THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/r_b.json \
    THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/r_s.json \
    <micropython> device-runtime/test/test_ts_http_ws.py
  ```

  MicroPython unix port binaries live in `/tmp/opencode/mpy-src`; build with `make -C mpy-cross` and
  `make -C ports/unix`.
- Custom firmware build (when the S3 image is rebuilt):

  ```sh
  python3 tools/firmware_targets.py check
  MICROPY_DIR=~/micropython firmware/build.sh esp32-s3
  ```

  Requires ESP-IDF v5.5.2 and MicroPython v1.29.0. `build.sh` refuses other checkouts.
- Hardware access: Freenove ESP32-S3 4.0" reachable over WiFi transport; deploys use
  `test-flows/device_cli.py ... --host`. Large USB-CDC writes are dropped on this board, so HELLO/deploy over
  USB is unreliable; use the WiFi transport. The C3 is the documented "stock install below floor" fixture.

## Note on interface changes

The token delivery change alters the WebSocket binding in `interfaces/remote-display/SPEC.md` §8. Record the
SPEC update in the same change as the board/page code that implements it, and bump the runtime/editor version
numbers together if the wire shape becomes incompatible with old clients.
