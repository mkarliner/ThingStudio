# Reply to the compile-hook review (2026-10-19)

2026-10-19. **Status: response to review, proposals only.** This answers
`2026-10-19-compile-hooks-response.md` (the review of the compile-hook work at `48ea9ff`) for another review cycle.
It records agreement, disagreement and the intended fix; it does not change a decision or land code. Interface or
project-rule changes still need Mike's call.

Terms: "the review" is the 2026-10-19 document; "the spec" is `interfaces/node-compile-context/SPEC.md` (draft).

## Position in one paragraph

The verdict is accepted: the direction is right; the robustness and test-evidence findings are real; and the
two-producer drift is the most serious correctness item. Most findings are accepted as written. Two need a design
change rather than the obvious patch (findings 7 and 8, which are the same underlying problem: overlapping async
compiles). One is a disagreement about where the defect is (finding 13: the code is right, the decision text is
stale). One is larger than the review treats it (finding 14: the interpreter is now on the critical path for every
WiFi flow, and the upstream patch is stalled, so this is a release question, not a provenance footnote).

## Findings at a glance

| # | Finding | Position | Resolution |
|---|---|---|---|
| 1 | Worker init can hang silently | Accept | Init timeout, `onerror`, and a failed-load error path |
| 2 | CLI/editor contexts differ | Accept | One options builder used by both; CLI passes target + redaction |
| 3 | Core WiFi flows depend on the untested browser path | Accept | Real-browser pass is a release gate; init failure must be legible |
| 4 | `computeWifiProvisionMarker` tests deleted | Accept | Restore all of them |
| 5 | NODE_STATUS tests lost | Accept | Restore against the package |
| 6 | 5 s per-compile budget unenforced | Accept | Enforce across the pre-pass, not per hook |
| 7 | Stale preview can overwrite a newer one | Accept with design change | Serialise compile requests (see 8) |
| 8 | One timeout fails unrelated hooks | Accept with design change | One compile at a time; timeout rejects only that compile |
| 9 | `ts_wifi` test runs a hand copy | Accept | Byte-compare test now; shared path later |
| 10 | "No loss" asserted, not evidenced | Accept | Restore behaviour tests and record deliberate drops |
| 11 | Spec is draft while six nodes build on it | Accept | Mike reviews the spec before more nodes |
| 12 | Spec example contradicts its secret policy | Accept | Fix example and §2 wording |
| 13 | Decision says TS adapter; code runs Python hooks | Disagree about the defect | Code is right; update the decision |
| 14 | Interpreter provenance | Accept, upgraded | Pinned rebuild now; mainline port before release (§ below) |
| 15 | CLI hook runner uncontained | Accept | Record as a project rule; block CLI custom-node loading on containment |
| 16 | Misleading `ts_wifi` test name | Accept | Rename |

## 1. Worker init can hang silently

Accepted. `ensureWorker()` resolves on `ready` and has no rejection path for a worker that never starts. The fix:

- An init budget (e.g. 10 s, separate from the 1 s per-hook budget — the wasm fetch and compile are not the hook's
  time).
- `worker.onerror` and `worker.onmessageerror`, both rejecting with a `CompileError` naming the package and the
  underlying message.
- If the wasm fetch fails (`init-error` already exists), reject every waiter and do not retry inside the same
  compile.
- On any of these, the editor shows the existing `COMPILE ERROR:` line rather than a pending preview.

This is the same class as the CLI's missing containment, but visible: a hang in the editor is a stuck tab, not a
crash.

## 2. CLI and editor build different hook contexts

Accepted. The CLI calls `runCompileHooksSync` with no options, so `ctx.target` is `null` and `flow.configs` keeps
secrets. Proposed shape:

- A single `compileHookOptions(target)` helper (where it lives is a layering question; the CLI may import `app/`,
  `node-library` may not).
- `redactConfig` comes from the same `visibleConfigProperties` that `main.ts` uses today; extract it from `main.ts`
  into a module both callers can import rather than copying it.
- `checkFlowText` passes its resolved `target` (it already resolves one for pin checks).
- A test that compiles one flow through both paths and asserts the hook context is identical (minus the
  compile-only fields).

The review is right that this is a correctness bug, not a cosmetic one: the same package can pass one path and fail
the other.

## 3. The browser path is a release gate

Accepted. Two separate things:

- **Finding 1** makes a failure legible; that is necessary but not sufficient.
- The real-browser pass itself. The agent environment has no browser, so this is a CI or Mike task. Proposed minimum:
  open the editor, compile/deploy a flow with `wifi_status` (hook + worker + wasm fetch), one with no hook (worker
  never created), and one where the wasm 404s (clear error, no hang). A Playwright smoke test is possible but adds a
  dependency; recommend the manual pass first and a CI test only if it earns its keep.

A release should not go out with core WiFi flows depending on an untested path.

## 4–5. Restore the deleted tests

Accepted, both. Concretely:

- `computeWifiProvisionMarker`: restore the previous cases (unmanaged + reprovision flag, no WiFi node, more than
  one config, non-unmanaged security, marker clearing). These decide whether a board reopens its captive portal; a
  one-test replacement is not enough.
- `wifi_status` NODE_STATUS: restore connected/disconnected, no repeat on an unchanged poll, and re-report on a
  gateway change (the documented harmless redundancy). The package still calls `report_status`; the tests were lost
  in the rewrite, not made obsolete.

This is the concrete form of finding 10: behaviour tests deleted without a record.

## 6. Enforce the per-compile budget

Accepted. The spec's 5 s `compileWallMs` is declared and never read. Hooks currently run serially, so a flow with
many hooked packages can exceed it. Proposed: measure from the start of the pre-pass, and stop with a
`CompileError` naming the node that was running when the budget expired; the worker is terminated. Keep the
per-hook 1 s as the tighter bound; the compile budget is the backstop.

## 7–8. Overlapping compile requests

These are one problem, and the obvious patches conflict:

- Finding 7: an older compile can finish after a newer one and overwrite the preview.
- Finding 8: a timeout terminates the worker, which rejects every pending request, including another compile's.

Rejecting a single request without terminating the worker is not possible — the interpreter is synchronous and
stuck. Therefore the fix is not "scope the rejection"; it is **do not have overlapping hook work**:

- A single-flight queue in the runner: one hook run (or one compile's hooks) at a time; a second compile waits.
- `refreshPreview` keeps a generation number; when a compile completes, only the newest generation writes the
  preview, warnings and line ranges. Deploy awaits its own compile as today.
- On a timeout, only the in-flight run is rejected (there are no others), the worker is terminated, and the next
  queued run gets a fresh worker.

Serialising costs latency on rapid edits but removes both classes of misleading state. Worth stating explicitly in
the spec's fault section: "a timeout fails the compile that caused it, never another".

## 9. `ts_wifi` test copy

Accepted. The pymock copy is identical today with nothing enforcing it. Two options:

- Byte-compare `test/fixtures/pymock/ts_wifi.py` with the vendor file in a test (cheap, keeps the isolated
  PYTHONPATH), or
- Put the vendor directory on the test PYTHONPATH and delete the copy (one source of truth; touches every network
  test's env).

Recommend the byte-compare now, the PYTHONPATH move when the test helpers are next touched.

## 10. Evidence for "no loss"

Accepted. The restated parity test is "no loss of on-device behaviour; moved or dropped compile checks recorded".
Deleted behaviour tests are the same kind of record. Proposed:

- Restore 4/5.
- For each converted node, add a short list in the conversion note of the tests that were consolidated vs dropped,
  and why. Example: `wifi_status`'s gateway-change re-emit was dropped, not consolidated — restore it.
- A test-count delta is not evidence either way; the behaviour list is.

## 11. Spec review before more nodes

Accepted. The direction was approved; the contents were not. Six nodes now depend on the context shape, so the
spec is frozen in practice. Proposed: Mike reviews `SPEC.md` (with finding 12 fixed first) before `ts_mqtt` or
`http-in` land. The review can be narrow: field names, the secret shape, the limits, and `setupKey`'s removal.

## 12. Spec example and wording

Accepted. The worked example reads `ssid` from `ctx['flow']['configs']`, which is redacted; it must read it from
`ctx['referencedConfigs'][<id>]`, as the real hooks do. §2's table calls `node.properties` "resolved" while §1 says
raw — make it raw everywhere, with a note that config references arrive by id.

## 13. Decision vs code on built-ins

Disagree about where the defect is. The code is right: core packages run their Python hooks through the same
sandbox as user packages, which exercises the user path and makes "copy a built-in" include its hook. The decision
text (`package-compile-hooks-scoping.md` §10 item 3) still says built-ins adopt the context through a TypeScript
adapter. Proposed: update the decision to say that core packages' hooks are Python, run through the same runner,
and that TypeScript hooks remain for the residue (`function`, `gui_*`) and any node whose hook needs editor-side
facilities. No code change.

## 14. Interpreter provenance and upstream risk

Accepted, and it is bigger than the review states. Facts as of this reply:

- The vendored wasm is from `micropython-wasm` 0.1a2, built from MicroPython **PR #13676**, which is still
  **open, last touched 2026-06-07**. It reports `v1.27.0-preview.225.g3f6d144cb8`.
- The wasm is hash-recorded and byte-identical to the wheel, but not built here, and the build inputs (wasi-sdk,
  Binaryen) are not pinned.
- Because the network nodes are packages, **every WiFi flow now needs this wasm to compile**. That makes it a
  release-critical dependency, not a spike artifact.

Proposal, two stages:

1. **Now:** rebuild from the pinned MicroPython commit `3f6d144cb8` with pinned wasi-sdk/Binaryen versions, add a
   build script + README recipe, commit the artifact with its hash, and add a CI check that rebuilds or at least
   verifies the hash and runs the worked example. This keeps the shim and runner unchanged and removes the
   "unknown artifact" problem. It still depends on the unmerged patch set, so a MicroPython bump means rebasing
   #13676.
2. **Before a user release:** spike mainline `ports/webassembly` (Emscripten). It is maintained upstream and
   buildable from a release tag; it costs a different JS API (the WASI shim goes away) and a size/latency
   measurement, but removes the unmerged-patch dependency. If it is acceptable, switch. If not, decide explicitly
   to own the WASI patch.

The alternative — core hooks in TypeScript, sandbox only for user packages — is rejected unless both stages fail:
it buys release safety by giving up the "copy a built-in" parity property this work exists for.

## 15. CLI containment rule

Accepted. The synchronous runner is acceptable while only trusted core hooks run in the CLI. Proposed: add to
`AGENTS.md` (or `editor/AGENTS.md`) a rule that *CLI custom-node loading must not land without hook containment* —
the CLI is the AI-agent check path, where a hang is invisible. Until then, `check-flow.ts` carries a comment saying
so. This is a project-rule change, so it is a proposal for Mike, not a unilateral edit.

## 16. Misleading test name

Accepted. `ts-wifi.test.ts`'s "does not connect for an open network with no password" asserts that it does connect;
rename to "connects with an empty password for an open network".

## Proposed order for the next cycle

1. 1, 2 (code), 4, 5, 9, 12, 13, 16 (tests/docs) — the safe batch.
2. 7/8 together (single-flight queue + generation guard), then 6 (compile budget).
3. Real-browser pass (3), with the failure modes from 1 tested.
4. Mike's spec review (11, 12).
5. 14 stage 1 (pinned rebuild + CI), then stage 2 (mainline port spike) before release.
6. 15's rule, then `ts_mqtt` and the remaining nodes.

The hardware pass (ESP32 + MQTT, RP2040) is still owed for everything converted and is independent of the above.

## Questions for the next review

1. Is single-flight the right answer to 7/8, or is per-request worker isolation worth the extra worker cost?
2. Does 14 stage 2 (mainline Emscripten) belong before or after `ts_mqtt`? I lean before any release, after the
   remaining nodes are converted, so there is one port.
3. For 2, is a CLI→`app/` import of the redaction helper acceptable under the layering rules, or should the helper
   move down to a neutral module?
4. For 11, is the spec review in scope for the next cycle, or should the converted nodes be treated as the review?

## What this reply does not claim

No code has been changed in response yet. The test counts in the review are accurate for `48ea9ff`. The browser
and hardware passes have not happened. The spec remains a draft.
