# Review: the reply, a browser smoke test, and the remaining design questions

2026-10-19. Reviewer: Claude, in a session with Mike. **Status: review** -- findings and recommendations, no
decision taken. Follows `2026-10-19-compile-hooks-response.md` (the review) and
`2026-10-19-compile-hooks-response-reply.md` (the reply). Repo state reviewed: `f5eb6fe`.

Covers four things Mike asked for in the same session: a review of the reply, a real-browser smoke test, the "two
compilers" concern, and recommendations for the remaining blocked nodes (two-faced `ntp`, the shared MQTT client,
`http_in`, and the rest).

## 0. A correction to the earlier review

Mike let the compile-hook implementation go ahead before the spec was reviewed **deliberately**, so the review would
have concrete code to examine, and accepted the risk to the investment. Finding 11 of the earlier review ("the spec
is a draft while six nodes build on it") is therefore withdrawn as a process criticism: it was a chosen experiment,
not drift. It paid off -- most of the findings in both reviews only showed up in running code.

What remains of it is a release gate, not a process point: the built-in network nodes' generated WiFi setup changed
(`ts_wifi`) and that is on `main`. The browser and hardware passes should happen before the next release, so the
experiment does not ship by accident.

## 1. The reply

**Verdict: approve the plan, with the amendments below.** The reply accepts what was right, explains the two places
where the obvious fix is wrong, and claims nothing it has not done.

Where the reply improves on the review:

- **Findings 7/8.** The review suggested scoping a timeout's rejection to the compile that caused it. That is not
  possible: a stuck hook can only be stopped by terminating its worker, which takes every pending request with it.
  "Never overlap hook work" is the correct fix.
- **Finding 14.** Right to upgrade it: every WiFi flow now needs the interpreter to compile, so its provenance is a
  release question. The two stages (pinned reproducible rebuild now; a mainline `ports/webassembly` spike before a
  release) are sound, as is keeping "copy a built-in includes its hook" unless both fail.

Amendments:

1. **A browser is available.** The reply says the agent environment has none; the reviewer's cloud environment has
   Chromium, and Playwright is already a CI dependency through the docs-screenshot workflow
   (`docs/screenshots/requirements.txt`). The smoke test now exists (§2); the reply's three proposed cases are
   covered, plus two more.
2. **Single-flight needs "latest wins".** A plain queue fed by a preview that recompiles on every change builds a
   backlog. At most one compile running and one waiting, a newer request replacing the waiting one, plus the
   generation guard on the preview.
3. **Finding 13 is agreement, not disagreement** -- the review already said the code was right. But the proposed
   decision text keeps TypeScript hooks for "any node whose hook needs editor-side facilities". That clause is
   open-ended and lets a second producer back in. Name the residue (`function`, `gui_*`) and require any further
   exception to be recorded when it is made.
4. **Finding 2's helper.** The CLI already imports `app/rete/nodes.js`, so layering is not the real issue. Still move
   the redaction helper to a neutral module both callers import, and keep its allowlist semantics (only declared
   config fields are visible): that hides secrets by default.
5. **The setup-dedup key was dropped without a record.** `package-compile-hooks-scoping.md` §3 offered an optional
   setup-dedup key; the spec does not have one and nothing records the change. The reply mentions "`setupKey`'s
   removal" in passing. Record it as a decision -- presumably that shared device libraries (`ts_wifi`, next
   `ts_mqtt`) replaced it.
6. **The ESP32 + MQTT hardware pass comes before `ts_mqtt`, not alongside.** The reply calls it independent, but the
   built-in network nodes' generated WiFi setup already changed and is pushed, and MQTT is where the WiFi-flapping
   bug lived. Test the current state on a board before `ts_mqtt` changes the same path again.

The reply's questions:

1. Single-flight vs per-request worker isolation: single-flight with latest-wins coalescing. A worker per request
   costs cold starts and buys nothing coalescing doesn't.
2. Mainline interpreter spike before or after `ts_mqtt`: after the remaining conversions, before any release. The
   hooks are Python either way and the runner interface hides the interpreter, so the conversions don't depend on
   which one wins.
3. CLI importing the redaction helper from `app/`: move it to a neutral module (amendment 4).
4. Spec review this cycle, or treat the converted nodes as the review: this cycle. Six conversions exercise the
   interface; they don't review it, and `ts_mqtt` would make seven.

## 2. Browser smoke test

`tools/compile_hook_smoke.py` (fixtures in `tools/compile_hook_smoke/`). It starts `thingstudio-backend` on a spare
port with a throwaway data folder holding one test custom node, opens the built editor in headless Chromium, loads
fixture flows through the file-open fallback, and checks the source preview. No board.

```
cd editor && npm run build && cd ..
pip install ./backend -r docs/screenshots/requirements.txt && playwright install chromium
python tools/compile_hook_smoke.py            # --chromium PATH, --wait SECONDS
```

Results at `f5eb6fe`, Chromium 141 (identical across three runs):

| Case | Result | Detail |
|---|---|---|
| `hooked` -- `wifi_status` flow | PASS | compiled in 0.13 s; interpreter fetched once |
| `no-hook` -- blink flow | PASS | no Worker created, no interpreter fetch |
| `wasm-404` -- interpreter missing | PASS | legible `COMPILE ERROR ... could not load ...` in 0.06 s |
| `worker-404` -- Worker script fails to load | **FAIL** | hangs: no result in 12 s, preview never updates |
| `runaway` -- user hook loops forever | PASS | stopped at 1.07 s, error names `smoke/spin` |
| `recovery` -- good flow, same tab, after `runaway` | **FAIL** | `wifi_status ... timed out after 1000 ms` |

What it shows:

- **The central risk is retired.** Containment of a runaway hook works in a real browser, and a missing interpreter
  fails legibly.
- **Finding 1 is narrower than the review said.** The wasm-404 path is handled (the worker's `init-error`); only a
  Worker script that fails to load hangs, because nothing listens for `worker.onerror`.
- **Finding 8 is user-visible.** After a runaway hook, the next good flow is blamed for a timeout it did not cause,
  then recovers on a later compile. Probing showed overlapping preview compiles from the flow load are the cause.
- **Finding 7 was observed** (not a scripted case, because it isn't deterministic): one re-open left "debug is
  disconnected from any source" -- a half-loaded graph's result -- on screen for 3 s after the real compile.

The two FAILs are the bugs; the test asserts the intended behaviour. Add it to CI (the docs workflow already
installs Playwright and Chromium) once findings 1 and 7/8 are fixed, so it goes in green. Not covered: the deploy
path, Firefox/Safari, and CSP when the editor is served from a non-default host.

## 3. The "two compilers"

There is one compiler (`compile.ts`). While the conversion is unfinished, a node's compile-time logic can come from
three places: TypeScript codegen, descriptor data, or a Python hook. That is survivable as a transition. The
discomfort is justified in two concrete places:

- **The WiFi rules exist twice.** In TypeScript (`resolveFlowWifiCredentials`, used by `mqtt_publish`,
  `mqtt_subscribe`, `ntp`, `http_in`) and in Python (`WIFI_DERIVATION`, used by the five converted network
  packages). A mixed flow is checked by both; only `ts_wifi`'s on-device `ValueError` catches a disagreement. That is
  the "format implemented in more than one place" the `AGENTS.md` architecture rule says to fix in the change that
  names it.
- **Two hook runners** (the editor's worker, the CLI's synchronous one) build different contexts (finding 2).

Recommendations:

1. **Finish the network family as one unit, next**, so the TypeScript WiFi rules can be deleted. Until then, a test
   that runs both rule sets over the same fixture flows and asserts the same accept/reject and derived values.
2. **Make the transition one-way**: a registry test that fails if a node defines TypeScript `codegen*` hooks and is
   not on a named list -- the residue (`function`, `gui_*`) plus a not-yet-converted list that only shrinks. No new
   TypeScript node can appear, and the list is the progress measure.
3. **One context builder** for the editor and CLI (finding 2).

End state: one compiler, one node path (packages), hooks in one language, TypeScript only for the named residue.

## 4. The remaining blocked nodes

With the compile hook available, every built-in outside the named residue converts without new descriptor
vocabulary:

- **`ntp` (two-faced).** Allow `eventSource: true` on a `sink` in the package format: `.node.py` defines `run()` for
  the input face and `wait()`/`emit()` for the output face. Easier than for built-ins: both faces live in the same
  per-instance closure, so they share state through `nonlocal` with no workaround. Same rule as built-ins: not on a
  transform. Don't split `ntp` -- that breaks saved flows for nothing. Put it in the custom schema too; user-written
  GUI-style nodes will want it.
- **`mqtt_publish` / `mqtt_subscribe` (shared client).** A `ts_mqtt` library keyed by broker, the `ts_wifi` pattern:
  it owns the connection and status reporting, nodes register subscriptions, cleanup through
  `runtime.register_cleanup`, and it relies on the per-deploy `forget_modules()` reset `ts_wifi` already depends on.
  Hardware pass on ESP32 + MQTT before (amendment 6) and after.
- **`http_in` (sibling scan + shared server).** Neither of the briefing's options as written. The hook already sees
  every node, so the duplicate `(method, path)` check is the hook scanning `ctx.flow.nodes` -- no `nodesOfType` field
  kind needed. The server goes in a shared `ts_http` library: each node registers its route during setup, and the
  library starts listening in a spawned task after setup has run, which settles registration order. Keeps the
  built-in's compile-time route validation and inlines no sibling properties.
- **`adc`** is unblocked now: its hook reads `ctx.target` and `ctx.flow.nodes`.
- **`touch_i2c`** is unblocked: the I2C bus config has no secrets, so the hook follows the panel's bus reference
  through `ctx.flow.configs`; claims go in the result. No spec change.
- **`display_spi`**: the hook computes geometry (MADCTL, stride) as constants; the viper loops stay in `.node.py`.
  Needs a hardware pass.
- **`inject`, `startup`, `variable_get`**: the agreed port-type data form.

## 5. Suggested order

Merging the reply's order with the amendments:

1. The reply's safe batch (1, 2, 4, 5, 9, 12, 13, 16), with amendment 4 for finding 2.
2. Findings 7/8 together (single-flight, latest-wins coalescing, generation guard), then 6 (the compile budget).
3. The smoke test green, then into CI.
4. Mike's spec review, including a recorded decision on the setup-dedup key (amendment 5).
5. The ESP32 + MQTT hardware pass on the current state (amendment 6).
6. The network family as one unit -- `ts_mqtt`, two-faced `ntp`, `http_in` -- then delete the TypeScript WiFi rules;
   the residue-allowlist registry test lands with the first of these.
7. `adc`, `touch_i2c`, then `display_spi` with hardware.
8. Interpreter stage 1 (pinned rebuild) any time; stage 2 (mainline spike) before a release.
