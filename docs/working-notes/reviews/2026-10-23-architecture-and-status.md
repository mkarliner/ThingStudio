# Review: architecture problems and overall status

2026-10-23. Reviewer: Claude, in a session with Mike. **Status: review** -- findings, no decision taken. Built from
the working notes, the 2026-10-14 to 2026-10-19 reviews, the decision logs and spot checks of the code
(`editor/src`, `device-runtime/src/listener.py`); not a fresh audit of the whole codebase. Previous whole-repo
opinion: `../architecture-review-continuation-briefing.md` (2026-10-14).

Mike's verdict on the overall architecture stands: coherent, fault-first, one structural bet (editor as platform).
What follows is what is still wrong with it.

## 1. What is wrong with the architecture

1. **Memory on small boards is handled by advice, not design.** Stock MicroPython on a classic ESP32 (CYD) cannot
   start the hero GUI flow. Repeated deploys break up the MicroPython heap and take the ESP-IDF heap down to 18 KB,
   where WiFi may not start. The settled answer is guidance (remove flow, power cycle, deploy) plus an optional
   frozen-library image (`decisions/classic-esp32-firmware.md`, 2026-10-23). Honest, but every low-memory board
   meets it. Related and still open: reset before deploy (P3, `outstanding-items/reset-before-deploy.md`), WLAN not
   torn down on redeploy (POST-MVP), the low-memory warning against a board budget (P4).
2. **The editor is still the single point of failure.** Compiler, type system, dependency resolution and version
   gate are client-side; `editor/src/app/main.ts` is 3,392 lines (about 3,100 on 2026-10-14). A codegen bug fails
   every board.
3. **Runtime and editor versions are mirrored by hand** (`_RUNTIME_VERSION` in `listener.py` and
   `EDITOR_TARGET_VERSION`). The 2026-10-14 review named this the strongest candidate for a real structural
   weakness; nothing has changed. The runtime went 10.0.0 to 12.1.0 in under two weeks, and the version constant's
   comment has become a one-line changelog.
4. **The compile hook depends on an unmerged upstream PR.** `micropython-wasi.wasm` comes from MicroPython PR
   #13676; every WiFi flow needs it to compile. Stage 1 (pinned rebuild) is done; mainline `ports/webassembly`
   works but is 3.7x larger and loads asynchronously (`../webassembly-mainline-spike.md`). Release-critical
   dependency on something upstream may never merge.
5. **Node-parity leftovers.**
   - Every non-residue built-in is a package (`function` and `gui_*` are the named residue).
   - The TypeScript WiFi rules (`resolveFlowWifiCredentials`, `wifiSetupStatement`, `normalizeWifiConfigs`,
     `computeWifiProvisionMarker` in `editor/src/node-library/wifi-status.ts`) have no callers left in `src`; only
     comments and `test/flow-wifi-helper.ts` mention them, and the file header still says "the still-built-in
     network nodes". The 2026-10-19 review asked for them to be deleted once the network family was converted.
   - The core-only descriptor vocabulary (`resources`, `lessThan`, `dynamicOutputs`, `placeholderWhen`, and others)
     is still not in `custom-node.schema.json`, so a user's node still cannot do what a core package can (axis 2
     of the 2026-10-18 review).
6. **Deliberate wire-protocol debt.** `VALUE_STREAM` and `STATE_READ`/`STATE_WRITE` reserved and unbuilt; the
   backend is a relay that never decodes CBOR; runtime install is a separate raw-REPL path. Fine for launch, known
   cost later.
7. **The serial-link fix only reaches the custom image.** The esp32 port's 260-byte stdin ring buffer drops bytes
   while a display draws. Only the custom image patches it (8 KB). Boards on stock MicroPython get a clear
   `Garbled` answer and a resend (runtime 12.1.0), not the fix.
8. **User-authored GUI widgets are not possible yet** -- Mike, 2026-10-23: a must (see
   `decisions/gui-layout.md`). The GUI is the named residue of node parity, so today only core can add or restyle
   a widget.

## 2. Overall status

- **Recently landed:** network nodes as packages (`ts_mqtt`, dynamic subscription, `http_in` via `nodesOfType`),
  the `change` node replacing `variable_get`/`variable_set`, chunked 5 KB deploys, the classic-ESP32 image
  installing and deploying three times in a row over a running GUI flow on the CYD.
- **Tests at the last full run (2026-10-20):** editor 1130 passed / 2 skipped, backend 301, MicroPython 109. The
  runtime 12.x and firmware work came after that run.
- **Left before launch:** `publish.sh v0.4.0` and publish the draft; the newcomer test with a target-group
  tester; button rework leftovers (one rotation control, the touch panel's landscape axes); the HTTP response-size
  `MemoryError` decision; Windows install on a real machine and the Homebrew tap; trend autoscale and a `series`
  port type; memory-gate example flows (end of queue); user-authored GUI widgets if Mike puts them before launch.
- **Housekeeping:** `outstanding-items.md` is drifting -- it still says repo-root `AGENTS.md` is empty (443 lines
  today), and the 2026-10-17 custom-display-node item appears twice.

## 3. Recommended next steps

1. Delete the dead TypeScript WiFi helpers and fix the header (small, self-contained).
2. Decide when user-authored GUI widgets land relative to launch, then scope them in the GUI subsystem's own
   model (`decisions/gui-layout.md`, 2026-10-15).
3. Derive the editor's target version from the runtime's (one source), or add a test that fails when they drift.
