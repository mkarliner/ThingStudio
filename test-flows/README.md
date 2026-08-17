# test-flows

Hand-authored flow JSON files, for manually exercising a real node type on
real hardware outside the `test/hil/` automated checks -- a human at the
DUT board watching what happens, not a pass/fail script.

**Correction:** this doc originally claimed there's no real flow-file
load/save in the editor yet. Wrong -- there is (`editor/src/flow-file/
flow-file.ts`, wired into the browser's "Open Flow"/"Save Flow" buttons in
`main.ts`). Files here use that real format directly, and can be loaded
straight into the editor.

`interrupt-basic.flow.json` uses `FlowFile`'s real shape
(`editor/src/flow-file/flow-file.ts`): `formatVersion` (must be `1`),
`nodes` (`{ id, type, properties }[]`), `edges`
(`[originId, originSlot, targetId, targetSlot][]` -- 4 elements, not the
6-element `GraphLink` tuple the compiler consumes internally; link IDs and
socket types are regenerated on load, not saved), and `layout` (canvas
position per node id). This is the git-friendly `nodes`/`edges`/`layout`
split design doc §6 describes, not the compiler's own lower-level
`GraphData` input shape.

## `interrupt-basic.flow.json`

Tier 1 item 5's interrupt/pin-change node, first hands-on test since it
was built this session. `thingstudio/interrupt` (pin 1, both edges,
debounce on, 50ms cooldown) fans out to `thingstudio/gpio_out` (pin 12,
the onboard LED on the LuatOS CORE-ESP32-C3 boards this project's already
using) and `thingstudio/debug` (prints to the console) -- press/release a
button on GPIO1 and the LED should mirror it with a debug line per
transition, debounced.

Pin **1**, not 4 -- deliberately clear of `test/hil/pin-map.md`'s already-
wired GPIO4/witness-GPIO5 pair (the automated HIL check's own interrupt
test uses that pair; this manual experiment needs its own pin so the two
don't collide on the same physical board). GPIO1 is one of `pin-map.md`'s
listed free pins (GPIO1/11/18/19), no caveats attached (18/19 carry a
"confirm your board doesn't need them for native USB" note; 1 doesn't).

Also newly true as of this same round: `interrupt` is now wired into the
canvas (ports on `interrupt.ts`, a Rete node class + palette entry +
property panel section in `editor/src/app/rete/`) -- it wasn't when this
file was first written, matching `gpio_in`'s old registry-only precedent.
Loading this file into the editor and hitting Deploy is now the intended
path; it was not before.

Verified two ways before being handed over, neither a substitute for the
real thing (below): parsed through the actual `parseFlowFile` logic
(`editor/src/dev-tools/verify-flow-file.ts`) to confirm the shape is
valid and every referenced node type has a real canvas factory; and
compiled through the actual `compile()` + registry once (before the
`edges`/`layout` rewrite, same node config) to confirm the generated code
is correct -- fan-out, debounce cooldown, both sinks fault-boundary-
wrapped. Not run on real hardware -- that's this experiment.

**Two real prerequisites before deploying this, not polish:**

1. **`threadsafe_event.py` has to already be on the device's filesystem.**
   `device-runtime/src/vendor/threadsafe_event/README.md`'s own "Deploy
   note" flags this: nothing in the compile/deploy pipeline pushes
   `vendor/` files alongside a flow's bytecode yet, and this flow's
   generated code does `from threadsafe_event import ThreadSafeEvent`,
   which will fail with `ImportError` on-device if that file isn't there
   already. One-time, before the first interrupt-node deploy to a given
   board:
   ```sh
   mpremote connect <dut-port> cp device-runtime/src/vendor/threadsafe_event/threadsafe_event.py :threadsafe_event.py
   ```
   (or `ampy put`, whichever tool your setup already uses -- same as
   `listener.py`'s own install step in `test/hil/README.md`.)

2. **GPIO4 needs an external pull, or a button module with one built in.**
   `interrupt.ts`'s codegen is `machine.Pin(pin, machine.Pin.IN)` with no
   pull argument at all (matches `gpio_in`'s old scope, which also never
   had one) -- a bare floating pin will read noise, not a clean
   button-press signal. Wire a pull-down with the button to 3.3V (idle
   LOW, press HIGH -- LED lights when pressed, the intuitive direction for
   this flow's direct mirror), not a bare switch to a floating pin.

## Loading and deploying via the browser (the intended path now)

Open the editor (`npm run dev` in `editor/`), click "Open Flow", pick
`interrupt-basic.flow.json`. Pin/edge/debounce are editable in the
property panel once the interrupt node is selected. Deploy as normal.

## Verifying a flow file without a browser

```sh
cd editor
npx tsc -p tsconfig.devtools.json          # emits to /tmp/ts-out
node /tmp/ts-out/dev-tools/verify-flow-file.js ../test-flows/interrupt-basic.flow.json
```

Runs the file through the real `parseFlowFile` and checks every node type
against the canvas's own factory set -- catches a malformed file or an
unwired node type before it produces a confusing partial load in the
browser. `tsconfig.devtools.json` is a separate, narrower tsconfig
(compiler + node-library + dev-tools + `flow-file.ts` only) -- the main
`tsconfig.json` includes `src/app/rete/**`, which relies on Vite's
bundler-mode module resolution and won't type-check under plain Node ESM
resolution; this sidesteps that rather than fighting it.

## Alternate path: compiling and deploying without the browser

`dev-tools/compile-flow.ts` takes the compiler's own lower-level
`GraphData` shape (`{ nodes, links }`, 6-element link tuples), not a
`FlowFile` -- a different, lower-level shape than the files in this
directory now use, and there's no automated converter between the two
(the real conversion, `graph-adapter.ts`'s `toGraphData()`, runs against a
live Rete graph in the browser, not a `FlowFile` on disk). Useful if you
want a scriptable deploy with no browser involved at all, at the cost of
hand-writing a second file in the older shape; not needed for
`interrupt-basic.flow.json` now that the browser path works.

```sh
node /tmp/ts-out/dev-tools/compile-flow.js path/to/a-graphdata-shaped-file.json > /tmp/flow.py
python3 test-flows/deploy_flow.py --dut-port /dev/ttyUSB0 --mpy-cross /path/to/mpy-cross /tmp/flow.py
```

`deploy_flow.py` itself is unaffected by any of this -- it only ever
consumed already-compiled Python, never the JSON directly. Reuses
`test/hil/hil_common.py`'s `DutLink`/`compile_flow`, same §13 protocol
handling every `test/hil/` script uses, just without a witness board or
pass/fail assertions. Sends `DEPLOY`, waits for `DEPLOY_ACK`, then prints
console output and any `NODE_ERROR` until you Ctrl-C. `--mpy-cross` needs
a native build -- `device-runtime/test/README.md` has the recipe.

## What this experiment is actually checking

Everything `tsc`/off-device tests already covered for this node
(`editor/test/node-interrupt.test.ts`) is arithmetic and structure, not
proof. This is the first time any of the following got checked against
real hardware:

- Does `machine.Pin.irq()` -> `ThreadSafeEvent.set()` (hard-IRQ context) ->
  the coroutine's `await evt.wait()` actually hand off correctly, at all.
  **Confirmed** (2026-08-17) -- button press/release cleanly toggled the
  LED via the fan-out to `gpio_out`.
- Does debounce actually suppress real mechanical switch bounce, not just
  a simulated `DRIVE_BOUNCE` sequence (`test/hil/run_gpio_pwm_timer_checks.py`
  already covers that half). **Confirmed** (2026-08-17) -- rapid presses
  produced no flicker/double-fire within the 50ms cooldown window.
- Does a redeploy leave the IRQ handler in a sane state -- no leak, no
  crash, no double-firing from a stale handler still registered on the
  pin from a prior deploy. Not specifically exercised this round (only
  one deploy-after-reset, not a redeploy-over-redeploy); still open.
- Does the property panel / canvas wiring itself work in a real browser.
  **Confirmed** (2026-08-17) -- flow loaded, edited, and deployed via the
  browser end to end.

Also confirmed this round, not part of the original list: the
`RuntimeError: name too long` failure seen on the first deploy attempt
was a stale-HELLO/version-check-skipped artifact, not a real bug -- a
board reset (forcing a fresh HELLO) let the version check run and the
same flow deployed clean.
