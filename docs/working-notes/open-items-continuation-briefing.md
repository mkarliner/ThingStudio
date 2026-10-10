# Briefing: continuing the open items

Status: brief, 2026-10-10 (updated after Mike's extra items). For the session that picks up after the AI-authoring
work. Take the list in the order Mike sets. The full item text is in `docs/working-notes/outstanding-items.md`, under
"Added 2026-10-10".

## State at hand-off

- The AI-authoring work is finished: node catalog, `thingstudio-compile` (`--describe`, `--board-info`, `--list-boards`),
  the authoring page, `llms.txt`/`llms-full.txt`, three test rounds (fresh agents wrote flows from the docs alone; the
  11 kept in `test-flows/ai-authoring/` all pass the check), setup block for assistants, proposed
  `thingstudio-flow-author` skill.
- Last full run: `tsc` clean, 77 test files and 989 tests pass, `vite build` ok. `mkdocs build --strict` passes on
  mkdocs 1.6.1.
- Uncommitted when this was written: round-3 docs and flows, assistant-setup block (now with docs.thingstudio.net),
  clock link fix, the outstanding-items additions. Mike has the commit commands for the earlier parts.
- Pre-existing environment failures, not regressions: `test_listener_integration.py`, `test_wifi_provision.py`.
- Test commands (scratch copy `$HOME/work` after rsync, from `editor/`): `npx tsc --noEmit -p .`;
  `MICROPYTHON_BIN=$HOME/mpy/mpy-src/ports/unix/build-standard/micropython npx vitest run`; `npx vite build`;
  `npm run build:cli`. Device tests from `device-runtime/test`. Docs: a venv with mkdocs 1.6 and mkdocs-material
  (`$HOME/mkvenv` in the last session), `mkdocs build --strict`.

## Open items

Suggested order, with reasons. Mike picks.

1. **Board runs of `test-flows/ai-authoring/` (Mike).** Eleven flows have passed the check but never run on
   hardware. First: `bme280-oled-pico2` (does a `framebuf` function work as documented?), `climate-two-page-modal-freenove`
   (modal layout), the two HTTP flows. Any that fail on the board are docs bugs: fix the authoring page.
2. **Trend autoscale and a `series` port type.** Mike's earlier question (why pressure shows min/max and temperature
   does not) traced to scale. The trend should scale to its data; a typed `series` port would let the check refuse a
   trend wired to the wrong thing. Touches `gui_trend`, the journal output type, the compile, the catalog and the docs.
3. **New nodes from Peter Hinch's `micropython-async` primitives (MIT, vendored the same way as `primitives_events`):**
   - **`adc`** (`AADC`, DRIVERS.md section 5): awaitable; wakes when the reading leaves absolute or relative bounds.
     ADC2 pins don't work with WiFi on ESP32: the compile should refuse them. Output raw counts plus an optional
     scaled value.
   - **`encoder`** (`Encoder`, DRIVERS.md section 6): `div`, `vmin`/`vmax`, `mod`, debounce `delay`; outputs value and delta.
   - **`neopixel`** (built-in module, not Hinch): pin, pixel count, colour order, brightness; input a colour, a list or
     `{index, colour}`.
   Each needs: node definition and codegen, editor class and palette entry, property panel, device test with mocks,
   a docs page, an example flow in `test-flows/`, a `PROPERTY_NOTES` entry and regenerated catalog, a
   `third-party-licenses.md` row for the vendored files, and a hardware check by Mike. Ask Mike for the sizes and
   boards he wants first (see questions below). Do `adc` and `encoder` together: same vendoring pattern.
4. **UI: foldable palette groups and a wider or resizable console.** Small, both in the editor only. Do the palette
   recolour-by-group item (`palette.ts`) in the same pass, since it touches the same file.
5. **Newcomer test.** Run `validation/newcomer-test-script.md` on the current release. Needs v0.1.2 tagged and
   published first (see `newcomer-docs-review-briefing.md`). Best run after the style rewrite of the sample pages
   (`user-docs-style-review-briefing.md`) so it tests the new writing.
6. **CYD gate for custom firmware images.** Block a flashed image from installing on a CYD variant it was not built for.
7. **Download generated Python.** Let the user save the compiled MicroPython from the editor.
8. **Packaging items** from `mvp-remaining-work-briefing.md`: Windows install on a real machine, Homebrew tap (needs
   Mike to create the repo), `thingstudio` as the command name everywhere, `thingstudio service` helper, fresh-VM
   acceptance per route, seeded board-definition copies hiding updated built-ins.
9. **Workspace `AGENTS.md`.** A first-run file for the user's flow folder, written when the workspace folder exists.
10. **End of queue (Mike's call):** external-controls flow, memory-gate flows, the `--check-node` loader check for
    custom nodes, an MCP wrapper for the checker only if tests show an assistant needs it.

## Round-3 loose ends

- Unverified on a board: a `json` import inside a function node; a `framebuf` buffer passed to `display_i2c`.
- Round 4 of the AI-authoring test only if the board runs show docs gaps. Include a non-Claude assistant if possible.
- After the new nodes land, regenerate `nodes-catalog.md` and add them to the authoring page's "Which node" table.

## Questions for Mike before the new nodes

- `adc`: which boards and pins will he test on? Output as raw counts, volts, or both? Does he want a plain periodic
  read too (the `AADC` pattern only wakes on change)?
- `encoder`: does he want it to drive GUI navigation (next/prev) directly, or just emit values?
- `neopixel`: strips or rings, how many pixels, RGB or RGBW? Animations (chase, fade) as part of the node, or colours
  only?
- Anything else still unlisted: DS18B20 / one-wire, DHT22, relay output with a safe default, servo, I2C expanders,
  buzzer, deep sleep, SD card logging, OTA update; boards or displays not yet defined; annoyances in the editor not
  written down.

## Constraints

Mike does all git writes (commit commands starting `rm -f .git/index.lock`, no `#` comments, with the two trailers).
Build and test only in `$HOME/work` after rsync. Warn before adding any npm package. Place nodes left to right in
test flows. Don't use the phrase "load bearing".
