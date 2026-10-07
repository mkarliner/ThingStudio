# Decisions — Editor connect-error UX

Status: detail file for `decisions.md`'s "Editor connect-error UX" index entry.

- **2026-09-22 — Backend-relay connect failures get a plain-language workaround, not raw exception
  text; scope is backend-relay only, not WebSerial-direct.** MVP item 2
  (`mvp-kickoff-brief.md`/`road-to-mvp.md`'s "Clear connect failures, not guaranteed connects" —
  the fixed decision is "no attempt to guarantee connects on every board... failures give a clear
  message and suggested workarounds"). First slice, not the whole item:
  - `serial_relay.py`'s `SerialRelayError` was already structured (operation + port + cause) but the
    editor just printed `err.message` raw on a `connectPort()` rejection. New
    `editor/src/app/connect-error-help.ts` (`explainBackendConnectError()`) best-effort
    pattern-matches the NODE_ERROR text for the causes this project has actually seen documented
    (permission denied / access denied, port busy / already open, device vanished) and appends a
    plain workaround; anything unrecognized falls through to a generic "check it's plugged in and
    powered" suggestion rather than leaving bare exception text with no next step. Wired in at
    `main.ts`'s backend-connect `catch` block.
  - The HELLO-timeout message (no HELLO within `HELLO_WAIT_MS` of Connect) now explicitly names the
    real, confirmed cause from `learnings/hardware-bringup-hil-rig.md`'s 2026-09-18 entry: a
    `SyntaxError: invalid syntax` / `File "<stdin>", line 1` line on connect or "Check status" means
    the board has no runtime installed at all, not a boot-timing race — and points at the existing
    manual `test-flows/deploy_runtime.py` step until item 1 (below) ships a real in-editor install.
  - Deliberately scoped to the "via backend" connection mode only, not WebSerial-direct — matches
    `decisions/backend.md`'s 2026-09-08 entry (`direct` mode's `connModeSelect` option already
    hidden in `index.html`, "no new investment" per the 2026-08-16 addendum). Confirmed with Mike
    before building rather than assumed, alongside the transport-scope call for item 1 below.
  - Verified: 6 new cases in `editor/test/connect-error-help.test.ts` (real NODE_ERROR string shapes,
    not invented ones — Linux/macOS/Windows permission wording, macOS "Resource busy," a vanished
    port, and a fallback case), a real isolated-extraction `tsc --noEmit` (clean, only the
    pre-existing unrelated `node-startup.test.ts` gap) and `vitest run` (full suite: same category of
    environmental failures this project has already documented — `device-runtime/vendor/` files not
    present in an `editor/`-only extraction — none touching this change).
  - **Not done yet, tracked separately:** the actual "detect no runtime, offer to install it" flow
    (MVP item 1) — see `outstanding-items/deploy-runtime-from-editor.md`'s 2026-09-22 update. A user
    doc page for connect troubleshooting doesn't exist yet either (`road-to-mvp.md`'s doc item 2 —
    no docs have real content yet, this isn't a regression from this change).
- 2026-10-07 (Mike: "too wordy, human eyes will skip over them"): console advice rewritten terse, one line of what
  happened plus what to do, detail left to the linked docs page. Covers the deploy-restart, safe-mode, library,
  memory, import-error, no-HELLO/install diagnosis and connect-error texts. Rule in `CLAUDE.md` ("Console
  messages: terse").
