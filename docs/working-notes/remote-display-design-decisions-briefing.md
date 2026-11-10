# Remote display — design/architecture decisions briefing

Status: handoff, 2026-11-10, for the next session. Mike's ask: go through the design/architecture decisions as the
first step. The spike is **staying on its branch** (`remote-display-spike`) while the main-as-production question is
live -- main is not merged, nothing here moves off-branch.

## Read first

1. `docs/working-notes/remote-display-scoping.md` — the design; "Where the questions stand" + "Where the spike
   stands in code".
2. `docs/working-notes/remote-display-spike-results.md` — hardware figures: C3 floor (IDF heap collapse), S3 in
   class, live taps verified; the verdict points at custom images.
3. `decisions/remote-display.md` — the decided rules (P1/P2, our own WebSocket, general-facility server, one
   viewer, remote screens are screen-size agnostic). Do not re-open these in the session; they are the frame.
4. `docs/security-policy.md` §3.8 — the phone page as zone/code source, spike-tier, with its recorded gaps.
5. `interfaces/remote-display/SPEC.md` — the wire contract as the spike ships it (draft); what is proven is exact.

Skim only: `remote-display-spike-code-side-briefing.md` (2026-11-06 handoff; superseded in detail by the code),
`learnings/remote-display-spike.md` (21 entries, the traps), and the branch's own test files for shape.

## Where the branch actually stands (2026-11-10 tip `f2e43da4`)

- Board side (kept): `ts_http_server` as a general facility with WS support; `ts_remote` (login over TSAUTH1,
  one-viewer take-over, HMAC+counter input frames, chunked definition, stale/safe link policy with deadman,
  page-change stream); the gzipped page; 12/12 unix-port tests on the message layer, 9/9 on the transport.
- Editor side (kept, built against existing compiler machinery): remote screens as gui screens with display kind
  "remote", `web_server` config node, the grid→flex definition conversion, four phone-input widget nodes
  (`gui_number`/`gui_text`/`gui_submit`/`gui_slider`), link policy as a screen property. 1387 editor tests green,
  docs (user-guide page + node catalog) current.
- Proven on hardware: the board half end to end (live taps, settings over WiFi deploy); C3 below the floor; S3
  comfortable with a custom image (runtime 15.1.0 was both deployed and verified over the WiFi transport).
- Open/Gaps: capacity of the grid→flex conversion at real page complexity; remote cards (dropped with a warning);
  page-cards on remote; trend/theme parity questions; the `?t=` token in the URL; form_err semantics half-written
  in the results sheet; Pico W unmeasured; first-run provisioning not yet a usage document; custom widget faces
  (P1) not built.

## The agenda (design decisions made in this session, first-to-last)

1. **MVP or post-MVP** (the results sheet's `<decide>`, Mike's call): given the C3 floor, an S3 discipline
   (a custom image), what's left to build below, and who carries the work? Recommendation the branch's own
   numbers suggest: treat it as an MVP-besides-the-image, i.e. build it but in a custom image schedule the
   gate. Doing so ends the `Not yet built` entry in the security policy at §3.8.
2. **Target model: capability parity vs implementation parity.** Direction: the physical GUI computes rects
   from fonts; the remote delivers a definition the phone interprets. Parity of capability (the same widgets and
   settings) is the deliverable; implementation parity (themes, fonts, pixels) is exactly the trap
   P1 writes down in the phrase "widget faces are data". Decide the widget-face data format (JSON primitives
   the page interpreter) as the first production item, with a JS face as the explicit v2 (security
   review).
3. **Authoring vocabulary.** Today the panel grid auto-converts (col spans as grow weights, rowSpan as vertical
   weight). Does it hold at real page complexity (mixed spans, alignment, sheets of fields) or does remote need
   its own layout mode? Also: the panel card nature (cards over a flex layout), and the outline's modal story
   (screen-edit's already had a model, the remote branch drops cards with a warning).
   Recommendation: keep the grid conversion for v1; card/panel shapes on remote become a *layout in definitions*
   decided with the face format, not a layout editor feature.
4. **Do remote pages carry panels/cards at all?** P2 says the definition is data; a `panel` is visual.
   Currently dropped by the compiler with a warning. Decide (commit to the drop with a note, or build card).
5. **Board class and images**: confirm "remote displays ship as custom images" (the hardware session's
   decision), mark the C3 as documented-floor (keep the results table), decide whether the Pico W gets a
   measured column or an explicit "not now". This affects `firmware/targets/` (an S3 target exists) and the
   image type list.
6. **Editor surface**: what remote flows *avoid*: navigator? trend? pagedots (dropped, drawn by the page)?
   confirm the phase-1 widget list (readout/bar/led/button/label/(trend?)/fields/submit/slider) and how the
   compiler *warns* for knowingly-unrendered ones (today: trend renders; dots dropped; cards dropped).
 7. **Security tier for the phone page (production §3.8)**: the login token rides in `?t=` (URL text leaks
    through proxies/logs); replace with a header or per-session upgrade nonce; the page asset as a code
    source; rate limits on the login route; decide what must land *before* any non-Mike machine gets this code.
8. **Settings & forms**: the submit-write-consumers story: one form write = one message + one flow event; a
   write with no keys (no draft values) still emits (form_ok + event with zero keys) — is that the contract for
   `form_ok` and `form_err` to write into SPEC §5.1. Also: the security shape of form input (the input frames
   are HMAC-signed but the values route through `runtime.settings`).

## Decided rules NOT on the agenda

P1/P2 (faces are data; the page is the first client), our-own WebSocket code, the web server as a general
facility with `mount()`, one viewer per display, remote screens are screen-size agnostic, no new dependencies at
the edge, TSAUTH1 reuse, deploy = flow dependencies + custom image. Re-opening any of these is out of scope for
the session per the AGENTS handoff rules; contradictions should argue for the *rule*, recorded for later.

## Outputs expected from the session

- Each decision lands in `docs/working-notes/decisions/remote-display.md` that day (the same file the 2026-11-06
  rules live in); design questions that don't get an immediate implementation get a *plan* item in the scoping
  note's "Where the questions stand" section.
- The results sheet's "Recommendation" section (MVP/post-MVP) gets the actual text.
- Updates to `interfaces/remote-display/SPEC.md` if a decision changes the wire (note: SPEC is draft; changes
  are cheap *until* a board keeps a shipped image; then they are versioned).
- A short list of the next work items (a production plan, not a spike) either directly after the agenda or as a
  closed follow-up item.

## Environment (what the next session needs to know, per the AGENTS handoff rules)

- Branch `remote-display-spike`, tip `f2e43da4`; main is 116 commits ahead and on production; do not rebase
  aggressively -- merge when the MVP call is made.
- After every pull: `(cd editor && npm run build:cli)` -- the dist bundle is stale otherwise ("unknown node
  type gui_number" errors are that, not a bug).
- Editor verification: `find src test -name "*.js" -type f -delete` first, `npm test` (1387 green at time of
  writing), `./node_modules/.bin/tsc --noEmit`. Stray compiled .js files shadow the TS sources and produce
  ghost passes/failures.
- MicroPython unix port: binaries live in `/tmp/opencode/mpy-src` (mpy-src cloned at MicroPython HEAD;
  `make -C mpy-cross`, `make -C ports/unix`); device tests run as
  `THINGSTUDIO_BOARD_SETTINGS_PATH=/tmp/opencode/r_b.json THINGSTUDIO_SETTINGS_PATH=/tmp/opencode/r_s.json
  <micropython> test_remote_display.py` from `device-runtime/test/`; the ws tests are as-run. The board tests
  need scratch paths set every run.
- Hardware: Freenove ESP32-S3 4.0" (octal PSRAM) holds runtime 15.1.0 build `dc511ad`, reachable over the WiFi
  transport; its USB console drops writes over ~1 KB so deploys go `test-flows/device_cli.py flow deploy ... --host`
  with the board password (set over USB). Runtime installs on it need UART (REPL is on UART0, not the CDC -- a
  STOP_TO_PROMPT strands the board). The ESP32-C3 is the documented "does not fit" fixture. The Pico W is out
  (in the box, unmeasured).
- Doc hygiene: `python3 tools/docs_lint.py` before any user-guide commit; a new rule lands with the changes that
  make it pass; node catalog is generated (rebuild CLI, regenerate, commit with the node work).
