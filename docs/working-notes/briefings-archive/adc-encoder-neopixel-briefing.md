# Briefing: new nodes — `adc`, `encoder`, `neopixel`

Status: brief, 2026-10-11. Project pipeline item 3 (`open-items-continuation-briefing.md`); full item text under
"Added 2026-10-10" in `outstanding-items.md`. One session (probably two) to build three new nodes end to end. Do
`adc` and `encoder` together — same vendoring pattern — then `neopixel`.

## Read first

- `docs/working-notes/open-items-continuation-briefing.md` item 3, and `outstanding-items.md`'s "Added 2026-10-10"
  section: the per-node specs are there, not repeated here.
- `docs/thingstudio-design-doc.md` §11 (the `micropython-async` adoption question these resolve).
- `device-runtime/src/vendor/primitives_events/README.md`: the vendoring standard to copy — pinned per-file commit
  SHA (last commit to touch that path, via a real clone's `git log -- <path>`), upstream and post-patch SHA-256s,
  and every local patch written down. `threadsafe_event/README.md` set the same standard.
- The closest precedent for the whole job: `eswitch`/`ebutton`. Read `editor/src/node-library/eswitch.ts`,
  `ebutton.ts`, the vendored `primitives_events/events.py`, and the device-side handlers they generate.
- `editor/src/cli/describe.ts` (`PROPERTY_NOTES`, the catalog) and `editor/test/cli-describe.test.ts`'s header
  (the catalog regeneration command).

## Open questions for Mike — ask before writing code

- **`adc`** (`AADC`, DRIVERS.md §5): which boards and pins will he test on? Output raw counts, volts, or both?
  Does he want a plain periodic read too, or only wake-on-change?
- **`encoder`** (`Encoder`, DRIVERS.md §6): should it drive GUI navigation (next/prev) directly, or only emit
  value and delta?
- **`neopixel`** (built-in `neopixel` module, not Hinch): strips or rings, how many pixels, RGB or RGBW? Colours
  only, or animations (chase, fade)?

Also on the table but unlisted (Mike's call, not this session's unless he says so): DS18B20/one-wire, DHT22, a relay
output with a safe default, servo, I2C expanders, buzzer, deep sleep, SD logging, OTA.

## Per-node shape

From the "Added 2026-10-10" specs, in brief:

- **`adc`** — wake when the reading leaves absolute (`lower`/`upper`) or relative (current ± delta) bounds;
  `sense(False)` waits for it to come inside. 16-bit range (`read_u16`) is the same on every board. ADC2 pins
  don't work with WiFi on ESP32 — the compile must refuse them, checked against the board definitions. Output raw
  counts plus an optional scaled value.
- **`encoder`** — `div`, `vmin`/`vmax`, `mod`, debounce `delay` (default 100 ms). Order: divide, clamp, modulo.
  Outputs value and delta. Callback runs in asyncio context, not IRQ; not for CNC-grade counting.
- **`neopixel`** — pin, pixel count, colour order (GRB/RGB, RGBW variants), brightness. Input is a colour for all
  pixels, a list of colours, or `{index, colour}`; the node writes on each message. Check RP2 and ESP32 ports
  behave the same; note the 3.3 V data-line caveat in the docs.

## The checklist every node needs

1. Node definition and codegen (`editor/src/node-library/<name>.ts`), following `eswitch.ts`/`ebutton.ts`.
2. Editor class and palette entry (registry, palette group, colour per group — see the palette items).
3. Property panel fields.
4. Device test with mocks (`device-runtime/test/`).
5. A user docs page in the node-page fixed layout (`docs-style-guide.md`): one-line purpose, Properties, Wiring,
   Behavior, Errors.
6. An example flow in `test-flows/` (nodes left to right).
7. A `PROPERTY_NOTES` entry, then regenerate the catalog:
   `cd editor && npm run build:cli && node dist-cli/thingstudio-compile.mjs --describe-all --markdown > ../docs/user-guide/nodes-catalog.md`
8. A `docs/third-party-licenses.md` row for the vendored files (or the built-in module, for `neopixel`).
9. A hardware check by Mike.
10. Update `nodes/index.md` (the group table and the "Which node" table) and any authoring-page table.

## Vendoring

`adc` and `encoder` vendor `micropython-async` files the same way `primitives_events` does: put them under
`device-runtime/src/vendor/<name>/`, with a README carrying the pinned commit SHAs, before/after SHA-256s, and each
local patch described. Fetch from a real clone so the SHAs and hashes are verified, not remembered. Add the
`third-party-licenses.md` row in the same change. `neopixel` uses MicroPython's built-in `neopixel` module — no
vendoring, just the license note.

## Version bump (do not skip)

Any change to a file `deploy_runtime.py` pushes onto hardware (`device-runtime/src/*.py`, the vendored files) is a
breaking-change call, and new node types are codegen-visible: an editor with this change can produce a flow an old
`runtime.py` can't run. Per the `device-runtime version bump discipline` rule, bump both `_RUNTIME_VERSION`
(`device-runtime/src/listener.py`) and `EDITOR_TARGET_VERSION` (`editor/src/app/main.ts`) together, `major`, in the
same commit.

## Verification

- Device: run the real MicroPython suite in `device-runtime/test/` (not `py_compile`), against a scratch
  MicroPython unix-port build. `test/README.md` has the recipe.
- Editor: `./node_modules/.bin/tsc --noEmit`, `vitest run`, `vite build`, `npm run build:cli` — in a scratch copy
  (`$HOME/work` after rsync), never against the shared `editor/node_modules`.
- Docs: `mkdocs build --strict`, `python3 tools/build_llms_txt.py --check`, and the docs tests
  (`cd editor && ./node_modules/.bin/vitest run test/docs-llms.test.ts test/cli-check-flow.test.ts test/cli-describe.test.ts`).
- Delete stray compiled `.js` before trusting any `tsc`/`vitest` run (`find editor/src editor/test -name "*.js" -delete`).

## Constraints

- Mike does all git writes. Give commit commands, each starting `rm -f .git/index.lock`.
- Warn Mike before adding any npm package.
- Place nodes left to right in test flows. Don't use the phrase "load bearing".
- Log any surprising platform behaviour or library gotcha in `learnings/<topic>.md`, and any decision in
  `decisions/<topic>.md`, in the same change.
