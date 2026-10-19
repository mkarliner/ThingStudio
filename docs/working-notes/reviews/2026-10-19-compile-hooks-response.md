# Review: the compile-hook response (2026-10-18/19 work)

2026-10-19. Reviewer: Claude, in a session with Mike. **Status: review** -- findings, no decision taken. Follows
`2026-10-18-node-parity-architecture.md`. Repo state reviewed: `48ea9ffa` (`d1917f20..48ea9ffa`, 16 commits).

Scope: the decision record (`package-compile-hooks-scoping.md` §10, `decisions/node-authoring.md`), the spike
(`package-compile-hooks-spike.md`), the draft spec (`interfaces/node-compile-context/`), the hook machinery
(`editor/src/compile-hook/`, `node-library/compile-context.ts`/`compile-hook.ts`/`compile-hooks.ts`, `main.ts`,
`cli/check-flow.ts`), the `wifi_status` conversion and `ts_wifi`, and the converted nodes' tests. Verified by a
fresh clone in the reviewer's own workspace: `tsc --noEmit` clean; `vitest run` 99 files, 1107 passed / 2 skipped,
matching the handoff briefing.

## Verdict

The architecture is right and the work is real: the spike disproved the scoping note's synchronous-budget
assumption with numbers, the async pre-pass in front of a still-synchronous `compile()` is a better answer than the
note's, and the amendments (data stays the default, the port-type exception, output caps, the restated parity
test) improve the design. The problems are in robustness, in one two-producer drift, and in the evidence for "no
loss". None of them argues against the direction. The higher-priority items should be fixed before converting
more nodes on top of this.

## Findings, by priority

**Fix before more conversions**

1. **The editor can hang silently.** `runner.ts`'s `ensureWorker()` waits for `ready` with no timeout and no
   `worker.onerror`; a worker script that fails to load, a CSP refusal or a stalled wasm fetch leaves preview and
   deploy pending forever. The real browser is still untested, which is where this would appear. Add an init
   timeout and an `onerror` handler that rejects with a `CompileError`.
2. **CLI and editor build different hook contexts (two producers).** `check-flow.ts` calls `runCompileHooksSync`
   without `target` or `redactConfig`, so CLI hooks see `target: null` and unredacted `flow.configs`, while the
   editor's see the target and redacted configs. The same flow can pass in one and fail in the other. One shared
   options builder for both call sites.
3. **The compile-time core network nodes now need the WASM worker to compile at all.** Every WiFi flow in the
   shipped editor depends on the untested browser path (findings 1, 4). The real-browser pass is open; it should
   come before the next push to `main` that users install from, or before the next release.
4. **Deleted tests for unchanged code.** `computeWifiProvisionMarker` was not touched, but its tests went from about
   ten to one. It decides whether a board reopens its captive portal -- an attack surface per design doc §9. Move
   the tests back, don't delete them.
5. **NODE_STATUS lost all its `wifi_status` tests** (connected, disconnected, no repeat on an unchanged poll,
   re-report on a gateway change); the package still calls `report_status`. Restore them against the package.

**Fix soon**

6. **The spec's 5 s per-compile budget is declared but not enforced** (`compileWallMs` is never read). Hooks run
   serially, so a large flow can run far past it.
7. **The preview can show a stale result.** `refreshPreview()` is async and fired unawaited on every change with no
   ordering guard; an older, slower compile can overwrite a newer preview and `lastCompileWarnings`. Deploy awaits
   its own compile and is unaffected.
8. **One timeout fails unrelated hooks.** `discardWorker()` rejects every pending request, including an overlapping
   preview's, which then reports a misleading timeout.
9. **The `ts_wifi` test runs a hand copy** (`test/fixtures/pymock/ts_wifi.py`) of the real
   `device-runtime/src/vendor/thingstudio_wifi/ts_wifi.py`. Identical code today, nothing keeping it so. Load the
   real file, or add a sync test.
10. **"No loss" is asserted, not evidenced.** Under the restated test (no loss of on-device behaviour; moved or
    dropped checks recorded), dropped behaviour tests are a record too. `wifi_status` 49 -> 23 tests, `udp_receive`
    22 -> 16, `udp_send` 16 -> 13; part consolidation, part loss (e.g. the gateway-change re-emit), none recorded.

**Process and docs**

11. **The spec is "draft pending review" while six nodes are built on it and pushed.** The direction was approved,
    not the contents; the context shape is now frozen in practice. Mike should review `SPEC.md` before more nodes
    land on it.
12. **The spec's worked example contradicts its own secret policy**: it reads `ssid` from `flow.configs`, which is
    redacted. The real hooks are correct (a singleton `configRef` puts the WiFi secrets in `referencedConfigs`).
    Fix the example; §2's table also calls `node.properties` "resolved" where §1 says raw.
13. **Decision text and code disagree on built-ins.** §10 item 3 says built-ins adopt the context via a TypeScript
    adapter; the code (rightly, in the reviewer's view) writes core hooks in Python and runs them through the same
    sandbox, which exercises the user path and makes "copy a built-in" include its hook. Update the decision.
14. **Interpreter provenance.** The vendored wasm is an alpha PyPI wheel built from an unmerged MicroPython PR,
    hash-recorded but not reproducibly built. Fine for a spike; weak for something core nodes need to compile. A
    pinned, reproducible build (the `mpy-cross-wasm` pattern) belongs on the list before a release.
15. **The CLI's synchronous, uncontained hook runner** is acceptable while only trusted core hooks run there. Record
    as a rule, not only a briefing gotcha, that CLI custom-node loading must not land without containment -- the
    CLI is the AI-agent check path, where a hang is invisible.
16. **Misleading test name**: `ts-wifi.test.ts`'s "does not connect for an open network with no password" asserts
    that it does connect. The code is right.

## Checked and cleared

- **Secrets in the editor**: network packages get WiFi secrets only through `referencedConfigs`; `main.ts`
  redacts `flow.configs` via `visibleConfigProperties`. Policy upheld (CLI aside, finding 2).
- **`ts_wifi` across redeploys**: its module-level state cannot leak into the next flow; `listener.py` calls
  `deps.forget_modules()` on every deploy, so a changed SSID does not trip the "different settings" error.
- **`ts_wifi` behaviour** matches the old generated setup, including the ESP32 join-at-import workaround; turning
  a silent first-wins into a loud `ValueError` is an improvement.
- **Hook budget excludes cold start**: the per-hook timer starts after the worker is ready.
- **Skipped pre-pass fails loudly**: `compile()` refuses a hooked node without hook results.
- **Hooks cannot emit source**: results are validated data with size limits, as designed.

## Suggested order

Findings 1-2 (small code fixes), 4-5 (restore tests), then the real-browser pass (3), then Mike's spec review (11)
with 12 folded in, then 6-10. Only then `ts_mqtt` and the remaining network nodes. A hardware pass on ESP32 + MQTT
is still owed for everything converted, since nothing in this work touched a board.
