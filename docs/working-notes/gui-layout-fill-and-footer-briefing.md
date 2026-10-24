# Briefing: GUI layout — fill the page, footer dots

Session: 2026-10-24. Continuation handoff — the next session starts here.

## The one-sentence topic

The CYD's cards now draw correctly (two library bugs fixed and on the board), Mike has ruled that a layout must be
able to fill the rest of a page and that the page dots belong in a footer that **shrinks** the page, and the next
session **triages the backlog first, then** builds those two rulings — while 13.0.0 stays unshipped.

## First action: triage the backlog before picking work

`docs/working-notes/outstanding-items.md` has become unreadable as a working list: **946 lines, 150 top-level
bullets, and roughly 69 of them say "closed", "done", "settled" or "built" in their own text.** It has not been
re-audited against `git log` since the 2026-08-19 pass, so the active sections still carry finished work inline —
the CYD gate, the custom-image build, the deploy-guidance decision and others each take a paragraph to say they are
over, and the open items are buried between them.

**Spend the first task making it readable, and only then pick work from it** (Mike, 2026-10-24):

- move every bullet whose own text says it is closed into the "Resolved" section (or delete it where it is already
  there), so each active section holds open work only;
- keep the one-line pointer plus detail-file link that the file's own convention asks for — compress, don't lose;
- put a "last audited <date>, against `git log` at <sha>" line in the header, so the next audit knows what it
  covers;
- leave the `[LAUNCH]` / `[LAUNCH-NICE]` tags alone unless an item's status actually changed — this is a
  readability pass, not a re-prioritisation.

## State at handoff

`main` is at `b979395` as this is written (the Dependabot merge; this brief's own commit sits on top), pushed,
tree clean.
Runtime/editor are **13.0.0** (`_RUNTIME_VERSION`, `EDITOR_TARGET_VERSION`).

- `7d4a5f4` gui: a card's straight sides are full width, and text clears to what it sits on — the two rendering
  bugs that made the first cards look wrong.
- `772ee16` test-flows: a card-heavy CYD demo, with a vivid theme.
- `9452965` docs: a flow-only deploy is not a deploy; fill-the-page and footer rulings.
- `a2ee2d8` gui layout: the footer shrinks the page rather than overlaying it.
- `97a92dd` docs: this brief.
- `eebe4b4` editor: six dev-dependency advisories cleared (npm tree now audits clean).
- `0873df8` ci: `npm audit --audit-level=high` gate; the editor install documented; Dependabot config.
- `7fc7f2e` supply chain: Actions pinned to commit SHAs, backend hash-pinned, the general rule in `AGENTS.md`.
- `3db59f0` backend: the hash lock regenerated on the Python CI uses — the first one broke CI (see below).
- `60c0457` dependabot: why pip gets alerts and not automated PRs.
- PR #2 merged (`b979395`): `actions/setup-python` v5 → v7 under the new SHA pin, one line per workflow.

The previous session's briefing (`gui-cards-cyd-panel-briefing.md`) is closed — its hypothesis 4 was right — and now
carries a dated correction (see next section).

## The correction worth reading first

Yesterday's write-up said a frozen image means the library comes only from the image, so only a reflash could fix a
stale library. **That was backwards.** `deps.ensure_on_path()` puts `/lib` at `sys.path[0]`, ahead of `.frozen`
(runtime 11.1.0), and `librariesToSend()` sends any library whose hash differs from what HELLO reports. An ordinary
**Deploy from the editor replaces a frozen library**. What actually bit us is narrower: the flow was pushed by
`/tmp/opencode/deploy_flow.py`, which sends `FLOW_PUT`/`FLOW_COMMIT` only — the flow half of a deploy. Full story:
`learnings/micropython-device-runtime.md`, "A flow-only deploy is not a deploy".

Practical consequence for the Mac session: **a library change no longer needs a reflash**, just a Deploy. The
reflash erased the board's flows and WiFi credentials, which is why it should stay a last resort.

## The two bugs that were fixed (done, don't redo)

Both were in `device-runtime/src/vendor/thingstudio_gui/gui.py`, both invisible until the image actually contained
card code, and both caught by a test that fails on the old code:

- **The bite out of the sides.** `_fill_round` drew the straight middle as `fill_rect(x + rad, y, w - 2*rad, h)` —
  inset by the radius for the whole height, with only the corner rows widened. 23 of 31 rows on the header card
  were 4 px short on each side. Fixed to `fill_rect(x, y + rad, w, h - 2*rad, c)`.
- **The text background.** `Surface.text()` set its glyph palette to `self.background` unconditionally, so glyph
  cells cleared to the screen background inside a card. `text()` now takes `bg`; `label`/`readout` pass
  `background_for(rect)`, `button` passes `fg` when pressed, `led` clears its dashed ring to the card.

Verified on the real MicroPython unix port: `test_gui 23/23`, `test_gui_widgets 17/17`, `test_gui_bands 4/4`,
`test_gui_buttons 18/18`, `test_runtime 19/19`.

## What is next, in order

0. **Triage the backlog** — see "First action" above. Nothing below should start until the list it comes from can be
   read.
1. **Confirm the panel** (probably done by the Mac session): card sides straight edge-to-edge, no dark boxes behind
   `1022`/`Pressure`, dots no longer floating oddly below the card.
2. **Build the two layout rulings.** Detail, options and open sub-questions:
   `outstanding-items/gui-layout-fill-and-footer.md`.
   - *Fill:* `grow` and a full-screen root already exist, so this is a default plus an affordance (a `fill`
     control on a container, or a last-card default), not a new primitive. The demo is the illustration — content
     stops at y=205 of 320.
   - *Footer:* reserve a strip at the bottom, draw the page dots there instead of letting `pagedots` sit wherever
     the author dropped it (the demo has it at `(112, 211)`). **The footer shrinks the content area** (Mike,
     2026-10-24); it does not overlay. Footer height and whether a one-page flow shows a footer at all are still
     open.
   - Neither needs a runtime bump while nothing device-side changes. If the page table grows a `"footer"` entry,
     that is codegen-visible and does.
3. **Release debt — the biggest outstanding thing.** 13.0.0 has never shipped; `v0.4.0` is runtime 12.1.0 and
   `firmware/classic-esp32/tested.json` still holds only `thingstudio-classic-esp32-12.1.0-8e2f87d.bin`. To ship:
   flash a committed image on a board, run it, `record-tested.sh <image> "<board>" "<what you saw>"`, then
   `publish.sh <tag>`. The backlog also still owes `publish.sh v0.4.0` and publishing the draft.
   Note `build.sh` names the image from `git rev-parse HEAD`, so **an image built from a dirty tree carries a SHA
   it does not contain** — commit first, build second. That happened here and the file was deleted.
4. **Optional, cheap:** the vivid theme (`bg #0D0B20`, `card #6C2BD9`, `accent #00E5FF`) exists only inside the
   test flow. Promoting it to a third preset next to `dark-slate`/`light-paper` is a few lines in
   `gui-theme-shared.ts`, a test, and the preset list in `docs/user-guide/nodes/gui.md`.

## State of the board (CYD, `/dev/ttyUSB0`)

- Flashed with the image built at `a4f1e2f` **including** the two card fixes; functionally identical to
  `out/thingstudio-classic-esp32-13.0.0-772ee16.bin`, which is the correctly-named artifact. Rebuild after any
  further commit.
- Running flow `card-hero-vivid` (the vivid theme), resumed from `/_flow.mpy` across resets.
- `hasWifi: false` — the flash erased the credentials. The demo does not need them; anything MQTT does.

## Environment facts that will bite the next session

- No `dialout` group on this box: every serial command runs under `sg dialout -c '...'`.
- **The CH340 wedges with EIO (or hangs on open) after some closes, and only a replug clears it.** Do the whole job
  in one open — never a probe that opens and closes. `/tmp/opencode/deploy_reset.py <file.mpy> <flowName>` does a
  hard reset, waits for `LISTENER_READY` and deploys in a single session; `deploy_flow.py` waits for a boot banner
  that an already-running board never prints again.
- **`deploy_flow.py`/`deploy_reset.py` push the flow only.** They do not push libraries. For a library change, that
  is the difference between working and silently running the old code.
- `mpy-cross`: `/home/agent/esp/micropython/mpy-cross/build/mpy-cross -march=xtensawin`. Compile a flow with
  `node editor/dist-cli/thingstudio-compile.mjs --board board:cyd --out x.py flow.json` (note `board:cyd`, not
  `cyd`).
- Firmware build: `source /home/agent/esp/esp-idf/export.sh`, then
  `MICROPY_DIR=/home/agent/esp/micropython firmware/classic-esp32/build.sh`. Incremental off the existing tree is a
  couple of minutes; flashing 1.7 MB is about 100 s and erases flows, WiFi and board settings.
- MicroPython unix port for the device tests:
  `/tmp/opencode/mpy-src/ports/unix/build-standard/micropython` (run each `device-runtime/test/test_*.py` with it).
  Never trust `py_compile` for `device-runtime/src`.
- The `/tmp/opencode/docsvenv` mkdocs is broken (`No module named mkdocs.__main__`); working-notes are outside
  `docs_dir: docs/user-guide` anyway, so only user-guide edits need a site build.
- Only Python **3.13** is installed here; CI runs **3.12**, and the backend's hash lock depends on that difference.
  `uv python install 3.12` (uv is in `/tmp/opencode/piptools-venv/bin/`) gives you one.
- `gh` token: `/home/agent/.gh_token`. It can read Dependabot alerts (`Dependabot alerts: Read`) and Actions runs
  and logs; it cannot read repo settings, so `GET /vulnerability-alerts` and `GET /automated-security-fixes` return
  403 by design.

## Builds and installs (`npm` and `pip`)

Both toolchains now have mechanical rules in `AGENTS.md` ("Third-party code: pinned, scriptless, gated") — read that
before adding a dependency. The traps specific to this tree:

**Editor (npm).**
- Install with `npm ci --ignore-scripts`. A plain `npm install` fails with `Cannot read properties of null
  (reading 'edgesOut')` — an npm 10 arborist bug resolving vitest's optional browser peers, reproducible on an
  unchanged tree. Regenerating a lock takes `npm install --ignore-scripts --legacy-peer-deps`.
- CI fails on `npm audit --audit-level=high`, so a new dependency has to leave the tree clean. The six advisories
  of 2026-10-24 were cleared this way; `learnings/editor-build-tooling.md` has the detail.
- Dependabot is on: npm gets **security updates only** (version updates deliberately off), Actions get weekly
  version PRs because a pinned SHA never moves. pip gets alerts but no PRs — its lock cannot be regenerated by a
  bot.

**Backend (pip).** The install is no longer `pip install -e 'backend[test]'`. It is:

```
pip install --require-hashes -r backend/requirements.txt
pip install --no-deps --no-build-isolation -e ./backend
```

**The lock must be regenerated on Python 3.12**, which is what CI uses; this box only ships 3.13. The first attempt
was generated on 3.13, silently dropped aiohttp's `typing_extensions` (marker-gated to `<3.13`), and turned `main`
red with `In --require-hashes mode, all requirements must have their versions pinned with ==`. `uv python install
3.12` gives you an interpreter. The exact command, and why `uv --python-version` is not a workaround, are in
`backend/requirements-build.in`'s header — regenerate there, not from memory.

**Never run `npm ci`/`install`/`build`/`vitest` from the agent sandbox against the shared `editor/`** (`CLAUDE.md`):
Linux rollup/rolldown binaries land in the Mac's `node_modules`. Extract with `git archive HEAD` and work there.

## Decisions in force (do not relitigate)

- Fail well, not work badly: no automatic recovery inside a user action; warn on a prediction, refuse only on a
  fact; every failure line says what happened, the figure, and the next step.
- A layout must be able to fill the remaining space on a page; page dots belong in a footer; **the footer shrinks
  the page**. (Mike, 2026-10-24.)
- Cards are built on containers, not a separate tile widget; a card is drawn with the theme's `card` role, radius
  4, `padding` keeps content off the edge.
- A theme is a config node; presets seed editable roles. Themes fold per format at low colour depth rather than
  erroring.
- A frozen image's library is the fallback source, not the last word — `/lib` wins (runtime 11.1.0).
- Deploy pieces stay at 5 KB. The classic-ESP32 image is built locally and attached to a release by hand.
- **Third-party code is pinned, scriptless and gated** — `AGENTS.md` owns the rule and the per-source table; this
  brief does not restate it. If a step here conflicts with it, `AGENTS.md` wins.

## Relevant files

- `device-runtime/src/vendor/thingstudio_gui/gui.py` — `_fill_round`, `page_cards()`, `background_for()`,
  `text(bg=)`, `FrameSurface.draw`, `BandSurface._draw_band`.
- `device-runtime/src/vendor/thingstudio_gui/{label,readout,button,led}.py` — the `bg` call sites.
- `editor/src/gui/layout.ts` — `layoutPage()` ("root fills the whole screen"), grow/flex resolution.
- `editor/src/gui/screens.ts` — `Placed.grow`, `ContainerSpec.card`, `"cards"` emission; where a `footer` and a
  `fill` affordance would go.
- `editor/src/app/rete/ScreenOutline.vue` — the outline's per-element fields (grow, gap, padding, card) and the
  `@dots` add-choice.
- `editor/src/node-library/gui-theme-shared.ts` — `THEME_PRESETS`, `resolveThemeForFormat`.
- `test-flows/gui-hero-cyd-theme.flow.json` — the demo (vivid theme, carded containers).
- `docs/working-notes/outstanding-items/gui-layout-fill-and-footer.md` — the two rulings' detail.
- `docs/working-notes/outstanding-items.md` — the backlog to triage first.
- `docs/user-guide/nodes/gui.md` — Themes / Cards / Trend sections (update when the footer lands).
- `.github/workflows/ci.yml` — the audit gate and the backend's hashed install; `.github/dependabot.yml` — what gets
  a PR and what only gets an alert.
- `backend/requirements.txt` (generated) and `backend/requirements-build.in` (the command and the 3.12 rule).

## Suggested filename/commit hygiene

This brief is `gui-layout-fill-and-footer-briefing.md` — named for what the next session builds, not for what this
one fixed. Anything landed from it should commit with tests, and a device-side change (a page-table `footer` entry,
say) gets the usual version-bump judgement in the same commit.
