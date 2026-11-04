# User guide editing plan

Status: plan, 2026-11-01. Executes `reviews/2026-11-01-user-guide.md` (including its second-pass section).
Mike accepted the second-pass points and asked for this plan, a regression-mitigation strategy, and a model
recommendation. Nothing here is decided until Mike says so; decisions land in `decisions/` as usual.

## Regression mitigation: a docs style lint with a shrinking baseline

The problem: style rules enforced only by review passes regress between passes (the `debugging.md` opening came
back after being removed on 2026-10-11). The project already enforces its other boundaries mechanically;
the checkable subset of the style guide gets the same treatment.

- **`tools/docs_lint.py`** -- Python stdlib only, so no new third-party dependency and the pinning ledger is
  untouched. Runs in seconds. Local: `python3 tools/docs_lint.py`.
- **Rules (start set; each maps to a cross-cutting finding, all near-zero false positives):**
  1. Page-describing opening: "this page" / "this section" in the opening paragraph (C1). Widened from the first
     sentence: the review's own examples (`boards.md`, `nodes/index.md`) say it in the second.
  2. UK spellings outside code spans and fenced blocks: colour, catalogue, recognis\*, grey\*, centre, behaviour
     (C2). Code stripping makes `neopixel`'s `'colour'` payload key a non-issue.
  3. Plans and internal references in `docs/user-guide/`: `working-notes` paths, "coming soon", "next to be
     written", "more are coming", "work in progress" (C4). `sensor-display.md`'s work-in-progress note (Mike's
     remark 5) is a deliberate baseline entry.
  4. The same `**term**` twice in one Properties section (C5.5).
  5. A sentence of eight-plus words repeated verbatim in one file, code stripped (C2's repeated WiFi sentence).
  6. Trailing whitespace; more than one consecutive blank line (several "source only" findings).
- **Baseline ratchet, not Mike.** A checked-in `docs/style-lint-baseline.json` lists every current violation as
  `file / rule / snippet`. The lint fails on (a) any violation not in the baseline -- a regression or a new
  instance -- and (b) any baseline entry that no longer violates -- forcing the baseline to shrink as fixes land
  and never grow silently. Adding an entry is a hand-edit visible in review; CI failing is the enforcement.
- **CI:** one `docs-lint` job in `.github/workflows/ci.yml` (setup-python, stdlib only, no pip installs), running
  on every push/PR like the editor job. Not `docs.yml`: that one only fires on main and deploys.
- **New rules land only with the fixes that make them pass** -- the project's "update in the same change"
  convention applied to the lint, so it is always green on main.
- **Deliberately not checked:** voice, chattiness, repetition of ideas, word counts. Judgment stays with editing
  sessions and future reviews.
- Approved by Mike, 2026-11-01: the AGENTS.md line and the ci.yml job land with the lint in phase 0.

## Phases

Each phase ends green: `python3 tools/docs_lint.py`, `mkdocs build --strict`, the internal-link check, and a
commit prompt. Findings are quoted from the review, not re-derived -- sessions act without re-reading it.

### Phase 0 -- open facts + the lint (one session, strong model)

- Resolve the open fact-checks against editor/runtime source and append the answers to the review: C5.3 (panel
  vs card label; cell grid vs row/column tree -- which the editor actually implements), the [Fact?] on `topic`
  being required, C5.6's install paths against the installer scripts, the full `report_status` node list for
  `working-in-the-editor.md` finding 4, the `http in` methods claim.
- Write `tools/docs_lint.py`, generate the baseline, add the ci.yml job, propose the AGENTS.md line.
- Gate: CI green with the baseline covering every current violation.

Phase 0 done, 2026-11-01. Fact-check answers are the last section of the review. `tools/docs_lint.py` and
`tools/test_docs_lint.py` are written; `docs/style-lint-baseline.json` holds 38 violations; the `docs-lint` job is in
`ci.yml`; the AGENTS.md line is in. Notes for the editing phases:

- Rule 6 reports as two ids, `trailing-whitespace` and `blank-lines`.
- Rules 4 and 5 start with one and zero baseline entries (`display-spi.md`'s `palette`; no verbatim repeated sentence
  exists today, the WiFi sentence on the network pages differs between Properties and Behavior).
- Phase 3's work-in-progress note on `sensor-display.md` trips rule 3: add its baseline entry by hand in that change.
- The lint skips HTML comments, so phase 4's commented-out modal section in `gui.md` stays clean.
- Phase 1's examples-folder wording and phase 2's `topic` fix use the review's phase 0 answers, not the earlier guesses.

### Phase 1 -- quick fixes (review order item 1)

Installation details (remark 1, Remove heading, `~/.thingstudio` reset note); getting-started pointer; Installing
MicroPython (dialog labels, the three "further down" lines, step 4 split); editor-tour and working-in-the-editor
openings; first-flow ("Next, pick:", the state paragraph, the example's location); custom-firmware contradiction
(C5.4) and repeated MemoryError sentence; debugging.md's "a Thingstudio image" and "Image file" labels. Delete
baseline entries as they are fixed.

### Phase 2 -- what the tester hits (review order item 2)

Gap 1 (MQTT-unreachable troubleshooting entry, linked from both MQTT node pages); C6 memory home in debugging.md
(points a-d from the review) with the FAQ trimmed to one-line answers linking it; Gap 3 (runtime-by-accident);
known finding 4 on `coming-from/node-red.md`; the Unmanaged-MQTT line on `wifi-provisioning.md`. This phase holds
the most judgment: apply second-pass point 2 (one attributing clause per refusal) while stripping the rest of C2.

Additions from discussion #5 (clharting, CYD on Ubuntu, 2026-10-27..11-01):

- Gap 1's entry also covers the **runtime `wifi status 202` / "Wifi Internal State Error" variant** -- the
  wifi-status node and MQTT fighting over the interface (the existing debugging.md entry is deploy-scoped; his
  was a running flow). Advice: the wifi status node defers to MQTT by design; if the fight shows, remove the
  wifi status node.
- **"Where do I go for support"**: the user guide never names GitHub Discussions (he said so). One pointer in
  `faq.md` and one in Getting started.
- **Share the flow file, not the compiled output**: he pasted compiled Python containing his real WiFi password
  (the compiled output embeds resolved credentials). FAQ entry: share the `.flow.json` (File -> Save), never the
  console's compiled source. Product-side warning in the compiled-source view is Mike's call, not docs.

Phase 2 done, 2026-11-01, including the discussion #5 additions above (done in a second pass, once they had been
merged in). Notes for later phases:

- The memory home is two places on purpose: `debugging.md` "Memory" says what the `[memory]` line shows and which
  figure matters; "MemoryError or a library that won't load" keeps the recovery steps, because the editor links to
  that heading (`DEPLOY_MEMORY_DOC`) and a reader arriving from a failed deploy wants the steps. The FAQ's memory
  answers are one or two sentences linking them.
- The lint's repeated-sentence rule ignores sentences starting "See " (a cross-reference repeated across FAQ
  entries tripped it).
- The MQTT node pages now have a one-line `## Errors` section; phase 5 moves their error text there.
- The style guide has the one-attributing-clause rule ("A refusal says it is deliberate, once").
- The `wifi status 202` variant is a sub-entry of "MQTT broker unreachable". Its first two checks (credential, then a
  `wifi status` node beside MQTT nodes) follow the plan's advice; the source shows MQTT owning the WiFi join in such a
  flow (`ts_wifi.ensure_station`, `mqtt_as` README), but nothing in it proves the `wifi status` node is the cause.
  The wording was not checked against discussion #5, which wasn't readable from the sandbox.
- Support pointer: FAQ top entry and a "Getting help" section on Getting started. Sharing: FAQ entry second.

### Phase 2a -- the sample-scavenger path (discussion #5 evidence; tester-ready's majority profile)

The scavenger's surface exists unwired: 8 shipped example flows forming an accidental progression (blink ->
two-more-blinks -> http-blink -> basic-http-request -> basic-mqtt -> bmp280 -> gui-touch -> gui-headliner),
referenced from 5 pages, no index, layout-tested but not compile-tested.

- **Examples page in the user guide** -- the scavenger's home. One entry per shipped flow: what it does, nodes it
  uses, where the folder is (subsumes Gap 4), and 2-4 "try changing this" pointers each landing on a node page.
  **Leads with File -> Open...** -- handed the file, he replicated it from a screenshot instead ("load, don't
  copy"). A map, not steps. Cross-link `ai-authoring.md` (generate-then-modify is the same learner).
- **Compile-check every `examples/**/*.flow.json` in CI** -- generalize the `gui-trend.test.ts` pattern
  (`compileWithHooks` over one example) to all of them. They get a layout check today; a broken example is a
  silent failure at the scavenger's front door.

Phase 2a done, 2026-11-02. `docs/user-guide/tutorial-flows.md` ("Example flows", in the nav under Tutorials) leads with
File -> Open..., has one entry per shipped flow (what it does, what to change first, each pointer landing on a node page),
and now owns the examples-folder table; Installation details keeps one sentence and a link, and every other link was
updated. `editor/test/examples-compile.test.ts` runs `checkFlowText` and the editor's mpy-cross syntax check over every
`examples/*.flow.json` (before it, only `blink` and the GUI flows were compiled). Run in a cloud clone with the docs tests:
44 passed; a deliberately broken copy of an example fails it. Notes:

- `examples/README.md` was left as it is (it is the folder's own index and ships with the files). It says
  `basic-http-request` "takes a value out of the answer"; the flow is `inject -> http request -> debug`, and the page says that.
- `gui-headliner-sensor-freenove-s3-4in.flow.json` contains the hidden `gui navigator` node. The page doesn't mention it
  (remark 6); phase 4 removes it from the example or the tutorial.
- The "try changing" pointers were checked against the node pages' property labels, not run on hardware.

### Phase 3 -- tutorials (review order item 3)

Rewrite `blink-from-your-network.md` with a Build the flow section (facts from the review's item 1, template from
`first-flow.md`); voice pass on `two-more-blinks.md`; tutorials index without plans; the work-in-progress note on
`sensor-display.md` (remark 5). Then Gap 2, the MQTT tutorial, as its own session.

Requirements added 2026-11-01 (scavenger wiring, tester-ready 2026-10-30): the success-point pointers stay -- the
review's C7 renames the "Next, pick:" heading, it does not remove the 2-3 links under it; the MQTT pointer lands
on both the Gap 2 tutorial and `examples/basic-mqtt.flow.json`. Every tutorial download gets a "load, don't
copy" line (File -> Open...), from discussion #5.

**Gap 2 spec (Mike, 2026-11-01): "Blink from anywhere" -- the two-direction loop on one board.** The same LED as
Blink from your network, now reachable via a broker. Two halves: (1) board to world -- an `inject` node
(live-fire, no extra hardware) publishes to `thingstudio/<random>/button`, watched with `mosquitto_sub` or a
phone MQTT app (the mobile-data moment is the payoff); (2) world to board -- `mqtt subscribe` on
`thingstudio/<random>/led` to `gpio out`, driven from `mosquitto_pub`. Optional sidebar: a wired
button/`eswitch` replacing the inject. Teaches: broker config node, topic design with a random prefix, publish
vs subscribe; the public-broker caveat is taught by shape (`test.mosquitto.org`, trivial payloads, one honest
sentence that anyone can subscribe). "Nothing arrives?" links the Gap 1 troubleshooting entry. Same flow grows
from tutorial 3's. Left out: retain, LWT, local-broker setup beyond one end pointer, anything GUI. A GUI "first
screen" tutorial stays blocked on the sensor-display rework (remark 5); custom-node and neopixel/ADC/encoder
tutorials come later.

Phase 3 done except Gap 2, 2026-11-01. `blink-from-your-network.md` has a Build the flow section; `two-more-blinks.md`
had its voice pass; the tutorials index has no plans and lists three tutorials; `sensor-display.md` carries the
work-in-progress note, whose baseline entry was added by hand. Every tutorial download says to open the file, not
copy it. Gap 2 has its brief (the spec above); it is its own session. When it lands, point "Next" on
`blink-from-your-network.md` at it as well as at `examples/basic-mqtt.flow.json`, and add it to the tutorials index.

Gap 2 written, 2026-11-02, not yet run on a board. `tutorials/blink-from-anywhere.md` and
`examples/blink-from-anywhere.flow.json` follow the spec above: `inject` publishes to `thingstudio/<number>/button`,
`mqtt subscribe` on `.../led` feeds a `function` into `gpio out`, a `debug` shows what arrives, `test.mosquitto.org`
with a number of the reader's own, and "Nothing arrives?" linking the broker-unreachable entry. It starts a new flow
rather than growing tutorial 2's: that one has `http in` and `wifi status`, and the debugging entry says a `wifi
status` node beside MQTT nodes can fail the join, which nothing here could test. The example ships with the placeholder
`change-this-number` on purpose (a shared number would let strangers switch each other's LEDs); the page and the
Examples entry say to replace it. The function node is needed because `gpio out` uses Python truthiness, so the text
`off` would count as on. Compile, layout and syntax checks pass (the examples test covers it). Wiring done: nav, tutorials
index, "Next" on Blink from your network, the Examples page, `examples/README.md`.

**Tester-ready bar: phases 1-3 (including 2a).** Phases 4-7 are tractable with testers running.

### Phase 4 -- contradictions (review order item 4)

`node-conventions.md` vs `custom-nodes.md` (C5.1); `gui.md` -- merge `gui-layout.md` (remark 7), remove
`gui navigator` (remark 6), comment out the modal flow-file section for future inclusion (Mike, 2026-11-01), one
layout model from phase 0's facts; `display-spi.md`'s double palette entry.

Phase 4 done, 2026-11-02. `node-conventions.md` matches `custom-nodes.md` (ports follow the kind; a source can be
event-driven or run once; a sink can be two-faced). `nodes/gui.md`: one layout model (the cell grid, **panel**);
`gui-layout.md` merged into "Laying out pages" and deleted (nav entry and three links updated); `gui navigator` removed;
the `gui modal` bullet and "Modals in the flow file" commented out; sections in the review's order; Color folded into
Themes; the history and internal wording and the UK spellings gone. `display-spi.md` has one palette entry. Baseline
29 -> 11. Notes:

- The `gui modal` bullet is commented out as well as the section (its layout can only be written in the flow file).
  The review offered "one line saying it isn't laid out in the editor" instead; Mike to confirm which.
- `sensor-display.md` still mentions `gui navigator` (remark 6); the page is parked (remark 5), so it was left.

### Phase 5 -- node pages to layout and voice (review order item 5)

C2/C3 passes in the review's batches: network pages, then general, then hardware. Each page's findings are its
checklist; the lint plus `mkdocs build --strict` are the mechanical gate. Requirement added 2026-11-01: every
Wiring example is copy-pasteable -- the node page is the scavenger's document when an edit breaks, not the
tutorial.

Batch 1 done 2026-11-04 (for Mike's review before the rest): `wifi status`, `wifi gate`, `udp receive`, `http request`.
Each now has Properties, Wiring (**Input** / **Output**), Behavior and, where the page has errors, Errors; the repeated
WiFi sentence, the asides and the limitations paragraph are gone, with no facts added or dropped. The one inbound link
that named a moved section (Web Blink, "wifi status") was repointed. Left: network `http in`, `http response`,
`udp send`, `mqtt publish`, `mqtt subscribe`; general `inject`, `timer`, `function`, `change`, `delay`, `filter`,
`journal`, `debug`, `startup`; hardware pages; the BLE pages are newer than the review and need their own check.

Batch 2 done 2026-11-04: `http in`, `http response`, `udp send`, `mqtt publish`, `mqtt subscribe`, checked against
the code, not just reformatted. Facts corrected, not only moved: `udp send` timeout only covers a full send buffer, so
an unreachable IP raises nothing, and `None` sends the text `None` (also for `mqtt publish`); `http in` never reads
a POST body and answers 404 for any other path or method; `http response` doesn't raise on a second reply. Dropped as
unverifiable: `http in` queues same-route requests. Fixed: `mqtt subscribe`'s descriptor claimed the payload is bytes if it
isn't text; the code only decodes it, so the description now says UTF-8 text. A bytes fallback is a later change (runtime bump). The node catalog is now lean (type, ports, defaults, allowed values) and
links to the node pages for meanings.

Batch 3 started 2026-11-04 with `inject` and `timer`, for Mike's review before the other seven general pages.
Checked against the descriptors, `compile.ts`'s source loops and `runtime.py`. Added from the code: how `inject` reads
each value type (`bool` only `true` is true; a whole number is an `int`; empty is `0`); a bad number fails on the
click, not at deploy; the not-connected console line; `timer` sends its first message at flow start and its interval
starts after the chain finishes. New fact: a node error anywhere in a chain ends that chain's task (`_guarded` doesn't
restart it), so the source stops until the next deploy. Mike's review added three style rules (one home for facts
shared by many nodes, quote console messages exactly, defaults on node pages). Facts true of every node moved to their
homes: the chain-stop to `debugging.md` (Reading a node error), "a change reaches the board only with the next
deploy" to `flow-lifecycle.md` (Deploy). Every node page in later batches checks for such facts.

Batch 3 done 2026-11-04: the other seven general pages, `function`, `change`, `delay`, `filter`, `journal`, `debug`,
`startup`, checked against the descriptors, compile hooks and generated code (compile errors confirmed with the CLI).
Defaults added throughout. Corrected: `filter` threshold 0 passes every number, not "any change"; `journal` reads text
and bools as numbers, and `None` is a gap only with seconds per row 0; `timer`/`delay` minimum errors are the generic
`property ... is below its minimum, 1`. Added: `change` names are one top-level key and a missing source copies
`None`; `function` with one output passes a returned list on as the message; `debug` prints Python's repr and its
console line locates the node. Moved to `flow-lifecycle.md` (Deploy): the board restarts its saved flow at boot, and
every start begins nodes afresh except `settings`. Dropped as examples (Page types: examples go in tutorials): the
`change` text flow, the `filter` temperature example, `journal`'s cascade (now a link to A sensor display, which
has it) and its `test-flows/` path.

Follow-ups the same day (Mike): a `timer` or custom-source `intervalMs` must be a whole number (`resolveIntervalMs`
refuses a fraction, which compiled and then failed in `asyncio.sleep_ms()`); what a fork does to a message (first wire
gets it, the others shallow copies) now lives in Editor in depth, Wiring; the BLE pages, descriptors, catalog notes
and the two BLE error strings say "connected device" rather than "phone", since any central can connect. Repaired:
`editor/src/cli/describe.ts` in `ceb25be1` was an earlier draft than the committed catalog and test (tsc failed, three
catalog tests failed); rebuilt so it regenerates the committed catalog exactly.

Typed values (2026-11-04): how `inject`, `startup` and `change` read a typed value now lives in Editor in depth,
Typed values; the three pages link to it.

Batch 4a done 2026-11-04, pin nodes: `gpio out`, `pwm out`, `interrupt`, `eswitch`, `ebutton`, `encoder`, `adc`,
`neopixel`, checked against the descriptors, the vendored drivers (`events.py`, `encoder.py`, `aadc.py`) and the
CLI's clash messages. Defaults added; the per-page "Checked against your board" and "two nodes on one pin" lines are
one Errors line linking What gets checked and Hardware is shared. Corrected: `encoder` settle is a wait after motion
starts (about one message per settle while turning), not "still for settle"; `ebutton` events per action, with and
without suppress, as a table (suppress holds back press and release together, and a press between double click and
long press sends only `release`). Added: `pwm out` fails on any string, even `"0.5"`; `adc` absolute mode keeps
sending while the reading stays on the sense side; `neopixel` list and index edge cases. Open for Mike: `neopixel`
reorders to GRB itself, but MicroPython's `NeoPixel` already writes GRB (`ORDER = (1, 0, 2, 3)`), so red and green
look swapped on a GRB strip; needs a hardware check before any change. `adc` absolute repeat may be a bug rather
than behavior.

### Phase 6 -- structure (review order item 6)

Developer section in the nav (remark 4: check-a-flow, command-line's source-checkout half, From source,
custom-firmware's freeze paragraph); FAQ grouping; `flow-lifecycle.md`'s second half; `boards.md` duplication
with Supported hardware and the folder page.

### Phase 7 -- pictures (review order item 7)

Extend `tools/screenshots.py` for the broker edit form and Install firmware dialog; regenerate the editor tour
shot after v0.11.

## Model recommendation

Available providers checked 2026-11-01 (`opencode-go`, `opencode`).

- **Phases 0-4, 6, 7 (facts, rewrites, judgment, code): `opencode/claude-sonnet-5-5`** ($2/$10 per Mtok). The
  work is prose judgment against a style guide plus source-level fact-checking; Sonnet is the quality/cost sweet
  spot. `opencode-go/kimi-k3.1-pro` ($2/$10) is the equivalent alternative.
- **Phase 5 (bulk per-page passes): `opencode/claude-haiku-5-5`** ($0.1/$0.5 per Mtok), one batch of pages per
  subagent with the review's per-page findings as the checklist. The lint and the strict build are the gate;
  a strong-model pass reviews each batch's diff before commit. ~30 pages of mechanical edits is where the cheap
  model pays; it is not trusted with phases 1-4.
- **Phase 0's lint:** written and tested by the strong model in-session; no subagent (it gates everything after).

## Decisions (Mike, 2026-11-01)

Recorded in `decisions/documentation-process.md`.

1. **Lint in AGENTS.md:** yes -- the project rule lands in the same change as the lint (phase 0): run
   `python3 tools/docs_lint.py` before committing docs changes; new lint rules land only with the fixes that make
   them pass.
2. **`gui modal`:** commented out for future inclusion (HTML comment in `gui.md`), not deleted -- the text
   survives for when modal layout lands in the editor. `gui navigator` stays simply removed (remark 6).
3. **C2 refusal clause:** stands. `debugging.md`/`faq.md` keep one short clause per refusal saying the behavior is
   deliberate; the style guide gets the refinement in the same change as the phase 2 edits.
